/**
 * Token Scanner
 * Discovers and evaluates new token launches
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { SafetyChecker, SafetyCheckResult } from './safety.checker';
import { logger } from '../utils/logger';

export interface TokenCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  safetyCheck: SafetyCheckResult;
  age: number;
  score: number;
  tier: number;
  recommended: boolean;
}

export class TokenScanner {
  private connection: Connection;
  private safetyChecker: SafetyChecker;

  constructor(connection: Connection) {
    this.connection = connection;
    this.safetyChecker = new SafetyChecker(connection);
  }

  /**
   * Scan and evaluate a single token
   */
  async scanToken(mintAddress: string): Promise<TokenCandidate | null> {
    try {
      logger.info(`Scanning token: ${mintAddress}`);

      // Run safety check
      const safetyCheck = await this.safetyChecker.checkToken(mintAddress);

      if (!safetyCheck.passed) {
        logger.warn(`Token ${mintAddress} failed safety check`);
        return null;
      }

      // Check age
      const ageCheck = await this.safetyChecker.checkTokenAge(mintAddress);

      if (!ageCheck.passed) {
        logger.warn(`Token ${mintAddress} age check failed: ${ageCheck.message}`);
        return null;
      }

      // Create candidate object
      const candidate: TokenCandidate = {
        mintAddress,
        symbol: 'UNKNOWN', // Will be fetched from metadata in Phase 2
        name: 'UNKNOWN',
        safetyCheck,
        age: ageCheck.age,
        score: safetyCheck.score,
        tier: safetyCheck.tier,
        recommended: safetyCheck.score >= 75, // Tier 4 recommended
      };

      logger.success(`Token ${mintAddress} passed screening with score ${candidate.score}/100`);

      return candidate;
    } catch (error) {
      logger.error(`Error scanning token ${mintAddress}`, error);
      return null;
    }
  }

  /**
   * Scan multiple tokens
   */
  async scanTokens(mintAddresses: string[]): Promise<TokenCandidate[]> {
    logger.info(`Scanning ${mintAddresses.length} tokens...`);

    const candidates: TokenCandidate[] = [];

    for (const mintAddress of mintAddresses) {
      const candidate = await this.scanToken(mintAddress);
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
    console.log(`Safety Score: ${candidate.score}/100 (Tier ${candidate.tier})`);
    console.log(`Recommended: ${candidate.recommended ? '✅ YES' : '❌ NO'}`);
    console.log('\nSafety Checks:');

    for (const [checkName, check] of Object.entries(candidate.safetyCheck.checks)) {
      const icon = check.passed ? '✅' : '❌';
      const critical = check.critical ? ' [CRITICAL]' : '';
      console.log(`  ${icon} ${checkName}: ${check.message}${critical}`);
    }

    if (candidate.safetyCheck.warnings.length > 0) {
      console.log('\nWarnings:');
      candidate.safetyCheck.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    }

    if (candidate.safetyCheck.errors.length > 0) {
      console.log('\nErrors:');
      candidate.safetyCheck.errors.forEach(e => console.log(`  ❌ ${e}`));
    }

    console.log('='.repeat(60));
  }
}

export default TokenScanner;
