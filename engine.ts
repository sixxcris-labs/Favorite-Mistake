/**
 * Advanced Quantitative Analysis Engine
 * 
 * Implements sophisticated quant techniques:
 * - Volatility Surface Modeling (SABR, local vol)
 * - Regime Detection (HMM, change-point)
 * - Order Flow Imbalance (OFI)
 * - Market Microstructure Invariants
 * - Correlation Networks
 * 
 * Purpose: Extract alpha signals, detect regime shifts,
 * model volatility dynamics.
 */

import * as tf from '@tensorflow/tfjs-node';

export interface RegimeState {
  id: number;
  name: string;
  volatility: number;
  meanReturn: number;
  probability: number;
}

export interface VolatilitySurface {
  strikes: number[];
  maturities: number[];
  impliedVols: number[][];  // [maturity][strike]
  sabr_params: SABRParams;
}

export interface SABRParams {
  alpha: number;  // ATM vol level
  beta: number;   // CEV exponent (0.5-1.0)
  rho: number;    // Correlation (-1 to 1)
  nu: number;     // Vol of vol
}

export interface OrderFlowMetrics {
  ofi: number;        // Order Flow Imbalance
  vpin: number;       // Volume-Synchronized PIN
  spread: number;     // Bid-ask spread
  depth: number;      // Order book depth
  toxicity: number;   // Flow toxicity score [0,1]
}

export class QuantEngine {
  
  // ==================== Volatility Modeling ====================
  
  /**
   * SABR Model Calibration
   * 
   * Fits SABR stochastic volatility model to market quotes.
   * Used for options pricing and volatility arbitrage.
   * 
   * SABR: dF = σ F^β dW_1, dσ = ν σ dW_2, <dW_1, dW_2> = ρ dt
   * 
   * Reference: Hagan et al. (2002)
   * 
   * @param forward - Forward price
   * @param strikes - Array of strike prices
   * @param maturities - Array of times to maturity
   * @param marketVols - Market implied vols [maturity][strike]
   * @returns Calibrated SABR parameters
   */
  static calibrateSABR(
    forward: number,
    strikes: number[],
    maturities: number[],
    marketVols: number[][]
  ): SABRParams {
    // Initial guess
    let params: SABRParams = {
      alpha: 0.2,
      beta: 0.7,
      rho: -0.3,
      nu: 0.4
    };
    
    // Levenberg-Marquardt optimization
    const maxIters = 100;
    const lambda = 0.01;
    
    for (let iter = 0; iter < maxIters; iter++) {
      const modelVols: number[][] = [];
      const errors: number[] = [];
      
      // Compute model vols and errors
      for (let i = 0; i < maturities.length; i++) {
        const T = maturities[i];
        modelVols[i] = [];
        
        for (let j = 0; j < strikes.length; j++) {
          const K = strikes[j];
          const modelVol = this.sabrImpliedVol(
            forward, K, T, params.alpha, params.beta, params.rho, params.nu
          );
          modelVols[i][j] = modelVol;
          errors.push(marketVols[i][j] - modelVol);
        }
      }
      
      // Compute Jacobian numerically
      const jacobian = this.sabrJacobian(
        forward, strikes, maturities, params
      );
      
      // Gauss-Newton update
      const JtJ = this.matrixMultiply(
        this.matrixTranspose(jacobian), jacobian
      );
      const JtError = this.matrixVectorMultiply(
        this.matrixTranspose(jacobian), errors
      );
      
      // Add damping
      for (let i = 0; i < JtJ.length; i++) {
        JtJ[i][i] += lambda;
      }
      
      const delta = this.solveLinearSystem(JtJ, JtError);
      
      // Update parameters with constraints
      params.alpha = Math.max(0.01, params.alpha + delta[0]);
      params.beta = Math.max(0, Math.min(1, params.beta + delta[1]));
      params.rho = Math.max(-0.99, Math.min(0.99, params.rho + delta[2]));
      params.nu = Math.max(0.01, params.nu + delta[3]);
      
      // Check convergence
      const rmse = Math.sqrt(
        errors.reduce((sum, e) => sum + e * e, 0) / errors.length
      );
      
      if (rmse < 1e-4) break;
    }
    
    return params;
  }
  
  /**
   * SABR Implied Volatility (Hagan formula)
   * 
   * Analytic approximation for SABR implied vol.
   * Accurate for β ∈ [0.5, 1] and moderate ν.
   */
  private static sabrImpliedVol(
    F: number,
    K: number,
    T: number,
    alpha: number,
    beta: number,
    rho: number,
    nu: number
  ): number {
    if (Math.abs(F - K) < 1e-6) {
      // ATM case
      const term1 = alpha / Math.pow(F, 1 - beta);
      const term2 = (1 + ((Math.pow(1-beta, 2) / 24) * Math.pow(alpha / Math.pow(F, 1-beta), 2) +
                          (rho * beta * nu * alpha) / (4 * Math.pow(F, 1-beta)) +
                          ((2 - 3 * rho * rho) * nu * nu) / 24) * T);
      return term1 * term2;
    }
    
    // General case
    const logFK = Math.log(F / K);
    const FKb = Math.pow(F * K, (1 - beta) / 2);
    
    const z = (nu / alpha) * FKb * logFK;
    const x = Math.log((Math.sqrt(1 - 2 * rho * z + z * z) + z - rho) / (1 - rho));
    
    const num = alpha;
    const denom = FKb * (1 +
      Math.pow(1 - beta, 2) * Math.pow(logFK, 2) / 24 +
      Math.pow(1 - beta, 4) * Math.pow(logFK, 4) / 1920
    );
    
    const term1 = num / denom;
    const term2 = z / x;
    const term3 = 1 +
      (Math.pow(1 - beta, 2) * alpha * alpha / (24 * Math.pow(FKb, 2)) +
       rho * beta * nu * alpha / (4 * FKb) +
       (2 - 3 * rho * rho) * nu * nu / 24) * T;
    
    return term1 * term2 * term3;
  }
  
  // ==================== Regime Detection ====================
  
  /**
   * Hidden Markov Model for Volatility Regimes
   * 
   * Detects market states: Low Vol, Normal, High Vol, Crisis
   * Uses Baum-Welch algorithm for parameter estimation.
   * 
   * Reference: Ang & Timmermann (2012)
   */
  static detectRegimes(
    returns: number[],
    numStates: number = 4
  ): { states: RegimeState[]; sequence: number[] } {
    const n = returns.length;
    
    // Initialize HMM parameters
    let pi = new Array(numStates).fill(1 / numStates);  // Initial probs
    let A = this.initializeTransitionMatrix(numStates); // Transition
    let mu = this.initializeStateMeans(returns, numStates);
    let sigma = this.initializeStateStdDevs(returns, numStates);
    
    // Baum-Welch EM algorithm
    const maxIters = 50;
    for (let iter = 0; iter < maxIters; iter++) {
      const { alpha, beta, gamma, xi } = this.forwardBackward(
        returns, pi, A, mu, sigma
      );
      
      // M-step: Update parameters
      for (let i = 0; i < numStates; i++) {
        // Update initial probabilities
        pi[i] = gamma[0][i];
        
        // Update transition matrix
        for (let j = 0; j < numStates; j++) {
          let num = 0, denom = 0;
          for (let t = 0; t < n - 1; t++) {
            num += xi[t][i][j];
            denom += gamma[t][i];
          }
          A[i][j] = num / (denom + 1e-10);
        }
        
        // Update emission parameters
        let muNum = 0, sigmaNum = 0, denom = 0;
        for (let t = 0; t < n; t++) {
          muNum += gamma[t][i] * returns[t];
          denom += gamma[t][i];
        }
        mu[i] = muNum / (denom + 1e-10);
        
        for (let t = 0; t < n; t++) {
          sigmaNum += gamma[t][i] * Math.pow(returns[t] - mu[i], 2);
        }
        sigma[i] = Math.sqrt(sigmaNum / (denom + 1e-10));
      }
    }
    
    // Viterbi algorithm for most likely state sequence
    const sequence = this.viterbi(returns, pi, A, mu, sigma);
    
    // Build regime states
    const states: RegimeState[] = [];
    const regimeNames = ['Low Vol', 'Normal', 'High Vol', 'Crisis'];
    
    for (let i = 0; i < numStates; i++) {
      states.push({
        id: i,
        name: regimeNames[i] || `State ${i}`,
        volatility: sigma[i],
        meanReturn: mu[i],
        probability: pi[i]
      });
    }
    
    // Sort by volatility
    states.sort((a, b) => a.volatility - b.volatility);
    
    return { states, sequence };
  }
  
  /**
   * CUSUM Change-Point Detection
   * 
   * Detects abrupt changes in mean or variance.
   * Used for regime shift detection and circuit breakers.
   * 
   * Reference: Page (1954)
   */
  static cusumDetector(
    series: number[],
    threshold: number = 5.0,
    drift: number = 0.5
  ): { changepoint: number | null; score: number } {
    const n = series.length;
    const mu0 = this.median(series.slice(0, Math.min(100, n)));
    
    let sPlus = 0;
    let sMinus = 0;
    let maxS = 0;
    let changepoint = null;
    
    for (let t = 0; t < n; t++) {
      sPlus = Math.max(0, sPlus + (series[t] - mu0) - drift);
      sMinus = Math.max(0, sMinus - (series[t] - mu0) - drift);
      
      const s = Math.max(sPlus, sMinus);
      
      if (s > threshold && changepoint === null) {
        changepoint = t;
        break;
      }
      
      maxS = Math.max(maxS, s);
    }
    
    return { changepoint, score: maxS };
  }
  
  // ==================== Market Microstructure ====================
  
  /**
   * Order Flow Imbalance (OFI)
   * 
   * Measures signed order flow pressure on LOB.
   * Predictive of short-term price moves.
   * 
   * OFI = Δ(bid_size - ask_size)
   * 
   * Reference: Cont et al. (2014)
   */
  static computeOFI(
    bidSizes: number[],
    askSizes: number[]
  ): number[] {
    const n = bidSizes.length;
    const ofi = new Array(n).fill(0);
    
    for (let t = 1; t < n; t++) {
      const deltaBid = bidSizes[t] - bidSizes[t-1];
      const deltaAsk = askSizes[t] - askSizes[t-1];
      ofi[t] = deltaBid - deltaAsk;
    }
    
    return ofi;
  }
  
  /**
   * VPIN - Volume-Synchronized PIN
   * 
   * Measures probability of informed trading.
   * High VPIN → toxic flow, skip learning.
   * 
   * VPIN = |Buy Volume - Sell Volume| / Total Volume
   * 
   * Reference: Easley et al. (2012)
   */
  static computeVPIN(
    trades: Array<{ volume: number; side: 'buy' | 'sell' }>,
    bucketVolume: number = 1000
  ): number {
    // Partition trades into volume buckets
    const buckets: typeof trades = [];
    let currentBucket: typeof trades = [];
    let bucketVol = 0;
    
    for (const trade of trades) {
      currentBucket.push(trade);
      bucketVol += trade.volume;
      
      if (bucketVol >= bucketVolume) {
        buckets.push(...currentBucket);
        currentBucket = [];
        bucketVol = 0;
      }
    }
    
    // Compute VPIN per bucket
    const vpins: number[] = [];
    let buyVol = 0, sellVol = 0;
    
    for (const trade of buckets) {
      if (trade.side === 'buy') buyVol += trade.volume;
      else sellVol += trade.volume;
    }
    
    const totalVol = buyVol + sellVol;
    const vpin = totalVol > 0 ? Math.abs(buyVol - sellVol) / totalVol : 0;
    
    return vpin;
  }
  
  /**
   * Kyle's Lambda - Price Impact Coefficient
   * 
   * Measures how much price moves per unit of signed order flow.
   * Used for execution cost estimation.
   * 
   * Δp = λ * Q + ε
   * 
   * Reference: Kyle (1985)
   */
  static computeKyleLambda(
    priceChanges: number[],
    signedVolumes: number[]
  ): number {
    const n = priceChanges.length;
    
    // OLS regression: Δp ~ λ * Q
    let sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumXY += signedVolumes[i] * priceChanges[i];
      sumX2 += signedVolumes[i] * signedVolumes[i];
    }
    
    const lambda = sumXY / (sumX2 + 1e-10);
    return lambda;
  }
  
  /**
   * Spread Decomposition
   * 
   * Decomposes bid-ask spread into:
   * - Adverse selection (informed trading)
   * - Inventory cost
   * - Order processing cost
   * 
   * Reference: Glosten & Harris (1988)
   */
  static decomposeSpread(
    prices: number[],
    volumes: number[],
    quotes: Array<{ bid: number; ask: number }>
  ): { adverseSelection: number; inventory: number; processing: number } {
    const n = prices.length;
    
    // Compute trade indicator (1 if buyer-initiated, -1 if seller)
    const indicators = this.classifyTrades(prices, quotes);
    
    // Roll model for spread decomposition
    const spreads = quotes.map(q => q.ask - q.bid);
    const priceChanges = prices.slice(1).map((p, i) => p - prices[i]);
    
    // Covariance-based estimation
    const covSpreadIndicator = this.covariance(
      spreads.slice(1), indicators.slice(1)
    );
    const varIndicator = this.variance(indicators);
    
    const adverseSelection = covSpreadIndicator / (varIndicator + 1e-10);
    const avgSpread = this.mean(spreads);
    const inventory = 0.3 * avgSpread;  // Rough estimate
    const processing = avgSpread - adverseSelection - inventory;
    
    return { adverseSelection, inventory, processing };
  }
  
  // ==================== Helper Functions ====================
  
  private static initializeTransitionMatrix(n: number): number[][] {
    // Diagonal-dominant transition matrix
    const A = Array(n).fill(0).map(() => Array(n).fill(0.1 / (n - 1)));
    for (let i = 0; i < n; i++) {
      A[i][i] = 0.9;
    }
    return A;
  }
  
  private static initializeStateMeans(data: number[], n: number): number[] {
    const sorted = [...data].sort((a, b) => a - b);
    const means = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i + 0.5) * sorted.length / n);
      means.push(sorted[idx]);
    }
    return means;
  }
  
  private static initializeStateStdDevs(data: number[], n: number): number[] {
    const globalStd = this.stdDev(data);
    return Array(n).fill(globalStd);
  }
  
  private static forwardBackward(
    obs: number[],
    pi: number[],
    A: number[][],
    mu: number[],
    sigma: number[]
  ): any {
    const n = obs.length;
    const m = pi.length;
    
    // Forward pass
    const alpha = Array(n).fill(0).map(() => Array(m).fill(0));
    for (let i = 0; i < m; i++) {
      alpha[0][i] = pi[i] * this.gaussianPdf(obs[0], mu[i], sigma[i]);
    }
    
    for (let t = 1; t < n; t++) {
      for (let j = 0; j < m; j++) {
        let sum = 0;
        for (let i = 0; i < m; i++) {
          sum += alpha[t-1][i] * A[i][j];
        }
        alpha[t][j] = sum * this.gaussianPdf(obs[t], mu[j], sigma[j]);
      }
    }
    
    // Backward pass
    const beta = Array(n).fill(0).map(() => Array(m).fill(0));
    for (let i = 0; i < m; i++) {
      beta[n-1][i] = 1;
    }
    
    for (let t = n - 2; t >= 0; t--) {
      for (let i = 0; i < m; i++) {
        let sum = 0;
        for (let j = 0; j < m; j++) {
          sum += A[i][j] * this.gaussianPdf(obs[t+1], mu[j], sigma[j]) * beta[t+1][j];
        }
        beta[t][i] = sum;
      }
    }
    
    // Compute gamma and xi
    const gamma = Array(n).fill(0).map(() => Array(m).fill(0));
    const xi = Array(n-1).fill(0).map(() => 
      Array(m).fill(0).map(() => Array(m).fill(0))
    );
    
    for (let t = 0; t < n; t++) {
      let norm = 0;
      for (let i = 0; i < m; i++) {
        gamma[t][i] = alpha[t][i] * beta[t][i];
        norm += gamma[t][i];
      }
      for (let i = 0; i < m; i++) {
        gamma[t][i] /= norm + 1e-10;
      }
    }
    
    for (let t = 0; t < n - 1; t++) {
      let norm = 0;
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
          xi[t][i][j] = alpha[t][i] * A[i][j] *
            this.gaussianPdf(obs[t+1], mu[j], sigma[j]) * beta[t+1][j];
          norm += xi[t][i][j];
        }
      }
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
          xi[t][i][j] /= norm + 1e-10;
        }
      }
    }
    
    return { alpha, beta, gamma, xi };
  }
  
  private static viterbi(
    obs: number[],
    pi: number[],
    A: number[][],
    mu: number[],
    sigma: number[]
  ): number[] {
    const n = obs.length;
    const m = pi.length;
    
    const delta = Array(n).fill(0).map(() => Array(m).fill(0));
    const psi = Array(n).fill(0).map(() => Array(m).fill(0));
    
    // Initialization
    for (let i = 0; i < m; i++) {
      delta[0][i] = Math.log(pi[i] + 1e-10) +
        Math.log(this.gaussianPdf(obs[0], mu[i], sigma[i]) + 1e-10);
    }
    
    // Recursion
    for (let t = 1; t < n; t++) {
      for (let j = 0; j < m; j++) {
        let maxVal = -Infinity;
        let maxIdx = 0;
        
        for (let i = 0; i < m; i++) {
          const val = delta[t-1][i] + Math.log(A[i][j] + 1e-10);
          if (val > maxVal) {
            maxVal = val;
            maxIdx = i;
          }
        }
        
        delta[t][j] = maxVal +
          Math.log(this.gaussianPdf(obs[t], mu[j], sigma[j]) + 1e-10);
        psi[t][j] = maxIdx;
      }
    }
    
    // Backtrack
    const path = new Array(n);
    path[n-1] = delta[n-1].indexOf(Math.max(...delta[n-1]));
    
    for (let t = n - 2; t >= 0; t--) {
      path[t] = psi[t+1][path[t+1]];
    }
    
    return path;
  }
  
  private static gaussianPdf(x: number, mu: number, sigma: number): number {
    const z = (x - mu) / (sigma + 1e-10);
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI) + 1e-10);
  }
  
  private static classifyTrades(
    prices: number[],
    quotes: Array<{ bid: number; ask: number }>
  ): number[] {
    // Lee-Ready algorithm
    return prices.map((p, i) => {
      if (i === 0) return 0;
      const mid = (quotes[i].bid + quotes[i].ask) / 2;
      return p > mid ? 1 : (p < mid ? -1 : 0);
    });
  }
  
  private static median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
  
  private static mean(arr: number[]): number {
    return arr.reduce((sum, x) => sum + x, 0) / arr.length;
  }
  
  private static variance(arr: number[]): number {
    const mu = this.mean(arr);
    return arr.reduce((sum, x) => sum + (x - mu) ** 2, 0) / (arr.length - 1);
  }
  
  private static stdDev(arr: number[]): number {
    return Math.sqrt(this.variance(arr));
  }
  
  private static covariance(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    const muX = this.mean(x.slice(0, n));
    const muY = this.mean(y.slice(0, n));
    
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (x[i] - muX) * (y[i] - muY);
    }
    
    return sum / (n - 1);
  }
  
  private static sabrJacobian(
    forward: number,
    strikes: number[],
    maturities: number[],
    params: SABRParams
  ): number[][] {
    const eps = 1e-6;
    const jacobian: number[][] = [];
    
    for (let i = 0; i < maturities.length; i++) {
      for (let j = 0; j < strikes.length; j++) {
        const row = [];
        
        // Numerical derivatives w.r.t. each parameter
        for (const param of ['alpha', 'beta', 'rho', 'nu'] as const) {
          const params1 = { ...params, [param]: params[param] + eps };
          const params2 = { ...params, [param]: params[param] - eps };
          
          const vol1 = this.sabrImpliedVol(
            forward, strikes[j], maturities[i],
            params1.alpha, params1.beta, params1.rho, params1.nu
          );
          
          const vol2 = this.sabrImpliedVol(
            forward, strikes[j], maturities[i],
            params2.alpha, params2.beta, params2.rho, params2.nu
          );
          
          row.push((vol1 - vol2) / (2 * eps));
        }
        
        jacobian.push(row);
      }
    }
    
    return jacobian;
  }
  
  private static matrixMultiply(A: number[][], B: number[][]): number[][] {
    const m = A.length;
    const n = B[0].length;
    const p = B.length;
    const C = Array(m).fill(0).map(() => Array(n).fill(0));
    
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < p; k++) {
          C[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    
    return C;
  }
  
  private static matrixTranspose(A: number[][]): number[][] {
    const m = A.length;
    const n = A[0].length;
    const At = Array(n).fill(0).map(() => Array(m).fill(0));
    
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        At[j][i] = A[i][j];
      }
    }
    
    return At;
  }
  
  private static matrixVectorMultiply(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, aij, j) => sum + aij * v[j], 0));
  }
  
  private static solveLinearSystem(A: number[][], b: number[]): number[] {
    // Gaussian elimination with partial pivoting
    const n = A.length;
    const Ab = A.map((row, i) => [...row, b[i]]);
    
    for (let k = 0; k < n; k++) {
      // Pivot
      let maxRow = k;
      for (let i = k + 1; i < n; i++) {
        if (Math.abs(Ab[i][k]) > Math.abs(Ab[maxRow][k])) {
          maxRow = i;
        }
      }
      [Ab[k], Ab[maxRow]] = [Ab[maxRow], Ab[k]];
      
      // Eliminate
      for (let i = k + 1; i < n; i++) {
        const factor = Ab[i][k] / (Ab[k][k] + 1e-10);
        for (let j = k; j < n + 1; j++) {
          Ab[i][j] -= factor * Ab[k][j];
        }
      }
    }
    
    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = Ab[i][n];
      for (let j = i + 1; j < n; j++) {
        x[i] -= Ab[i][j] * x[j];
      }
      x[i] /= Ab[i][i] + 1e-10;
    }
    
    return x;
  }
}
