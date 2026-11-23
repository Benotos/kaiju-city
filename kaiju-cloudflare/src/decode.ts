/**
 * Decoders that turn raw feed messages into Stomp City trades.
 *
 * On-chain layouts come from pump.fun's official IDLs
 * (@pump-fun/pump-sdk `pump.json`, @pump-fun/pump-swap-sdk `pump_amm.json`).
 * Only the stable leading fields of each event are read.
 */

export type Side = "buy" | "sell";

export type Trade = {
  /** Unique key used for de-duplication across providers. */
  key: string;
  signature?: string;
  txType: Side;
  traderPublicKey: string;
  solAmount: number;
  tokenAmount: number;
  marketCapSol: number;
  timestamp: number;
};

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS = 1e9;
const TOKEN_DECIMALS = 1e6; // pump.fun tokens use 6 decimals

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const bin = atob(value);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function startsWith(bytes: Uint8Array, disc: readonly number[]) {
  if (bytes.length < disc.length) return false;
  for (let i = 0; i < disc.length; i++) if (bytes[i] !== disc[i]) return false;
  return true;
}

function u64(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true));
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeTimestamp(value: unknown): number {
  const n = finite(value);
  if (n !== null && n > 0) return Math.round(n < 1_000_000_000_000 ? n * 1000 : n);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/* ------------------------------------------------------------------ */
/* On-chain events (Solana logsSubscribe)                              */
/* ------------------------------------------------------------------ */

/** pump.fun bonding curve: TradeEvent */
const PUMP_TRADE_EVENT = [189, 219, 127, 211, 78, 230, 97, 238] as const;
/** PumpSwap AMM: BuyEvent / SellEvent */
const AMM_BUY_EVENT = [103, 244, 82, 31, 44, 245, 119, 119] as const;
const AMM_SELL_EVENT = [62, 47, 55, 10, 165, 3, 220, 42] as const;

type ChainEvent = Omit<Trade, "key" | "signature" | "marketCapSol">;

/**
 * pump.fun TradeEvent:
 * disc[8] mint[32] sol_amount u64 token_amount u64 is_buy bool user[32] timestamp i64
 * virtual_sol_reserves u64 virtual_token_reserves u64 ...
 */
export function decodePumpTrade(bytes: Uint8Array, mint: string): (ChainEvent & { marketCapSol: number }) | null {
  if (!startsWith(bytes, PUMP_TRADE_EVENT) || bytes.length < 113) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eventMint = base58(bytes.subarray(8, 40));
  if (eventMint !== mint) return null;
  const solAmount = u64(view, 40) / LAMPORTS;
  const tokenAmount = u64(view, 48) / TOKEN_DECIMALS;
  const isBuy = bytes[56] === 1;
  const user = base58(bytes.subarray(57, 89));
  const timestamp = Number(view.getBigInt64(89, true));
  const vSol = u64(view, 97) / LAMPORTS;
  const vTokens = u64(view, 105) / TOKEN_DECIMALS;
  // Market cap in SOL = price * 1B total supply.
  const marketCapSol = vTokens > 0 ? (vSol / vTokens) * 1_000_000_000 : 0;
  return { txType: isBuy ? "buy" : "sell", traderPublicKey: user, solAmount, tokenAmount, timestamp: normalizeTimestamp(timestamp), marketCapSol };
}

/**
 * PumpSwap BuyEvent / SellEvent share a prefix:
 * disc[8] timestamp i64, base_amount u64, (max|min)_quote u64, 4x reserves u64,
 * quote_amount_(in|out) u64 @64, 6 more u64, pool[32] @120, user[32] @152
 * The event does not name the mint, so callers must only feed transactions
 * that mention the city's mint (logsSubscribe `mentions` does exactly that).
 */
export function decodeAmmTrade(bytes: Uint8Array): ChainEvent | null {
  const buy = startsWith(bytes, AMM_BUY_EVENT);
  const sell = !buy && startsWith(bytes, AMM_SELL_EVENT);
  if ((!buy && !sell) || bytes.length < 184) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const timestamp = Number(view.getBigInt64(8, true));
  const tokenAmount = u64(view, 16) / TOKEN_DECIMALS;
  const solAmount = u64(view, 64) / LAMPORTS;
  const user = base58(bytes.subarray(152, 184));
  return { txType: buy ? "buy" : "sell", traderPublicKey: user, solAmount, tokenAmount, timestamp: normalizeTimestamp(timestamp) };
}

/** Extracts every trade for `mint` from one transaction's program logs. */
export function tradesFromLogs(signature: string, logs: string[], mint: string): Trade[] {
  const trades: Trade[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const bytes = fromBase64(line.slice(14).trim());
    if (!bytes) continue;
    const pump = decodePumpTrade(bytes, mint);
    const event = pump ?? decodeAmmTrade(bytes);
    if (!event || event.solAmount <= 0) continue;
    trades.push({
      key: trades.length === 0 ? signature : `${signature}#${trades.length}`,
      signature,
      marketCapSol: pump?.marketCapSol ?? 0,
      ...event,
    });
  }
  return trades;
}

/* ------------------------------------------------------------------ */
/* PumpPortal-style JSON feeds (PumpPortal, PumpDev)                   */
/* ------------------------------------------------------------------ */

export function tradeFromFeedEvent(event: Record<string, unknown>, mint: string): Trade | null {
  if (String(event.mint ?? "").trim() !== mint) return null;
  const side = String(event.txType ?? event.side ?? "").toLowerCase();
  if (side !== "buy" && side !== "sell") return null;
  const trader = String(event.traderPublicKey ?? event.wallet ?? event.user ?? "").trim();
  if (!trader) return null;

  let solAmount = finite(event.solAmount);
  if (solAmount === null) {
    const quote = finite(event.quoteAmount);
    if (quote !== null && String(event.quoteMint ?? "") === WRAPPED_SOL_MINT) solAmount = quote;
  }
  if (solAmount === null || solAmount <= 0) return null;

  const signature = typeof event.signature === "string" && event.signature.trim() ? event.signature.trim() : undefined;
  return {
    key: signature ?? `${trader}-${solAmount}-${event.timestamp ?? Date.now()}`,
    signature,
    txType: side,
    traderPublicKey: trader,
    solAmount,
    tokenAmount: finite(event.tokenAmount ?? event.baseAmount) ?? 0,
    marketCapSol: finite(event.marketCapSol ?? event.marketCapQuote) ?? 0,
    timestamp: normalizeTimestamp(event.timestamp),
  };
}