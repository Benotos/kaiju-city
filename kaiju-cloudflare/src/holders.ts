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
const MAX_PAGES = 20;
/** How many of the largest owners to check for program ownership. */
const PROGRAM_CHECK = 100; // getMultipleAccounts allows up to 100 per call

export type HolderSnapshot = {
  updatedAt: number;
  supply: number;
  total: number;
  holders: [string, number][];
  excluded: { owner: string; amount: number; reason: string }[];
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

  // The bonding curve / AMM pool are program-owned accounts, not people.
  // Check the largest owners plus anyone holding a meaningful share, whatever their rank.
  const ranked = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  const threshold = supply * 0.005;
  const candidates = ranked.filter(([, amount], i) => i < PROGRAM_CHECK || amount >= threshold).slice(0, 500).map(([owner]) => owner);
  for (let i = 0; i < candidates.length; i += 100) {
    const batch = candidates.slice(i, i + 100);
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
  return { updatedAt: Date.now(), supply, total: holders.length, holders: holders.slice(0, maxHolders), excluded };
}