/**
 * Solana Connection Manager
 * Handles RPC connection with retry logic and health checks
 */

import { Connection, Commitment, ConnectionConfig } from '@solana/web3.js';
import { getRpcUrl, SOLANA_CONFIG } from '../config/constants';
import { logger } from '../utils/logger';

export class SolanaConnection {
  private connection: Connection | null = null;
  private rpcUrl: string;
  private commitment: Commitment;
  private retryCount: number = 0;
  private maxRetries: number = 3;

  constructor() {
    this.rpcUrl = getRpcUrl();
    this.commitment = SOLANA_CONFIG.COMMITMENT;
  }

  /**
   * Initialize connection to Solana RPC
   */
  async initialize(): Promise<Connection> {
    try {
      logger.info(`Initializing Solana connection to ${this.rpcUrl}`);

      const config: ConnectionConfig = {
        commitment: this.commitment,
        confirmTransactionInitialTimeout: 60000,
      };

      this.connection = new Connection(this.rpcUrl, config);

      // Test connection
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        throw new Error('Connection health check failed');
      }

      logger.success('Solana connection established successfully');
      this.retryCount = 0;

      return this.connection;
    } catch (error) {
      logger.error('Failed to initialize Solana connection', error);

      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        logger.warn(`Retrying connection... Attempt ${this.retryCount}/${this.maxRetries}`);
        await this.sleep(2000 * this.retryCount); // Exponential backoff
        return this.initialize();
      }

      throw error;
    }
  }

  /**
   * Health check for Solana connection
   */
  async healthCheck(): Promise<boolean> {
    if (!this.connection) {
      return false;
    }

    try {
      logger.debug('Running connection health check...');

      // Get cluster version
      const version = await this.connection.getVersion();
      logger.debug(`Solana cluster version: ${version['solana-core']}`);

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      logger.debug(`Latest blockhash: ${blockhash}`);

      // Get current slot
      const slot = await this.connection.getSlot();
      logger.debug(`Current slot: ${slot}`);

      logger.success('Connection health check passed');
      return true;
    } catch (error) {
      logger.error('Connection health check failed', error);
      return false;
    }
  }

  /**
   * Get the connection instance
   */
  getConnection(): Connection {
    if (!this.connection) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.connection;
  }

  /**
   * Get current SOL price from Jupiter API
   */
  async getSolPrice(): Promise<number> {
    try {
      const axios = require('axios');
      const response = await axios.get(
        'https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112'
      );

      const solPrice = response.data.data['So11111111111111111111111111111111111111112'].price;
      logger.debug(`Current SOL price: $${solPrice}`);
      return solPrice;
    } catch (error) {
      logger.error('Failed to fetch SOL price', error);
      return 0;
    }
  }

  /**
   * Get network performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    tps: number;
    avgSlotTime: number;
  }> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    try {
      const perfSamples = await this.connection.getRecentPerformanceSamples(1);
      const sample = perfSamples[0];

      const tps = sample.numTransactions / sample.samplePeriodSecs;
      const avgSlotTime = sample.samplePeriodSecs / sample.numSlots;

      logger.debug(`Network TPS: ${tps.toFixed(0)}, Avg slot time: ${avgSlotTime.toFixed(2)}s`);

      return {
        tps: Math.round(tps),
        avgSlotTime: parseFloat(avgSlotTime.toFixed(2)),
      };
    } catch (error) {
      logger.error('Failed to get performance metrics', error);
      return { tps: 0, avgSlotTime: 0 };
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.connection) {
      logger.info('Closing Solana connection');
      this.connection = null;
    }
  }
}

// Singleton instance
let solanaConnection: SolanaConnection | null = null;

export const getSolanaConnection = async (): Promise<Connection> => {
  if (!solanaConnection) {
    solanaConnection = new SolanaConnection();
    await solanaConnection.initialize();
  }
  return solanaConnection.getConnection();
};

export const getConnectionInstance = (): SolanaConnection => {
  if (!solanaConnection) {
    solanaConnection = new SolanaConnection();
  }
  return solanaConnection;
};

export default SolanaConnection;
