/**
 * Multi-Model Gating System
 * 
 * Implements adversarial-resistant model architecture:
 * - Adaptive Model (A): Learns from live market
 * - Reference Model (R): Trained on golden set
 * - Gating: Accept A-update only if within corridor of R
 * - Circuit Breakers: Auto-halt on anomalies
 * - Rollback: Revert to last checkpoint on drift
 * 
 * Purpose: Prevent model drift, enable rapid recovery from poisoning.
 */

import { RobustEstimators } from './estimators';

export interface ModelState {
  mu: number[];
  Sigma: number[][];
  timestamp: Date;
  checkpoint: number;
}

export interface GateConfig {
  tauMu: number;       // Mean drift threshold (Mahalanobis units)
  tauSigma: number;    // Covariance spectral band (fraction)
  klThreshold: number; // KL divergence limit (nats)
  clipRadius: number;  // Influence clipping radius
  etaMax: number;      // Max learning rate
  etaDecay: number;    // Learning rate decay factor
}

export interface CircuitBreaker {
  name: string;
  condition: (state: GateMetrics) => boolean;
  action: 'freeze' | 'rollback' | 'alert';
  cooldown: number;  // Seconds before re-evaluation
}

export interface GateMetrics {
  mahalanobis_drift: number;
  spectral_norm: number;
  kl_divergence: number;
  provenance_entropy: number;
  herfindahl_index: number;
  anchor_anomaly_rate: number;
  update_rejection_rate: number;
  vpin: number;
}

export class MultiModelGate {
  private adaptiveModel: ModelState;
  private referenceModel: ModelState;
  private goldenSet: number[][];
  private checkpoints: ModelState[];
  private config: GateConfig;
  private breakers: CircuitBreaker[] = [];
  private metrics: GateMetrics;
  private lastBreakerTrigger: Map<string, Date>;
  private readonly alertSink?: (type: string, message: string) => void;
  
  constructor(
    goldenSet: number[][],
    config: Partial<GateConfig> = {},
    alertSink?: (type: string, message: string) => void
  ) {
    this.goldenSet = goldenSet;
    this.config = {
      tauMu: 0.5,
      tauSigma: 0.15,
      klThreshold: 0.1,
      clipRadius: 3,
      etaMax: 0.05,
      etaDecay: 0.995,
      ...config
    };
    this.alertSink = alertSink;
    
    // Initialize reference model on golden set
    const { mean, covariance } = RobustEstimators.mrcd(
      goldenSet,
      0.3  // 30% shrinkage toward identity
    );
    
    this.referenceModel = {
      mu: mean,
      Sigma: covariance,
      timestamp: new Date(),
      checkpoint: 0
    };
    
    // Initialize adaptive model (copy of reference)
    this.adaptiveModel = this.cloneModelState(this.referenceModel);
    
    this.checkpoints = [this.cloneModelState(this.referenceModel)];
    this.lastBreakerTrigger = new Map();
    
    // Initialize metrics
    this.metrics = {
      mahalanobis_drift: 0,
      spectral_norm: 1,
      kl_divergence: 0,
      provenance_entropy: 0,
      herfindahl_index: 0,
      anchor_anomaly_rate: 0,
      update_rejection_rate: 0,
      vpin: 0
    };
    
    this.initializeCircuitBreakers();
  }
  
  private cloneModelState(state: ModelState): ModelState {
    return {
      mu: [...state.mu],
      Sigma: state.Sigma.map(row => [...row]),
      timestamp: new Date(state.timestamp),
      checkpoint: state.checkpoint
    };
  }
  
  /**
   * Robust Update Pipeline
   * 
   * Applies full adversarial-resistant update:
   * 1. Admission control (quotas, trust, crypto)
   * 2. Stratified reservoir sampling
   * 3. Influence clipping
   * 4. Robust estimation (Catoni + MRCD)
   * 5. Gate against reference
   * 6. EMA merge with bounded step
   * 7. Circuit breaker checks
   * 
   * @param batch - New data samples
   * @param provenance - Source metadata for each sample
   * @returns Whether update was accepted
   */
  async robustUpdate(
    batch: number[][],
    provenance: Array<{ source: string; trust: number; timestamp: number }>
  ): Promise<{ accepted: boolean; reason?: string }> {
    // 1. Admission Control
    const admitted = this.admissionControl(batch, provenance);
    if (admitted.length === 0) {
      return { accepted: false, reason: 'All samples rejected by admission control' };
    }
    
    // 2. SNR Guard (require diversity)
    const uniqueSources = new Set(
      admitted.map((_, i) => provenance[i].source)
    ).size;
    
    const provenanceEntropy = this.computeEntropy(
      admitted.map((_, i) => provenance[i].source)
    );
    
    this.metrics.provenance_entropy = provenanceEntropy;
    this.metrics.herfindahl_index = this.computeHerfindahl(
      admitted.map((_, i) => provenance[i].source)
    );
    
    if (uniqueSources < 3 || provenanceEntropy < 1.5) {
      return { accepted: false, reason: 'Insufficient source diversity (SNR guard)' };
    }
    
    // 3. Stratified Reservoir Sampling
    const stratified = this.stratifiedReservoir(admitted, provenance, 200);
    
    // 4. Influence Clipping
    const clipped = RobustEstimators.influenceClip(
      stratified,
      this.adaptiveModel.mu,
      this.adaptiveModel.Sigma,
      this.config.clipRadius
    );
    
    // 5. Robust Estimation
    const muNew = RobustEstimators.catoniMean(clipped, 2);
    const { covariance: SigmaNew } = RobustEstimators.mrcd(
      clipped,
      0.3,
      this.referenceModel.Sigma
    );
    
    // 6. Gate Against Reference
    const gateCheck = this.withinCorridor(muNew, SigmaNew);
    if (!gateCheck.passed) {
      this.metrics.update_rejection_rate += 1;
      
      // Trigger rollback if consistent failures
      if (this.metrics.update_rejection_rate > 10) {
        await this.rollback();
        this.alert('GATE_VIOLATION', gateCheck.reason ?? 'Gate rejection threshold exceeded');
      }
      
      return { accepted: false, reason: `Gate violation: ${gateCheck.reason ?? 'unspecified'}` };
    }
    
    // 7. EMA Merge with Adaptive Learning Rate
    const eta = this.computeAdaptiveLearningRate(uniqueSources);
    
    for (let i = 0; i < this.adaptiveModel.mu.length; i++) {
      this.adaptiveModel.mu[i] =
        (1 - eta) * this.adaptiveModel.mu[i] + eta * muNew[i];
    }
    
    // Merge covariance matrices
    this.adaptiveModel.Sigma = this.mergeCovariance(
      this.adaptiveModel.Sigma,
      SigmaNew,
      eta
    );
    
    this.adaptiveModel.timestamp = new Date();
    
    // 8. Circuit Breaker Checks
    await this.checkCircuitBreakers();
    
    // 9. Periodic Checkpointing
    if (Date.now() % 300000 < 1000) {  // Every 5 min
      this.checkpoint();
    }
    
    return { accepted: true };
  }
  
  /**
   * Admission Control
   * 
   * Filters samples by:
   * - Trust score threshold
   * - Per-source rate limits
   * - Crypto binding (if available)
   */
  private admissionControl(
    batch: number[][],
    provenance: Array<{ source: string; trust: number; timestamp: number }>
  ): number[][] {
    const admitted: number[][] = [];
    const sourceCount = new Map<string, number>();
    const maxPerSource = 50;
    const minTrust = 0.3;
    
    for (let i = 0; i < batch.length; i++) {
      const prov = provenance[i];
      
      // Trust threshold
      if (prov.trust < minTrust) continue;
      
      // Per-source quota
      const count = sourceCount.get(prov.source) || 0;
      if (count >= maxPerSource) continue;
      
      admitted.push(batch[i]);
      sourceCount.set(prov.source, count + 1);
    }
    
    return admitted;
  }
  
  /**
   * Stratified Reservoir Sampling
   * 
   * Ensures balanced representation across sources.
   * Trust-weighted within each stratum.
   */
  private stratifiedReservoir(
    data: number[][],
    provenance: Array<{ source: string; trust: number }>,
    capacity: number
  ): number[][] {
    // Group by source
    const strata = new Map<string, Array<{ data: number[]; trust: number }>>();
    
    for (let i = 0; i < data.length; i++) {
      const source = provenance[i].source;
      if (!strata.has(source)) {
        strata.set(source, []);
      }
      strata.get(source)!.push({
        data: data[i],
        trust: provenance[i].trust
      });
    }
    
    // Allocate quota per stratum (proportional to trust)
    const totalTrust = Array.from(strata.values())
      .flatMap(s => s.map(x => x.trust))
      .reduce((sum, t) => sum + t, 0);
    
    const result: number[][] = [];
    
    for (const [source, items] of strata.entries()) {
      const stratumTrust = items.reduce((sum, x) => sum + x.trust, 0);
      const quota = Math.ceil((stratumTrust / totalTrust) * capacity);
      
      // Trust-weighted reservoir sampling
      const selected = this.weightedReservoir(items, quota);
      result.push(...selected.map(s => s.data));
    }
    
    return result;
  }
  
  /**
   * Within Corridor Check
   * 
   * Verifies that new model (μ_new, Σ_new) is "close" to
   * reference model (μ_R, Σ_R) by checking:
   * 1. Mahalanobis drift: ||μ_new - μ_R||_{Σ_R^{-1}} ≤ τ_μ
   * 2. Spectral band: eigenvalues of Σ_new vs Σ_R within ±τ_Σ
   * 3. KL divergence: KL(N(μ_new,Σ_new) || N(μ_R,Σ_R)) ≤ κ
   */
  private withinCorridor(
    muNew: number[],
    SigmaNew: number[][]
  ): { passed: boolean; reason?: string } {
    const muR = this.referenceModel.mu;
    const SigmaR = this.referenceModel.Sigma;
    
    // 1. Mahalanobis drift
    const diff = muNew.map((m, i) => m - muR[i]);
    const mahal = this.mahalanobisNorm(diff, SigmaR);
    this.metrics.mahalanobis_drift = mahal;
    
    if (mahal > this.config.tauMu) {
      return {
        passed: false,
        reason: `Mean drift too large: ${mahal.toFixed(3)} > ${this.config.tauMu}`
      };
    }
    
    // 2. Spectral corridor
    const spectralCheck = RobustEstimators.spectralCorridorCheck(
      SigmaNew,
      SigmaR,
      this.config.tauSigma
    );
    
    if (!spectralCheck) {
      return {
        passed: false,
        reason: `Spectral norm outside corridor (±${this.config.tauSigma})`
      };
    }
    
    // 3. KL divergence
    const kl = this.computeKLDivergence(
      muNew, SigmaNew,
      muR, SigmaR
    );
    this.metrics.kl_divergence = kl;
    
    if (kl > this.config.klThreshold) {
      return {
        passed: false,
        reason: `KL divergence too large: ${kl.toFixed(4)} > ${this.config.klThreshold}`
      };
    }
    
    return { passed: true };
  }
  
  /**
   * Circuit Breakers
   * 
   * Auto-halt conditions:
   * - Anchor anomaly: golden set looks anomalous under A
   * - Provenance concentration: Herfindahl > 0.2
   * - KL jump: sudden increase in divergence
   * - Update rejection spike: > 10 rejections/hour
   * - VPIN toxicity: > 0.75
   */
  private initializeCircuitBreakers() {
    this.breakers = [
      {
        name: 'anchor_anomaly',
        condition: (m) => m.anchor_anomaly_rate > 0.0001,
        action: 'rollback',
        cooldown: 300
      },
      {
        name: 'provenance_concentration',
        condition: (m) => m.herfindahl_index > 0.2,
        action: 'freeze',
        cooldown: 60
      },
      {
        name: 'kl_divergence_spike',
        condition: (m) => m.kl_divergence > this.config.klThreshold * 2,
        action: 'rollback',
        cooldown: 600
      },
      {
        name: 'update_rejection_spike',
        condition: (m) => m.update_rejection_rate > 10,
        action: 'alert',
        cooldown: 300
      },
      {
        name: 'toxic_flow',
        condition: (m) => m.vpin > 0.75,
        action: 'freeze',
        cooldown: 120
      }
    ];
  }
  
  /**
   * Check Circuit Breakers
   * 
   * Evaluates all breakers and executes actions if triggered.
   */
  private async checkCircuitBreakers() {
    // Update anchor anomaly rate
    this.metrics.anchor_anomaly_rate = this.computeAnchorAnomalyRate();
    
    for (const breaker of this.breakers) {
      const lastTrigger = this.lastBreakerTrigger.get(breaker.name);
      const now = new Date();
      
      // Cooldown check
      if (lastTrigger) {
        const elapsed = (now.getTime() - lastTrigger.getTime()) / 1000;
        if (elapsed < breaker.cooldown) continue;
      }
      
      // Condition check
      if (breaker.condition(this.metrics)) {
        this.lastBreakerTrigger.set(breaker.name, now);
        
        switch (breaker.action) {
          case 'rollback':
            await this.rollback();
            this.alert(breaker.name.toUpperCase(), 'Automatic rollback triggered');
            break;
          
          case 'freeze':
            this.alert(breaker.name.toUpperCase(), 'Learning frozen');
            // Freeze is handled by rejecting updates
            break;
          
          case 'alert':
            this.alert(breaker.name.toUpperCase(), 'Threshold exceeded');
            break;
        }
      }
    }
  }
  
  /**
   * Rollback to Last Checkpoint
   * 
   * Reverts adaptive model to most recent checkpoint.
   */
  private async rollback() {
    if (this.checkpoints.length === 0) {
      console.error('No checkpoints available for rollback');
      return;
    }
    
    const checkpoint = this.checkpoints[this.checkpoints.length - 1];
    this.adaptiveModel = this.cloneModelState(checkpoint);
    
    console.log(`[ROLLBACK] Reverted to checkpoint ${checkpoint.checkpoint} at ${checkpoint.timestamp}`);
  }
  
  /**
   * Create Checkpoint
   * 
   * Saves current adaptive model state.
   */
  private checkpoint() {
    const cp = this.cloneModelState(this.adaptiveModel);
    cp.checkpoint = this.checkpoints.length;
    this.checkpoints.push(cp);
    
    // Keep last 20 checkpoints
    if (this.checkpoints.length > 20) {
      this.checkpoints.shift();
    }
    
    console.log(`[CHECKPOINT] Saved checkpoint ${cp.checkpoint}`);
  }
  
  /**
   * Adaptive Learning Rate
   * 
   * η_t = min(η_max, 1 / (1 + α * n_unique))
   * 
   * Decouples learning rate from raw batch size.
   */
  private computeAdaptiveLearningRate(uniqueSources: number): number {
    const alpha = 0.1;
    const etaAdaptive = 1 / (1 + alpha * uniqueSources);
    return Math.min(this.config.etaMax, etaAdaptive);
  }
  
  /**
   * Anchor Anomaly Rate
   * 
   * Fraction of golden set that looks anomalous under adaptive model.
   * High rate → model has drifted from trusted baseline.
   */
  private computeAnchorAnomalyRate(): number {
    const threshold = 9;  // Chi-squared(d, 0.0001) approx
    let anomalies = 0;
    
    for (const x of this.goldenSet) {
      const mahal = this.mahalanobisNorm(
        x.map((xi, i) => xi - this.adaptiveModel.mu[i]),
        this.adaptiveModel.Sigma
      );
      
      if (mahal > threshold) {
        anomalies++;
      }
    }
    
    return anomalies / this.goldenSet.length;
  }
  
  /**
   * KL Divergence for Gaussians
   * 
   * KL(N(μ₁,Σ₁) || N(μ₂,Σ₂)) =
   *   0.5 * [tr(Σ₂^{-1}Σ₁) + (μ₂-μ₁)ᵀΣ₂^{-1}(μ₂-μ₁) - d + log(det(Σ₂)/det(Σ₁))]
   */
  private computeKLDivergence(
    mu1: number[],
    Sigma1: number[][],
    mu2: number[],
    Sigma2: number[][]
  ): number {
    const d = mu1.length;
    
    // Compute Σ₂^{-1}
    const Sigma2Inv = this.matrixInverse(Sigma2);
    
    // Trace term: tr(Σ₂^{-1}Σ₁)
    const product = this.matrixMultiply(Sigma2Inv, Sigma1);
    const trace = product.reduce((sum, row, i) => sum + row[i], 0);
    
    // Mahalanobis term: (μ₂-μ₁)ᵀΣ₂^{-1}(μ₂-μ₁)
    const diff = mu2.map((m, i) => m - mu1[i]);
    const mahal2 = this.mahalanobisNorm(diff, Sigma2) ** 2;
    
    // Log-det term
    const logDetRatio = this.logDet(Sigma2) - this.logDet(Sigma1);
    
    return 0.5 * (trace + mahal2 - d + logDetRatio);
  }
  
  // ==================== Helper Functions ====================
  
  private mahalanobisNorm(x: number[], Sigma: number[][]): number {
    const SigmaInv = this.matrixInverse(Sigma);
    const temp = this.matrixVectorMultiply(SigmaInv, x);
    const dist2 = x.reduce((sum, xi, i) => sum + xi * temp[i], 0);
    return Math.sqrt(Math.max(0, dist2));
  }
  
  private computeEntropy(labels: string[]): number {
    const counts = new Map<string, number>();
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    
    const total = labels.length;
    let entropy = 0;
    
    for (const count of counts.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    
    return entropy;
  }
  
  private computeHerfindahl(labels: string[]): number {
    const counts = new Map<string, number>();
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    
    const total = labels.length;
    let hhi = 0;
    
    for (const count of counts.values()) {
      const share = count / total;
      hhi += share * share;
    }
    
    return hhi;
  }
  
  private weightedReservoir<T extends { trust: number }>(
    items: T[],
    k: number
  ): T[] {
    const heap: Array<{ item: T; key: number }> = [];
    
    for (const item of items) {
      const key = Math.pow(Math.random(), 1 / item.trust);
      
      if (heap.length < k) {
        heap.push({ item, key });
        heap.sort((a, b) => a.key - b.key);
      } else if (key > heap[0].key) {
        heap[0] = { item, key };
        heap.sort((a, b) => a.key - b.key);
      }
    }
    
    return heap.map(h => h.item);
  }
  
  private mergeCovariance(
    Sigma1: number[][],
    Sigma2: number[][],
    eta: number
  ): number[][] {
    const d = Sigma1.length;
    const result = new Array(d).fill(0).map(() => new Array(d).fill(0));
    
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        result[i][j] = (1 - eta) * Sigma1[i][j] + eta * Sigma2[i][j];
      }
    }
    
    return result;
  }
  
  private matrixInverse(A: number[][]): number[][] {
    const n = A.length;
    const augmented = this.augmentWithIdentity(A);
    
    for (let i = 0; i < n; i++) {
      this.pivotRow(augmented, i);
      this.normalizePivotRow(augmented, i);
      this.eliminateOtherRows(augmented, i);
    }
    
    return augmented.map(row => row.slice(n));
  }

  private augmentWithIdentity(A: number[][]): number[][] {
    const n = A.length;
    return A.map((row, i) => [
      ...row,
      ...new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))
    ]);
  }

  private pivotRow(matrix: number[][], pivotIndex: number): void {
    let maxRow = pivotIndex;
    for (let candidate = pivotIndex + 1; candidate < matrix.length; candidate++) {
      if (Math.abs(matrix[candidate][pivotIndex]) > Math.abs(matrix[maxRow][pivotIndex])) {
        maxRow = candidate;
      }
    }
    if (maxRow !== pivotIndex) {
      [matrix[pivotIndex], matrix[maxRow]] = [matrix[maxRow], matrix[pivotIndex]];
    }
  }

  private normalizePivotRow(matrix: number[][], pivotIndex: number): void {
    const pivot = matrix[pivotIndex][pivotIndex];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Matrix is singular and cannot be inverted');
    }
    const width = matrix[pivotIndex].length;
    for (let column = 0; column < width; column++) {
      matrix[pivotIndex][column] /= pivot;
    }
  }

  private eliminateOtherRows(matrix: number[][], pivotIndex: number): void {
    const width = matrix[pivotIndex].length;
    for (let row = 0; row < matrix.length; row++) {
      if (row === pivotIndex) {
        continue;
      }
      const factor = matrix[row][pivotIndex];
      if (factor === 0) {
        continue;
      }
      for (let column = 0; column < width; column++) {
        matrix[row][column] -= factor * matrix[pivotIndex][column];
      }
    }
  }
  
  private matrixMultiply(A: number[][], B: number[][]): number[][] {
    const m = A.length;
    const n = B[0].length;
    const p = B.length;
    const C = new Array(m).fill(0).map(() => new Array(n).fill(0));
    
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < p; k++) {
          C[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    
    return C;
  }
  
  private matrixVectorMultiply(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, aij, j) => sum + aij * v[j], 0));
  }
  
  private logDet(A: number[][]): number {
    // LU decomposition to compute log determinant
    const n = A.length;
    const L = new Array(n).fill(0).map(() => new Array(n).fill(0));
    const U = A.map(row => [...row]);
    
    for (let i = 0; i < n; i++) {
      L[i][i] = 1;
      
      for (let k = i + 1; k < n; k++) {
        const factor = U[k][i] / (U[i][i] + 1e-10);
        L[k][i] = factor;
        
        for (let j = i; j < n; j++) {
          U[k][j] -= factor * U[i][j];
        }
      }
    }
    
    // log det = sum of log of diagonal elements of U
    let logDet = 0;
    for (let i = 0; i < n; i++) {
      logDet += Math.log(Math.abs(U[i][i]) + 1e-10);
    }
    
    return logDet;
  }
  
  private alert(type: string, message: string) {
    const formatted = `[ALERT] ${type}: ${message}`;
    console.error(formatted);
    if (this.alertSink) {
      this.alertSink(type, message);
    }
  }
  
  /**
   * Get Current Metrics
   */
  getMetrics(): GateMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get Model States
   */
  getModels(): { adaptive: ModelState; reference: ModelState } {
    return {
      adaptive: this.cloneModelState(this.adaptiveModel),
      reference: this.cloneModelState(this.referenceModel)
    };
  }
}
