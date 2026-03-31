# DLMM LP Agent 🤖

Automated Liquidity Provider Agent for Meteora DLMM on Solana

## 🎯 Strategy Overview

**Quick flip strategy** targeting new token launches (3-7 days old) with aggressive risk management:

- **Capital**: $50 USD starting capital
- **Target**: 20% daily gain
- **Risk**: Max 10% loss per position, Max 10% IL auto-exit
- **Positions**: 3 simultaneous positions across different tokens
- **Rebalancing**: 6-12x daily (semi-aggressive)

## 📊 Key Features

- ✅ Dual operation modes (Full Auto / Manual Approve)
- ✅ Multi-tier token safety screening
- ✅ Real-time IL monitoring
- ✅ Automated rebalancing (6-12x daily)
- ✅ Telegram notifications
- ✅ Emergency stop mechanisms
- ✅ Paper trading mode for testing

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Run in paper trading mode:**
   ```bash
   pnpm test
   ```

4. **Start the agent:**
   ```bash
   pnpm dev
   ```

## 📁 Project Structure

```
dlmm-lp-agent/
├── src/
│   ├── config/          # Configuration files
│   ├── core/            # Core Solana/DLMM functionality
│   ├── scanner/         # Token discovery & screening
│   ├── strategy/        # LP strategy logic
│   ├── execution/       # Transaction execution
│   ├── notifications/   # Telegram alerts
│   ├── modes/           # Full Auto / Manual Approve
│   ├── database/        # Position & performance tracking
│   └── utils/           # Helper functions
├── tests/               # Testing & paper trading
├── scripts/             # Deployment & backtest scripts
└── docs/                # Documentation
```

## 📖 Documentation

See `/docs` folder for detailed documentation:

- [Phase 1: PoC](docs/phase-1-poc.md)
- [Phase 2: Token Scanner](docs/phase-2-scanner.md)
- [Phase 3: Core Strategy](docs/phase-3-strategy.md)
- [Architecture](docs/architecture.md)
- [Safety Filters](docs/safety-filters.md)

## ⚠️ Disclaimer

This is experimental software for educational purposes. Use at your own risk. Cryptocurrency trading involves substantial risk of loss.

## 📝 License

MIT
