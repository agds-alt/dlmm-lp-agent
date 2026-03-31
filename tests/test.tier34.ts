/**
 * Test Script: Tier 3 & 4 Implementation
 * Tests all 4 tiers together with real market data
 */

import { Connection } from '@solana/web3.js';
import { TokenScanner } from '../src/scanner/token.scanner';
import { logger } from '../src/utils/logger';

async function main() {
  console.log('='.repeat(80));
  console.log('TIER 3 & 4 IMPLEMENTATION TEST');
  console.log('Testing complete scanner with all 4 tiers');
  console.log('='.repeat(80));
  console.log('');

  // Initialize connection
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  logger.info('Initializing token scanner with all tiers...');
  const scanner = new TokenScanner(connection);

  // Test tokens
  const testTokens = [
    {
      name: 'WIF (dogwifhat)',
      address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    },
    {
      name: 'POPCAT',
      address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    },
    {
      name: 'BONK',
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    },
  ];

  logger.info(`Testing ${testTokens.length} tokens with ALL 4 TIERS enabled...`);
  console.log('');

  const results = [];

  for (const token of testTokens) {
    console.log('\n' + '━'.repeat(80));
    console.log(`🔍 SCANNING: ${token.name}`);
    console.log('━'.repeat(80));

    try {
      const candidate = await scanner.scanToken(token.address, {
        includeTier2: true,
        includeTier3: true,
        includeTier4: true,
      });

      if (candidate) {
        results.push(candidate);
        scanner.printCandidateReport(candidate);
      } else {
        console.log(`❌ Token ${token.name} failed initial checks`);
      }
    } catch (error) {
      console.error(`Error scanning ${token.name}:`, error);
    }

    // Add delay to avoid rate limiting
    if (testTokens.indexOf(token) < testTokens.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next scan...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nTokens scanned: ${testTokens.length}`);
  console.log(`Tokens analyzed: ${results.length}`);
  console.log(`Pass rate: ${((results.length / testTokens.length) * 100).toFixed(1)}%`);

  console.log('\n--- Score Breakdown ---');
  results.forEach((candidate, index) => {
    console.log(`\n${index + 1}. ${candidate.symbol} (${candidate.name})`);
    console.log(`   Combined Score: ${candidate.score}/100 (Tier ${candidate.tier})`);
    console.log(`   Recommended: ${candidate.recommended ? '✅ YES' : '❌ NO'}`);
    console.log(`   ├─ Tier 1 (Safety):       ${candidate.safetyCheck.score}/100 (40% weight)`);

    if (candidate.volumeMetrics) {
      console.log(`   ├─ Tier 2 (Volume):       ${candidate.volumeMetrics.score}/100 (25% weight)`);
    } else {
      console.log(`   ├─ Tier 2 (Volume):       N/A`);
    }

    if (candidate.priceMetrics) {
      console.log(`   ├─ Tier 3 (Price):        ${candidate.priceMetrics.score}/100 (20% weight)`);
    } else {
      console.log(`   ├─ Tier 3 (Price):        N/A`);
    }

    if (candidate.smartSignals) {
      console.log(`   └─ Tier 4 (Smart Money):  ${candidate.smartSignals.score}/100 (15% weight)`);
    } else {
      console.log(`   └─ Tier 4 (Smart Money):  N/A`);
    }
  });

  // Top recommendations
  const recommended = results.filter(c => c.recommended);
  console.log('\n--- Recommended Tokens ---');

  if (recommended.length > 0) {
    console.log(`\n✅ ${recommended.length} token(s) recommended for LP:`);
    recommended.forEach((candidate, index) => {
      console.log(`\n${index + 1}. ${candidate.symbol} - Score: ${candidate.score}/100`);

      if (candidate.priceMetrics) {
        console.log(`   Price Action: ${candidate.priceMetrics.trendDirection.toUpperCase()}, ` +
                    `Volatility ${candidate.priceMetrics.volatility7d.toFixed(1)}%, ` +
                    `Range-bound: ${candidate.priceMetrics.isRangeBound ? 'YES ✓' : 'NO'}`);
      }

      if (candidate.smartSignals) {
        console.log(`   Smart Signals: ${candidate.smartSignals.signals.length > 0 ? candidate.smartSignals.signals.join(', ') : 'None'}`);
      }
    });
  } else {
    console.log('\n❌ No tokens recommended (all failed criteria)');
  }

  // Statistics
  console.log('\n--- Performance Statistics ---');

  if (results.length > 0) {
    const avgScore = results.reduce((sum, c) => sum + c.score, 0) / results.length;
    const maxScore = Math.max(...results.map(c => c.score));
    const minScore = Math.min(...results.map(c => c.score));

    console.log(`Average Score: ${avgScore.toFixed(1)}/100`);
    console.log(`Highest Score: ${maxScore}/100`);
    console.log(`Lowest Score: ${minScore}/100`);

    // Tier-specific stats
    const tier1Avg = results.reduce((sum, c) => sum + c.safetyCheck.score, 0) / results.length;
    console.log(`\nTier 1 (Safety) Avg: ${tier1Avg.toFixed(1)}/100`);

    const tier2Results = results.filter(c => c.volumeMetrics);
    if (tier2Results.length > 0) {
      const tier2Avg = tier2Results.reduce((sum, c) => sum + (c.volumeMetrics?.score || 0), 0) / tier2Results.length;
      console.log(`Tier 2 (Volume) Avg: ${tier2Avg.toFixed(1)}/100 (${tier2Results.length}/${results.length} tokens)`);
    }

    const tier3Results = results.filter(c => c.priceMetrics);
    if (tier3Results.length > 0) {
      const tier3Avg = tier3Results.reduce((sum, c) => sum + (c.priceMetrics?.score || 0), 0) / tier3Results.length;
      console.log(`Tier 3 (Price) Avg: ${tier3Avg.toFixed(1)}/100 (${tier3Results.length}/${results.length} tokens)`);
    }

    const tier4Results = results.filter(c => c.smartSignals);
    if (tier4Results.length > 0) {
      const tier4Avg = tier4Results.reduce((sum, c) => sum + (c.smartSignals?.score || 0), 0) / tier4Results.length;
      console.log(`Tier 4 (Smart) Avg: ${tier4Avg.toFixed(1)}/100 (${tier4Results.length}/${results.length} tokens)`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('');
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
