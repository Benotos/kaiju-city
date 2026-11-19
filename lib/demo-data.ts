import type { CityBuilding, TradeEvent } from "@/lib/types";
import { fakeWallet } from "@/lib/city";

/** Random visual events for demo mode. These are not market data. */
export function makeDemoTrade(index: number, existing: CityBuilding[]): TradeEvent {
  const side = Math.random() > 0.4 ? "buy" : "sell";
  const owners = existing.filter((b) => b.claimed && b.status === "standing");
  const reuse = owners.length > 0 && Math.random() > (side === "buy" ? 0.55 : 0.35);
  const wallet = reuse ? owners[Math.floor(Math.random() * owners.length)].wallet : fakeWallet(Math.random);
  // Mostly small trades with the occasional whale.
  const whale = Math.random() > 0.88;
  const base = side === "buy" ? 0.12 + Math.random() * 3.2 : 0.1 + Math.random() * 2.6;
  return {
    id: `demo-${Date.now()}-${index}`,
    txType: side,
    traderPublicKey: wallet,
    solAmount: Number((whale ? base * 3.5 + 3 : base).toFixed(2)),
    tokenAmount: Math.floor(120000 + Math.random() * 1800000),
    marketCapSol: 180 + Math.random() * 90,
    timestamp: Date.now(),
    source: "demo",
  };
}

export function shortWallet(wallet: string) {
  if (wallet.startsWith("genesis-")) return "UNCLAIMED";
  return wallet.length > 12 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}
