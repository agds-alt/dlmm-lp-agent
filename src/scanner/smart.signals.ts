/**
 * Smart Money Signals Analyzer
 * Tier 4: Detects trending tokens and smart money activity
 */

import axios from 'axios';
import { Connection } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface SmartSignals {
  isTrending: boolean;
  trendingScore: number; // 0-100
  isListedJupiter: boolean;
  isListedRaydium: boolean;
  hasRecentListing: boolean; // Listed in last 7 days
  socialScore: number; // 0-100
  txCount24h: number;
  holderCount: number;
  passed: boolean;
  score: number; // 0-100
  warnings: string[];
  signals: string[]; // Positive signals
}

export class SmartSignalsAnalyzer {
  private connection: Connection;
  private jupiterTokens: Set<string> = new Set();
  private jupiterLoaded: boolean = false;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Analyze smart money signals
   */
  async analyze(mintAddress: string): Promise<SmartSignals> {
    const result: SmartSignals = {
      isTrending: false,
      trendingScore: 0,
      isListedJupiter: false,
      isListedRaydium: false,
      hasRecentListing: false,
      socialScore: 0,
      txCount24h: 0,
      holderCount: 0,
      passed: false,
      score: 0,
      warnings: [],
      signals: [],
    };

    try {
      logger.info(`Analyzing smart signals for token: ${mintAddress}`);

      // Check Jupiter listing
      result.isListedJupiter = await this.checkJupiterListing(mintAddress);
      if (result.isListedJupiter) {
        result.signals.push('Listed on Jupiter');
      }

      // Check trending on DexScreener
      const trendingData = await this.checkDexScreenerTrending(mintAddress);
      if (trendingData) {
        result.isTrending = trendingData.isTrending;
        result.trendingScore = trendingData.score;
        result.socialScore = trendingData.socialScore;
        result.txCount24h = trendingData.txCount;

        if (result.isTrending) {
          result.signals.push(`Trending on DexScreener (${result.trendingScore}/100)`);
        }
      }

      // Check if recently listed (within 7 days on DEX)
      result.hasRecentListing = await this.checkRecentListing(mintAddress);
      if (result.hasRecentListing) {
        result.signals.push('Recently listed (fresh opportunity)');
      }

      // Run Tier 4 checks
      result.passed = this.checkTier4Criteria(result);
      result.score = this.calculateScore(result);

      logger.info(`Smart signals analysis complete: ${result.passed ? 'PASSED' : 'FAILED'} (${result.score}/100)`);

      return result;
    } catch (error) {
      logger.error(`Error analyzing smart signals for ${mintAddress}`, error);
      return result;
    }
  }

  /**
   * Check if token is listed on Jupiter
   */
  private async checkJupiterListing(mintAddress: string): Promise<boolean> {
    try {
      // Load Jupiter token list if not loaded
      if (!this.jupiterLoaded) {
        logger.debug('Loading Jupiter token list...');
        const response = await axios.get('https://token.jup.ag/all', {
          timeout: 5000,
        });

        if (response.data && Array.isArray(response.data)) {
          response.data.forEach((token: any) => {
            this.jupiterTokens.add(token.address);
          });
          this.jupiterLoaded = true;
          logger.debug(`Loaded ${this.jupiterTokens.size} Jupiter tokens`);
        }
      }

      const isListed = this.jupiterTokens.has(mintAddress);
      logger.debug(`Jupiter listing check: ${isListed ? 'LISTED' : 'NOT LISTED'}`);

      return isListed;
    } catch (error) {
      logger.debug(`Jupiter listing check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check trending status on DexScreener
   */
  private async checkDexScreenerTrending(mintAddress: string): Promise<any> {
    try {
      logger.debug(`Checking DexScreener trending for ${mintAddress}`);

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const bestPair = response.data.pairs[0];

        // Calculate trending score based on multiple factors
        const volume24h = bestPair.volume?.h24 || 0;
        const priceChange24h = Math.abs(bestPair.priceChange?.h24 || 0);
        const liquidity = bestPair.liquidity?.usd || 0;
        const txCount = bestPair.txns?.h24?.buys + bestPair.txns?.h24?.sells || 0;

        // Trending criteria:
        // - High volume (>$100k)
        // - Price movement (>10%)
        // - High tx count (>100 txs)
        // - Good liquidity (>$50k)

        let trendingScore = 0;

        if (volume24h > 100000) trendingScore += 30;
        else if (volume24h > 50000) trendingScore += 20;
        else if (volume24h > 10000) trendingScore += 10;

        if (priceChange24h > 20) trendingScore += 25;
        else if (priceChange24h > 10) trendingScore += 15;
        else if (priceChange24h > 5) trendingScore += 10;

        if (txCount > 200) trendingScore += 25;
        else if (txCount > 100) trendingScore += 15;
        else if (txCount > 50) trendingScore += 10;

        if (liquidity > 100000) trendingScore += 20;
        else if (liquidity > 50000) trendingScore += 10;

        const isTrending = trendingScore >= 60; // Need 60+ to be "trending"

        // Social score (based on info if available)
        const socialScore = bestPair.info?.websites?.length > 0 ? 50 : 0;

        logger.debug(`Trending score: ${trendingScore}/100, Trending: ${isTrending}`);

        return {
          isTrending,
          score: trendingScore,
          socialScore,
          txCount,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`DexScreener trending check failed: ${error}`);
      return null;
    }
  }

  /**
   * Check if token was recently listed
   */
  private async checkRecentListing(mintAddress: string): Promise<boolean> {
    try {
      // Check if pair creation is recent (within 7 days)
      // This is approximate - we'd need historical data for exact timing

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pairs = response.data.pairs;

        // Check if any pair has low tx count (indicator of new listing)
        // New tokens typically have <1000 transactions in first week
        const hasLowTxCount = pairs.some((pair: any) => {
          const totalTxs =
            (pair.txns?.h24?.buys || 0) +
            (pair.txns?.h24?.sells || 0);
          return totalTxs > 0 && totalTxs < 1000;
        });

        return hasLowTxCount;
      }

      return false;
    } catch (error) {
      logger.debug(`Recent listing check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if metrics meet Tier 4 criteria
   */
  private checkTier4Criteria(signals: SmartSignals): boolean {
    const checks: { [key: string]: boolean } = {};

    // Check 1: Listed on major DEX (Jupiter or high trending score)
    checks.majorListing = signals.isListedJupiter || signals.trendingScore >= 60;

    if (!checks.majorListing) {
      signals.warnings.push('Not listed on major DEX or trending platform');
    }

    // Check 2: Has some trending signals (score > 40)
    checks.hasTrending = signals.trendingScore >= 40 || signals.isTrending;

    if (!checks.hasTrending) {
      signals.warnings.push(`Low trending score: ${signals.trendingScore}/100`);
    }

    // Check 3: Recent activity (tx count > 50 in 24h)
    checks.hasActivity = signals.txCount24h >= 50;

    if (!checks.hasActivity && signals.txCount24h > 0) {
      signals.warnings.push(`Low activity: ${signals.txCount24h} txs in 24h (min 50)`);
    }

    // Pass if at least 2 out of 3 checks pass
    const passedCount = Object.values(checks).filter(c => c).length;
    return passedCount >= 2;
  }

  /**
   * Calculate Tier 4 score (0-100)
   */
  private calculateScore(signals: SmartSignals): number {
    let score = 0;

    // Jupiter listing (0-25 points)
    if (signals.isListedJupiter) {
      score += 25;
    }

    // Trending score (0-35 points)
    score += Math.min(35, (signals.trendingScore / 100) * 35);

    // Recent listing bonus (0-20 points)
    if (signals.hasRecentListing) {
      score += 20;
    }

    // Activity score (0-20 points)
    if (signals.txCount24h > 0) {
      const activityScore = Math.min(20, (signals.txCount24h / 200) * 20);
      score += activityScore;
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Get smart signals summary for display
   */
  getSignalsSummary(signals: SmartSignals): string {
    return `
Jupiter Listed: ${signals.isListedJupiter ? 'YES ✓' : 'NO'}
Trending: ${signals.isTrending ? 'YES ✓' : 'NO'}
Trending Score: ${signals.trendingScore}/100
Recent Listing: ${signals.hasRecentListing ? 'YES ✓' : 'NO'}
24h Transactions: ${signals.txCount24h}
Score: ${signals.score}/100
Status: ${signals.passed ? '✅ PASSED' : '❌ FAILED'}
Positive Signals: ${signals.signals.length > 0 ? signals.signals.join(', ') : 'None'}
    `.trim();
  }
}

export default SmartSignalsAnalyzer;
