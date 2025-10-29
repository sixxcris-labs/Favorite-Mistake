import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TrainingBatch {
  states: number[][][];
  targets: number[][];
}

const FEATURE_SIZE = 15;
const SEQ_LENGTH = 20;

function randomState(): number[][] {
  return Array.from({ length: SEQ_LENGTH }, () =>
    Array.from({ length: FEATURE_SIZE }, () => Number((Math.random() * 2 - 1).toFixed(6)))
  );
}

export async function loadTrainingBatch(modelsDir = path.resolve(process.cwd(), 'models')): Promise<TrainingBatch> {
  const filePath = path.join(modelsDir, 'dqn-lstm.bin');

  try {
    const data = await fs.readFile(filePath);
    if (data.length === 0) {
      return generateSyntheticBatch();
    }

    const text = data.toString('utf8').trim();
    if (!text) {
      return generateSyntheticBatch();
    }

    const parsed = JSON.parse(text) as TrainingBatch;
    return parsed;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return generateSyntheticBatch();
    }
    throw error;
  }
}

function generateSyntheticBatch(size = 64): TrainingBatch {
  const states = Array.from({ length: size }, () => randomState());
  const targets = Array.from({ length: size }, () => [Math.random(), Math.random(), Math.random()]);
  return { states, targets };
}
