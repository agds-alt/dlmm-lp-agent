/**
 * DLMM LP Agent - Main Entry Point
 * Phase 1: Proof of Concept
 */

import { getSolanaConnection, getConnectionInstance } from './core/connection';
import { validateConfig } from './config/constants';
import { logger } from './utils/logger';

async function main() {
  try {
    logger.info('='.repeat(60));
    logger.info('🚀 DLMM LP Agent - Starting PoC');
    logger.info('='.repeat(60));

    // Validate configuration
    logger.info('\n📋 Step 1: Validating configuration...');
    const isValid = validateConfig();
    if (!isValid) {
      logger.error('Configuration validation failed. Please check your .env file.');
      process.exit(1);
    }
    logger.success('Configuration validated successfully');

    // Initialize Solana connection
    logger.info('\n🔌 Step 2: Connecting to Solana RPC...');
    const connection = await getSolanaConnection();
    logger.success('Connected to Solana RPC');

    // Get network info
    logger.info('\n📊 Step 3: Fetching network information...');
    const connectionInstance = getConnectionInstance();

    // Get SOL price
    const solPrice = await connectionInstance.getSolPrice();
    logger.info(`Current SOL price: $${solPrice.toFixed(2)}`);

    // Get performance metrics
    const metrics = await connectionInstance.getPerformanceMetrics();
    logger.info(`Network TPS: ${metrics.tps}`);
    logger.info(`Average slot time: ${metrics.avgSlotTime}s`);

    // Get current slot
    const slot = await connection.getSlot();
    logger.info(`Current slot: ${slot}`);

    logger.info('\n' + '='.repeat(60));
    logger.success('✅ PoC Phase 1 - Basic Connection: SUCCESS');
    logger.info('='.repeat(60));

    logger.info('\n📝 Next steps:');
    logger.info('  1. ✅ Solana connection working');
    logger.info('  2. ⏳ Implement token scanner');
    logger.info('  3. ⏳ Implement DLMM pool reading');
    logger.info('  4. ⏳ Test with real tokens');

  } catch (error) {
    logger.error('Fatal error in main()', error);
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main()
    .then(() => {
      logger.info('\n👋 Exiting gracefully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Unhandled error', error);
      process.exit(1);
    });
}

export default main;
