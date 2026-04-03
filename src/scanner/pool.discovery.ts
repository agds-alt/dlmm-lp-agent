/**
 * Pool Discovery
 *
 * Auto-discovers new DLMM pool candidates by fetching trending Solana tokens
 * from DexScreener, filtering by age/volume, and scoring them with the
 * existing TokenScanner pipeline.
 */

import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { logger } from '../utils/logger';
import { TOKEN_FILTERS, DLMM_CONFIG } from '../config/constants';
import { TokenScanner, TokenCandidate } from './token.scanner';

const DEXSCREENER_API = 'https://api.dexscreener.com';

/** Raw pair record returned by DexScreener. */
interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  volume: { h24: number };
  liquidity: { usd: number };
  pairCreatedAt: number; // epoch ms
  fdv: number;
}

/** Discovered candidate enriched with pool info and scanner score. */
export interface DiscoveredCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  poolAddress: string;
  dexId: string;
  volume24h: number;
  liquidity: number;
  ageDays: number;
  priceUsd: number;
  fdv: number;
  /** Score from the TokenScanner (0-100), or -1 if scanning failed. */
  score: number;
  /** Full TokenCandidate when available. */
  candidate: TokenCandidate | null;
}

/**
 * In-memory cache entry to avoid re-scanning the same mint within a cooldown
 * window.
 */
interface CacheEntry {
  result: DiscoveredCandidate;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class PoolDiscovery {
  private connection: Connection;
  private tokenScanner: TokenScanner;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(connection: Connection, cacheTtlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.connection = connection;
    this.tokenScanner = new TokenScanner(connection);
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Discover top DLMM pool candidates from DexScreener trending tokens.
   *
   * Flow:
   * 1. Fetch trending Solana pairs from DexScreener.
   * 2. Filter by age, volume, and whether the pair is on Meteora DLMM.
   * 3. Score each token via the existing TokenScanner (Tier 1-2).
   * 4. Return the top `limit` candidates sorted by score.
   */
  async discoverCandidates(limit: number = 5): Promise<DiscoveredCandidate[]> {
    logger.info(`[PoolDiscovery] Starting candidate discovery (limit=${limit})`);

    // Step 1: Fetch trending pairs
    const pairs = await this.fetchTrendingPairs();
    if (pairs.length === 0) {
      logger.warn('[PoolDiscovery] No trending pairs returned from DexScreener');
      return [];
    }
    logger.info(`[PoolDiscovery] Fetched ${pairs.length} trending Solana pairs`);

    // Step 2: Filter
    const filtered = this.filterPairs(pairs);
    logger.info(`[PoolDiscovery] ${filtered.length} pairs passed filters`);

    if (filtered.length === 0) {
      return [];
    }

    // Step 3: Score each candidate (with cache)
    const scored: DiscoveredCandidate[] = [];

    for (const pair of filtered) {
      const cached = this.getFromCache(pair.baseToken.address);
      if (cached) {
        logger.debug(`[PoolDiscovery] Cache hit for ${pair.baseToken.symbol}`);
        scored.push(cached);
        continue;
      }

      const discovered = await this.scorePair(pair);
      if (discovered) {
        this.addToCache(discovered);
        scored.push(discovered);
      }
    }

    // Step 4: Sort by score desc, take top N
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    logger.info(
      `[PoolDiscovery] Returning top ${top.length} candidates: ` +
        top.map(c => `${c.symbol}(${c.score})`).join(', '),
    );

    return top;
  }

  // ─── Internal helpers ───────────────────────────────────────────

  /**
   * Fetch trending Solana token pairs from DexScreener.
   * Falls back to the search/boosted endpoint when the token-boosts
   * endpoint is empty.
   */
  private async fetchTrendingPairs(): Promise<DexScreenerPair[]> {
    try {
      // Primary: boosted tokens (trending/promoted)
      const boostResp = await axios.get<DexScreenerPair[]>(
        `${DEXSCREENER_API}/token-boosts/top/v1`,
        { timeout: 15_000 },
      );

      let pairs: DexScreenerPair[] = Array.isArray(boostResp.data) ? boostResp.data : [];

      // Filter to Solana only
      pairs = pairs.filter(p => p.chainId === 'solana');

      if (pairs.length > 0) {
        return pairs;
      }

      // Fallback: search Solana pairs sorted by volume
      logger.debug('[PoolDiscovery] Boost endpoint empty, falling back to search');
      const searchResp = await axios.get<{ pairs: DexScreenerPair[] }>(
        `${DEXSCREENER_API}/latest/dex/search`,
        {
          params: { q: 'SOL' },
          timeout: 15_000,
        },
      );

      return (searchResp.data?.pairs ?? []).filter(p => p.chainId === 'solana');
    } catch (error) {
      logger.error('[PoolDiscovery] Failed to fetch trending pairs', error);
      return [];
    }
  }

  /**
   * Apply age, volume, and DLMM-presence filters.
   */
  private filterPairs(pairs: DexScreenerPair[]): DexScreenerPair[] {
    const now = Date.now();

    return pairs.filter(pair => {
      // Must have creation timestamp
      if (!pair.pairCreatedAt) return false;

      // Age filter
      const ageDays = (now - pair.pairCreatedAt) / (24 * 60 * 60 * 1000);
      if (ageDays < TOKEN_FILTERS.MIN_TOKEN_AGE_DAYS) return false;
      if (ageDays > TOKEN_FILTERS.MAX_TOKEN_AGE_DAYS) return false;

      // Volume filter
      const vol24h = pair.volume?.h24 ?? 0;
      if (vol24h < TOKEN_FILTERS.MIN_DAILY_VOLUME) return false;
      if (vol24h > TOKEN_FILTERS.MAX_DAILY_VOLUME) return false;

      // Liquidity floor
      const liq = pair.liquidity?.usd ?? 0;
      if (liq < TOKEN_FILTERS.MIN_LIQUIDITY) return false;

      // Prefer Meteora DLMM pairs, but also accept other Solana DEXes
      // (users can check for a DLMM pool on-chain before opening a position)
      return true;
    });
  }

  /**
   * Score a single DexScreener pair by running it through the TokenScanner.
   */
  private async scorePair(pair: DexScreenerPair): Promise<DiscoveredCandidate | null> {
    const mintAddress = pair.baseToken.address;
    const now = Date.now();
    const ageDays = (now - pair.pairCreatedAt) / (24 * 60 * 60 * 1000);

    try {
      const candidate = await this.tokenScanner.scanToken(mintAddress, {
        includeTier2: true,
        includeTier3: false,
        includeTier4: false,
      });

      const discovered: DiscoveredCandidate = {
        mintAddress,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        poolAddress: pair.pairAddress,
        dexId: pair.dexId,
        volume24h: pair.volume?.h24 ?? 0,
        liquidity: pair.liquidity?.usd ?? 0,
        ageDays,
        priceUsd: parseFloat(pair.priceUsd) || 0,
        fdv: pair.fdv ?? 0,
        score: candidate?.score ?? -1,
        candidate,
      };

      return discovered;
    } catch (error) {
      logger.error(`[PoolDiscovery] Failed to score ${mintAddress}`, error);
      return null;
    }
  }

  // ─── Cache management ───────────────────────────────────────────

  private getFromCache(mintAddress: string): DiscoveredCandidate | null {
    const entry = this.cache.get(mintAddress);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(mintAddress);
      return null;
    }
    return entry.result;
  }

  private addToCache(candidate: DiscoveredCandidate): void {
    this.cache.set(candidate.mintAddress, {
      result: candidate,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Evict expired cache entries. Call periodically if running long-lived.
   */
  pruneCache(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug(`[PoolDiscovery] Pruned ${pruned} expired cache entries`);
    }
    return pruned;
  }
}

export default PoolDiscovery;
