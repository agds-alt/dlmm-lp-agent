/**
 * Rebalancing Engine
 *
 * Monitors positions and rebalances when:
 * - Price drifts out of bin range
 * - IL exceeds threshold
 * - Scheduled rebalancing interval hit
 */

import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';
import { STRATEGY_CONFIG, TIME_CONSTANTS } from '../config/constants';
import { PositionManager, Position } from './position.manager';
import { DLMMPoolReader } from '../core/dlmm.pool';

export interface RebalanceDecision {
  positionId: string;
  action: 'hold' | 'rebalance' | 'close';
  reason: string;
  newRange?: { min: number; max: number };
}

export class Rebalancer {
  private poolReader: DLMMPoolReader;
  private positionManager: PositionManager;
  private lastRebalanceTime: Map<string, number> = new Map();

  constructor(
    connection: Connection,
    poolReader: DLMMPoolReader,
    positionManager: PositionManager,
  ) {
    this.poolReader = poolReader;
    this.positionManager = positionManager;
  }

  /**
   * Check all positions and decide what to do
   */
  async checkAll(): Promise<RebalanceDecision[]> {
    const decisions: RebalanceDecision[] = [];
    const positions = this.positionManager.getOpenPositions();

    for (const position of positions) {
      const decision = await this.evaluate(position);
      decisions.push(decision);

      if (decision.action !== 'hold') {
        logger.info(`Rebalance decision for ${position.id}: ${decision.action} - ${decision.reason}`);
      }
    }

    return decisions;
  }

  /**
   * Evaluate a single position
   */
  async evaluate(position: Position): Promise<RebalanceDecision> {
    // Update position first
    const updated = await this.positionManager.updatePosition(position.id);
    if (!updated) {
      return { positionId: position.id, action: 'hold', reason: 'Failed to update' };
    }

    // 1. Check IL limit
    if (Math.abs(updated.ilPercent) >= STRATEGY_CONFIG.MAX_IL_PERCENT) {
      return {
        positionId: position.id,
        action: 'close',
        reason: `IL ${updated.ilPercent.toFixed(2)}% exceeds ${STRATEGY_CONFIG.MAX_IL_PERCENT}% limit`,
      };
    }

    // 2. Check loss limit
    if (updated.pnlPercent <= -STRATEGY_CONFIG.MAX_LOSS_PERCENT) {
      return {
        positionId: position.id,
        action: 'close',
        reason: `Loss ${updated.pnlPercent.toFixed(2)}% exceeds ${STRATEGY_CONFIG.MAX_LOSS_PERCENT}% limit`,
      };
    }

    // 3. Check if price drifted out of range
    const analysis = await this.poolReader.analyzePool(position.poolAddress);
    if (analysis) {
      const activeId = analysis.pool.activeId;
      const outOfRange = activeId < position.binRange.min || activeId > position.binRange.max;

      if (outOfRange) {
        return {
          positionId: position.id,
          action: 'rebalance',
          reason: `Price drifted out of range (active bin ${activeId}, range ${position.binRange.min}-${position.binRange.max})`,
          newRange: { min: analysis.suggestedRange.min, max: analysis.suggestedRange.max },
        };
      }
    }

    // 4. Check scheduled rebalance
    const lastRebalance = this.lastRebalanceTime.get(position.id) || position.entryTime;
    const timeSince = Date.now() - lastRebalance;
    const interval = TIME_CONSTANTS.REBALANCE_INTERVAL_MS;

    if (timeSince >= interval) {
      const analysis2 = await this.poolReader.analyzePool(position.poolAddress);
      if (analysis2) {
        return {
          positionId: position.id,
          action: 'rebalance',
          reason: `Scheduled rebalance (${(timeSince / TIME_CONSTANTS.MILLISECONDS_PER_HOUR).toFixed(1)}h since last)`,
          newRange: analysis2.suggestedRange,
        };
      }
    }

    return { positionId: position.id, action: 'hold', reason: 'Position healthy' };
  }

  /**
   * Execute rebalancing for a position
   */
  async executeRebalance(decision: RebalanceDecision): Promise<boolean> {
    if (decision.action === 'hold') return true;

    const position = this.positionManager.getAllPositions().find(p => p.id === decision.positionId);
    if (!position) return false;

    if (decision.action === 'close') {
      const closed = await this.positionManager.closePosition(decision.positionId);
      return closed !== null;
    }

    if (decision.action === 'rebalance' && decision.newRange) {
      logger.info(`Rebalancing ${position.id}: closing old, opening new range`);

      // Close old position
      const closed = await this.positionManager.closePosition(decision.positionId);
      if (!closed) return false;

      // Open new position with updated range
      const newPosition = await this.positionManager.openPosition(
        position.poolAddress,
        closed.currentValueUsd + closed.feesEarned, // Compound fees
        decision.newRange.min,
        decision.newRange.max,
      );

      if (newPosition) {
        this.lastRebalanceTime.set(newPosition.id, Date.now());
        logger.info(`Rebalanced into ${newPosition.id}: range ${decision.newRange.min}-${decision.newRange.max}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Run full rebalancing cycle
   */
  async runCycle(): Promise<{ checked: number; rebalanced: number; closed: number }> {
    const decisions = await this.checkAll();
    let rebalanced = 0;
    let closed = 0;

    for (const decision of decisions) {
      if (decision.action === 'hold') continue;

      const success = await this.executeRebalance(decision);
      if (success) {
        if (decision.action === 'rebalance') rebalanced++;
        if (decision.action === 'close') closed++;
      }
    }

    return { checked: decisions.length, rebalanced, closed };
  }
}
