import ccxt from 'ccxt';
import { JsonRpcProvider } from 'ethers';
import winston from 'winston';

export interface DexArbOptions {
  symbol: string;
  threshold: number;
}

export async function runDexArb(
  exchange: ccxt.Exchange,
  provider: JsonRpcProvider,
  logger: winston.Logger,
  options: DexArbOptions = { symbol: 'BTC/USDT', threshold: 0.005 }
): Promise<void> {
  const ticker = await exchange.fetchTicker(options.symbol);
  const binancePrice = ticker.last ?? ticker.close;
  if (!binancePrice) {
    logger.warn(`No price data available for ${options.symbol}`);
    return;
  }

  const pseudoAddress = '0x0000000000000000000000000000000000000000';
  const rawBalance = await provider.getBalance(pseudoAddress);
  const uniPrice = Number(rawBalance) / 1e18;

  const diff = Math.abs(binancePrice - uniPrice) / binancePrice;
  if (diff > options.threshold) {
    logger.info(`Arb opportunity detected on ${options.symbol}: Δ=${(diff * 100).toFixed(3)}%`);
  }
}
