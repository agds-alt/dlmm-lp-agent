/**
 * High Volume Token Scanner
 *
 * Ported from smart-grid-bot/volume_scanner.py
 *
 * Scans trending Solana tokens from DexScreener and scores them by:
 * - 24h volume (up to 30pts)
 * - Liquidity depth (up to 20pts)
 * - Volume spike vs previous scan (up to 20pts)
 * - Token age / freshness (up to 15pts)
 * - Buy pressure ratio (up to 15pts)
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { TOKEN_FILTERS } from '../config/constants';

const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface ScannedToken {
  mint: string;
  symbol: string;
  name: string;
  pairAddress: string;
  dex: string;
  price: number;
  volume24h: number;
  volume6h: number;
  volume1h: number;
  liquidity: number;
  fdv: number;
  change24h: number;
  change1h: number;
  ageDays: number;
  buys24h: number;
  sells24h: number;
  buyRatio: number;
  volumeSpike: number;
  score: number;
}

// Track previous volumes for spike detection
const prevVolumes: Map<string, number> = new Map();

// Alert cooldown per token (1 hour)
const alertedTokens: Map<string, number> = new Map();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Scan trending Solana tokens and return scored results.
 */
export async function scanHighVolume(): Promise<ScannedToken[]> {
  logger.info('[VolumeScanner] Scanning trending Solana tokens...');

  const rawTokens = await fetchTrendingSolana();
  const filtered = filterAndScore(rawTokens);

  logger.info(`[VolumeScanner] ${rawTokens.length} total → ${filtered.length} passed filters`);
  return filtered;
}

/**
 * Check if we should alert for this token (cooldown).
 */
export function shouldAlert(mint: string): boolean {
  const last = alertedTokens.get(mint) || 0;
  return (Date.now() - last) > ALERT_COOLDOWN_MS;
}

/**
 * Mark token as alerted.
 */
export function markAlerted(mint: string): void {
  alertedTokens.set(mint, Date.now());
}

/**
 * Fetch trending Solana tokens from DexScreener.
 */
async function fetchTrendingSolana(): Promise<ScannedToken[]> {
  const tokens: ScannedToken[] = [];
  const seen = new Set<string>();

  const queries = ['solana new', 'SOL pump', 'meteora', 'raydium SOL', 'solana meme trending'];

  for (const q of queries) {
    try {
      const resp = await axios.get(`${DEXSCREENER_API}/latest/dex/search`, {
        params: { q },
        timeout: 10_000,
      });

      const pairs = resp.data?.pairs ?? [];
      for (const p of pairs) {
        if (p.chainId !== 'solana') continue;
        const mint = p.baseToken?.address || '';
        if (!mint || seen.has(mint)) continue;
        seen.add(mint);

        const vol24h = parseFloat(p.volume?.h24 ?? 0) || 0;
        const vol6h = parseFloat(p.volume?.h6 ?? 0) || 0;
        const vol1h = parseFloat(p.volume?.h1 ?? 0) || 0;
        const liq = parseFloat(p.liquidity?.usd ?? 0) || 0;
        const price = parseFloat(p.priceUsd ?? 0) || 0;
        const change24h = parseFloat(p.priceChange?.h24 ?? 0) || 0;
        const change1h = parseFloat(p.priceChange?.h1 ?? 0) || 0;
        const fdv = parseFloat(p.fdv ?? 0) || 0;
        const created = p.pairCreatedAt || 0;
        const ageDays = created ? (Date.now() - created) / 86_400_000 : 999;
        const buys24h = p.txns?.h24?.buys ?? 0;
        const sells24h = p.txns?.h24?.sells ?? 0;

        tokens.push({
          mint,
          symbol: p.baseToken?.symbol || '?',
          name: p.baseToken?.name || '?',
          pairAddress: p.pairAddress || '',
          dex: p.dexId || '',
          price,
          volume24h: vol24h,
          volume6h: vol6h,
          volume1h: vol1h,
          liquidity: liq,
          fdv,
          change24h,
          change1h,
          ageDays,
          buys24h,
          sells24h,
          buyRatio: 0,
          volumeSpike: 0,
          score: 0,
        });
      }
    } catch (error) {
      logger.debug(`[VolumeScanner] Search '${q}' failed: ${(error as Error).message}`);
    }
  }

  return tokens;
}

/**
 * Filter by volume/liquidity/age and score tokens.
 */
function filterAndScore(tokens: ScannedToken[]): ScannedToken[] {
  const results: ScannedToken[] = [];
  const maxAgeDays = TOKEN_FILTERS.MAX_TOKEN_AGE_DAYS;

  for (const t of tokens) {
    if (t.volume24h < TOKEN_FILTERS.MIN_DAILY_VOLUME) continue;
    if (t.liquidity < TOKEN_FILTERS.MIN_LIQUIDITY) continue;
    if (t.ageDays > maxAgeDays) continue;

    // Volume spike detection
    const prevVol = prevVolumes.get(t.mint) || 0;
    t.volumeSpike = prevVol > 0 ? t.volume24h / prevVol : 0;

    // Buy pressure
    const totalTxns = t.buys24h + t.sells24h;
    t.buyRatio = totalTxns > 0 ? t.buys24h / totalTxns : 0.5;

    // Score (0-100)
    let score = 0;
    score += Math.min((t.volume24h / 500_000) * 30, 30);                    // Volume up to 30pts
    score += Math.min((t.liquidity / 200_000) * 20, 20);                    // Liquidity up to 20pts
    score += t.volumeSpike > 1 ? Math.min((t.volumeSpike / 5) * 20, 20) : 0; // Spike up to 20pts
    score += (1 - t.ageDays / maxAgeDays) * 15;                             // Newer = higher, up to 15pts
    score += t.buyRatio * 15;                                                 // Buy pressure up to 15pts
    t.score = Math.round(score * 10) / 10;

    results.push(t);
  }

  // Update previous volumes for next scan
  for (const t of tokens) {
    prevVolumes.set(t.mint, t.volume24h);
  }

  // Sort by score desc
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Format a scanned token for Telegram display.
 */
export function formatTokenAlert(t: ScannedToken): string {
  const changeIcon = t.change24h >= 0 ? '🟢' : '🔴';
  const spikeText = t.volumeSpike > 1.5 ? ` | Spike: ${t.volumeSpike.toFixed(1)}x` : '';

  const buyBars = Math.round(t.buyRatio * 10);
  const buyBar = '🟩'.repeat(buyBars) + '🟥'.repeat(10 - buyBars);

  return [
    `🔔 <b>HIGH VOLUME ALERT</b>`,
    '',
    `<b>${t.symbol}</b> (${t.name.slice(0, 20)})`,
    `DEX: ${t.dex} | Age: ${t.ageDays.toFixed(1)} days`,
    '',
    `💰 Price: $${t.price < 0.01 ? t.price.toExponential(2) : t.price.toFixed(6)}`,
    `${changeIcon} 24h: ${t.change24h}% | 1h: ${t.change1h}%`,
    `📊 Vol 24h: $${fmtNum(t.volume24h)}${spikeText}`,
    `💧 Liq: $${fmtNum(t.liquidity)}`,
    `📈 FDV: $${fmtNum(t.fdv)}`,
    '',
    `Buy/Sell: ${buyBar}`,
    `Buys: ${t.buys24h} | Sells: ${t.sells24h}`,
    '',
    `Score: <b>${t.score}/100</b>`,
    `<code>${t.mint}</code>`,
  ].join('\n');
}

/**
 * Format scan results summary for /scan command.
 */
export function formatScanResults(tokens: ScannedToken[]): string {
  if (tokens.length === 0) {
    return '😕 No high-volume tokens found right now.';
  }

  const lines = ['<b>🔍 Top Volume Tokens (Solana)</b>\n'];

  for (const t of tokens.slice(0, 8)) {
    const changeIcon = t.change24h >= 0 ? '🟢' : '🔴';
    lines.push(
      `<b>${t.symbol}</b> | $${t.price < 0.01 ? t.price.toExponential(2) : t.price.toFixed(6)}`,
      `  Vol: $${fmtNum(t.volume24h)} | Liq: $${fmtNum(t.liquidity)}`,
      `  ${changeIcon} ${t.change24h}% | Age: ${t.ageDays.toFixed(0)}d | Score: ${t.score}`,
      '',
    );
  }

  return lines.join('\n');
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
