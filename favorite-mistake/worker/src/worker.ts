import ccxt from 'ccxt';
import { ethers } from 'ethers';
import { DQNAttention } from './ml/dqn-attention.js';
import { getSentiment } from './ml/sentiment.js';
import { runDexArb } from './strategies/dex-arb.js';
import { applyStealth } from './stealth/index.js';
import { createLogger } from './logger.js';
import { subscribeToTrades, TradeTask } from './orchestratorClient.js';

const logger = createLogger();

const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET,
  enableRateLimit: true
});

const provider = new ethers.JsonRpcProvider(process.env.INFURA_URL);
const agent = new DQNAttention();

const DEFAULT_SYMBOL = 'BTC/USDT';

async function getState(symbol: string): Promise<number[][]> {
  let candles = await exchange.fetchOHLCV(symbol, '1m', undefined, 20);
  if (candles.length === 0) {
    throw new Error(`No candle data for ${symbol}`);
  }
  if (candles.length < 20) {
    const last = candles[candles.length - 1];
    const padding = Array.from({ length: 20 - candles.length }, () => last);
    candles = [...padding, ...candles];
  } else if (candles.length > 20) {
    candles = candles.slice(candles.length - 20);
  }
  const sentiment = await getSentiment(symbol);
  return candles.map(candle => {
    const [, open, high, low, close, volume] = candle;
    return [open, high, low, close, volume, close - open, high - low, volume * close, sentiment, Math.random(), Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
  });
}

async function tradeLoop(): Promise<void> {
  try {
    const state = await getState(DEFAULT_SYMBOL);
    const action = await agent.act(state);
    if (action === 0) {
      await applyStealth('market-buy', async () => {
        logger.info('Simulating market buy order for BTC/USDT');
      }, logger);
    } else if (action === 1) {
      logger.info('Holding position this cycle');
    } else {
      logger.info('Simulating market sell order for BTC/USDT');
    }
  } catch (error) {
    logger.error(`Trade loop failed: ${(error as Error).message}`);
  }
}

async function handleTask(task: TradeTask): Promise<void> {
  logger.info(`Received strategy from orchestrator: ${task.strategy}`);
  switch (task.strategy) {
    case 'dex-arb': {
      const symbol = task.symbols[0] ?? DEFAULT_SYMBOL;
      await runDexArb(exchange, provider, logger, { symbol, threshold: 0.005 });
      break;
    }
    default:
      logger.warn(`Unknown strategy ${task.strategy}`);
  }
}

function startTradeStream(): void {
  const stream = subscribeToTrades(handleTask, err => {
    logger.error(`Trade stream error: ${err.message}`);
    setTimeout(startTradeStream, 5_000);
  });
  stream.on('end', () => {
    logger.warn('Trade stream ended, reconnecting shortly');
    setTimeout(startTradeStream, 5_000);
  });
}

startTradeStream();

setInterval(() => {
  tradeLoop().catch(error => logger.error(`Loop crashed: ${(error as Error).message}`));
}, Number(process.env.TRADE_INTERVAL_MS ?? 60_000));
