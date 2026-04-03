/**
 * Position Manager
 *
 * Manages LP positions lifecycle:
 * - Open positions (add liquidity to DLMM bins)
 * - Track positions (value, PnL, IL)
 * - Close positions (remove liquidity)
 * - Paper trading simulation
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { StrategyType } from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { logger } from '../utils/logger';
import { STRATEGY_CONFIG, POSITION_CONFIG, OPERATION_MODE } from '../config/constants';

export interface Position {
  id: string;
  poolAddress: string;
  tokenX: string;
  tokenY: string;
  binRange: { min: number; max: number };
  entryPrice: number;
  entryTime: number;
  amountX: number;
  amountY: number;
  totalValueUsd: number;
  currentValueUsd: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  ilPercent: number;
  feesEarned: number;
  status: 'open' | 'closed' | 'rebalancing';
  isPaper: boolean;
}

export class PositionManager {
  private connection: Connection;
  private wallet: Keypair | null;
  private positions: Map<string, Position> = new Map();
  private isPaper: boolean;

  constructor(connection: Connection, wallet: Keypair | null = null) {
    this.connection = connection;
    this.wallet = wallet;
    this.isPaper = OPERATION_MODE.PAPER_TRADING || !wallet;
  }

  /**
   * Open a new LP position
   */
  async openPosition(
    poolAddress: string,
    amountUsd: number,
    minBinId: number,
    maxBinId: number,
  ): Promise<Position | null> {
    // Check position limits
    const openPositions = this.getOpenPositions();
    if (openPositions.length >= STRATEGY_CONFIG.MAX_POSITIONS) {
      logger.warn(`Max positions reached (${STRATEGY_CONFIG.MAX_POSITIONS}). Cannot open new.`);
      return null;
    }

    // Check position size
    const maxSize = POSITION_CONFIG.POSITION_SIZE;
    if (amountUsd > maxSize) {
      logger.warn(`Position size $${amountUsd} exceeds max $${maxSize}. Capping.`);
      amountUsd = maxSize;
    }

    try {
      const dlmmPool = await DLMM.create(this.connection, new PublicKey(poolAddress));
      const activeBin = await dlmmPool.getActiveBin();
      const entryPrice = activeBin.pricePerToken
        ? parseFloat(activeBin.pricePerToken)
        : 0;

      const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (this.isPaper) {
        // Paper trading: simulate position
        const position: Position = {
          id: positionId,
          poolAddress,
          tokenX: dlmmPool.tokenX.publicKey.toBase58(),
          tokenY: dlmmPool.tokenY.publicKey.toBase58(),
          binRange: { min: minBinId, max: maxBinId },
          entryPrice,
          entryTime: Date.now(),
          amountX: amountUsd / 2 / entryPrice, // Split 50/50
          amountY: amountUsd / 2,
          totalValueUsd: amountUsd,
          currentValueUsd: amountUsd,
          currentPrice: entryPrice,
          pnl: 0,
          pnlPercent: 0,
          ilPercent: 0,
          feesEarned: 0,
          status: 'open',
          isPaper: true,
        };

        this.positions.set(positionId, position);
        logger.info(`[PAPER] Opened position ${positionId}: $${amountUsd} in ${poolAddress}`);
        logger.info(`  Range: bins ${minBinId}-${maxBinId} | Entry: $${entryPrice.toFixed(6)}`);
        return position;
      }

      // Live trading
      if (!this.wallet) {
        logger.error('No wallet configured for live trading');
        return null;
      }

      // Calculate token amounts for the position
      const totalXAmount = new BN(Math.floor((amountUsd / 2 / entryPrice) * 10 ** dlmmPool.tokenX.mint.decimals));
      const totalYAmount = new BN(Math.floor((amountUsd / 2) * 10 ** dlmmPool.tokenY.mint.decimals));

      // Create position with Spot strategy (evenly distributed)
      const newPosition = new Keypair();
      const createPositionTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey,
        user: this.wallet.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: StrategyType.Spot,
        },
      });

      // Sign and send transaction
      for (const tx of Array.isArray(createPositionTx) ? createPositionTx : [createPositionTx]) {
        tx.sign(this.wallet, newPosition);
        const sig = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction(sig, 'confirmed');
        logger.info(`[LIVE] TX confirmed: ${sig}`);
      }

      const position: Position = {
        id: positionId,
        poolAddress,
        tokenX: dlmmPool.tokenX.publicKey.toBase58(),
        tokenY: dlmmPool.tokenY.publicKey.toBase58(),
        binRange: { min: minBinId, max: maxBinId },
        entryPrice,
        entryTime: Date.now(),
        amountX: amountUsd / 2 / entryPrice,
        amountY: amountUsd / 2,
        totalValueUsd: amountUsd,
        currentValueUsd: amountUsd,
        currentPrice: entryPrice,
        pnl: 0,
        pnlPercent: 0,
        ilPercent: 0,
        feesEarned: 0,
        status: 'open',
        isPaper: false,
      };

      this.positions.set(positionId, position);
      logger.info(`[LIVE] Opened position ${positionId}: $${amountUsd}`);
      return position;
    } catch (error) {
      logger.error(`Failed to open position: ${error}`);
      return null;
    }
  }

  /**
   * Update position with current prices
   */
  async updatePosition(positionId: string): Promise<Position | null> {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'open') return null;

    try {
      const dlmmPool = await DLMM.create(this.connection, new PublicKey(position.poolAddress));
      const activeBin = await dlmmPool.getActiveBin();
      const currentPrice = activeBin.pricePerToken
        ? parseFloat(activeBin.pricePerToken)
        : position.currentPrice;

      position.currentPrice = currentPrice;

      // Calculate current value
      const xValue = position.amountX * currentPrice;
      const yValue = position.amountY;
      position.currentValueUsd = xValue + yValue;

      // Calculate PnL
      position.pnl = position.currentValueUsd - position.totalValueUsd;
      position.pnlPercent = (position.pnl / position.totalValueUsd) * 100;

      // Calculate IL (simplified)
      const priceRatio = currentPrice / position.entryPrice;
      const holdValue = (position.amountX * currentPrice) + position.amountY;
      const lpValue = position.currentValueUsd;
      position.ilPercent = holdValue > 0
        ? ((holdValue - lpValue) / holdValue) * 100
        : 0;

      // Estimate fees earned (simplified - real impl needs on-chain data)
      const hoursOpen = (Date.now() - position.entryTime) / (1000 * 60 * 60);
      const estimatedApy = 0.5; // Conservative 50% APY estimate
      position.feesEarned = position.totalValueUsd * (estimatedApy / 365 / 24) * hoursOpen;

      return position;
    } catch (error) {
      logger.error(`Failed to update position ${positionId}: ${error}`);
      return null;
    }
  }

  /**
   * Close a position (remove liquidity)
   */
  async closePosition(positionId: string): Promise<Position | null> {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'open') {
      logger.warn(`Position ${positionId} not found or already closed`);
      return null;
    }

    // Update with latest values first
    await this.updatePosition(positionId);

    if (this.isPaper) {
      position.status = 'closed';
      logger.info(`[PAPER] Closed position ${positionId}: PnL $${position.pnl.toFixed(4)} (${position.pnlPercent.toFixed(2)}%)`);
      return position;
    }

    // Live: remove liquidity
    try {
      // TODO: Implement actual liquidity removal
      // This requires getting the user's position accounts and calling removeLiquidity
      logger.warn('[LIVE] Liquidity removal not fully implemented yet');
      position.status = 'closed';
      return position;
    } catch (error) {
      logger.error(`Failed to close position ${positionId}: ${error}`);
      return null;
    }
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

  /**
   * Get all positions (including closed)
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get total portfolio value
   */
  getTotalValue(): number {
    return this.getOpenPositions().reduce((sum, p) => sum + p.currentValueUsd, 0);
  }

  /**
   * Get total PnL
   */
  getTotalPnL(): { pnl: number; pnlPercent: number; fees: number } {
    const positions = this.getOpenPositions();
    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    const totalFees = positions.reduce((sum, p) => sum + p.feesEarned, 0);
    const totalInvested = positions.reduce((sum, p) => sum + p.totalValueUsd, 0);
    return {
      pnl: totalPnl,
      pnlPercent: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
      fees: totalFees,
    };
  }

  /**
   * Check if any position needs attention (IL too high, loss limit)
   */
  checkRiskLimits(): { positionId: string; reason: string }[] {
    const alerts: { positionId: string; reason: string }[] = [];

    for (const position of this.getOpenPositions()) {
      // IL check
      if (Math.abs(position.ilPercent) >= STRATEGY_CONFIG.MAX_IL_PERCENT) {
        alerts.push({
          positionId: position.id,
          reason: `IL ${position.ilPercent.toFixed(2)}% exceeds max ${STRATEGY_CONFIG.MAX_IL_PERCENT}%`,
        });
      }

      // Loss check
      if (position.pnlPercent <= -STRATEGY_CONFIG.MAX_LOSS_PERCENT) {
        alerts.push({
          positionId: position.id,
          reason: `Loss ${position.pnlPercent.toFixed(2)}% exceeds max ${STRATEGY_CONFIG.MAX_LOSS_PERCENT}%`,
        });
      }
    }

    return alerts;
  }
}
