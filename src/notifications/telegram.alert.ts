/**
 * Telegram Alert System
 *
 * Sends formatted notifications to a Telegram chat via the Bot API.
 * All messages use HTML parse_mode for rich formatting.
 */

import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { TELEGRAM_CONFIG, STRATEGY_CONFIG } from '../config/constants';
import { Position } from '../strategy/position.manager';
import { DailySnapshot } from '../database/position.db';
import { scanHighVolume, formatScanResults } from '../scanner/volume.scanner';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}`;

// ─── Command handler types ────────────────────────────────────────
type StatusProvider = () => {
  running: boolean;
  mode: string;
  paper: boolean;
  uptime: number;
  positions: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  feesEarned: number;
  cyclesCompleted: number;
};

type PositionsProvider = () => Position[];

interface ScanCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  poolAddress: string;
  volume24h: number;
  liquidity: number;
  ageDays: number;
  priceUsd: number;
  fdv: number;
  score: number;
}

type ScanProvider = () => Promise<ScanCandidate[]>;
type EntryProvider = (poolAddress: string, mintAddress: string, symbol: string) => Promise<boolean>;

let statusProvider: StatusProvider | null = null;
let positionsProvider: PositionsProvider | null = null;
let scanProvider: ScanProvider | null = null;
let entryProvider: EntryProvider | null = null;
let pollingOffset = 0;
let pollingActive = false;

// Pending scan results waiting for user selection
let pendingCandidates: ScanCandidate[] = [];

/**
 * Send a raw HTML message to the configured Telegram chat.
 * Silently logs and returns false when Telegram is not configured.
 */
export async function sendAlert(message: string): Promise<boolean> {
  if (!TELEGRAM_CONFIG.ENABLED) {
    logger.debug('Telegram alerts disabled (missing BOT_TOKEN or CHAT_ID)');
    return false;
  }

  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: TELEGRAM_CONFIG.CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return true;
  } catch (error) {
    const axiosErr = error as AxiosError;
    const status = axiosErr.response?.status ?? 'unknown';
    logger.error(`Telegram sendMessage failed (HTTP ${status})`, error);
    return false;
  }
}

/**
 * Format a USD value with sign and 2-decimal precision.
 */
function fmtUsd(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

/**
 * Format a percentage with sign and 2-decimal precision.
 */
function fmtPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format a duration in ms to a human-readable string.
 */
function fmtDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

/**
 * Shorten a Solana address for display: first6...last4
 */
function shortAddr(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ─── Notification helpers ───────────────────────────────────────────

/**
 * Notify that a new LP position has been opened.
 */
export async function notifyPositionOpened(position: Position): Promise<boolean> {
  const mode = position.isPaper ? '📝 PAPER' : '🟢 LIVE';
  const msg = [
    `${mode} <b>Position Opened</b>`,
    '',
    `🏊 <b>Pool:</b> <code>${shortAddr(position.poolAddress)}</code>`,
    `🪙 <b>Tokens:</b> ${shortAddr(position.tokenX)} / ${shortAddr(position.tokenY)}`,
    `💰 <b>Amount:</b> $${position.totalValueUsd.toFixed(2)}`,
    `📊 <b>Entry Price:</b> $${position.entryPrice.toFixed(6)}`,
    `📐 <b>Bin Range:</b> ${position.binRange.min} → ${position.binRange.max}`,
    `🆔 <code>${position.id}</code>`,
  ].join('\n');

  return sendAlert(msg);
}

/**
 * Notify that a position has been closed, including PnL and duration.
 */
export async function notifyPositionClosed(position: Position): Promise<boolean> {
  const duration = fmtDuration(Date.now() - position.entryTime);
  const pnlEmoji = position.pnl >= 0 ? '🟢' : '🔴';

  const msg = [
    `${pnlEmoji} <b>Position Closed</b>`,
    '',
    `🏊 <b>Pool:</b> <code>${shortAddr(position.poolAddress)}</code>`,
    `💰 <b>Invested:</b> $${position.totalValueUsd.toFixed(2)}`,
    `💵 <b>Returned:</b> $${position.currentValueUsd.toFixed(2)}`,
    `📈 <b>PnL:</b> ${fmtUsd(position.pnl)} (${fmtPct(position.pnlPercent)})`,
    `📉 <b>IL:</b> ${fmtPct(position.ilPercent)}`,
    `🎁 <b>Fees Earned:</b> $${position.feesEarned.toFixed(4)}`,
    `⏱ <b>Duration:</b> ${duration}`,
    `🆔 <code>${position.id}</code>`,
  ].join('\n');

  return sendAlert(msg);
}

/**
 * Notify that a position has been rebalanced (old closed, new opened).
 */
export async function notifyRebalance(
  oldPosition: Position,
  newPosition: Position,
): Promise<boolean> {
  const msg = [
    `🔄 <b>Position Rebalanced</b>`,
    '',
    `<b>Old Position</b> <code>${oldPosition.id}</code>`,
    `  Bins: ${oldPosition.binRange.min}→${oldPosition.binRange.max}`,
    `  PnL: ${fmtUsd(oldPosition.pnl)} (${fmtPct(oldPosition.pnlPercent)})`,
    '',
    `<b>New Position</b> <code>${newPosition.id}</code>`,
    `  Bins: ${newPosition.binRange.min}→${newPosition.binRange.max}`,
    `  Entry: $${newPosition.entryPrice.toFixed(6)}`,
    `  Amount: $${newPosition.totalValueUsd.toFixed(2)}`,
    '',
    `🏊 Pool: <code>${shortAddr(newPosition.poolAddress)}</code>`,
  ].join('\n');

  return sendAlert(msg);
}

/**
 * Send a risk/warning alert for a specific position.
 */
export async function notifyRiskAlert(
  positionId: string,
  reason: string,
): Promise<boolean> {
  const msg = [
    `⚠️ <b>Risk Alert</b>`,
    '',
    `🆔 <code>${positionId}</code>`,
    `📋 <b>Reason:</b> ${reason}`,
    '',
    `Action may be required. Check the dashboard.`,
  ].join('\n');

  return sendAlert(msg);
}

/**
 * Send a daily performance summary.
 */
export async function notifyDailySummary(stats: DailySnapshot): Promise<boolean> {
  const pnlEmoji = stats.totalPnl >= 0 ? '🟢' : '🔴';
  const best = stats.bestPosition
    ? `${shortAddr(stats.bestPosition.id)} (${fmtPct(stats.bestPosition.pnlPercent)})`
    : 'N/A';
  const worst = stats.worstPosition
    ? `${shortAddr(stats.worstPosition.id)} (${fmtPct(stats.worstPosition.pnlPercent)})`
    : 'N/A';

  const msg = [
    `📊 <b>Daily Summary — ${stats.date}</b>`,
    '',
    `${pnlEmoji} <b>PnL:</b> ${fmtUsd(stats.totalPnl)} (${fmtPct(stats.totalPnlPercent)})`,
    `💰 <b>Portfolio Value:</b> $${stats.totalValueUsd.toFixed(2)}`,
    `🎁 <b>Fees Earned:</b> $${stats.totalFeesEarned.toFixed(4)}`,
    '',
    `📂 <b>Open:</b> ${stats.openPositions}  |  <b>Closed:</b> ${stats.closedPositions}`,
    `🏆 <b>Best:</b> ${best}`,
    `💀 <b>Worst:</b> ${worst}`,
  ].join('\n');

  return sendAlert(msg);
}

// ─── Telegram Command Polling ─────────────────────────────────────

/**
 * Register providers so the command handler can query agent state.
 */
export function registerCommandHandlers(
  getStatus: StatusProvider,
  getPositions: PositionsProvider,
  getScanCandidates: ScanProvider,
  enterPosition: EntryProvider,
): void {
  statusProvider = getStatus;
  positionsProvider = getPositions;
  scanProvider = getScanCandidates;
  entryProvider = enterPosition;
}

/**
 * Start polling for incoming Telegram commands.
 */
export function startCommandPolling(): void {
  if (!TELEGRAM_CONFIG.ENABLED) {
    logger.debug('Telegram command polling disabled (not configured)');
    return;
  }
  if (pollingActive) return;
  pollingActive = true;
  logger.info('Telegram command polling started');
  pollLoop();
}

/**
 * Send a message with inline keyboard buttons.
 */
async function sendWithButtons(
  message: string,
  buttons: { text: string; callback_data: string }[][],
): Promise<boolean> {
  if (!TELEGRAM_CONFIG.ENABLED) return false;

  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: TELEGRAM_CONFIG.CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    });
    return true;
  } catch (error) {
    const axiosErr = error as AxiosError;
    logger.error(`Telegram sendWithButtons failed (HTTP ${axiosErr.response?.status ?? 'unknown'})`);
    return false;
  }
}

/**
 * Answer a callback query (removes loading spinner on button).
 */
async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text: text ?? '',
    });
  } catch {
    // non-critical
  }
}

async function pollLoop(): Promise<void> {
  while (pollingActive) {
    try {
      const resp = await axios.get(`${TELEGRAM_API}/getUpdates`, {
        params: {
          offset: pollingOffset,
          timeout: 30,
          allowed_updates: JSON.stringify(['message', 'callback_query']),
        },
        timeout: 35_000,
      });

      const updates = resp.data?.result ?? [];
      for (const update of updates) {
        pollingOffset = update.update_id + 1;

        // Handle callback query (inline button press)
        if (update.callback_query) {
          const cbChatId = String(update.callback_query.message?.chat?.id ?? '');
          if (cbChatId !== TELEGRAM_CONFIG.CHAT_ID) continue;
          await handleCallbackQuery(update.callback_query);
          continue;
        }

        // Handle text command
        const text: string = update.message?.text ?? '';
        const chatId: string = String(update.message?.chat?.id ?? '');
        if (chatId !== TELEGRAM_CONFIG.CHAT_ID) continue;

        if (text === '/dlmm') {
          await handleDlmmCommand();
        } else if (text === '/status') {
          await handleStatusCommand();
        } else if (text === '/scan') {
          await handleScanCommand();
        } else if (text === '/help') {
          await handleHelpCommand();
        }
      }
    } catch (error) {
      logger.debug(`Telegram poll error: ${error}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── /dlmm — Scan & show token candidates ────────────────────────

async function handleDlmmCommand(): Promise<void> {
  if (!scanProvider) {
    await sendAlert('⚠️ Agent not fully initialized yet.');
    return;
  }

  // Check if there's already an open position
  if (positionsProvider) {
    const openPos = positionsProvider();
    if (openPos.length >= STRATEGY_CONFIG.MAX_POSITIONS) {
      await sendAlert(
        `⚠️ <b>Max positions reached</b> (${openPos.length}/${STRATEGY_CONFIG.MAX_POSITIONS})\n\nGunakan /status untuk cek posisi aktif.\nTunggu posisi ditutup sebelum entry baru.`,
      );
      return;
    }
  }

  await sendAlert('🔍 <b>Scanning tokens...</b>\nMencari token high volume yang aman dan berpotensi cuan. Tunggu sebentar...');

  try {
    const candidates = await scanProvider();

    if (candidates.length === 0) {
      await sendAlert('😕 <b>Tidak ada kandidat ditemukan</b>\n\nSemua token yang ditemukan gagal lolos filter keamanan atau volume terlalu rendah. Coba lagi nanti.');
      return;
    }

    // Store for later selection
    pendingCandidates = candidates;

    // Find the best candidate (highest score)
    const bestIdx = candidates.reduce((best, c, i) =>
      c.score > candidates[best].score ? i : best, 0);

    // Build message
    const lines: string[] = [
      `🎯 <b>Token Candidates Found!</b>`,
      `Capital: <b>$${STRATEGY_CONFIG.STARTING_CAPITAL}</b> | Target: <b>+${STRATEGY_CONFIG.PROFIT_TARGET_PERCENT}%</b>`,
      '',
    ];

    // Build inline buttons
    const buttons: { text: string; callback_data: string }[][] = [];

    candidates.forEach((c, i) => {
      const isRecommended = i === bestIdx;
      const medal = isRecommended ? '⭐' : `${i + 1}.`;
      const safetyLabel = c.score >= 75 ? '🟢 SAFE' : c.score >= 50 ? '🟡 OK' : '🟠 RISKY';

      lines.push(
        `${medal} <b>${c.symbol}</b>${isRecommended ? ' 👈 RECOMMENDED' : ''}`,
        `   💰 Price: $${c.priceUsd < 0.01 ? c.priceUsd.toExponential(2) : c.priceUsd.toFixed(4)}`,
        `   📊 Vol 24h: $${formatVolume(c.volume24h)}`,
        `   💧 Liquidity: $${formatVolume(c.liquidity)}`,
        `   🛡 Safety: ${safetyLabel} (${c.score}/100)`,
        `   📅 Age: ${c.ageDays.toFixed(1)} days`,
        `   💎 FDV: $${formatVolume(c.fdv)}`,
        '',
      );

      const btnLabel = isRecommended
        ? `⭐ ${c.symbol} (RECOMMENDED)`
        : `${i + 1}. ${c.symbol}`;

      buttons.push([{ text: btnLabel, callback_data: `entry:${i}` }]);
    });

    // Add bot recommendation explanation
    const best = candidates[bestIdx];
    lines.push(
      `💡 <b>Bot Recommendation: ${best.symbol}</b>`,
      `Alasan: Safety score tertinggi (${best.score}/100)`,
      `Volume 24h $${formatVolume(best.volume24h)} dengan liquidity $${formatVolume(best.liquidity)}`,
      '',
      `👇 <b>Pilih token untuk entry atau tap RECOMMENDED:</b>`,
    );

    // Add cancel button
    buttons.push([{ text: '❌ Cancel', callback_data: 'entry:cancel' }]);

    await sendWithButtons(lines.join('\n'), buttons);
  } catch (error) {
    logger.error(`Scan command failed: ${error}`);
    await sendAlert(`❌ <b>Scan failed</b>\n${error}`);
  }
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

// ─── Callback query handler (button press) ────────────────────────

async function handleCallbackQuery(cbQuery: any): Promise<void> {
  const data: string = cbQuery.data ?? '';
  const cbId: string = cbQuery.id;

  // Handle "Scan Tokens" button from /status
  if (data === 'cmd:scan') {
    await answerCallback(cbId, 'Scanning...');
    await handleDlmmCommand();
    return;
  }

  if (!data.startsWith('entry:')) {
    await answerCallback(cbId);
    return;
  }

  const selection = data.replace('entry:', '');

  if (selection === 'cancel') {
    pendingCandidates = [];
    await answerCallback(cbId, 'Cancelled');
    await sendAlert('❌ Entry cancelled.');
    return;
  }

  const idx = parseInt(selection, 10);
  if (isNaN(idx) || idx < 0 || idx >= pendingCandidates.length) {
    await answerCallback(cbId, 'Invalid selection');
    return;
  }

  const chosen = pendingCandidates[idx];
  pendingCandidates = [];

  await answerCallback(cbId, `Entering ${chosen.symbol}...`);
  await sendAlert(
    `🚀 <b>Entering ${chosen.symbol}...</b>\n\n` +
    `💰 Capital: $${STRATEGY_CONFIG.STARTING_CAPITAL}\n` +
    `📊 Volume: $${formatVolume(chosen.volume24h)}\n` +
    `🛡 Safety: ${chosen.score}/100\n\n` +
    `Tunggu konfirmasi...`,
  );

  if (!entryProvider) {
    await sendAlert('⚠️ Entry provider not available.');
    return;
  }

  try {
    const success = await entryProvider(chosen.poolAddress, chosen.mintAddress, chosen.symbol);
    if (success) {
      await sendAlert(
        `✅ <b>Entry berhasil!</b>\n\n` +
        `Token: <b>${chosen.symbol}</b>\n` +
        `Pool: <code>${shortAddr(chosen.poolAddress)}</code>\n` +
        `Capital: $${STRATEGY_CONFIG.STARTING_CAPITAL}\n` +
        `🎯 Target: +${STRATEGY_CONFIG.PROFIT_TARGET_PERCENT}%\n` +
        `🛑 Stop Loss: -${STRATEGY_CONFIG.MAX_LOSS_PERCENT}%\n\n` +
        `Bot akan auto-exit saat hit target atau stop loss.\nGunakan /status untuk monitor.`,
      );
    } else {
      await sendAlert(`❌ <b>Entry gagal untuk ${chosen.symbol}</b>\nPool mungkin tidak valid atau ada error. Coba /dlmm lagi.`);
    }
  } catch (error) {
    logger.error(`Entry via Telegram failed: ${error}`);
    await sendAlert(`❌ <b>Entry error:</b> ${error}`);
  }
}

// ─── /status — Show current status ────────────────────────────────

async function handleStatusCommand(): Promise<void> {
  if (!statusProvider || !positionsProvider) {
    await sendAlert('⚠️ Agent not fully initialized yet.');
    return;
  }

  const s = statusProvider();
  const positions = positionsProvider();
  const mode = s.paper ? 'PAPER' : 'LIVE';
  const upHours = (s.uptime / (1000 * 60 * 60)).toFixed(1);
  const pnlEmoji = s.totalPnl >= 0 ? '🟢' : '🔴';

  const lines = [
    `🤖 <b>DLMM LP Agent</b>`,
    `Service: <b>${s.running ? 'ACTIVE' : 'STOPPED'}</b>`,
    `Mode: <b>${mode}</b>`,
    '',
    `📊 Positions: ${s.positions}/${STRATEGY_CONFIG.MAX_POSITIONS}`,
    `💰 Value: $${s.totalValue.toFixed(2)}`,
    `${pnlEmoji} PnL: ${fmtUsd(s.totalPnl)} (${fmtPct(s.totalPnlPct)})`,
    `🎁 Fees: $${s.feesEarned.toFixed(4)}`,
    `⏱ Uptime: ${upHours}h | Cycles: ${s.cyclesCompleted}`,
    `🎯 Target: +${STRATEGY_CONFIG.PROFIT_TARGET_PERCENT}%`,
    `💵 Capital: $${STRATEGY_CONFIG.STARTING_CAPITAL}`,
  ];

  if (positions.length > 0) {
    lines.push('', '<b>Open Positions:</b>');
    for (const pos of positions) {
      const posEmoji = pos.pnlPercent >= 0 ? '🟢' : '🔴';
      lines.push(
        `${posEmoji} <code>${pos.id.slice(0, 16)}...</code>`,
        `   $${pos.currentValueUsd.toFixed(2)} | PnL: ${fmtPct(pos.pnlPercent)} | IL: ${fmtPct(pos.ilPercent)}`,
      );
    }
  } else {
    lines.push('', '📭 No open positions');
  }

  // Add quick action buttons
  const buttons: { text: string; callback_data: string }[][] = [];
  if (positions.length < STRATEGY_CONFIG.MAX_POSITIONS) {
    buttons.push([{ text: '🔍 Scan Tokens', callback_data: 'cmd:scan' }]);
  }

  if (buttons.length > 0) {
    await sendWithButtons(lines.join('\n'), buttons);
  } else {
    await sendAlert(lines.join('\n'));
  }
}

async function handleScanCommand(): Promise<void> {
  await sendAlert('🔍 <b>Scanning high volume tokens...</b>');
  try {
    const tokens = await scanHighVolume();
    await sendAlert(formatScanResults(tokens));
  } catch (error) {
    await sendAlert(`❌ Scan failed: ${error}`);
  }
}

async function handleHelpCommand(): Promise<void> {
  const msg = [
    `🤖 <b>DLMM LP Agent Commands</b>`,
    '',
    `/dlmm - Scan token & pilih untuk entry`,
    `/scan - Scan high volume tokens (top 8)`,
    `/status - Cek status agent & posisi`,
    `/help - Tampilkan bantuan ini`,
  ].join('\n');

  await sendAlert(msg);
}

/**
 * Stop command polling.
 */
export function stopCommandPolling(): void {
  pollingActive = false;
}
