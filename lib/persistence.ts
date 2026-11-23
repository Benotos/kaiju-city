import type { CityBuilding, FeedItem, HolderScale } from "@/lib/types";
import { CITY_SLOTS } from "@/lib/city";

/**
 * Saves the live city in the visitor's browser so a reload paints the
 * same skyline, feed and stats instantly, before the relay reconnects.
 * Everything here is best-effort: storage can be full, blocked (private
 * mode) or cleared, and the page must work the same without it.
 */

const VERSION = 2;
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // older snapshots are stale; start fresh
const MAX_SEEN = 600;

export type CityStats = {
  buyVolume: number;
  sellVolume: number;
  totalTrades: number;
  stomps: { destroyed: number; damaged: number };
};

export type HolderInfo = { total: number; supply: number; updatedAt: number; scale: HolderScale; mint?: string };

export type CitySnapshot = {
  holders?: HolderInfo;
  buildings: CityBuilding[];
  feed: FeedItem[];
  stats: CityStats;
  /** Trade ids already applied, so replayed history is never double-counted. */
  seen: string[];
  savedAt: number;
};

export function cacheKey(scope: string) {
  return `stomp-city:v${VERSION}:${scope}`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validBuilding(b: unknown): b is CityBuilding {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.wallet === "string" &&
    isNum(x.slot) && x.slot >= 0 && x.slot < CITY_SLOTS.length &&
    isNum(x.x) && isNum(x.z) && isNum(x.height) && isNum(x.width) && isNum(x.style) && isNum(x.seed) &&
    typeof x.color === "string" &&
    (x.status === "standing" || x.status === "rubble")
  );
}

function validFeedItem(f: unknown): f is FeedItem {
  if (!f || typeof f !== "object") return false;
  const x = f as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    (x.txType === "buy" || x.txType === "sell") &&
    typeof x.traderPublicKey === "string" &&
    isNum(x.solAmount) && isNum(x.timestamp) &&
    !!x.impact && typeof (x.impact as Record<string, unknown>).label === "string"
  );
}

export function loadSnapshot(key: string): CitySnapshot | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CitySnapshot>;
    if (!data || !isNum(data.savedAt) || Date.now() - data.savedAt > MAX_AGE_MS) return null;
    if (!Array.isArray(data.buildings) || !data.buildings.every(validBuilding)) return null;
    // One tower per lot; drop anything inconsistent rather than render overlaps.
    const slots = new Set<number>();
    const buildings = data.buildings.filter((b) => (slots.has(b.slot) ? false : (slots.add(b.slot), true)));
    const feed = Array.isArray(data.feed) ? data.feed.filter(validFeedItem) : [];
    const s = data.stats;
    const stats: CityStats = {
      buyVolume: isNum(s?.buyVolume) ? s.buyVolume : 0,
      sellVolume: isNum(s?.sellVolume) ? s.sellVolume : 0,
      totalTrades: isNum(s?.totalTrades) ? s.totalTrades : feed.length,
      stomps: {
        destroyed: isNum(s?.stomps?.destroyed) ? s.stomps.destroyed : 0,
        damaged: isNum(s?.stomps?.damaged) ? s.stomps.damaged : 0,
      },
    };
    const seen = Array.isArray(data.seen) ? data.seen.filter((id): id is string => typeof id === "string") : [];
    const h = data.holders;
    const holders =
      h && isNum(h.total) && isNum(h.supply) && isNum(h.updatedAt) && h.scale && isNum(h.scale.min) && isNum(h.scale.max) && isNum(h.scale.supply)
        ? h
        : undefined;
    return { buildings, feed, stats, seen, holders, savedAt: data.savedAt };
  } catch {
    return null;
  }
}

export function saveSnapshot(key: string, snapshot: Omit<CitySnapshot, "savedAt">) {
  try {
    const payload: CitySnapshot = { ...snapshot, seen: snapshot.seen.slice(-MAX_SEEN), savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage full or blocked: the live feed still works */
  }
}