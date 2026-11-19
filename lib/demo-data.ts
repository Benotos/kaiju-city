import type { CityBuilding, TradeEvent } from "@/lib/types";

const palette = ["#78c9c1", "#a5c3ad", "#d5b47b", "#7f9da9", "#b39bb2", "#d18c76"];
const wallets = [
  "8xQmKp4rT9vL", "4nJzW2aP6sYh", "D7fKq9mR3xUa", "2bVnH8cL5pQe",
  "F6tYw3kM9aRs", "9pLdC4vX7nBg", "3rHaJ6uN2mTf", "G5wZq8eK4yPc",
  "7cMbR2xT9vLd", "A4nFp6qS8hYe", "5yQkD3mV7jWa", "H8sLz2bN6pXc",
];

export function makeInitialBuildings(): CityBuilding[] {
  return wallets.map((wallet, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const height = 2.2 + ((i * 7) % 8) * 0.58;
    return {
      id: `tower-${i}`,
      wallet,
      x: (col - 1.5) * 4.5,
      z: (row - 1) * 4.4,
      height,
      targetHeight: height,
      color: palette[i % palette.length],
      tradeCount: 2 + (i % 7),
      lastSide: "buy",
      isFlattened: false,
    };
  });
}

export function makeDemoTrade(index: number, existing: CityBuilding[]): TradeEvent {
  const side = Math.random() > 0.36 ? "buy" : "sell";
  const knownWallet = existing.length > 0 && Math.random() > 0.42
    ? existing[Math.floor(Math.random() * existing.length)].wallet
    : `${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 12);
  return {
    id: `demo-${Date.now()}-${index}`,
    txType: side,
    traderPublicKey: knownWallet,
    solAmount: Number((0.15 + Math.random() * (side === "buy" ? 8.7 : 5.5)).toFixed(2)),
    tokenAmount: Math.floor(120000 + Math.random() * 1800000),
    marketCapSol: 180 + Math.random() * 90,
    timestamp: Date.now(),
    source: "demo",
  };
}

export function shortWallet(wallet: string) {
  return wallet.length > 12 ? `${wallet.slice(0, 5)}…${wallet.slice(-4)}` : wallet;
}
