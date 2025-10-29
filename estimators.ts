/**
 * Robust Statistical Estimators
 * 
 * Implements adversarial-resistant estimators:
 * - MRCD (Minimum Regularized Covariance Determinant)
 * - Catoni Mean (bounded influence)
 * - Median-of-Means (MOM)
 * - Influence clipping via Mahalanobis distance
 * 
 * Purpose: Prevent data poisoning, wash trading, and spoofing
 * from corrupting model parameters.
 */

import * as tf from '@tensorflow/tfjs-node';
import { Matrix, EigenvalueDecomposition } from 'ml-matrix';

export interface RobustEstimate {
  mean: number[];
  covariance: number[][];
  breakdown: number;  // Proportion of outliers tolerated
  influence: number;  // Max per-sample influence
}

export class RobustEstimators {
  
  /**
   * Catoni Mean - Bounded influence estimator
   * 
   * Each sample contributes at most O(c/n) to the mean,
   * preventing single outliers from dominating.
   * 
   * Reference: Catoni (2012), "Challenging the empirical mean"
   * 
   * @param data - n x d matrix of samples
   * @param c - Clip radius (typically 2-4)
   * @param maxIters - Maximum iterations
   * @returns Robust mean vector
   */
  static catoniMean(
    data: number[][],
    c: number = 2.0,
    maxIters: number = 10
  ): number[] {
    const n = data.length;
    const d = data[0].length;
    
    // Initialize with coordinate-wise median
    let mu = this.coordinateMedian(data);
    
    for (let iter = 0; iter < maxIters; iter++) {
      const muPrev = [...mu];
      
      // Compute residuals and their norms
      const residuals = data.map(x => 
        x.map((xi, i) => xi - mu[i])
      );
      
      const norms = residuals.map(r => 
        Math.sqrt(r.reduce((sum, ri) => sum + ri * ri, 0))
      );
      
      // Catoni weight: tanh(||r||/c) / ||r||
      const weights = norms.map(norm => {
        if (norm < 1e-9) return 1.0;
        const clipped = Math.min(norm / c, 3.0);  // Cap at 3
        return Math.tanh(clipped) / (norm + 1e-9);
      });
      
      // Weighted update
      for (let j = 0; j < d; j++) {
        let sum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < n; i++) {
          const w = weights[i];
          sum += w * residuals[i][j];
          weightSum += w;
        }
        
        mu[j] += sum / (weightSum + 1e-9);
      }
      
      // Check convergence
      const delta = Math.sqrt(
        mu.reduce((sum, mi, i) => sum + (mi - muPrev[i]) ** 2, 0)
      );
      
      if (delta < 1e-6) break;
    }
    
    return mu;
  }
  
  /**
   * Median of Means (MOM) - High breakdown estimator
   * 
   * Partition data into K blocks, compute mean of each,
   * return median of block means. Breakdown ≈ 0.5 - 1/(2K).
   * 
   * Reference: Nemirovsky & Yudin (1983)
   * 
   * @param data - n x d matrix
   * @param numBlocks - Number of blocks (default: 10)
   */
  static medianOfMeans(
    data: number[][],
    numBlocks: number = 10
  ): number[] {
    const n = data.length;
    const d = data[0].length;
    const blockSize = Math.floor(n / numBlocks);
    
    // Shuffle data to randomize blocks
    const shuffled = this.shuffleArray([...data]);
    
    // Compute block means
    const blockMeans: number[][] = [];
    for (let b = 0; b < numBlocks; b++) {
      const start = b * blockSize;
      const end = b === numBlocks - 1 ? n : (b + 1) * blockSize;
      const block = shuffled.slice(start, end);
      
      const mean = new Array(d).fill(0);
      for (const x of block) {
        for (let j = 0; j < d; j++) {
          mean[j] += x[j];
        }
      }
      
      blockMeans.push(mean.map(m => m / block.length));
    }
    
    // Return coordinate-wise median
    return this.coordinateMedian(blockMeans);
  }
  
  /**
   * MRCD - Minimum Regularized Covariance Determinant
   * 
   * Robust covariance estimation with shrinkage toward
   * a prior (identity or golden set covariance).
   * 
   * Prevents adversarial inflation of eigenvalues.
   * 
   * Reference: Rousseeuw & Van Driessen (1999)
   * 
   * @param data - n x d matrix
   * @param alpha - Shrinkage parameter [0,1]
   * @param priorCov - Prior covariance (default: identity)
   * @param h - Subset size (default: n/2)
   */
  static mrcd(
    data: number[][],
    alpha: number = 0.3,
    priorCov?: number[][],
    h?: number
  ): { mean: number[]; covariance: number[][] } {
    const n = data.length;
    const d = data[0].length;
    h = h || Math.floor(n / 2);
    
    // Prior: identity if not provided
    if (!priorCov) {
      priorCov = Matrix.eye(d, d).to2DArray();
    }
    
    // Iterative MCD approximation
    let mu = this.coordinateMedian(data);
    let Sigma = this.sampleCovariance(data, mu);
    
    for (let iter = 0; iter < 10; iter++) {
      // Compute Mahalanobis distances
      const distances = data.map(x => 
        this.mahalanobisDistance(x, mu, Sigma)
      );
      
      // Select h samples with smallest distances
      const indices = distances
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .slice(0, h)
        .map(item => item.i);
      
      const subset = indices.map(i => data[i]);
      
      // Recompute on subset
      mu = this.mean(subset);
      const SigmaRaw = this.sampleCovariance(subset, mu);
      
      // Shrinkage: (1-α)Σ_prior + α Σ_raw
      Sigma = this.shrinkCovariance(SigmaRaw, priorCov, alpha);
    }
    
    return { mean: mu, covariance: Sigma };
  }
  
  /**
   * Influence Clipping - Clip samples by Mahalanobis distance
   * 
   * Ensures no single sample can move the mean more than
   * a bounded amount (proportional to clipRadius).
   * 
   * @param data - n x d matrix
   * @param mu - Current mean
   * @param Sigma - Current covariance
   * @param clipRadius - Max Mahalanobis distance (typically 3-4)
   */
  static influenceClip(
    data: number[][],
    mu: number[],
    Sigma: number[][],
    clipRadius: number = 3.0
  ): number[][] {
    return data.map(x => {
      const residual = x.map((xi, i) => xi - mu[i]);
      const dist = this.mahalanobisDistance(x, mu, Sigma);
      
      if (dist <= clipRadius) {
        return x;  // Keep as is
      }
      
      // Clip: x_clipped = μ + (x - μ) * (clipRadius / dist)
      const scale = clipRadius / (dist + 1e-9);
      return residual.map((r, i) => mu[i] + r * scale);
    });
  }
  
  /**
   * Spectral Corridor Check
   * 
   * Verifies that covariance Σ_A is "close" to reference Σ_R
   * by checking spectral norm of relative difference.
   * 
   * Used for multi-model gating.
   */
  static spectralCorridorCheck(
    SigmaA: number[][],
    SigmaR: number[][],
    tauSigma: number = 0.2
  ): boolean {
    // Compute: Σ_R^{-1/2} Σ_A Σ_R^{-1/2}
    const SigmaRInvSqrt = this.matrixPower(SigmaR, -0.5);
    const M = this.matrixMultiply(
      this.matrixMultiply(SigmaRInvSqrt, SigmaA),
      SigmaRInvSqrt
    );
    
    // Spectral norm (max eigenvalue)
    const eigs = this.eigenvalues(M);
    const maxEig = Math.max(...eigs);
    const minEig = Math.min(...eigs);
    
    // Check: eigenvalues in [1-τ, 1+τ]
    return minEig >= 1 - tauSigma && maxEig <= 1 + tauSigma;
  }
  
  // ==================== Helper Functions ====================
  
  private static coordinateMedian(data: number[][]): number[] {
    const d = data[0].length;
    const median = new Array(d);
    
    for (let j = 0; j < d; j++) {
      const column = data.map(x => x[j]).sort((a, b) => a - b);
      const mid = Math.floor(column.length / 2);
      median[j] = column.length % 2 === 0
        ? (column[mid - 1] + column[mid]) / 2
        : column[mid];
    }
    
    return median;
  }
  
  private static mean(data: number[][]): number[] {
    const n = data.length;
    const d = data[0].length;
    const sum = new Array(d).fill(0);
    
    for (const x of data) {
      for (let j = 0; j < d; j++) {
        sum[j] += x[j];
      }
    }
    
    return sum.map(s => s / n);
  }
  
  private static sampleCovariance(
    data: number[][],
    mu: number[]
  ): number[][] {
    const n = data.length;
    const d = data[0].length;
    const cov = Array(d).fill(0).map(() => Array(d).fill(0));
    
    for (const x of data) {
      const residual = x.map((xi, i) => xi - mu[i]);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          cov[i][j] += residual[i] * residual[j];
        }
      }
    }
    
    return cov.map(row => row.map(c => c / (n - 1)));
  }
  
  private static mahalanobisDistance(
    x: number[],
    mu: number[],
    Sigma: number[][]
  ): number {
    const residual = x.map((xi, i) => xi - mu[i]);
    const SigmaInv = this.matrixInverse(Sigma);
    const temp = this.matrixVectorMultiply(SigmaInv, residual);
    const dist2 = residual.reduce((sum, r, i) => sum + r * temp[i], 0);
    return Math.sqrt(Math.max(0, dist2));
  }
  
  private static shrinkCovariance(
    Sigma: number[][],
    SigmaPrior: number[][],
    alpha: number
  ): number[][] {
    const d = Sigma.length;
    const result = Array(d).fill(0).map(() => Array(d).fill(0));
    
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        result[i][j] = alpha * Sigma[i][j] + (1 - alpha) * SigmaPrior[i][j];
      }
    }
    
    return result;
  }
  
  private static matrixInverse(A: number[][]): number[][] {
    const mat = new Matrix(A);
    return mat.inverse().to2DArray();
  }
  
  private static matrixMultiply(A: number[][], B: number[][]): number[][] {
    const matA = new Matrix(A);
    const matB = new Matrix(B);
    return matA.mmul(matB).to2DArray();
  }
  
  private static matrixVectorMultiply(A: number[][], v: number[]): number[] {
    const mat = new Matrix(A);
    const vec = Matrix.columnVector(v);
    return mat.mmul(vec).to1DArray();
  }
  
  private static matrixPower(A: number[][], p: number): number[][] {
    const mat = new Matrix(A);
    const evd = new EigenvalueDecomposition(mat);
    const eigVals = evd.realEigenvalues;
    const eigVecs = evd.eigenvectorMatrix;
    
    // Diagonal matrix of eigenvalues^p
    const d = eigVals.length;
    const D = Matrix.zeros(d, d);
    for (let i = 0; i < d; i++) {
      D.set(i, i, Math.pow(Math.max(eigVals[i], 1e-10), p));
    }
    
    // A^p = V * D^p * V^T
    return eigVecs.mmul(D).mmul(eigVecs.transpose()).to2DArray();
  }
  
  private static eigenvalues(A: number[][]): number[] {
    const mat = new Matrix(A);
    const evd = new EigenvalueDecomposition(mat);
    return evd.realEigenvalues;
  }
  
  private static shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

/**
 * Usage Example:
 * 
 * const prices = [[100, 101], [102, 103], ...];
 * 
 * // Robust mean (resistant to outliers)
 * const mu = RobustEstimators.catoniMean(prices, 2.0);
 * 
 * // Robust covariance (resistant to poisoning)
 * const { mean, covariance } = RobustEstimators.mrcd(prices, 0.3);
 * 
 * // Clip influential samples
 * const clipped = RobustEstimators.influenceClip(
 *   newData, mu, covariance, 3.0
 * );
 */
