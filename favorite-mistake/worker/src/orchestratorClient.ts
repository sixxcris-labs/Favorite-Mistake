import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  ChannelCredentials,
  ClientReadableStream,
  ServiceError,
  credentials as grpcCredentials,
  loadPackageDefinition
} from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

export interface TradeTask {
  strategy: string;
  symbols: string[];
  capital: number;
}

const require = createRequire(import.meta.url);
const googleProtoFiles = require('google-proto-files');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.resolve(__dirname, '../proto/trade.proto');
const includeDirs = [path.resolve(__dirname, '../proto'), googleProtoFiles.getProtoPath()];

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs
});

const grpcObject = loadPackageDefinition(packageDefinition) as unknown as {
  favorite: {
    TradeService: new (address: string, creds: ChannelCredentials) => {
      QueueTrade: (data: unknown, callback: (err: ServiceError | null, response: unknown) => void) => void;
      StreamTrades: (data: Record<string, never>) => ClientReadableStream<unknown>;
    };
  };
};

const target = process.env.ORCHESTRATOR_GRPC ?? 'localhost:50051';
const client = new grpcObject.favorite.TradeService(target, grpcCredentials.createInsecure());

export function subscribeToTrades(
  onTask: (task: TradeTask) => Promise<void> | void,
  onError?: (error: ServiceError) => void
): ClientReadableStream<unknown> {
  const stream = client.StreamTrades({});
  stream.on('data', async payload => {
    try {
      const task = toTradeTask(payload);
      await onTask(task);
    } catch (error) {
      console.error('Failed to process trade task', error);
    }
  });
  stream.on('error', err => {
    if (onError) {
      onError(err);
    } else {
      console.error('Trade stream error', err);
    }
  });
  return stream;
}

export async function queueTrade(task: TradeTask): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.QueueTrade(task, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function toTradeTask(raw: unknown): TradeTask {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid trade payload');
  }
  const payload = raw as Record<string, unknown>;
  const strategy = String(payload.strategy ?? '');
  const symbols = Array.isArray(payload.symbols) ? payload.symbols.map(symbol => String(symbol)) : [];
  const capitalValue = Number(payload.capital ?? 0);
  return { strategy, symbols, capital: capitalValue };
}
