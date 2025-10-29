# 🚀 Deployment & Operations Guide

## Military-Grade Crypto Quant System - Production Deployment

---

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INGESTION LAYER                              │
├─────────────────────────────────────────────────────────────────────┤
│  Exchange APIs  │  WebSocket Feeds  │  Historical Data  │  Alt Data │
│  (ccxt)         │  (real-time)      │  (TimescaleDB)    │  (custom) │
└────────┬────────┴───────────┬────────┴─────────┬────────┴───────────┘
         │                    │                   │
         ▼                    ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PROVENANCE & ADMISSION                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Source Tags  │  │ Trust Scores │  │ Rate Limiters│             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Crypto Bind  │  │ Quotas       │  │ SNR Guards   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└────────┬──────────────────────┬──────────────────────┬─────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ROBUST ESTIMATION LAYER                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  STRATIFIED RESERVOIR                                        │   │
│  │  • Trust-weighted sampling                                   │   │
│  │  • Per-source caps (50-200)                                  │   │
│  │  • Balanced representation                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  INFLUENCE CLIPPING                                          │   │
│  │  • Mahalanobis distance ≤ 3σ                                │   │
│  │  • Per-sample bounded contribution                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ROBUST ESTIMATORS                                           │   │
│  │  • Catoni Mean (c=2.0)                                       │   │
│  │  • MRCD Covariance (α=0.3 shrinkage)                        │   │
│  │  • Median-of-Means (K=10 blocks)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MULTI-MODEL GATING                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐              ┌────────────────────┐        │
│  │  ADAPTIVE MODEL    │◄─── GATE ───►│  REFERENCE MODEL   │        │
│  │  (learns live)     │              │  (golden set)      │        │
│  │  μ_A, Σ_A          │              │  μ_R, Σ_R          │        │
│  └────────────────────┘              └────────────────────┘        │
│           │                                      │                  │
│           ▼                                      ▼                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  CORRIDOR CHECKS                                             │   │
│  │  ✓ Mahalanobis: ||μ_A - μ_R||_{Σ_R^{-1}} ≤ 0.5            │   │
│  │  ✓ Spectral: eigenvalues within ±15%                        │   │
│  │  ✓ KL Divergence: ≤ 0.1 nats                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│           │ PASS ✓                    │ FAIL ✗                     │
│           ▼                            ▼                            │
│    ┌──────────┐                ┌──────────────┐                    │
│    │  UPDATE  │                │   ROLLBACK   │                    │
│    └──────────┘                └──────────────┘                    │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     QUANTITATIVE ANALYSIS                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ REGIME DETECTION │  │  VOL SURFACES    │  │  MICROSTRUCTURE│   │
│  │ • HMM (4 states) │  │  • SABR model    │  │  • OFI         │   │
│  │ • CUSUM alerts   │  │  • Calibration   │  │  • VPIN        │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │  CORRELATION     │  │   ALPHA SIGNALS  │  │  TOXIC FILTER  │   │
│  │  • Network       │  │   • ML + Quant   │  │  • Kyle Lambda │   │
│  │  • Contagion     │  │   • Ensemble     │  │  • Spread Decomp│   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       TRADING DECISION                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  DQN AGENT (Robust)                                          │   │
│  │  State: [price, vol, OFI, VPIN, regime, ...]               │   │
│  │  Actions: [buy, sell, hold]                                 │   │
│  │  Training: Clipped rewards, adversarial examples            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       RISK MANAGEMENT                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ POSITION SIZING  │  │  VAR / CVAR      │  │  KELLY CRITERION│   │
│  │ • Vol-adjusted   │  │  • 95%, 99%      │  │  • Quarter-Kelly│   │
│  │ • Risk parity    │  │  • Monte Carlo   │  │  • Vol scaling  │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ CIRCUIT BREAKERS                                              │  │
│  │ • Volatility spike (> 2x normal)                             │  │
│  │ • Drawdown (> 20%)                                           │  │
│  │ • Flash crash (> 5% in 1 min)                                │  │
│  │ • Leverage (> 2.0x)                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       EXECUTION LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ SMART ROUTING    │  │  SLIPPAGE GUARDS │  │  STEALTH       │   │
│  │ • Multi-exchange │  │  • Price bounds  │  │  • Human-like  │   │
│  │ • TWAP / VWAP    │  │  • Timeout       │  │  • TLS vary    │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       MONITORING & ALERTING                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ PROMETHEUS       │  │  GRAFANA         │  │  JAEGER        │   │
│  │ • Metrics        │  │  • Dashboards    │  │  • Tracing     │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ALERTS: Slack / PagerDuty / Email                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Installation

### Prerequisites

```bash
# System requirements
- Node.js >= 18.0
- Python >= 3.9 (for quantitative libraries)
- Docker >= 20.10
- Kubernetes >= 1.28 (optional, for prod)
- MongoDB >= 7.0
- Redis >= 7.0
- TimescaleDB >= 2.14
```

### Step 1: Clone & Install

```bash
git clone <repo-url>
cd crypto-quant-adversarial

# Backend
cd backend
npm install
npm run build

# Frontend (if needed)
cd ../frontend
npm install
npm run build
```

### Step 2: Environment Configuration

```bash
cp .env.example .env
nano .env
```

**Key Environment Variables:**

```bash
# Exchange API Keys
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here

# Database
MONGO_URI=mongodb://localhost:27017/crypto-quant
REDIS_URL=redis://localhost:6379
TIMESCALE_URL=postgresql://localhost:5432/market_data

# Risk Parameters
MAX_LEVERAGE=2.0
MAX_POSITION_SIZE=0.2
VAR_95_LIMIT=0.05
KELLY_FRACTION=0.25

# Circuit Breaker Thresholds
CB_VOLATILITY_THRESHOLD=0.60
CB_DRAWDOWN_THRESHOLD=0.20
CB_FLASH_CRASH_THRESHOLD=0.05

# Robust Estimator Config
CATONI_C=2.0
MRCD_ALPHA=0.3
CLIP_RADIUS=3.0
TAU_MU=0.5
TAU_SIGMA=0.15
KL_THRESHOLD=0.1

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Alerts
SLACK_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
PAGERDUTY_KEY=your_pagerduty_integration_key
```

### Step 3: Database Setup

```bash
# Start infrastructure
docker-compose up -d mongo redis timescaledb

# Initialize databases
npm run db:migrate
npm run db:seed:golden  # Load golden set
```

### Step 4: Train Models

```bash
# Train robust DQN agent
npm run train:robust -- --symbol BTC/USDT --episodes 5000

# Calibrate reference model
npm run calibrate:reference -- --golden-set ./data/golden_set.json

# Verify models
npm run verify:models
```

---

## 🎯 Operational Procedures

### Daily Operations

**Morning Routine (Pre-Market)**

```bash
# 1. Check system health
curl http://localhost:5000/api/health

# 2. Review overnight metrics
curl http://localhost:5000/api/monitoring/overnight

# 3. Validate circuit breakers
curl http://localhost:5000/api/circuit-breakers/status

# 4. Check risk limits
curl http://localhost:5000/api/risk/portfolio

# 5. Review golden set anchor drift
curl http://localhost:5000/api/monitoring/anchor-drift
```

**Real-Time Monitoring**

```bash
# Grafana dashboards
open http://localhost:3001/d/crypto-quant-main

# Watch logs
docker logs -f crypto-quant-backend

# Stream metrics
curl -N http://localhost:5000/api/monitoring/stream
```

**End-of-Day Routine**

```bash
# 1. Generate daily report
npm run report:daily

# 2. Checkpoint models
npm run checkpoint:models

# 3. Backup data
npm run backup:all

# 4. Review performance
npm run performance:analyze
```

---

## 🛡️ Circuit Breaker Management

### Breaker Types & Thresholds

| Breaker | Threshold | Action | Cooldown |
|---------|-----------|--------|----------|
| Volatility Spike | Vol > 2x normal | Freeze | 5 min |
| Drawdown | DD > 20% | Rollback | 10 min |
| Flash Crash | |ΔP| > 5% in 1 min | Halt | 5 min |
| Leverage | Lev > 2.0x | Reduce | 1 min |
| Anchor Anomaly | P(D_M > τ) < 0.0001 | Rollback | 10 min |
| VPIN Toxicity | VPIN > 0.75 | Skip Learn | 2 min |
| KL Divergence | KL > 0.2 | Rollback | 10 min |
| Provenance Conc | HHI > 0.2 | Freeze | 1 min |

### Manual Override

```bash
# Disable breaker (emergency only)
curl -X POST http://localhost:5000/api/circuit-breakers/disable \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"breaker": "volatility_spike", "duration": 300}'

# Force rollback
curl -X POST http://localhost:5000/api/models/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Clear all breakers (use with EXTREME caution)
curl -X POST http://localhost:5000/api/circuit-breakers/clear-all \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 📊 Key Metrics to Monitor

### Model Health

- **Mahalanobis Drift**: ||μ_A - μ_R||_{Σ_R^{-1}} (target: < 0.5)
- **Spectral Norm**: eigenvalue range (target: [0.85, 1.15])
- **KL Divergence**: (target: < 0.1 nats)
- **Anchor Anomaly Rate**: (target: < 0.01%)

### Portfolio Risk

- **VaR (95%)**: (target: < 5%)
- **CVaR (95%)**: (target: < 7.5%)
- **Max Drawdown**: (target: < 20%)
- **Sharpe Ratio**: (target: > 1.5)
- **Leverage**: (target: < 2.0x)

### Market Microstructure

- **VPIN**: (threshold: 0.75)
- **Spread**: (monitor for widening)
- **Depth**: (monitor for depletion)
- **Kyle's Lambda**: (price impact)

### Data Quality

- **Provenance Entropy**: (target: > 2.0)
- **Herfindahl Index**: (target: < 0.15)
- **Update Rejection Rate**: (target: < 5%)
- **Unique Sources**: (target: > 5)

---

## 🚨 Incident Response

### Scenario 1: Circuit Breaker Triggered

**Symptoms**: Alert received, trading halted

**Response:**
1. Identify triggering breaker
2. Review last 100 trades
3. Check data feeds for anomalies
4. Inspect model drift metrics
5. If legitimate market event → wait for cooldown
6. If attack detected → rollback + investigate

```bash
# Investigate
curl http://localhost:5000/api/incidents/latest

# Review influencers
curl http://localhost:5000/api/monitoring/top-influences

# Rollback if needed
curl -X POST http://localhost:5000/api/models/rollback
```

### Scenario 2: Anchor Drift Detected

**Symptoms**: Golden set anomaly rate > 0.0001

**Response:**
1. Automatic rollback triggered
2. Review adaptive model update history
3. Identify poisoned data sources
4. Update trust scores / ban sources
5. Re-calibrate if needed

```bash
# Get drift report
curl http://localhost:5000/api/monitoring/anchor-drift/report

# Identify bad sources
curl http://localhost:5000/api/provenance/suspicious

# Ban sources
curl -X POST http://localhost:5000/api/provenance/ban \
  -d '{"sources": ["source-id-1", "source-id-2"]}'
```

### Scenario 3: Flash Crash

**Symptoms**: |ΔP| > 5% in 1 minute

**Response:**
1. Circuit breaker halts trading
2. Check if legitimate market event (news scan)
3. Review liquidation cascades
4. Assess portfolio impact
5. Decide: wait (if market-wide) or liquidate (if targeted)

```bash
# Check news
curl "http://newsapi.org/v2/everything?q=crypto+crash"

# Portfolio impact
curl http://localhost:5000/api/risk/stress-test

# Liquidate if needed
curl -X POST http://localhost:5000/api/trade/emergency-liquidate \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 🔬 Backtesting & Validation

### Run Comprehensive Backtest

```bash
npm run backtest -- \
  --symbol BTC/USDT \
  --start 2023-01-01 \
  --end 2024-12-31 \
  --capital 100000 \
  --strategy robust_dqn \
  --risk-profile conservative
```

### Adversarial Robustness Testing

```bash
# Simulate attacks
npm run attack:simulate -- \
  --type wash_trading \
  --intensity 0.05 \
  --duration 24h

npm run attack:simulate -- \
  --type data_poisoning \
  --samples 1000 \
  --offset 2.0

# Measure impact
npm run attack:measure-impact
```

### Stress Testing

```bash
# Run all scenarios
npm run stress:test -- --scenarios all

# Specific scenario
npm run stress:test -- --scenario black_monday

# Custom scenario
npm run stress:test -- \
  --custom \
  --price-drop 0.30 \
  --vol-spike 3.0 \
  --correlation 0.95
```

---

## 📈 Performance Benchmarks

### Expected Metrics (Live Trading)

| Metric | Target | Acceptable | Alarm |
|--------|--------|------------|-------|
| Sharpe Ratio | > 2.0 | > 1.5 | < 1.0 |
| Max Drawdown | < 15% | < 20% | > 25% |
| Win Rate | > 60% | > 55% | < 50% |
| Profit Factor | > 1.8 | > 1.5 | < 1.2 |
| VaR (95%) | < 3% | < 5% | > 7% |
| Avg Trade | > 0.5% | > 0.2% | < 0% |

### System Performance

| Component | Latency | Throughput |
|-----------|---------|------------|
| Data Ingestion | < 10ms | 10k msgs/sec |
| Robust Update | < 50ms | 100 updates/sec |
| Risk Check | < 5ms | 1000 checks/sec |
| Order Execution | < 100ms | 50 orders/sec |
| Circuit Breaker | < 1ms | Real-time |

---

## 🔐 Security Considerations

### API Key Management

- Store keys in secure vault (AWS Secrets Manager, HashiCorp Vault)
- Rotate keys every 90 days
- Use IP whitelisting on exchange accounts
- Enable 2FA on all accounts
- Monitor for unauthorized access

### Network Security

- Deploy behind VPC
- Use TLS 1.3 for all connections
- mTLS for inter-service communication
- Rate limiting on all endpoints
- DDoS protection (Cloudflare, AWS Shield)

### Data Protection

- Encrypt data at rest (AES-256)
- Encrypt backups
- Audit logs for all operations
- GDPR compliance (if applicable)
- Regular security audits

---

## 📞 Support & Escalation

### Level 1: Monitoring Alerts

- Automatic notifications to Slack
- Self-healing via circuit breakers
- Logs to ELK stack

### Level 2: Performance Degradation

- PagerDuty alerts on-call engineer
- Review dashboards
- Apply fixes / rollback

### Level 3: Critical Incidents

- Escalate to senior engineers
- Emergency rollback
- Post-mortem analysis
- System hardening

---

## 📚 Further Reading

- **Robust Statistics**: Huber (1981)
- **Market Microstructure**: O'Hara (1995)
- **Quantitative Trading**: Chan (2009)
- **Risk Management**: Jorion (2006)
- **Adversarial ML**: Goodfellow et al. (2014)

---

## ✅ Pre-Launch Checklist

```
□ All dependencies installed
□ Environment variables configured
□ Databases initialized
□ Golden set loaded
□ Models trained & validated
□ Backtests passed (Sharpe > 1.5)
□ Adversarial tests passed (< 5% impact)
□ Circuit breakers functional
□ Monitoring dashboards live
□ Alert channels configured
□ Paper trading successful (1 week)
□ Small capital test (< $1k, 1 week)
□ Risk limits verified
□ Incident response plan documented
□ Team trained on procedures
```

---

**Remember**: This is a high-stakes system. Start with paper trading, then small capital, then scale gradually. Monitor constantly, especially in first weeks.

**Production readiness timeline**: 3-6 months of testing recommended before significant capital deployment.
