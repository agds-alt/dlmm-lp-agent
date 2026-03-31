/**
 * Test Token Scanner
 * Tests safety checker with known Solana tokens
 */

import { getSolanaConnection } from '../src/core/connection';
import { TokenScanner } from '../src/scanner/token.scanner';
import { logger } from '../src/utils/logger';

// Known Solana token addresses for testing
const TEST_TOKENS = {
  // These are well-known tokens we can test with
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // dogwifhat
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (should pass all checks)
  // Add more test tokens here
};

async function main() {
  try {
    logger.info('='.repeat(60));
    logger.info('🧪 Testing Token Scanner');
    logger.info('='.repeat(60));

    // Initialize connection
    logger.info('\n🔌 Connecting to Solana...');
    const connection = await getSolanaConnection();
    logger.success('Connected to Solana');

    // Initialize scanner
    logger.info('\n📡 Initializing token scanner...');
    const scanner = new TokenScanner(connection);
    logger.success('Scanner initialized');

    // Test tokens
    const tokenAddresses = Object.values(TEST_TOKENS);
    logger.info(`\n🔍 Scanning ${tokenAddresses.length} test tokens...`);

    const candidates = await scanner.scanTokens(tokenAddresses);

    logger.info(`\n\n📊 SCAN RESULTS`);
    logger.info('='.repeat(60));
    logger.info(`Total scanned: ${tokenAddresses.length}`);
    logger.info(`Passed checks: ${candidates.length}`);
    logger.info(`Failed checks: ${tokenAddresses.length - candidates.length}`);

    if (candidates.length > 0) {
      logger.info('\n\n✅ PASSED CANDIDATES:');
      candidates.forEach((candidate, index) => {
        console.log(`\n[${index + 1}/${candidates.length}]`);
        scanner.printCandidateReport(candidate);
      });

      // Show top 3
      const top3 = scanner.getTopCandidates(candidates, 3);
      logger.info('\n\n🏆 TOP 3 CANDIDATES:');
      top3.forEach((candidate, index) => {
        logger.info(`  ${index + 1}. ${candidate.symbol} - Score: ${candidate.score}/100 (Tier ${candidate.tier})`);
      });
    } else {
      logger.warn('\n❌ No candidates passed safety checks');
    }

    logger.info('\n' + '='.repeat(60));
    logger.success('✅ Scanner test completed');
    logger.info('='.repeat(60));

  } catch (error) {
    logger.error('Test failed', error);
    process.exit(1);
  }
}

// Run test
if (require.main === module) {
  main()
    .then(() => {
      logger.info('\n👋 Test completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Test error', error);
      process.exit(1);
    });
}

export default main;
