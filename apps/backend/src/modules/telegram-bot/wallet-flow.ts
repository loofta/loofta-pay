import { PublicKey } from '@solana/web3.js';
import type { InlineKeyboard } from './telegram-api';

/**
 * Deposit and withdraw from the bot, Solana first: USDC on Solana is the default, and any other token
 * or network NEAR Intents supports is the "advanced" path, only offered when asked for.
 */

const EVM_CHAINS = new Set([
  'eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism', 'bsc', 'berachain', 'pol', 'polygon',
  'avax', 'avalanche', 'gnosis', 'fantom', 'ftm', 'linea', 'scroll', 'zksync', 'zk', 'blast', 'matic', 'monad',
]);

export function isValidSolanaAddress(address: string): boolean {
  try {
    const raw = address.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return false;
    return new PublicKey(raw).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Same rules the app uses on its withdraw screen. A wrong-format address must never reach a transfer. */
export function validateAddress(address: string, chain: string): boolean {
  const raw = (address || '').trim();
  if (!raw) return false;
  const ch = String(chain || '').toLowerCase();
  if (EVM_CHAINS.has(ch)) return /^0x[a-fA-F0-9]{40}$/.test(raw);
  if (ch === 'solana' || ch === 'sol') return isValidSolanaAddress(raw);
  if (ch === 'near') return /^[a-z0-9_.-]+\.(near|testnet)$/i.test(raw) || /^[a-f0-9]{64}$/i.test(raw);
  if (ch === 'btc' || ch === 'bitcoin') return /^bc1[0-9a-zA-Z]{20,90}$/.test(raw) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(raw);
  if (ch === 'ton') return /^[A-Za-z0-9_-]{48,66}$/.test(raw);
  if (ch === 'sui') return /^0x[a-fA-F0-9]{64}$/.test(raw);
  if (ch === 'ada' || ch === 'cardano') return /^addr1[0-9a-z]+$/.test(raw);
  if (ch === 'zec' || ch === 'zcash') return /^t1[0-9A-Za-z]{33}$/.test(raw) || /^zs1[0-9a-zA-Z]{75}$/.test(raw);
  if (ch === 'xlm' || ch === 'stellar') return /^G[2-7A-Z]{55}$/.test(raw);
  if (ch === 'trx' || ch === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw);
  if (ch === 'xrp' || ch === 'xrpledger') return /^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(raw);
  if (ch === 'ltc' || ch === 'litecoin') return /^ltc1[0-9a-z]{20,90}$/.test(raw) || /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(raw);
  if (ch === 'doge' || ch === 'dogecoin') return /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(raw);
  if (ch === 'aptos') return /^0x[a-fA-F0-9]{64}$/.test(raw);
  return false; // unknown network: refuse rather than guess
}

/** "9WzD…AWWM": enough to recognise, short enough for a button or a line. */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** The amounts offered as buttons for a withdrawal: a few presets that fit the balance, and Max. */
export const WITHDRAW_PRESETS = [10, 25, 50, 100];
export function withdrawAmountRows(balanceUsd: number): InlineKeyboard['inline_keyboard'] {
  const presets = WITHDRAW_PRESETS.filter((a) => a <= balanceUsd);
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (presets.length) rows.push(presets.map((a) => ({ text: `$${a}`, callback_data: `wd:amt:${a}` })));
  rows.push([
    ...(balanceUsd >= 1 ? [{ text: `Max $${Math.floor(balanceUsd * 100) / 100}`, callback_data: 'wd:amt:max' }] : []),
    { text: 'Custom amount', callback_data: 'wd:custom' },
  ]);
  rows.push([{ text: 'Cancel', callback_data: 'wd:cancel' }]);
  return rows;
}

/** Other networks, "advanced": a short list of the usual ones, and anything else by typing it. */
export const POPULAR_TOKENS: Array<{ label: string; symbol: string; chains: string[] }> = [
  { label: 'USDC on Base', symbol: 'USDC', chains: ['base'] },
  { label: 'USDC on Ethereum', symbol: 'USDC', chains: ['eth', 'ethereum'] },
  { label: 'USDC on Arbitrum', symbol: 'USDC', chains: ['arb', 'arbitrum'] },
  { label: 'USDT on Tron', symbol: 'USDT', chains: ['tron', 'trx'] },
  { label: 'ETH', symbol: 'ETH', chains: ['eth', 'ethereum'] },
  { label: 'BTC', symbol: 'BTC', chains: ['btc', 'bitcoin'] },
];

/** "arb on arbitrum", "usdt tron", "BTC": a symbol and, optionally, a network. */
export function parseTokenQuery(text: string): { symbol: string; chain?: string } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^([a-z0-9]{2,12})(?: (?:on )?([a-z0-9]{2,15}))?$/.exec(t);
  if (!m) return null;
  return { symbol: m[1].toUpperCase(), chain: m[2] };
}

/** Rounds a token amount for display without scientific notation. */
export function formatTokenAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return Number(n.toFixed(digits)).toString();
}

/** What a withdraw or deposit that is waiting on the next message has gathered so far. */
export interface WalletToken { symbol: string; chain: string; tokenId: string; decimals: number }
export interface WalletDraft {
  flow: 'withdraw' | 'deposit';
  /** token: waiting for a typed token. address: a wallet address. amount/custom: how much. */
  step: 'token' | 'address' | 'amount' | 'custom';
  /** solana: USDC on Solana (the default). near: any other token or network. */
  network?: 'solana' | 'near';
  token?: WalletToken;
  /** Several networks carry this token: the choices on screen. */
  options?: WalletToken[];
  destination?: string;
  /** Deposit only: the person's own address on the source network, used to refund if a bridge fails. */
  refundAddress?: string;
  balanceUsd?: number | null;
  expires: number;
}

/** The names NEAR Intents might use for one network. */
export function chainAliases(chain: string): string[] {
  const c = chain.toLowerCase();
  const groups = [['eth', 'ethereum'], ['arb', 'arbitrum'], ['op', 'optimism'], ['pol', 'polygon', 'matic'], ['btc', 'bitcoin'], ['sol', 'solana'], ['trx', 'tron'], ['avax', 'avalanche']];
  return groups.find((g) => g.includes(c)) ?? [c];
}

export const chainLabel = (chain: string): string => {
  const c = chain.toLowerCase();
  const names: Record<string, string> = { eth: 'Ethereum', ethereum: 'Ethereum', arb: 'Arbitrum', arbitrum: 'Arbitrum', op: 'Optimism', optimism: 'Optimism', pol: 'Polygon', polygon: 'Polygon', btc: 'Bitcoin', bitcoin: 'Bitcoin', trx: 'Tron', tron: 'Tron', base: 'Base', sol: 'Solana', solana: 'Solana', near: 'NEAR', bsc: 'BNB Chain', avax: 'Avalanche', ton: 'TON' };
  return names[c] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
};
