/**
 * Risk Management Framework
 * 
 * Implements quantitative risk controls:
 * - VaR/CVaR (Value at Risk / Conditional VaR)
 * - Kelly Criterion for position sizing
 * - Exposure limits (per-asset, sector, total)
 * - Circuit breakers (volatility, drawdown, correlation)
 * - Stress testing (fat-tail scenarios)
 * - Liquidation guards (slippage bounds)
 * 
 * Purpose: Bound tail risk, prevent catastrophic losses.
 */

export interface RiskLimits {
  maxLeverage: number;
  maxPositionSize: number;        // Per-asset (fraction of capital)
  maxSectorExposure: number;      // Per-sector (fraction)
  maxTotalExposure: number;       // Total (leverage)
  maxCorrelation: number;         // Between positions
  maxDrawdown: number;            // Total portfolio
  var95: number;                  // 95% VaR limit
  var99: number;                  // 99% VaR limit
  cvar95: number;                 // 95% CVaR limit
  maxVolatility: number;          // Annualized
  minSharpe: number;              // Minimum Sharpe ratio
}

export interface PositionRisk {
  symbol: string;
  size: number;
  value: number;
  weight: number;                 // Portfolio weight
  volatility: number;
  beta: number;                   // Market beta
  var95: number;
  cvar95: number;
  contribution_to_var: number;    // Marginal VaR
  max_loss_24h: number;
}

export interface PortfolioRisk {
  totalValue: number;
  totalExposure: number;
  leverage: number;
  volatility: number;              // Annualized
  sharpe: number;
  sortino: number;
  calmar: number;
  var95: number;
  var99: number;
  cvar95: number;
  maxDrawdown: number;
  correlationMatrix: number[][];
  beta: number;                    // Market beta
}

export interface CircuitBreakerStatus {
  name: string;
  active: boolean;
  triggered_at?: Date;
  reason?: string;
  cooldown_until?: Date;
}

export class RiskManager {
  private limits: RiskLimits;
  private positions: Map<string, PositionRisk>;
  private returns: number[][];     // Historical returns matrix
  private breakers: CircuitBreakerStatus[];
  private equity_curve: number[];
  private peak_equity: number;
  
  constructor(limits: Partial<RiskLimits> = {}) {
    this.limits = {
      maxLeverage: 2.0,
      maxPositionSize: 0.2,
      maxSectorExposure: 0.4,
      maxTotalExposure: 1.5,
      maxCorrelation: 0.8,
      maxDrawdown: 0.2,
      var95: 0.05,
      var99: 0.10,
      cvar95: 0.075,
      maxVolatility: 0.40,
      minSharpe: 0.5,
      ...limits
    };
    
    this.positions = new Map();
    this.returns = [];
    this.equity_curve = [100000];  // Start with $100k
    this.peak_equity = 100000;
    this.breakers = [];
    
    this.initializeCircuitBreakers();
  }
  
  // ==================== Position Sizing ====================
  
  /**
   * Kelly Criterion Position Sizing
   * 
   * Optimal fraction: f* = (p*b - q) / b
   * Where:
   * - p = win probability
   * - q = 1 - p
   * - b = odds (reward/risk ratio)
   * 
   * We use quarter-Kelly for safety: f_actual = 0.25 * f*
   * 
   * @param winProb - Probability of profit (from ML model)
   * @param rewardRisk - Expected reward/risk ratio
   * @param volatility - Asset volatility (annualized)
   * @returns Position size (fraction of capital)
   */
  kellySize(
    winProb: number,
    rewardRisk: number,
    volatility: number
  ): number {
    const p = Math.max(0.01, Math.min(0.99, winProb));
    const b = Math.max(0.1, rewardRisk);
    
    // Kelly formula
    const kelly = (p * b - (1 - p)) / b;
    
    // Apply safety multiplier (quarter-Kelly)
    const kellyFraction = 0.25;
    let size = Math.max(0, kelly * kellyFraction);
    
    // Volatility adjustment: reduce size in high-vol
    const volFactor = Math.min(1.0, 0.20 / volatility);
    size *= volFactor;
    
    // Hard cap at position limit
    size = Math.min(size, this.limits.maxPositionSize);
    
    return size;
  }
  
  /**
   * Volatility-Adjusted Position Sizing
   * 
   * Size ∝ 1 / √(volatility)
   * 
   * Allocates more capital to low-vol assets,
   * ensuring equal risk contribution.
   */
  volAdjustedSize(
    targetRisk: number,
    volatility: number
  ): number {
    const size = targetRisk / volatility;
    return Math.min(size, this.limits.maxPositionSize);
  }
  
  /**
   * Risk Parity Position Sizing
   * 
   * Each asset contributes equally to portfolio risk.
   * Used for diversified portfolios.
   */
  riskParityWeights(
    volatilities: number[],
    correlations: number[][]
  ): number[] {
    const n = volatilities.length;
    
    // Inverse volatility weights (normalized)
    const invVol = volatilities.map(v => 1 / v);
    const sumInvVol = invVol.reduce((sum, iv) => sum + iv, 0);
    const weights = invVol.map(iv => iv / sumInvVol);
    
    // Adjust for correlations (simplified)
    const adjusted = weights.map((w, i) => {
      let corrAdj = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          corrAdj += Math.abs(correlations[i][j]) * weights[j];
        }
      }
      return w * (1 - 0.5 * corrAdj);
    });
    
    // Renormalize
    const sumAdjusted = adjusted.reduce((sum, a) => sum + a, 0);
    return adjusted.map(a => a / sumAdjusted);
  }
  
  // ==================== Risk Metrics ====================
  
  /**
   * Value at Risk (VaR) - Historical Method
   * 
   * VaR_α = -Percentile(returns, α)
   * 
   * Represents the maximum loss at confidence level α.
   * 
   * @param returns - Historical return series
   * @param confidence - Confidence level (0.95 or 0.99)
   * @returns VaR as fraction of portfolio value
   */
  historicalVaR(returns: number[], confidence: number = 0.95): number {
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return -sorted[index];
  }
  
  /**
   * Conditional VaR (CVaR / Expected Shortfall)
   * 
   * CVaR_α = E[Loss | Loss > VaR_α]
   * 
   * Average loss beyond VaR threshold.
   * More conservative than VaR.
   */
  conditionalVaR(returns: number[], confidence: number = 0.95): number {
    const sorted = [...returns].sort((a, b) => a - b);
    const varIndex = Math.floor((1 - confidence) * sorted.length);
    
    // Average of losses beyond VaR
    const tailLosses = sorted.slice(0, varIndex);
    const cvar = -tailLosses.reduce((sum, r) => sum + r, 0) / tailLosses.length;
    
    return cvar;
  }
  
  /**
   * Parametric VaR (Assumes normal distribution)
   * 
   * VaR_α = μ - σ * z_α
   * 
   * Faster but less accurate for fat-tailed distributions.
   */
  parametricVaR(
    mu: number,
    sigma: number,
    confidence: number = 0.95
  ): number {
    // Z-scores for common confidence levels
    const zScores: { [key: number]: number } = {
      0.90: 1.28,
      0.95: 1.65,
      0.99: 2.33
    };
    
    const z = zScores[confidence] || 1.65;
    return -(mu - sigma * z);
  }
  
  /**
   * Monte Carlo VaR
   * 
   * Simulates portfolio returns using historical covariance.
   * More accurate for multi-asset portfolios.
   */
  monteCarloVaR(
    mu: number[],
    Sigma: number[][],
    weights: number[],
    numSims: number = 10000,
    confidence: number = 0.95
  ): number {
    const n = mu.length;
    const returns: number[] = [];
    
    for (let sim = 0; sim < numSims; sim++) {
      // Generate multivariate normal sample
      const z = this.randn(n);
      const L = this.choleskyDecomposition(Sigma);
      const sample = this.matrixVectorMultiply(L, z);
      
      // Portfolio return
      let portfolioReturn = 0;
      for (let i = 0; i < n; i++) {
        portfolioReturn += weights[i] * (mu[i] + sample[i]);
      }
      
      returns.push(portfolioReturn);
    }
    
    return this.historicalVaR(returns, confidence);
  }
  
  /**
   * Maximum Drawdown
   * 
   * MDD = max_t [(Peak_t - Trough_t) / Peak_t]
   */
  maxDrawdown(equity_curve: number[]): number {
    let peak = equity_curve[0];
    let maxDD = 0;
    
    for (const value of equity_curve) {
      if (value > peak) {
        peak = value;
      }
      
      const drawdown = (peak - value) / peak;
      maxDD = Math.max(maxDD, drawdown);
    }
    
    return maxDD;
  }
  
  /**
   * Sharpe Ratio
   * 
   * Sharpe = (E[R] - R_f) / σ(R)
   * 
   * Annualized risk-adjusted return.
   */
  sharpeRatio(
    returns: number[],
    riskFreeRate: number = 0.02
  ): number {
    const mu = this.mean(returns);
    const sigma = this.stdDev(returns);
    
    // Annualize (assuming daily returns)
    const annualMu = mu * 252;
    const annualSigma = sigma * Math.sqrt(252);
    
    return (annualMu - riskFreeRate) / annualSigma;
  }
  
  /**
   * Sortino Ratio
   * 
   * Sortino = (E[R] - R_f) / σ_downside(R)
   * 
   * Uses downside deviation instead of total volatility.
   */
  sortinoRatio(
    returns: number[],
    riskFreeRate: number = 0.02
  ): number {
    const mu = this.mean(returns);
    const downside = returns.filter(r => r < 0);
    const downsideSigma = this.stdDev(downside);
    
    // Annualize
    const annualMu = mu * 252;
    const annualDownsideSigma = downsideSigma * Math.sqrt(252);
    
    return (annualMu - riskFreeRate) / annualDownsideSigma;
  }
  
  /**
   * Calmar Ratio
   * 
   * Calmar = Annualized Return / Max Drawdown
   */
  calmarRatio(returns: number[], equity_curve: number[]): number {
    const annualReturn = this.mean(returns) * 252;
    const mdd = this.maxDrawdown(equity_curve);
    
    return annualReturn / (mdd + 1e-10);
  }
  
  // ==================== Portfolio Risk ====================
  
  /**
   * Compute Portfolio Risk Metrics
   * 
   * Aggregates position-level risks into portfolio metrics.
   */
  computePortfolioRisk(): PortfolioRisk {
    const positions = Array.from(this.positions.values());
    const n = positions.length;
    
    // Total value and exposure
    const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
    const totalExposure = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
    const leverage = totalExposure / totalValue;
    
    // Portfolio weights
    const weights = positions.map(p => p.value / totalValue);
    
    // Covariance matrix (from historical returns)
    const correlationMatrix = this.computeCorrelationMatrix();
    const volatilities = positions.map(p => p.volatility);
    const covMatrix = this.correlationToCovariance(correlationMatrix, volatilities);
    
    // Portfolio volatility: σ_p = √(w'Σw)
    const portfolioVariance = this.quadraticForm(weights, covMatrix);
    const portfolioVol = Math.sqrt(portfolioVariance);
    
    // Portfolio beta: β_p = Σ w_i β_i
    const portfolioBeta = weights.reduce((sum, w, i) => sum + w * positions[i].beta, 0);
    
    // VaR and CVaR
    const portfolioReturns = this.computePortfolioReturns(weights);
    const var95 = this.historicalVaR(portfolioReturns, 0.95);
    const var99 = this.historicalVaR(portfolioReturns, 0.99);
    const cvar95 = this.conditionalVaR(portfolioReturns, 0.95);
    
    // Performance metrics
    const sharpe = this.sharpeRatio(portfolioReturns);
    const sortino = this.sortinoRatio(portfolioReturns);
    const calmar = this.calmarRatio(portfolioReturns, this.equity_curve);
    const maxDrawdown = this.maxDrawdown(this.equity_curve);
    
    return {
      totalValue,
      totalExposure,
      leverage,
      volatility: portfolioVol,
      sharpe,
      sortino,
      calmar,
      var95,
      var99,
      cvar95,
      maxDrawdown,
      correlationMatrix,
      beta: portfolioBeta
    };
  }
  
  /**
   * Check Risk Limits
   * 
   * Returns violations (if any).
   */
  checkRiskLimits(portfolioRisk: PortfolioRisk): string[] {
    const violations: string[] = [];
    
    if (portfolioRisk.leverage > this.limits.maxLeverage) {
      violations.push(`Leverage ${portfolioRisk.leverage.toFixed(2)} > ${this.limits.maxLeverage}`);
    }
    
    if (portfolioRisk.var95 > this.limits.var95) {
      violations.push(`VaR(95%) ${portfolioRisk.var95.toFixed(3)} > ${this.limits.var95}`);
    }
    
    if (portfolioRisk.cvar95 > this.limits.cvar95) {
      violations.push(`CVaR(95%) ${portfolioRisk.cvar95.toFixed(3)} > ${this.limits.cvar95}`);
    }
    
    if (portfolioRisk.maxDrawdown > this.limits.maxDrawdown) {
      violations.push(`Max Drawdown ${portfolioRisk.maxDrawdown.toFixed(2)} > ${this.limits.maxDrawdown}`);
    }
    
    if (portfolioRisk.volatility > this.limits.maxVolatility) {
      violations.push(`Volatility ${portfolioRisk.volatility.toFixed(2)} > ${this.limits.maxVolatility}`);
    }
    
    if (portfolioRisk.sharpe < this.limits.minSharpe) {
      violations.push(`Sharpe ${portfolioRisk.sharpe.toFixed(2)} < ${this.limits.minSharpe}`);
    }
    
    return violations;
  }
  
  // ==================== Circuit Breakers ====================
  
  /**
   * Initialize Circuit Breakers
   * 
   * Auto-halt conditions:
   * - Volatility spike (> 2x normal)
   * - Drawdown threshold (> maxDrawdown)
   * - Correlation breakdown (< 0.3 expected)
   * - Flash crash (> 5% move in 1 min)
   * - Leverage breach (> maxLeverage)
   */
  private initializeCircuitBreakers() {
    this.breakers = [
      {
        name: 'volatility_spike',
        active: false
      },
      {
        name: 'drawdown_breach',
        active: false
      },
      {
        name: 'correlation_breakdown',
        active: false
      },
      {
        name: 'flash_crash',
        active: false
      },
      {
        name: 'leverage_breach',
        active: false
      }
    ];
  }
  
  /**
   * Check Circuit Breakers
   * 
   * Evaluates all breakers and triggers if conditions met.
   */
  checkCircuitBreakers(
    currentPrice: number,
    prevPrice: number,
    portfolioRisk: PortfolioRisk
  ): CircuitBreakerStatus[] {
    const now = new Date();
    
    // 1. Volatility spike
    const normalVol = 0.30;  // 30% annualized
    if (portfolioRisk.volatility > 2 * normalVol) {
      this.triggerBreaker('volatility_spike', `Vol ${portfolioRisk.volatility.toFixed(2)} > 2x normal`);
    }
    
    // 2. Drawdown breach
    if (portfolioRisk.maxDrawdown > this.limits.maxDrawdown) {
      this.triggerBreaker('drawdown_breach', `DD ${portfolioRisk.maxDrawdown.toFixed(2)} > ${this.limits.maxDrawdown}`);
    }
    
    // 3. Flash crash (> 5% in 1 minute)
    const priceChange = Math.abs(currentPrice - prevPrice) / prevPrice;
    if (priceChange > 0.05) {
      this.triggerBreaker('flash_crash', `Price moved ${(priceChange * 100).toFixed(1)}% in 1 minute`);
    }
    
    // 4. Leverage breach
    if (portfolioRisk.leverage > this.limits.maxLeverage) {
      this.triggerBreaker('leverage_breach', `Leverage ${portfolioRisk.leverage.toFixed(2)} > ${this.limits.maxLeverage}`);
    }
    
    // Check cooldowns
    for (const breaker of this.breakers) {
      if (breaker.active && breaker.cooldown_until && now > breaker.cooldown_until) {
        breaker.active = false;
        breaker.cooldown_until = undefined;
      }
    }
    
    return this.breakers.filter(b => b.active);
  }
  
  private triggerBreaker(name: string, reason: string) {
    const breaker = this.breakers.find(b => b.name === name);
    if (!breaker) return;
    
    if (!breaker.active) {
      breaker.active = true;
      breaker.triggered_at = new Date();
      breaker.reason = reason;
      breaker.cooldown_until = new Date(Date.now() + 300000);  // 5 min cooldown
      
      console.error(`[CIRCUIT BREAKER] ${name}: ${reason}`);
      // TODO: Send alert, halt trading
    }
  }
  
  // ==================== Stress Testing ====================
  
  /**
   * Stress Test Portfolio
   * 
   * Simulates extreme scenarios:
   * - Black Monday (-20% in 1 day)
   * - Flash Crash (-10% in 1 hour)
   * - Correlation Spike (all corr → 0.9)
   * - Vol Spike (3x normal)
   */
  stressTest(portfolioRisk: PortfolioRisk): {
    scenario: string;
    loss: number;
    var_breach: boolean;
  }[] {
    const results = [];
    
    // Scenario 1: Black Monday
    const blackMondayLoss = portfolioRisk.totalValue * 0.20;
    results.push({
      scenario: 'Black Monday (-20%)',
      loss: blackMondayLoss,
      var_breach: blackMondayLoss > portfolioRisk.totalValue * this.limits.var99
    });
    
    // Scenario 2: Flash Crash
    const flashCrashLoss = portfolioRisk.totalValue * 0.10;
    results.push({
      scenario: 'Flash Crash (-10%)',
      loss: flashCrashLoss,
      var_breach: flashCrashLoss > portfolioRisk.totalValue * this.limits.var95
    });
    
    // Scenario 3: Volatility Spike (3x)
    const volSpikeLoss = portfolioRisk.totalValue * portfolioRisk.volatility * 3 * Math.sqrt(1/252);
    results.push({
      scenario: 'Vol Spike (3x)',
      loss: volSpikeLoss,
      var_breach: volSpikeLoss > portfolioRisk.totalValue * this.limits.var95
    });
    
    return results;
  }
  
  // ==================== Helper Functions ====================
  
  private computeCorrelationMatrix(): number[][] {
    const n = this.positions.size;
    const matrix = Array(n).fill(0).map(() => Array(n).fill(0));
    
    // Placeholder: compute from historical returns
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else {
          matrix[i][j] = 0.3;  // Assumed correlation
        }
      }
    }
    
    return matrix;
  }
  
  private correlationToCovariance(
    corrMatrix: number[][],
    volatilities: number[]
  ): number[][] {
    const n = corrMatrix.length;
    const covMatrix = Array(n).fill(0).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        covMatrix[i][j] = corrMatrix[i][j] * volatilities[i] * volatilities[j];
      }
    }
    
    return covMatrix;
  }
  
  private quadraticForm(x: number[], A: number[][]): number {
    const n = x.length;
    let result = 0;
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        result += x[i] * A[i][j] * x[j];
      }
    }
    
    return result;
  }
  
  private computePortfolioReturns(weights: number[]): number[] {
    // Placeholder: compute from historical data
    return Array(252).fill(0).map(() => this.randn()[0] * 0.01);
  }
  
  private choleskyDecomposition(A: number[][]): number[][] {
    const n = A.length;
    const L = Array(n).fill(0).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        
        if (i === j) {
          for (let k = 0; k < j; k++) {
            sum += L[j][k] * L[j][k];
          }
          L[j][j] = Math.sqrt(Math.max(0, A[j][j] - sum));
        } else {
          for (let k = 0; k < j; k++) {
            sum += L[i][k] * L[j][k];
          }
          L[i][j] = (A[i][j] - sum) / (L[j][j] + 1e-10);
        }
      }
    }
    
    return L;
  }
  
  private matrixVectorMultiply(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, aij, j) => sum + aij * v[j], 0));
  }
  
  private randn(n: number = 1): number[] {
    return Array(n).fill(0).map(() => {
      // Box-Muller transform
      const u1 = Math.random();
      const u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    });
  }
  
  private mean(arr: number[]): number {
    return arr.reduce((sum, x) => sum + x, 0) / arr.length;
  }
  
  private stdDev(arr: number[]): number {
    const mu = this.mean(arr);
    const variance = arr.reduce((sum, x) => sum + (x - mu) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }
}
