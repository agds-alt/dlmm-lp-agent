/**
 * Telegram Alert System
 *
 * Sends formatted notifications to a Telegram chat via the Bot API.
 * All messages use HTML parse_mode for rich formatting.
 */

import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { TELEGRAM_CONFIG } from '../config/constants';
import { Position } from '../strategy/position.manager';
import { DailySnapshot } from '../database/position.db';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}`;

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
