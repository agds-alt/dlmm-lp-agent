# DLMM LP Agent - Project Overview

**Created**: March 31, 2026
**Version**: 0.1.0 (Development)
**Status**: Phase 1 - PoC in Progress

---

## 🎯 Project Goal

Build an automated Liquidity Provider agent for Meteora DLMM that targets new token launches on Solana with aggressive quick-flip strategy.

---

## 📊 Strategy Specifications

### Capital & Risk Management
- **Starting Capital**: $50 USD
- **Target Daily Gain**: 20%
- **Max Loss per Position**: 10%
- **Max Impermanent Loss**: 10% (auto-exit)
- **Position Count**: 3 simultaneous positions
- **Capital Allocation**: $15 per position, $5 reserve

### Token Criteria
- **Age**: 3-7 days from creation (new launches)
- **Volume**: $50k - $500k daily (sweet spot)
- **Liquidity**: Minimum $10k
- **Safety**: Must pass Tier 1-4 screening filters

### Execution Strategy
- **Entry**: Auto-detect or manual CA input
- **Bin Range**: ±5-8% from current price (tight)
- **Rebalancing**: 6-12x daily (semi-aggressive)
- **Exit**: +20% profit OR -10% loss/IL

---

## 🏗️ Implementation Plan

### **Option A: Quick PoC (2-3 hours)** - CURRENT
**Goal**: Validate approach with minimal viable product

**Deliverables**:
- ✅ Basic project structure
- ⏳ Token scanner (Tier 1 filters only)
- ⏳ Solana connection + DLMM pool reading
- ⏳ Test with SOL-TROLL, SOL-POPCAT
- ⏳ Documentation of results

**Success Criteria**:
- Can connect to Solana RPC
- Can read DLMM pool data
- Can evaluate token safety (basic)
- Can identify bin ranges

---

### **Option C: Token Scanner (3-4 days)** - NEXT
**Goal**: Build comprehensive token discovery system

**Deliverables**:
- Complete Tier 1-4 safety filters
- Auto-detection of new launches
- Volume & liquidity analysis
- Trending score algorithm
- Top 10 candidate ranking system

**Success Criteria**:
- Detects tokens aged 3-7 days
- Filters out rugpulls/scams
- Scores tokens 0-100
- Returns top candidates daily

---

### **Option B: Full Foundation (1 week)** - AFTER C
**Goal**: Solid foundation for strategy implementation

**Deliverables**:
- Complete Phase 1 components
- Paper trading framework
- Database setup (positions, performance)
- Logging & monitoring system
- Error handling & retry logic

**Success Criteria**:
- Can simulate trades without real funds
- All transactions logged
- Performance metrics tracked
- System runs 24/7 stable

---

## 🔐 Safety Filters Overview

### Tier 1: Critical Safety (Instant Reject)
- Age < 3 days or > 30 days
- Freeze authority enabled
- Mint authority enabled
- Top holder > 20% supply
- Liquidity < $10k
- No verified contract

### Tier 2: Volume & Activity
- 24h volume: $50k - $500k
- Unique traders: > 100 wallets
- Buy/Sell ratio: 0.7 - 1.3
- Liquidity/Volume ratio: > 5%

### Tier 3: Price Action (Range-Bound)
- 7-day volatility: 30-60%
- Current phase: Consolidation
- Bin distribution: ±15% range

### Tier 4: Smart Money Signals
- Listed on Jupiter
- Listed on Birdeye/DEXScreener
- Active community (>500 members)
- Fresh DLMM listings (<7 days)

---

## 📈 Performance Expectations

### Daily Target: 20%

**Breakdown**:
- Fees earned: 5-10%
- Price appreciation: 10-15%
- Rebalancing alpha: 5%

**Realistic Outcomes**:
- ✅ Good days: 25-40% (all 3 positions profit)
- ⚖️ Average days: 10-15% (mixed results)
- ❌ Bad days: -5% to -10% (stopped out)

**Win Rate Needed**:
- 70% win rate (7/10 positions profit)
- Average winner: +30%
- Average loser: -10%
- Net: 18-20% daily

---

## 🛠️ Tech Stack

### Core Dependencies
- `@solana/web3.js` - Blockchain interaction
- `@meteora-ag/dlmm` - DLMM SDK
- `@project-serum/anchor` - Smart contracts
- `axios` - HTTP requests
- `node-telegram-bot-api` - Notifications

### Development
- TypeScript 5.3+
- Node.js 20+
- pnpm (package manager)

### Infrastructure
- Helius RPC (Solana endpoint)
- PostgreSQL (future - for now in-memory)
- Telegram Bot API

---

## 📊 Operation Modes

### Mode 1: Full Auto
- Agent selects all 3 positions automatically
- Zero user intervention required
- Sends notifications only
- Best for: Hands-off operation

### Mode 2: Manual Approve
- Agent scans and ranks top 10 candidates
- User approves top 3 to enter
- Agent handles execution & exits
- Best for: Learning & control

---

## 🚨 Risk Management

### Position-Level Stops
- Max loss: 10% → immediate exit
- Max IL: 10% → immediate exit
- Volume drop >70% → exit
- Large holder dump detected → exit

### Portfolio-Level Stops
- Daily drawdown >15% → pause new entries
- SOL dumps >10% in 1h → exit all positions
- RPC connection lost → emergency mode

### Emergency Procedures
- Manual override via Telegram
- Instant position liquidation
- Withdraw all funds to wallet
- Detailed alert logs

---

## 📝 Development Log

### March 31, 2026 - Initial Setup
- ✅ Project structure created
- ✅ Package.json configured
- ✅ TypeScript setup
- ✅ Documentation framework
- ⏳ Starting Option A implementation

---

## 🎯 Next Steps

1. ✅ Complete Option A PoC (today)
2. Document PoC results
3. Begin Option C (token scanner)
4. Implement Tier 1-4 filters
5. Test with real market data
6. Move to Option B (foundation)

---

## 📞 Contact & Support

For questions or issues, refer to:
- `/docs/architecture.md` - System design
- `/docs/safety-filters.md` - Token screening details
- `/docs/troubleshooting.md` - Common issues

---

**Last Updated**: March 31, 2026
**Next Review**: After Option A completion
