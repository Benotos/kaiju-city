/**
 * Builds the token's holder list from Helius (DAS `getTokenAccounts`).
 *
 * Every token account for the mint is fetched (paginated), balances are
 * summed per owner wallet, and accounts that are not people are excluded:
 * burn addresses and wallets owned by a program (the pump.fun bonding
 * curve, the PumpSwap pool, lockers), detected with getMultipleAccounts.
 */

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const BURN_ADDRESSES = new Set(["1nc1nerator11111111111111111111111111111111", SYSTEM_PROGRAM]);
const PAGE_LIMIT = 1000;
const MAX_PAGES = 60;
/** How many of the largest owners to check for program ownership. */
const PROGRAM_CHECK = 100; // getMultipleAccounts allows up to 100 per call

/* ------------------------------------------------------------------ */
/* Wallet vs. program address                                          */
/* Real wallets are ed25519 public keys (points on the curve). Program */
/* derived addresses (pool vaults, curve PDAs, lockers) are not.       */
/* ------------------------------------------------------------------ */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return n === 0n ? out : null;
}

const P = 2n ** 255n - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(b: bigint, e: bigint) {
  let r = 1n;
  b = mod(b);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}
const D = mod(-121665n * pow(121666n, P - 2n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

/** True when the address is a valid ed25519 public key (a wallet someone can sign for). */
export function isOnCurve(address: string): boolean {
  const bytes = base58Decode(address);
  if (!bytes) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = (v * v % P) * v % P;
  const v7 = (v3 * v3 % P) * v % P;
  let x = (u * v3 % P) * pow(u * v7, (P - 5n) / 8n) % P;
  const vx2 = v * x % P * x % P;
  if (vx2 !== u) {
    if (vx2 === mod(-u)) x = x * SQRT_M1 % P;
    else return false;
  }
  if (x === 0n && sign === 1n) return false;
  return true;
}

export type HolderSnapshot = {
  updatedAt: number;
  mint: string;
  supply: number;
  decimals: number;
  total: number;
  holders: [string, number][];
  excluded: { owner: string; amount: number; reason: string }[];
  /** Every holder (not sent to browsers; used for lookups). */
  all?: [string, number][];
};

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } };

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "stomp-city", method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const data = (await response.json()) as RpcResponse<T>;
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  if (data.result === undefined) throw new Error(`${method}: empty result`);
  return data.result;
}

/** wss://host/?api-key=… → https://host/?api-key=… */
export function httpRpcUrl(wsUrl: string): string {
  return wsUrl.trim().replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

export async function fetchHolders(rpcUrl: string, mint: string, maxHolders: number): Promise<HolderSnapshot> {
  // Decimals and supply.
  const supplyInfo = await rpc<{ value: { amount: string; decimals: number; uiAmount: number | null } }>(rpcUrl, "getTokenSupply", [mint]);
  const decimals = supplyInfo.value.decimals;
  const divisor = 10 ** decimals;
  const supply = Number(supplyInfo.value.amount) / divisor;

  // All token accounts for the mint, summed per owner.
  const byOwner = new Map<string, number>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await rpc<{ token_accounts?: { owner: string; amount: number | string }[] }>(rpcUrl, "getTokenAccounts", {
      mint,
      page,
      limit: PAGE_LIMIT,
    });
    const accounts = result.token_accounts ?? [];
    for (const account of accounts) {
      const amount = Number(account.amount) / divisor;
      if (!account.owner || !(amount > 0)) continue;
      byOwner.set(account.owner, (byOwner.get(account.owner) ?? 0) + amount);
    }
    if (accounts.length < PAGE_LIMIT) break;
  }

  const excluded: HolderSnapshot["excluded"] = [];
  for (const owner of BURN_ADDRESSES) {
    const amount = byOwner.get(owner);
    if (amount !== undefined) {
      excluded.push({ owner, amount, reason: "burn" });
      byOwner.delete(owner);
    }
  }

  // Pools, bonding curves and lockers are not people:
  //  1. owners that are program-derived addresses (off the ed25519 curve), e.g. LP vault authorities;
  //  2. owners whose account is held by a program (pump.fun curve, PumpSwap pool, multisig programs).
  const ranked = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  const threshold = supply * 0.001;
  const candidates = ranked.filter(([, amount], i) => i < 400 || amount >= threshold).map(([owner]) => owner);
  for (const owner of candidates) {
    if (!isOnCurve(owner)) {
      excluded.push({ owner, amount: byOwner.get(owner) ?? 0, reason: "program address (pool / vault / curve)" });
      byOwner.delete(owner);
    }
  }
  const remaining = candidates.filter((o) => byOwner.has(o)).slice(0, 500);
  for (let i = 0; i < remaining.length; i += 100) {
    const batch = remaining.slice(i, i + 100);
    const info = await rpc<{ value: ({ owner: string } | null)[] }>(rpcUrl, "getMultipleAccounts", [batch, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
    info.value.forEach((account, j) => {
      if (!account || account.owner === SYSTEM_PROGRAM) return;
      const owner = batch[j];
      const reason = account.owner === PUMP_PROGRAM ? "pump.fun bonding curve" : account.owner === PUMP_AMM_PROGRAM ? "PumpSwap pool" : `program-owned (${account.owner.slice(0, 6)}…)`;
      excluded.push({ owner, amount: byOwner.get(owner) ?? 0, reason });
      byOwner.delete(owner);
    });
  }

  const holders = [...byOwner.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([owner, amount]) => [owner, Math.round(amount * 1e6) / 1e6] as [string, number]);
  return { updatedAt: Date.now(), mint, supply, decimals, total: holders.length, holders: holders.slice(0, maxHolders), excluded, all: holders };
}