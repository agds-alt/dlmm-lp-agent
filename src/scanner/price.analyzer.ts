/**
 * Price Action Analyzer
 * Tier 3: Analyzes price volatility and range-bound behavior
 */

import axios from 'axios';
import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface PriceMetrics {
  currentPrice: number;
  priceChange24h: number;
  priceChange7d: number;
  volatility7d: number;
  isRangeBound: boolean;
  priceHigh24h: number;
  priceLow24h: number;
  priceHigh7d: number;
  priceLow7d: number;
  trendDirection: 'up' | 'down' | 'sideways';
  passed: boolean;
  score: number; // 0-100
  warnings: string[];
}

export class PriceAnalyzer {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Analyze price action metrics
   */
  async analyze(mintAddress: string): Promise<PriceMetrics> {
    const result: PriceMetrics = {
      currentPrice: 0,
      priceChange24h: 0,
      priceChange7d: 0,
      volatility7d: 0,
      isRangeBound: false,
      priceHigh24h: 0,
      priceLow24h: 0,
      priceHigh7d: 0,
      priceLow7d: 0,
      trendDirection: 'sideways',
      passed: false,
      score: 0,
      warnings: [],
    };

    try {
      logger.info(`Analyzing price action for token: ${mintAddress}`);

      // Fetch price data from DexScreener
      const dexData = await this.fetchDexScreenerPriceData(mintAddress);

      if (dexData) {
        result.currentPrice = dexData.currentPrice || 0;
        result.priceChange24h = dexData.priceChange24h || 0;
        result.priceChange7d = dexData.priceChange7d || 0;
        result.priceHigh24h = dexData.priceHigh24h || 0;
        result.priceLow24h = dexData.priceLow24h || 0;

        // Calculate volatility (using 24h range as proxy for 7d)
        if (result.currentPrice > 0) {
          const range24h = Math.abs(result.priceChange24h);
          result.volatility7d = range24h * 1.5; // Estimate 7d from 24h
        }

        // Determine if range-bound (low volatility + sideways trend)
        result.isRangeBound = this.isRangeBoundPrice(
          result.volatility7d,
          result.priceChange7d
        );

        // Determine trend direction
        result.trendDirection = this.determineTrend(
          result.priceChange24h,
          result.priceChange7d
        );
      }

      // Run Tier 3 checks
      result.passed = this.checkTier3Criteria(result);
      result.score = this.calculateScore(result);

      logger.info(`Price analysis complete: ${result.passed ? 'PASSED' : 'FAILED'} (${result.score}/100)`);

      return result;
    } catch (error) {
      logger.error(`Error analyzing price for ${mintAddress}`, error);
      return result;
    }
  }

  /**
   * Fetch price data from DexScreener
   */
  private async fetchDexScreenerPriceData(mintAddress: string): Promise<any> {
    try {
      logger.debug(`Fetching DexScreener price data for ${mintAddress}`);

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        // Get the pair with highest liquidity
        const pairs = response.data.pairs;
        const bestPair = pairs.sort((a: any, b: any) =>
          (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        )[0];

        logger.debug(`DexScreener price data fetched successfully`);

        return {
          currentPrice: parseFloat(bestPair.priceUsd || 0),
          priceChange24h: parseFloat(bestPair.priceChange?.h24 || 0),
          priceChange7d: parseFloat(bestPair.priceChange?.h7 || 0) ||
                         parseFloat(bestPair.priceChange?.h24 || 0) * 2, // Estimate
          priceHigh24h: parseFloat(bestPair.priceUsd || 0) * (1 + Math.abs(bestPair.priceChange?.h24 || 0) / 100),
          priceLow24h: parseFloat(bestPair.priceUsd || 0) * (1 - Math.abs(bestPair.priceChange?.h24 || 0) / 100),
        };
      }

      return null;
    } catch (error) {
      logger.debug(`DexScreener price fetch failed: ${error}`);
      return null;
    }
  }

  /**
   * Check if price is range-bound (good for LP)
   */
  private isRangeBoundPrice(volatility: number, priceChange7d: number): boolean {
    // Range-bound criteria:
    // 1. Volatility between 30-60% (not too stable, not too volatile)
    // 2. 7-day change < 50% (no parabolic moves)
    const volatilityOk = volatility >= 30 && volatility <= 60;
    const changeOk = Math.abs(priceChange7d) < 50;

    return volatilityOk && changeOk;
  }

  /**
   * Determine price trend direction
   */
  private determineTrend(change24h: number, change7d: number): 'up' | 'down' | 'sideways' {
    // Strong trend: >10% move
    // Sideways: -10% to +10%

    if (change24h > 10 && change7d > 10) return 'up';
    if (change24h < -10 && change7d < -10) return 'down';
    return 'sideways';
  }

  /**
   * Check if metrics meet Tier 3 criteria
   */
  private checkTier3Criteria(metrics: PriceMetrics): boolean {
    const checks: { [key: string]: boolean } = {};

    // Check 1: Volatility in acceptable range (30-60%)
    checks.volatilityRange = metrics.volatility7d >= 30 && metrics.volatility7d <= 60;

    if (!checks.volatilityRange) {
      if (metrics.volatility7d < 30) {
        metrics.warnings.push(`Volatility too low: ${metrics.volatility7d.toFixed(1)}% (min 30%)`);
      } else {
        metrics.warnings.push(`Volatility too high: ${metrics.volatility7d.toFixed(1)}% (max 60%)`);
      }
    }

    // Check 2: Not in parabolic pump/dump (7d change < 100%)
    checks.noParabolic = Math.abs(metrics.priceChange7d) < 100;

    if (!checks.noParabolic) {
      metrics.warnings.push(
        `Parabolic movement detected: ${metrics.priceChange7d.toFixed(1)}% in 7d (too risky)`
      );
    }

    // Check 3: Preferably range-bound or slight uptrend
    checks.favorableTrend =
      metrics.isRangeBound ||
      metrics.trendDirection === 'sideways' ||
      (metrics.trendDirection === 'up' && metrics.priceChange7d < 50);

    if (!checks.favorableTrend) {
      metrics.warnings.push(
        `Unfavorable trend: ${metrics.trendDirection} with ${metrics.priceChange7d.toFixed(1)}% change`
      );
    }

    // All checks should pass ideally, but we're lenient
    // Pass if at least 2 out of 3 checks pass
    const passedCount = Object.values(checks).filter(c => c).length;
    return passedCount >= 2;
  }

  /**
   * Calculate Tier 3 score (0-100)
   */
  private calculateScore(metrics: PriceMetrics): number {
    let score = 0;

    // Volatility score (0-40 points)
    // Ideal: 30-60% volatility
    if (metrics.volatility7d >= 30 && metrics.volatility7d <= 60) {
      const midpoint = 45;
      const deviation = Math.abs(metrics.volatility7d - midpoint);
      score += Math.max(0, 40 - (deviation * 2));
    } else if (metrics.volatility7d > 0) {
      // Partial points for being close
      if (metrics.volatility7d < 30) {
        score += (metrics.volatility7d / 30) * 20; // Up to 20 points
      } else {
        // Over 60%
        const excess = metrics.volatility7d - 60;
        score += Math.max(0, 20 - excess); // Penalty for high volatility
      }
    }

    // Range-bound bonus (0-30 points)
    if (metrics.isRangeBound) {
      score += 30;
    } else if (metrics.trendDirection === 'sideways') {
      score += 20; // Partial points for sideways
    }

    // Trend score (0-30 points)
    if (metrics.trendDirection === 'up' && metrics.priceChange7d > 0 && metrics.priceChange7d < 50) {
      score += 30; // Healthy uptrend
    } else if (metrics.trendDirection === 'sideways') {
      score += 25; // Good for LP
    } else if (metrics.trendDirection === 'down' && metrics.priceChange7d > -30) {
      score += 15; // Mild downtrend ok
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Get price summary for display
   */
  getPriceSummary(metrics: PriceMetrics): string {
    return `
Current Price: $${metrics.currentPrice.toFixed(8)}
24h Change: ${metrics.priceChange24h >= 0 ? '+' : ''}${metrics.priceChange24h.toFixed(2)}%
7d Change: ${metrics.priceChange7d >= 0 ? '+' : ''}${metrics.priceChange7d.toFixed(2)}%
Volatility (7d): ${metrics.volatility7d.toFixed(1)}%
Trend: ${metrics.trendDirection.toUpperCase()}
Range-bound: ${metrics.isRangeBound ? 'YES ✓' : 'NO'}
Score: ${metrics.score}/100
Status: ${metrics.passed ? '✅ PASSED' : '❌ FAILED'}
    `.trim();
  }
}

export default PriceAnalyzer;
