/**
 * DLMM LP Agent - Entry Point
 *
 * Usage:
 *   pnpm dev       - Start agent (paper mode by default)
 *   pnpm start     - Start agent (compiled)
 *   pnpm discover  - Discover trending pools
 */

import { DLMMAgent } from './strategy/agent';
import { logger } from './utils/logger';

async function main() {
  const agent = new DLMMAgent();

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    agent.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await agent.start();
}

main().catch((error) => {
  logger.error(`Fatal: ${error}`);
  process.exit(1);
});
