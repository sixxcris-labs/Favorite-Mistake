# Favorite Mistake v2.0

AI Crypto Bot: DQN-LSTM + Attention + DEX Arb + Sentiment.

## Setup
```bash
make setup
nano .env  # Add BINANCE_API_KEY, INFURA_URL
make start
make train-gpu
curl -X POST http://localhost:8080/trade/start -d '{"strategy":"dex-arb"}'
```

## Services
- API: http://localhost:8080
- Dashboard: http://localhost:3001
- Grafana: http://localhost:3000

## Utilities
- `go run scripts/train.go -strategy dex-arb -capital 2500` queues a gRPC trade task.
