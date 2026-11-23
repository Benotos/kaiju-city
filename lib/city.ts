import type { CityBuilding, HolderScale, HolderSnapshot, KaijuAttack, TradeEvent, TradeImpact } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Spacing between the two lots inside a block. */
export const LOT = 2.7;
/** Street width between blocks. */
export const STREET = 1.9;
/** Distance between block centres. */
export const BLOCK_PITCH = LOT * 2 + STREET;
/** Blocks per side of the grid. */
export const GRID_BLOCKS = 22;
/** Number of lots the market can build on (one per holder). */
export const MAX_TOWERS = 1600;
/** How long the kaiju takes to reach a target, in ms. */
export const KAIJU_LEAD_MS = 1150;
export const TOWER_STYLES = 7;

/** Simulator palette: ice and electric blues with amber accents. */
export const NEON = ["#5fd4ff", "#7ea6ff", "#d8ecff", "#3f7bff", "#ffb547", "#43e3d0", "#9d93ff", "#ffd28a"];

export type Slot = { index: number; x: number; z: number; ring: number };

function buildSlots(): Slot[] {
  const slots: Omit<Slot, "index">[] = [];
  const half = (GRID_BLOCKS - 1) / 2;
  for (let bx = 0; bx < GRID_BLOCKS; bx++) {
    for (let bz = 0; bz < GRID_BLOCKS; bz++) {
      for (let lx = 0; lx < 2; lx++) {
        for (let lz = 0; lz < 2; lz++) {
          const x = (bx - half) * BLOCK_PITCH + (lx - 0.5) * LOT;
          const z = (bz - half) * BLOCK_PITCH + (lz - 0.5) * LOT;
          slots.push({ x, z, ring: Math.hypot(x, z) });
        }
      }
    }
  }
  // Grow outward from the centre so the city stays compact and in frame.
  slots.sort((a, b) => a.ring - b.ring || Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  return slots.slice(0, MAX_TOWERS).map((slot, index) => ({ ...slot, index }));
}

export const CITY_SLOTS: Slot[] = buildSlots();
export const CITY_RADIUS = CITY_SLOTS[CITY_SLOTS.length - 1].ring + LOT;
/** Radius of the first n lots, used to frame the camera and size the ground. */
export function radiusForCount(n: number) {
  const i = Math.max(0, Math.min(CITY_SLOTS.length - 1, n - 1));
  return CITY_SLOTS[i].ring + LOT;
}
/** Street centre lines (x and z share them). */
export const STREET_LINES: number[] = Array.from({ length: GRID_BLOCKS + 1 }, (_, i) => (i - GRID_BLOCKS / 2) * BLOCK_PITCH);

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

export function hashString(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function fakeWallet(rand: () => number) {
  let out = "";
  for (let i = 0; i < 44; i++) out += BASE58[Math.floor(rand() * BASE58.length)];
  return out;
}

/* ------------------------------------------------------------------ */
/* Tower sizing                                                        */
/* ------------------------------------------------------------------ */

const MIN_HEIGHT = 3;
const MAX_HEIGHT = 26;

export function heightForBuy(sol: number) {
  return Math.min(MAX_HEIGHT - 4, MIN_HEIGHT + 2.7 * Math.log2(1 + Math.max(0, sol) * 1.4));
}
export function growthForBuy(sol: number) {
  return 1.1 + 1.6 * Math.log2(1 + Math.max(0, sol));
}
export function floors(height: number) {
  return Math.max(1, Math.round(height * 2));
}

function makeTower(partial: Pick<CityBuilding, "id" | "wallet" | "claimed" | "slot" | "height"> & Partial<CityBuilding>, now: number): CityBuilding {
  const slot = CITY_SLOTS[partial.slot];
  const seed = partial.seed ?? hashString(partial.id + partial.wallet);
  const rand = rng(seed);
  return {
    x: slot.x,
    z: slot.z,
    width: 1.5 + rand() * 0.7,
    style: Math.floor(rand() * TOWER_STYLES),
    color: NEON[Math.floor(rand() * NEON.length)],
    seed,
    tradeCount: 1,
    solIn: 0,
    lastSide: "buy",
    status: "standing",
    bornAt: now,
    grewAt: 0,
    hitAt: 0,
    lastActive: now,
    ...partial,
  };
}

/** The skyline the page opens with, so the city is never empty. */
export function makeGenesisCity(claimed: boolean, now = Date.now()): CityBuilding[] {
  const rand = rng(7331);
  const count = 40;
  const towers: CityBuilding[] = [];
  for (let i = 0; i < count; i++) {
    const slot = CITY_SLOTS[i];
    const centreBias = 1 - slot.ring / (CITY_SLOTS[count - 1].ring + 1);
    let height = MIN_HEIGHT + 2 + centreBias * 13 * (0.55 + rand() * 0.7);
    if (i === 0) height = 23; // landmark
    if (i === 3 || i === 9) height = Math.max(height, 18);
    const wallet = claimed ? fakeWallet(rand) : `genesis-${String(i + 1).padStart(2, "0")}`;
    towers.push(
      makeTower(
        {
          id: `genesis-${i}`,
          wallet,
          claimed,
          slot: i,
          height: Math.min(MAX_HEIGHT, height),
          // Staggered rise: the skyline assembles in about a second.
          bornAt: now + i * 22,
          lastActive: now - 60_000,
          tradeCount: claimed ? 1 + Math.floor(rand() * 6) : 0,
          solIn: claimed ? Number((0.4 + rand() * 6).toFixed(2)) : 0,
          seed: Math.floor(rand() * 2 ** 31),
        },
        now,
      ),
    );
  }
  return towers;
}

/* ------------------------------------------------------------------ */
/* Trade → city                                                        */
/* ------------------------------------------------------------------ */

export type TradeOutcome = {
  buildings: CityBuilding[];
  impact: TradeImpact;
  attack: KaijuAttack | null;
  focusId: string | null;
};

function freeSlot(buildings: CityBuilding[], now: number): { slot: number; evict: string | null } {
  const used = new Set(buildings.map((b) => b.slot));
  // Rebuild on old ruins near the centre first, after the wreck has been visible a while.
  const oldRuins = buildings
    .filter((b) => b.status === "rubble" && now - b.hitAt > 7000)
    .sort((a, b) => a.slot - b.slot);
  const empty = CITY_SLOTS.find((s) => !used.has(s.index));
  if (oldRuins[0] && (!empty || oldRuins[0].slot < empty.index)) return { slot: oldRuins[0].slot, evict: oldRuins[0].id };
  if (empty) return { slot: empty.index, evict: null };
  const anyRuin = buildings.filter((b) => b.status === "rubble").sort((a, b) => a.hitAt - b.hitAt)[0];
  if (anyRuin) return { slot: anyRuin.slot, evict: anyRuin.id };
  const oldest = [...buildings].sort((a, b) => Number(a.claimed) - Number(b.claimed) || a.lastActive - b.lastActive)[0];
  return { slot: oldest.slot, evict: oldest.id };
}

export function towerTop(b: CityBuilding) {
  return b.height + 1.2;
}

export function applyTradeToCity(current: CityBuilding[], trade: TradeEvent, now = Date.now()): TradeOutcome {
  const wallet = trade.traderPublicKey;
  const sol = Math.max(0, trade.solAmount);

  if (trade.txType === "buy") {
    const own = current.find((b) => b.claimed && b.wallet === wallet && b.status === "standing");
    if (own) {
      const grown: CityBuilding = {
        ...own,
        height: Math.min(MAX_HEIGHT, own.height + growthForBuy(sol)),
        tradeCount: own.tradeCount + 1,
        solIn: own.solIn + sol,
        lastSide: "buy",
        grewAt: now,
        lastActive: now,
      };
      const added = floors(grown.height) - floors(own.height);
      return {
        buildings: current.map((b) => (b.id === own.id ? grown : b)),
        impact: { kind: "grow", label: `Tower grew +${added} floors`, lot: own.slot + 1 },
        attack: null,
        focusId: own.id,
      };
    }
    const hadRuin = current.some((b) => b.claimed && b.wallet === wallet && b.status === "rubble");
    const { slot, evict } = freeSlot(current, now);
    const tower = makeTower(
      { id: `${trade.id}-${slot}`, wallet, claimed: true, slot, height: heightForBuy(sol), solIn: sol, bornAt: now },
      now,
    );
    const next = current.filter((b) => b.id !== evict);
    next.push(tower);
    return {
      buildings: next,
      impact: { kind: hadRuin ? "rebuild" : "rise", label: `${hadRuin ? "Rebuilt" : "New tower"} · ${floors(tower.height)} floors`, lot: slot + 1 },
      attack: null,
      focusId: tower.id,
    };
  }

  // SELL → the kaiju attacks.
  const standing = current.filter((b) => b.status === "standing");
  let target = standing.find((b) => b.claimed && b.wallet === wallet) ?? null;
  if (!target && standing.length) {
    const tallest = [...standing].sort((a, b) => b.height - a.height).slice(0, 6);
    target = tallest[Math.floor(Math.random() * tallest.length)];
  }
  const strength = Math.min(2.4, Math.max(0.7, 0.7 + Math.log2(1 + sol) / 2));
  const at = now + KAIJU_LEAD_MS;

  if (!target) {
    return {
      buildings: current,
      impact: { kind: "miss", label: "Kaiju roars · nothing left to stomp" },
      attack: { id: trade.id, buildingId: null, x: 0, z: 0, top: 1, strength, destroy: false, at },
      focusId: null,
    };
  }

  const damage = 1.3 + 2.4 * Math.log2(1 + sol * 1.5);
  const destroy = sol >= 2.5 || target.height - damage < MIN_HEIGHT + 0.5;
  const hit: CityBuilding = destroy
    ? { ...target, status: "rubble", hitAt: at, lastSide: "sell", tradeCount: target.tradeCount + 1, lastActive: now }
    : { ...target, height: target.height - damage, hitAt: at, lastSide: "sell", tradeCount: target.tradeCount + 1, lastActive: now };
  const pct = Math.round((damage / target.height) * 100);
  return {
    buildings: current.map((b) => (b.id === target!.id ? hit : b)),
    impact: destroy
      ? { kind: "destroy", label: "Tower destroyed", lot: target.slot + 1 }
      : { kind: "damage", label: `Tower hit −${pct}%`, lot: target.slot + 1 },
    attack: { id: trade.id, buildingId: target.id, x: target.x, z: target.z, top: towerTop(target), strength, destroy, at },
    focusId: target.id,
  };
}
/* ------------------------------------------------------------------ */
/* Holder city: one tower per wallet, height by balance                */
/* ------------------------------------------------------------------ */

const HOLDER_MIN_H = 2.4;
const HOLDER_MAX_H = 30;

export function scaleFromSnapshot(snapshot: HolderSnapshot): HolderScale {
  const balances = snapshot.holders.map(([, b]) => b).filter((b) => b > 0);
  const max = balances.length ? Math.max(...balances) : 1;
  const min = balances.length ? Math.min(...balances) : 1;
  return { min: Math.max(min, 1e-6), max: Math.max(max, min * 1.0001, 1e-6), supply: snapshot.supply || 1_000_000_000 };
}

/** 0 = smallest holder, 1 = largest (can exceed 1 after big buys). */
function holderT(balance: number, scale: HolderScale) {
  if (balance <= 0) return 0;
  const lo = Math.log(scale.min);
  const hi = Math.log(scale.max);
  const t = hi - lo < 1e-9 ? 1 : (Math.log(balance) - lo) / (hi - lo);
  return Math.max(0, Math.min(1.12, t));
}

export function heightForBalance(balance: number, scale: HolderScale) {
  const t = holderT(balance, scale);
  return HOLDER_MIN_H + (HOLDER_MAX_H - HOLDER_MIN_H) * Math.pow(t, 1.15);
}

function widthForBalance(balance: number, scale: HolderScale) {
  return 1.1 + 1.1 * Math.min(1, holderT(balance, scale));
}

export function isHolderCity(buildings: CityBuilding[]) {
  return buildings.some((b) => b.balance !== undefined);
}

function holderTower(wallet: string, balance: number, slot: number, scale: HolderScale, bornAt: number, now: number): CityBuilding {
  return makeTower(
    {
      id: `h-${wallet}`,
      wallet,
      claimed: true,
      slot,
      balance,
      height: heightForBalance(balance, scale),
      width: widthForBalance(balance, scale),
      seed: hashString(wallet),
      bornAt,
      lastActive: now - 60_000,
      tradeCount: 0,
    },
    now,
  );
}

/**
 * Applies an on-chain holder list. The first snapshot lays the city out by
 * rank (largest holder in the centre). Later snapshots keep every tower on
 * its lot and only update heights, add new holders and remove sold-out ones,
 * so the skyline never jumps around while people are watching.
 */
export function applyHolderSnapshot(current: CityBuilding[], snapshot: HolderSnapshot, scale: HolderScale, now = Date.now()): CityBuilding[] {
  const holders = [...snapshot.holders].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_TOWERS);

  if (!isHolderCity(current)) {
    // Fresh layout. Stagger the rise so the skyline assembles in ~2s.
    const step = Math.min(4, 2000 / Math.max(1, holders.length));
    return holders.map(([wallet, balance], i) => holderTower(wallet, balance, i, scale, now + i * step, now));
  }

  const balances = new Map(holders);
  const next: CityBuilding[] = [];
  const used = new Set<number>();
  for (const b of current) {
    if (b.balance === undefined) continue;
    const balance = balances.get(b.wallet);
    if (balance === undefined) {
      // No longer a holder: keep fresh ruins on screen briefly, drop the rest.
      if (b.status === "rubble" && now - b.hitAt < 20_000) {
        next.push(b);
        used.add(b.slot);
      }
      continue;
    }
    balances.delete(b.wallet);
    used.add(b.slot);
    const height = heightForBalance(balance, scale);
    const width = widthForBalance(balance, scale);
    const rebuilt = b.status === "rubble" && now - b.hitAt > 6000;
    if (rebuilt) {
      next.push({ ...b, balance, height, width, status: "standing", bornAt: now, hitAt: 0 });
    } else if (Math.abs(b.height - height) > 0.05 || Math.abs(b.width - width) > 0.05 || b.balance !== balance) {
      next.push({ ...b, balance, height: b.status === "rubble" ? b.height : height, width: b.status === "rubble" ? b.width : width });
    } else {
      next.push(b);
    }
  }
  // New holders take the free lots closest to the centre.
  let cursor = 0;
  for (const [wallet, balance] of balances) {
    while (cursor < CITY_SLOTS.length && used.has(cursor)) cursor++;
    if (cursor >= CITY_SLOTS.length) break;
    used.add(cursor);
    next.push(holderTower(wallet, balance, cursor, scale, now, now));
  }
  return next;
}

/** Live trade in a holder city: buys grow the buyer's tower, sells send the kaiju after the seller's. */
export function applyTradeToHolders(current: CityBuilding[], trade: TradeEvent, scale: HolderScale, now = Date.now()): TradeOutcome {
  const wallet = trade.traderPublicKey;
  const tokens = Math.max(0, trade.tokenAmount ?? 0);
  const own = current.find((b) => b.wallet === wallet && b.balance !== undefined);

  if (trade.txType === "buy") {
    if (own) {
      const before = own.balance ?? 0;
      const balance = before + (tokens || before * 0.1);
      const height = heightForBalance(balance, scale);
      const updated: CityBuilding = {
        ...own,
        balance,
        height,
        width: widthForBalance(balance, scale),
        status: "standing",
        bornAt: own.status === "rubble" ? now : own.bornAt,
        hitAt: own.status === "rubble" ? 0 : own.hitAt,
        grewAt: now,
        tradeCount: own.tradeCount + 1,
        solIn: own.solIn + trade.solAmount,
        lastSide: "buy",
        lastActive: now,
      };
      const added = floors(height) - floors(own.height);
      return {
        buildings: current.map((b) => (b.id === own.id ? updated : b)),
        impact: { kind: own.status === "rubble" ? "rebuild" : "grow", label: own.status === "rubble" ? "Holder rebuilt" : added > 0 ? `Tower grew +${added} floors` : "Holder added to bag", lot: own.slot + 1 },
        attack: null,
        focusId: own.id,
      };
    }
    const used = new Set(current.map((b) => b.slot));
    const free = CITY_SLOTS.find((s) => !used.has(s.index));
    if (!free) return { buildings: current, impact: { kind: "grow", label: "New holder" }, attack: null, focusId: null };
    const tower = { ...holderTower(wallet, tokens || scale.min, free.index, scale, now, now), lastActive: now, tradeCount: 1, solIn: trade.solAmount };
    return {
      buildings: [...current, tower],
      impact: { kind: "rise", label: `New holder · ${floors(tower.height)} floors`, lot: free.index + 1 },
      attack: null,
      focusId: tower.id,
    };
  }

  // SELL
  const strength = Math.min(2.4, Math.max(0.7, 0.7 + Math.log2(1 + trade.solAmount) / 2));
  const at = now + KAIJU_LEAD_MS;
  if (!own || own.status === "rubble") {
    return {
      buildings: current,
      impact: { kind: "miss", label: "Seller had no tower" },
      attack: { id: trade.id, buildingId: null, x: 0, z: 0, top: 1, strength, destroy: false, at },
      focusId: null,
    };
  }
  const before = own.balance ?? 0;
  const sold = tokens || before * 0.25;
  const balance = Math.max(0, before - sold);
  const soldOut = balance <= Math.max(before * 0.02, 1);
  const pct = before > 0 ? Math.min(100, Math.round((sold / before) * 100)) : 100;
  const hit: CityBuilding = soldOut
    ? { ...own, balance: 0, status: "rubble", hitAt: at, lastSide: "sell", tradeCount: own.tradeCount + 1, lastActive: now }
    : { ...own, balance, height: heightForBalance(balance, scale), hitAt: at, lastSide: "sell", tradeCount: own.tradeCount + 1, lastActive: now };
  return {
    buildings: current.map((b) => (b.id === own.id ? hit : b)),
    impact: soldOut ? { kind: "destroy", label: "Sold out · tower destroyed", lot: own.slot + 1 } : { kind: "damage", label: `Sold ${pct}% · tower hit`, lot: own.slot + 1 },
    attack: { id: trade.id, buildingId: own.id, x: own.x, z: own.z, top: towerTop(own), strength, destroy: soldOut, at },
    focusId: own.id,
  };
}