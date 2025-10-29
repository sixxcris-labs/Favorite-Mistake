import { DQNAttention } from './dqn-attention.js';
import { loadTrainingBatch } from './dqn-lstm.js';

async function main(): Promise<void> {
  const agent = new DQNAttention();
  const batch = await loadTrainingBatch();
  const history = await agent.trainBatch(batch.states, batch.targets);
  const finalLoss = history.history.loss?.at(-1);
  console.log(`Training complete. Final loss: ${finalLoss}`);
}

main().catch(err => {
  console.error('Training failed', err);
  process.exitCode = 1;
});
