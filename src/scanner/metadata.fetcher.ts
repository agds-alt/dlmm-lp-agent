/**
 * Token Metadata Fetcher
 * Fetches token symbol, name, and other metadata
 */

import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  description?: string;
  tags?: string[];
  verified?: boolean;
}

export class MetadataFetcher {
  private connection: Connection;
  private cache: Map<string, TokenMetadata>;

  constructor(connection: Connection) {
    this.connection = connection;
    this.cache = new Map();
  }

  /**
   * Fetch token metadata from multiple sources
   */
  async fetchMetadata(mintAddress: string): Promise<TokenMetadata> {
    // Check cache first
    if (this.cache.has(mintAddress)) {
      logger.debug(`Using cached metadata for ${mintAddress}`);
      return this.cache.get(mintAddress)!;
    }

    try {
      logger.debug(`Fetching metadata for ${mintAddress}`);

      // Try Jupiter first (most reliable for Solana tokens)
      let metadata = await this.fetchFromJupiter(mintAddress);

      // Fallback to DexScreener
      if (!metadata || metadata.symbol === 'UNKNOWN') {
        metadata = await this.fetchFromDexScreener(mintAddress);
      }

      // Fallback to Birdeye
      if (!metadata || metadata.symbol === 'UNKNOWN') {
        metadata = await this.fetchFromBirdeye(mintAddress);
      }

      // Default metadata if all sources fail
      if (!metadata) {
        metadata = {
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          decimals: 9,
        };
      }

      // Cache the result
      this.cache.set(mintAddress, metadata);

      logger.debug(`Metadata fetched: ${metadata.symbol} (${metadata.name})`);

      return metadata;
    } catch (error) {
      logger.error(`Error fetching metadata for ${mintAddress}`, error);

      return {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9,
      };
    }
  }

  /**
   * Fetch from Jupiter Token List
   */
  private async fetchFromJupiter(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.get(
        'https://token.jup.ag/all',
        { timeout: 5000 }
      );

      if (response.data && Array.isArray(response.data)) {
        const token = response.data.find((t: any) => t.address === mintAddress);

        if (token) {
          return {
            symbol: token.symbol || 'UNKNOWN',
            name: token.name || 'Unknown',
            decimals: token.decimals || 9,
            logoURI: token.logoURI,
            tags: token.tags || [],
            verified: true, // Jupiter tokens are verified
          };
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Jupiter fetch failed: ${error}`);
      return null;
    }
  }

  /**
   * Fetch from DexScreener
   */
  private async fetchFromDexScreener(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const token = pair.baseToken?.address === mintAddress ? pair.baseToken : pair.quoteToken;

        if (token) {
          return {
            symbol: token.symbol || 'UNKNOWN',
            name: token.name || 'Unknown',
            decimals: 9, // DexScreener doesn't provide decimals
            logoURI: pair.info?.imageUrl,
            verified: false,
          };
        }
      }

      return null;
    } catch (error) {
      logger.debug(`DexScreener fetch failed: ${error}`);
      return null;
    }
  }

  /**
   * Fetch from Birdeye
   */
  private async fetchFromBirdeye(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.get(
        `https://public-api.birdeye.so/public/token_overview?address=${mintAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.data) {
        const data = response.data.data;

        return {
          symbol: data.symbol || 'UNKNOWN',
          name: data.name || 'Unknown',
          decimals: data.decimals || 9,
          logoURI: data.logoURI,
          verified: false,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`Birdeye fetch failed: ${error}`);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Metadata cache cleared');
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

export default MetadataFetcher;
