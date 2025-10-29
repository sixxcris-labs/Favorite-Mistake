import * as tf from '@tensorflow/tfjs-node-gpu';

export interface TradeState {
  symbol: string;
  timestep: number;
  features: number[][];
}

export class DQNAttention {
  private readonly model: tf.LayersModel;

  constructor() {
    this.model = this.buildModel();
  }

  private buildModel(): tf.LayersModel {
    const input = tf.input({ shape: [20, 15] });
    const lstmOutput = tf.layers.lstm({ units: 128, returnSequences: true }).apply(input) as tf.SymbolicTensor;

    let attentionOutput = lstmOutput;
    const maybeMultiHead = (tf.layers as unknown as { multiHeadAttention?: (config: Record<string, unknown>) => tf.layers.Layer }).multiHeadAttention;
    if (maybeMultiHead) {
      const attentionLayer = maybeMultiHead({ numHeads: 4, keyDim: 32 });
      attentionOutput = attentionLayer.apply([lstmOutput, lstmOutput, lstmOutput]) as tf.SymbolicTensor;
    }

    const pooled = tf.layers.globalAveragePooling1d().apply(attentionOutput) as tf.SymbolicTensor;
    const dense = tf.layers.dense({ units: 64, activation: 'relu' }).apply(pooled) as tf.SymbolicTensor;
    const output = tf.layers.dense({ units: 3, activation: 'linear' }).apply(dense) as tf.SymbolicTensor;

    const model = tf.model({ inputs: input, outputs: output });
    model.compile({ optimizer: tf.train.adam(5e-4), loss: 'meanSquaredError' });
    return model;
  }

  async act(state: number[][]): Promise<number> {
    const input = tf.tensor3d([state]);
    const prediction = this.model.predict(input) as tf.Tensor;
    const values = Array.from(await prediction.data());
    const action = values.indexOf(Math.max(...values));
    input.dispose();
    prediction.dispose();
    return action;
  }

  async trainBatch(states: number[][][], targets: number[][]): Promise<tf.History> {
    const inputs = tf.tensor3d(states);
    const labels = tf.tensor2d(targets);
    try {
      const history = await this.model.fit(inputs, labels, {
        batchSize: 16,
        epochs: 5,
        shuffle: true,
        verbose: 0
      });
      return history;
    } finally {
      inputs.dispose();
      labels.dispose();
    }
  }

  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }
}
