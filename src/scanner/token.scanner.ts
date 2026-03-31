/**
 * Token Scanner
 * Discovers and evaluates new token launches
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { SafetyChecker, SafetyCheckResult } from './safety.checker';
import { VolumeAnalyzer, VolumeMetrics } from './volume.analyzer';
import { MetadataFetcher, TokenMetadata } from './metadata.fetcher';
import { logger } from '../utils/logger';

export interface TokenCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  metadata: TokenMetadata;
  safetyCheck: SafetyCheckResult;
  volumeMetrics?: VolumeMetrics;
  age: number;
  score: number;
  tier: number;
  recommended: boolean;
}

export class TokenScanner {
  private connection: Connection;
  private safetyChecker: SafetyChecker;
  private volumeAnalyzer: VolumeAnalyzer;
  private metadataFetcher: MetadataFetcher;

  constructor(connection: Connection) {
    this.connection = connection;
    this.safetyChecker = new SafetyChecker(connection);
    this.volumeAnalyzer = new VolumeAnalyzer(connection);
    this.metadataFetcher = new MetadataFetcher(connection);
  }

  /**
   * Scan and evaluate a single token (with optional Tier 2 analysis)
   */
  async scanToken(mintAddress: string, includeTier2: boolean = false): Promise<TokenCandidate | null> {
    try {
      logger.info(`Scanning token: ${mintAddress}`);

      // Fetch metadata
      const metadata = await this.metadataFetcher.fetchMetadata(mintAddress);

      // Tier 1: Safety check
      const safetyCheck = await this.safetyChecker.checkToken(mintAddress);

      if (!safetyCheck.passed) {
        logger.warn(`Token ${metadata.symbol} failed Tier 1 safety check`);
        return null;
      }

      // Check age
      const ageCheck = await this.safetyChecker.checkTokenAge(mintAddress);

      if (!ageCheck.passed) {
        logger.warn(`Token ${metadata.symbol} age check failed: ${ageCheck.message}`);
        // Don't return null - age check might fail for established tokens
        // Just log the warning
      }

      // Tier 2: Volume & liquidity analysis (optional)
      let volumeMetrics: VolumeMetrics | undefined;
      if (includeTier2) {
        volumeMetrics = await this.volumeAnalyzer.analyze(mintAddress);

        if (!volumeMetrics.passed) {
          logger.warn(`Token ${metadata.symbol} failed Tier 2 volume checks`);
          // Don't return null yet - still include in candidates but mark as risky
        }
      }

      // Calculate combined score
      const combinedScore = this.calculateCombinedScore(safetyCheck, volumeMetrics);

      // Create candidate object
      const candidate: TokenCandidate = {
        mintAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        metadata,
        safetyCheck,
        volumeMetrics,
        age: ageCheck.age,
        score: combinedScore,
        tier: this.determineCombinedTier(combinedScore),
        recommended: combinedScore >= 75 && safetyCheck.passed && (!volumeMetrics || volumeMetrics.passed),
      };

      logger.success(`Token ${metadata.symbol} scanned - Score: ${candidate.score}/100 (Tier ${candidate.tier})`);

      return candidate;
    } catch (error) {
      logger.error(`Error scanning token ${mintAddress}`, error);
      return null;
    }
  }

  /**
   * Calculate combined score from all tiers
   */
  private calculateCombinedScore(
    safetyCheck: SafetyCheckResult,
    volumeMetrics?: VolumeMetrics
  ): number {
    // Tier 1 (Safety): 60% weight
    const tier1Score = safetyCheck.score * 0.6;

    // Tier 2 (Volume): 40% weight
    const tier2Score = volumeMetrics ? volumeMetrics.score * 0.4 : 0;

    return Math.round(tier1Score + tier2Score);
  }

  /**
   * Determine tier from combined score
   */
  private determineCombinedTier(score: number): number {
    if (score >= 80) return 4; // Excellent
    if (score >= 65) return 3; // Good
    if (score >= 50) return 2; // Fair
    return 1; // Poor
  }

  /**
   * Scan multiple tokens
   */
  async scanTokens(mintAddresses: string[], includeTier2: boolean = false): Promise<TokenCandidate[]> {
    logger.info(`Scanning ${mintAddresses.length} tokens...`);

    const candidates: TokenCandidate[] = [];

    for (const mintAddress of mintAddresses) {
      const candidate = await this.scanToken(mintAddress, includeTier2);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    logger.info(`Found ${candidates.length} viable candidates out of ${mintAddresses.length} tokens`);

    return candidates;
  }

  /**
   * Get top N candidates
   */
  getTopCandidates(candidates: TokenCandidate[], count: number = 3): TokenCandidate[] {
    return candidates.slice(0, count);
  }

  /**
   * Print candidate report
   */
  printCandidateReport(candidate: TokenCandidate): void {
    console.log('\n' + '='.repeat(60));
    console.log(`Token: ${candidate.symbol} (${candidate.name})`);
    console.log(`Address: ${candidate.mintAddress}`);
    console.log(`Age: ${candidate.age.toFixed(1)} days`);
    console.log(`Combined Score: ${candidate.score}/100 (Tier ${candidate.tier})`);
    console.log(`Recommended: ${candidate.recommended ? '✅ YES' : '❌ NO'}`);

    console.log('\n--- TIER 1: SAFETY CHECKS ---');
    console.log(`Score: ${candidate.safetyCheck.score}/100`);

    for (const [checkName, check] of Object.entries(candidate.safetyCheck.checks)) {
      const icon = check.passed ? '✅' : '❌';
      const critical = check.critical ? ' [CRITICAL]' : '';
      console.log(`  ${icon} ${checkName}: ${check.message}${critical}`);
    }

    if (candidate.safetyCheck.warnings.length > 0) {
      console.log('\nTier 1 Warnings:');
      candidate.safetyCheck.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    }

    if (candidate.safetyCheck.errors.length > 0) {
      console.log('\nTier 1 Errors:');
      candidate.safetyCheck.errors.forEach(e => console.log(`  ❌ ${e}`));
    }

    // Show Tier 2 volume metrics if available
    if (candidate.volumeMetrics) {
      console.log('\n--- TIER 2: VOLUME & LIQUIDITY ---');
      console.log(`Score: ${candidate.volumeMetrics.score}/100`);
      console.log(`Status: ${candidate.volumeMetrics.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`\n  Volume 24h: $${candidate.volumeMetrics.volume24h.toLocaleString()}`);
      console.log(`  Liquidity: $${candidate.volumeMetrics.liquidity.toLocaleString()}`);
      console.log(`  Unique Traders: ${candidate.volumeMetrics.uniqueTraders24h}`);
      console.log(`  Buy/Sell Ratio: ${candidate.volumeMetrics.buySellRatio.toFixed(2)}`);
      console.log(`  Liq/Vol Ratio: ${candidate.volumeMetrics.liquidityVolumeRatio.toFixed(1)}%`);

      if (candidate.volumeMetrics.warnings.length > 0) {
        console.log('\nTier 2 Warnings:');
        candidate.volumeMetrics.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
      }
    }

    console.log('='.repeat(60));
  }
}

export default TokenScanner;
