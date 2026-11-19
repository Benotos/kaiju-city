export type TradeSide = "buy" | "sell";

export type TradeEvent = {
  id: string;
  txType: TradeSide;
  traderPublicKey: string;
  solAmount: number;
  tokenAmount?: number;
  marketCapSol?: number;
  signature?: string;
  timestamp: number;
  source: "demo" | "live";
};

export type CityBuilding = {
  id: string;
  wallet: string;
  x: number;
  z: number;
  height: number;
  targetHeight: number;
  color: string;
  tradeCount: number;
  lastSide: TradeSide;
  isFlattened: boolean;
};
