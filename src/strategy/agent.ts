/**
 * DLMM LP Agent - Main Orchestrator
 *
 * Ties everything together:
 * 1. Scan for tokens (4-tier filter)
 * 2. Find DLMM pools
 * 3. Open LP positions
 * 4. Monitor & rebalance
 * 5. Auto-exit on risk limits
 */

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '../utils/logger';
import {
  STRATEGY_CONFIG,
  POSITION_CONFIG,
  OPERATION_MODE,
  WALLET_CONFIG,
  TIME_CONSTANTS,
  EMERGENCY_STOPS,
  getRpcUrl,
  validateConfig,
} from '../config/constants';
import { DLMMPoolReader } from '../core/dlmm.pool';
import { TokenScanner } from '../scanner/token.scanner';
import { PositionManager, Position } from './position.manager';
import { Rebalancer } from './rebalancer';

export interface AgentStatus {
  running: boolean;
  mode: string;
  paper: boolean;
  uptime: number;
  positions: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  feesEarned: number;
  cyclesCompleted: number;
  lastScan: number;
  lastRebalance: number;
}

export class DLMMAgent {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private poolReader: DLMMPoolReader;
  private scanner: TokenScanner;
  private positionManager: PositionManager;
  private rebalancer: Rebalancer;

  private running = false;
  private startTime = 0;
  private cyclesCompleted = 0;
  private lastScanTime = 0;
  private lastRebalanceTime = 0;

  // SOL mint for pairing
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';

  constructor() {
    const rpcUrl = getRpcUrl();
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Setup wallet if available
    if (WALLET_CONFIG.PRIVATE_KEY && !OPERATION_MODE.PAPER_TRADING) {
      try {
        this.wallet = Keypair.fromSecretKey(bs58.decode(WALLET_CONFIG.PRIVATE_KEY));
        logger.info(`Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
      } catch {
        logger.error('Invalid wallet private key');
      }
    }

    this.poolReader = new DLMMPoolReader(this.connection);
    this.scanner = new TokenScanner(this.connection);
    this.positionManager = new PositionManager(this.connection, this.wallet);
    this.rebalancer = new Rebalancer(this.connection, this.poolReader, this.positionManager);
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (!validateConfig()) {
      logger.error('Invalid configuration. Aborting.');
      return;
    }

    this.running = true;
    this.startTime = Date.now();

    const mode = OPERATION_MODE.PAPER_TRADING ? 'PAPER' : 'LIVE';
    logger.info('='.repeat(50));
    logger.info('  DLMM LP AGENT STARTED');
    logger.info(`  Mode: ${mode}`);
    logger.info(`  Capital: $${STRATEGY_CONFIG.STARTING_CAPITAL}`);
    logger.info(`  Max Positions: ${STRATEGY_CONFIG.MAX_POSITIONS}`);
    logger.info(`  Target: +${STRATEGY_CONFIG.TARGET_DAILY_GAIN}%/day`);
    logger.info(`  Risk: -${STRATEGY_CONFIG.MAX_LOSS_PERCENT}% max loss, -${STRATEGY_CONFIG.MAX_IL_PERCENT}% max IL`);
    logger.info('='.repeat(50));

    // Main loop
    while (this.running) {
      try {
        await this.cycle();
        this.cyclesCompleted++;

        // Wait before next cycle
        const waitMs = Math.min(TIME_CONSTANTS.REBALANCE_INTERVAL_MS, 5 * 60 * 1000); // Max 5 min
        logger.info(`Cycle #${this.cyclesCompleted} complete. Next in ${(waitMs / 1000 / 60).toFixed(1)}min`);
        await this.sleep(waitMs);
      } catch (error) {
        logger.error(`Cycle error: ${error}`);
        await this.sleep(30000); // Wait 30s on error
      }
    }

    logger.info('Agent stopped.');
  }

  /**
   * Single agent cycle
   */
  async cycle(): Promise<void> {
    const openPositions = this.positionManager.getOpenPositions();
    logger.info(`--- Cycle #${this.cyclesCompleted + 1} | Positions: ${openPositions.length}/${STRATEGY_CONFIG.MAX_POSITIONS} ---`);

    // 1. Update all positions
    for (const pos of openPositions) {
      await this.positionManager.updatePosition(pos.id);
    }

    // 2. Check risk limits
    const alerts = this.positionManager.checkRiskLimits();
    for (const alert of alerts) {
      logger.warn(`RISK ALERT: ${alert.reason}`);
      await this.positionManager.closePosition(alert.positionId);
    }

    // 3. Rebalance existing positions
    const rebalResult = await this.rebalancer.runCycle();
    if (rebalResult.rebalanced > 0 || rebalResult.closed > 0) {
      logger.info(`Rebalance: ${rebalResult.rebalanced} rebalanced, ${rebalResult.closed} closed`);
    }
    this.lastRebalanceTime = Date.now();

    // 4. If we have room, scan for new opportunities
    const currentOpen = this.positionManager.getOpenPositions().length;
    if (currentOpen < STRATEGY_CONFIG.MAX_POSITIONS) {
      await this.scanAndEnter(STRATEGY_CONFIG.MAX_POSITIONS - currentOpen);
    }

    // 5. Print status
    this.printStatus();
  }

  /**
   * Scan for tokens and enter new positions
   */
  async scanAndEnter(maxNew: number): Promise<void> {
    logger.info(`Scanning for ${maxNew} new position(s)...`);
    this.lastScanTime = Date.now();

    try {
      // Use scanner to find top candidates
      // For now, use a predefined watchlist of popular DLMM tokens
      const watchlist = [
        'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
        '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
      ];

      for (const tokenMint of watchlist) {
        if (maxNew <= 0) break;

        // Scan token
        const result = await this.scanner.scanToken(tokenMint);
        if (!result || result.score < 75) {
          logger.info(`Token ${tokenMint.slice(0, 8)}... score ${result?.score || 0} - skipped`);
          continue;
        }

        // Find DLMM pool
        const pools = await this.poolReader.findPools(tokenMint, this.SOL_MINT);
        if (pools.length === 0) {
          logger.info(`No DLMM pool found for ${tokenMint.slice(0, 8)}...`);
          continue;
        }

        // Analyze best pool
        const analysis = await this.poolReader.analyzePool(pools[0]);
        if (!analysis) continue;

        // Open position
        const positionSize = POSITION_CONFIG.POSITION_SIZE;
        const position = await this.positionManager.openPosition(
          pools[0],
          positionSize,
          analysis.suggestedRange.min,
          analysis.suggestedRange.max,
        );

        if (position) {
          maxNew--;
          logger.info(`Entered position: $${positionSize} in ${pools[0].slice(0, 8)}...`);
        }
      }
    } catch (error) {
      logger.error(`Scan and enter failed: ${error}`);
    }
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    const pnl = this.positionManager.getTotalPnL();
    return {
      running: this.running,
      mode: OPERATION_MODE.MODE,
      paper: OPERATION_MODE.PAPER_TRADING,
      uptime: Date.now() - this.startTime,
      positions: this.positionManager.getOpenPositions().length,
      totalValue: this.positionManager.getTotalValue(),
      totalPnl: pnl.pnl,
      totalPnlPct: pnl.pnlPercent,
      feesEarned: pnl.fees,
      cyclesCompleted: this.cyclesCompleted,
      lastScan: this.lastScanTime,
      lastRebalance: this.lastRebalanceTime,
    };
  }

  /**
   * Print status summary
   */
  printStatus(): void {
    const status = this.getStatus();
    const positions = this.positionManager.getOpenPositions();
    const upHours = (status.uptime / TIME_CONSTANTS.MILLISECONDS_PER_HOUR).toFixed(1);

    logger.info('─'.repeat(40));
    logger.info(`Status | ${status.paper ? 'PAPER' : 'LIVE'} | Uptime: ${upHours}h | Cycles: ${status.cyclesCompleted}`);
    logger.info(`Value: $${status.totalValue.toFixed(2)} | PnL: $${status.totalPnl.toFixed(4)} (${status.totalPnlPct.toFixed(2)}%) | Fees: $${status.feesEarned.toFixed(4)}`);

    for (const pos of positions) {
      logger.info(`  ${pos.id.slice(0, 12)}... | $${pos.currentValueUsd.toFixed(2)} | PnL: ${pos.pnlPercent.toFixed(2)}% | IL: ${pos.ilPercent.toFixed(2)}%`);
    }
    logger.info('─'.repeat(40));
  }

  /**
   * Stop the agent gracefully
   */
  stop(): void {
    logger.info('Stopping agent...');
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
