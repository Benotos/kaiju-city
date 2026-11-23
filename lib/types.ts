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

/** What a trade did to the city, shown in the feed. */
export type TradeImpact = {
  kind: "rise" | "grow" | "rebuild" | "damage" | "destroy" | "miss";
  label: string;
  lot?: number;
};

export type FeedItem = TradeEvent & { impact: TradeImpact };

export type BuildingStatus = "standing" | "rubble";

export type CityBuilding = {
  id: string;
  /** Owner wallet. Unclaimed genesis towers use a synthetic id. */
  wallet: string;
  claimed: boolean;
  /** Index into CITY_SLOTS. */
  slot: number;
  x: number;
  z: number;
  /** Target height in world units. The scene animates towards it. */
  height: number;
  width: number;
  /** Architecture archetype, 0..TOWER_STYLES-1. */
  style: number;
  color: string;
  seed: number;
  tradeCount: number;
  solIn: number;
  lastSide: TradeSide;
  status: BuildingStatus;
  /** ms timestamp: when the tower started rising. */
  bornAt: number;
  /** ms timestamp of the last growth pulse. */
  grewAt: number;
  /** ms timestamp when the kaiju's hit lands (0 = never hit). */
  hitAt: number;
  lastActive: number;
  /** Token balance (holder cities only). */
  balance?: number;
};

/** On-chain holder list sent by the relay. Balances are in whole tokens. */
export type HolderSnapshot = {
  updatedAt: number;
  supply: number;
  total: number;
  holders: [string, number][];
  excluded?: { owner: string; amount: number; reason: string }[];
};

/** Balance range used to turn balances into heights (log scale). */
export type HolderScale = { min: number; max: number; supply: number };

export type KaijuAttack = {
  id: string;
  buildingId: string | null;
  x: number;
  z: number;
  /** Top of the target tower, for the breath beam. */
  top: number;
  strength: number;
  destroy: boolean;
  /** ms timestamp when the stomp lands. */
  at: number;
};