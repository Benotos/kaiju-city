import type { CityBuilding, KaijuAttack, TradeEvent, TradeImpact } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Spacing between the two lots inside a block. */
export const LOT = 3.3;
/** Street width between blocks. */
export const STREET = 2.6;
/** Distance between block centres. */
export const BLOCK_PITCH = LOT * 2 + STREET;
/** Blocks per side of the grid. */
export const GRID_BLOCKS = 6;
/** Number of lots the market can build on. */
export const MAX_TOWERS = 84;
/** How long the kaiju takes to reach a target, in ms. */
export const KAIJU_LEAD_MS = 1150;
export const TOWER_STYLES = 7;

export const NEON = ["#22e6ff", "#ff2bd6", "#b6ff3b", "#8b5cff", "#ffc94d", "#ff6a3d", "#3dffb4", "#5b8cff"];

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
    width: 1.75 + rand() * 0.85,
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
