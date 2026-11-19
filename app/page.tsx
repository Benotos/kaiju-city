"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Building2, Camera, Check, Copy, Crosshair,
  ExternalLink, Flame, Layers, LocateFixed, Radio, Search, Send, Skull, Volume2, VolumeX, X, Zap,
} from "lucide-react";
import type { CityBuilding, FeedItem, KaijuAttack, TradeEvent } from "@/lib/types";
import { applyTradeToCity, floors, KAIJU_LEAD_MS, makeGenesisCity } from "@/lib/city";
import { makeDemoTrade, shortWallet } from "@/lib/demo-data";
import { formatSol, shortSignature, timeAgo } from "@/lib/format";
import { playTradeSound, setTradeSoundEnabled } from "@/lib/audio";

const CityScene = dynamic(() => import("@/components/CityScene"), {
  ssr: false,
  loading: () => <div className="scene-message"><div className="loading-orb" /><b>BUILDING THE CITY…</b></div>,
});

const START_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
const RELAY_URL = process.env.NEXT_PUBLIC_TRADE_RELAY_URL || "";
const X_URL = process.env.NEXT_PUBLIC_X_URL || "";
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "";
const FEED_LIMIT = 24;

type FeedStatus = "demo" | "connecting" | "live" | "offline";
type Banner = { key: number; tone: "attack" | "build"; title: string; sub: string };

function randomId() {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg viewBox="0 0 40 40">
        <rect x="4" y="16" width="7" height="20" rx="1" />
        <rect x="13" y="6" width="8" height="30" rx="1" />
        <rect x="23" y="12" width="6" height="24" rx="1" />
        <rect x="31" y="20" width="5" height="16" rx="1" />
      </svg>
    </div>
  );
}

function StatusChip({ status }: { status: FeedStatus }) {
  const label = status === "live" ? "LIVE ON-CHAIN" : status === "connecting" ? "CONNECTING RELAY" : status === "offline" ? "RELAY OFFLINE" : "DEMO STREAM";
  return <span className={`status-chip status-${status}`}><span className="pulse" />{label}</span>;
}

function Stat({ label, value, unit, detail, icon, tone, children }: { label: string; value: string; unit?: string; detail: ReactNode; icon: ReactNode; tone: string; children?: ReactNode }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-label"><span className="stat-icon">{icon}</span>{label}</div>
      <div className="stat-value">{value}{unit && <small>{unit}</small>}</div>
      {children}
      <div className="stat-detail">{detail}</div>
    </div>
  );
}

function FeedRow({ item, onFocus }: { item: FeedItem; onFocus: (wallet: string) => void }) {
  const buy = item.txType === "buy";
  const big = item.solAmount >= 2.5;
  return (
    <li className={`feed-row ${buy ? "is-buy" : "is-sell"} ${big ? "is-big" : ""}`}>
      <div className="feed-side">{buy ? <ArrowDownRight size={18} strokeWidth={3} /> : <ArrowUpRight size={18} strokeWidth={3} />}<b>{buy ? "BUY" : "SELL"}</b></div>
      <div className="feed-body">
        <div className="feed-top">
          <strong>{formatSol(item.solAmount)}</strong>
          <button className="feed-wallet" onClick={() => onFocus(item.traderPublicKey)} title="Fly to this wallet's tower">{shortWallet(item.traderPublicKey)}</button>
        </div>
        <div className={`feed-impact impact-${item.impact.kind}`}>
          {item.impact.kind === "destroy" ? <Skull size={13} /> : item.impact.kind === "damage" ? <Flame size={13} /> : <Building2 size={13} />}
          {item.impact.label}{item.impact.lot ? <em> · LOT {String(item.impact.lot).padStart(2, "0")}</em> : null}
        </div>
        <div className="feed-meta">{shortSignature(item.signature)} · {timeAgo(item.timestamp)} <span className={`feed-src src-${item.source}`}>{item.source === "live" ? "LIVE" : "DEMO"}</span></div>
      </div>
    </li>
  );
}

function KaijuArt() {
  return (
    <svg className="kaiju-art-svg" viewBox="0 0 220 150" role="img" aria-label="The kaiju">
      <defs>
        <linearGradient id="kj-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b5560" /><stop offset="1" stopColor="#141f28" /></linearGradient>
        <radialGradient id="kj-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ff5a2a" stopOpacity=".35" /><stop offset="1" stopColor="#ff5a2a" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="110" cy="80" rx="100" ry="70" fill="url(#kj-glow)" />
      <path d="M50 140 C46 112 58 88 80 74 C76 58 82 40 98 32 C112 25 132 30 140 44 C150 46 160 54 160 66 C160 76 152 82 144 82 C150 98 152 118 146 140 Z" fill="url(#kj-skin)" />
      <path d="M146 140 C168 136 190 128 210 112 C196 132 176 144 150 146 Z" fill="#1b2a33" />
      {[[92, 34, 14], [80, 52, 16], [72, 72, 15], [66, 94, 13], [62, 114, 10]].map(([x, y, s], i) => (
        <path key={i} d={`M${x} ${y} L${x - s} ${y - s * 0.6} L${x - s * 0.2} ${y + s * 0.5} Z`} fill="#ff5a2a" />
      ))}
      <circle cx="140" cy="54" r="4.5" fill="#ff2a2a" />
      <circle cx="140" cy="54" r="9" fill="#ff2a2a" opacity=".25" />
      <path d="M134 70 L158 68 L152 76 Z" fill="#ff8a2a" />
      <path d="M118 96 C126 100 132 108 132 118" stroke="#d9b26f" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

export default function Home() {
  const [buildings, setBuildings] = useState<CityBuilding[]>(() => makeGenesisCity(!RELAY_URL));
  const [attacks, setAttacks] = useState<KaijuAttack[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [focusedWallet, setFocusedWallet] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [walletQuery, setWalletQuery] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>(RELAY_URL ? "connecting" : "demo");
  const [toast, setToast] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [flash, setFlash] = useState(0);
  const [buyVolume, setBuyVolume] = useState(0);
  const [sellVolume, setSellVolume] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [stomps, setStomps] = useState({ destroyed: 0, damaged: 0 });
  const [, setTick] = useState(0);

  const buildingsRef = useRef(buildings);
  const soundOnRef = useRef(soundOn);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  // Keep "12s ago" labels fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const showBanner = useCallback((b: Omit<Banner, "key">) => {
    setBanner({ ...b, key: Date.now() });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 2300);
  }, []);

  const applyTrade = useCallback((trade: TradeEvent) => {
    const outcome = applyTradeToCity(buildingsRef.current, trade);
    buildingsRef.current = outcome.buildings;
    setBuildings(outcome.buildings);
    setFeed((current) => [{ ...trade, impact: outcome.impact }, ...current].slice(0, FEED_LIMIT));
    setTotalTrades((v) => v + 1);

    if (trade.txType === "buy") {
      setBuyVolume((v) => v + trade.solAmount);
      if (trade.solAmount >= 2) showBanner({ tone: "build", title: "WHALE BUY", sub: `${formatSol(trade.solAmount)} · ${outcome.impact.label}` });
      if (soundOnRef.current) playTradeSound("buy", trade.solAmount);
    } else {
      setSellVolume((v) => v + trade.solAmount);
      if (outcome.attack) {
        const attack = outcome.attack;
        setAttacks((current) => [...current.filter((a) => a.at > Date.now() - 4000), attack].slice(-8));
        if (trade.solAmount >= 0.8 || attack.destroy) {
          showBanner({ tone: "attack", title: attack.destroy ? "KAIJU ATTACK" : "KAIJU STRIKE", sub: `${formatSol(trade.solAmount)} sell · ${outcome.impact.label}` });
        }
        // Flash, count and sound land with the stomp, not before it.
        setTimeout(() => {
          setFlash((v) => v + 1);
          if (outcome.impact.kind === "destroy") setStomps((s) => ({ ...s, destroyed: s.destroyed + 1 }));
          else if (outcome.impact.kind === "damage") setStomps((s) => ({ ...s, damaged: s.damaged + 1 }));
          if (soundOnRef.current) playTradeSound("sell", trade.solAmount);
        }, KAIJU_LEAD_MS);
      }
    }
  }, [showBanner]);

  // Demo mode keeps the city moving until a relay URL is configured.
  useEffect(() => {
    if (RELAY_URL) return;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      count += 1;
      applyTrade(makeDemoTrade(count, buildingsRef.current));
      timer = setTimeout(loop, 2300 + Math.random() * 1700);
    };
    timer = setTimeout(loop, 1600);
    return () => clearTimeout(timer);
  }, [applyTrade]);

  // One browser connection to the relay; API credentials never reach this client.
  useEffect(() => {
    if (!RELAY_URL) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      setFeedStatus("connecting");
      try {
        socket = new WebSocket(RELAY_URL);
        socket.onmessage = (message) => {
          try {
            const payload = JSON.parse(String(message.data));
            if (payload.type === "status") {
              setFeedStatus(payload.status === "live" ? "live" : payload.status === "connecting" ? "connecting" : "offline");
              return;
            }
            if (payload.type === "trade" && (payload.txType === "buy" || payload.txType === "sell")) {
              applyTrade({
                id: payload.id || randomId(),
                txType: payload.txType,
                traderPublicKey: payload.traderPublicKey || "unknown-wallet",
                solAmount: Number(payload.solAmount || 0),
                tokenAmount: Number(payload.tokenAmount || 0),
                marketCapSol: Number(payload.marketCapSol || 0),
                signature: payload.signature,
                timestamp: Number(payload.timestamp || Date.now()),
                source: "live",
              });
            }
          } catch { /* ignore malformed relay messages */ }
        };
        socket.onclose = () => {
          setFeedStatus("offline");
          if (!closed) retry = setTimeout(connect, 3000);
        };
      } catch {
        setFeedStatus("offline");
        retry = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [applyTrade]);

  /* ---------------------------- derived ---------------------------- */
  const standing = useMemo(() => buildings.filter((b) => b.status === "standing"), [buildings]);
  const ruins = buildings.length - standing.length;
  const tallest = useMemo(() => standing.reduce<CityBuilding | null>((best, b) => (!best || b.height > best.height ? b : best), null), [standing]);
  const claimedTowers = useMemo(() => buildings.filter((b) => b.claimed), [buildings]);
  const focusedTower = useMemo(() => buildings.find((b) => b.claimed && b.wallet === focusedWallet && b.status === "standing") ?? buildings.find((b) => b.claimed && b.wallet === focusedWallet), [buildings, focusedWallet]);
  const volume = buyVolume + sellVolume;
  const buyShare = volume > 0 ? Math.round((buyVolume / volume) * 100) : 50;
  const stompTotal = stomps.destroyed + stomps.damaged;
  const threat = Math.min(100, Math.round(20 + (sellVolume / Math.max(1, volume)) * 60 + Math.min(20, stompTotal * 2)));
  const lastAttack = feed.find((f) => f.txType === "sell");

  const suggestions = useMemo(() => {
    const q = walletQuery.trim().toLowerCase();
    if (q.length < 2 || q === focusedWallet?.toLowerCase()) return [];
    return claimedTowers.filter((b) => b.wallet.toLowerCase().startsWith(q) || b.wallet.toLowerCase().endsWith(q)).slice(0, 5);
  }, [walletQuery, claimedTowers, focusedWallet]);

  /* ---------------------------- actions ---------------------------- */
  const focusWallet = useCallback((query: string) => {
    const q = query.trim().toLowerCase().replace("…", "");
    if (!q) return;
    const candidates = buildingsRef.current.filter((b) => b.claimed);
    const match =
      candidates.find((b) => b.wallet.toLowerCase() === q && b.status === "standing") ??
      candidates.find((b) => b.wallet.toLowerCase() === q) ??
      candidates.find((b) => b.wallet.toLowerCase().startsWith(q) && b.status === "standing") ??
      candidates.find((b) => b.wallet.toLowerCase().startsWith(q));
    if (!match) {
      notify("No tower for that wallet yet. Buy to build one.");
      return;
    }
    setFocusedWallet(match.wallet);
    setWalletQuery(match.wallet);
    notify(match.status === "standing" ? `Flying to ${shortWallet(match.wallet)}` : `${shortWallet(match.wallet)}'s tower is in ruins`);
    document.getElementById("city")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [notify]);

  const submitWalletSearch = (event: FormEvent) => {
    event.preventDefault();
    focusWallet(walletQuery);
  };

  const simulateTrade = (side: "buy" | "sell") => {
    const owners = buildingsRef.current.filter((b) => b.claimed && b.status === "standing");
    const reuse = side === "sell" || Math.random() > 0.6;
    const wallet = reuse && owners.length ? owners[Math.floor(Math.random() * owners.length)].wallet : makeDemoTrade(0, []).traderPublicKey;
    applyTrade({
      id: randomId(),
      txType: side,
      traderPublicKey: wallet,
      solAmount: Number((side === "buy" ? 0.6 + Math.random() * 5 : 0.5 + Math.random() * 4.5).toFixed(2)),
      timestamp: Date.now(),
      source: "demo",
    });
  };

  const copyMint = async () => {
    if (!START_MINT) { notify("Contract address not set yet"); return; }
    try { await navigator.clipboard.writeText(START_MINT); notify("Contract address copied"); }
    catch { notify("Could not copy the contract address"); }
  };

  const resetCamera = () => { setFocusedWallet(null); setWalletQuery(""); setResetToken((v) => v + 1); };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setTradeSoundEnabled(next);
    if (next) notify("Sound on. Turn up your volume");
  };

  const sampleWallet = tallest?.claimed ? tallest.wallet : claimedTowers[0]?.wallet;

  return (
    <div className="site">
      <div className="backdrop-glow" aria-hidden />
      <header className="topbar">
        <div className="topbar-inner">
        <a className="brand" href="#city" aria-label="Kaiju City home">
          <BrandMark />
          <span className="brand-type"><strong>KAIJU<i>/</i>CITY</strong><small>THE MARKET IS ALIVE</small></span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a href="#city">CITY</a>
          <a href="#feed">LIVE FEED</a>
          <a href="#lore">THE KAIJU</a>
        </nav>
        <div className="top-actions">
          {X_URL && <a className="icon-pill" href={X_URL} target="_blank" rel="noreferrer" aria-label="X">𝕏</a>}
          {TELEGRAM_URL && <a className="icon-pill" href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="Telegram"><Send size={15} strokeWidth={2.6} /></a>}
          <button className="ca-pill" onClick={copyMint} title="Copy contract address">
            <span className="ca-tag">CA</span>
            <span className="ca-value">{START_MINT ? `${START_MINT.slice(0, 4)}…${START_MINT.slice(-4)}` : "SOON"}</span>
            <Copy size={13} strokeWidth={2.6} />
          </button>
          <a className="cta" href={START_MINT ? `https://pump.fun/coin/${START_MINT}` : "#city"} target={START_MINT ? "_blank" : undefined} rel="noreferrer">
            {START_MINT ? "BUY THE CITY" : "LAUNCHING SOON"}<ExternalLink size={14} strokeWidth={2.8} />
          </a>
        </div>
        </div>
      </header>

    <main className="app">


      <section className="hero">
        <div className="hero-copy">
          <div className="hero-chips"><StatusChip status={feedStatus} /><span className="chain-chip">◎ SOLANA</span></div>
          <h1>Every trade <em>leaves a mark.</em></h1>
        </div>
        <p className="hero-sub"><b className="buy-text">Buys build towers.</b> <b className="sell-text">Sells wake the kaiju.</b> Watch the market build and wreck the city in real time.</p>
      </section>

      <section className="console" id="city">
        <div className="stage">
          <CityScene buildings={buildings} attacks={attacks} focusedWallet={focusedWallet} resetToken={resetToken} />
          <div className="sim-frame" aria-hidden><i /><i /><i /><i /></div>

          <div className="hud hud-top">
            <div className="hud-title">
              <span className="live-dot" />
              <div><b><span className="sim-tag">SIM</span>NEO-TOKYO · SECTOR 07</b><small>{focusedTower ? `TRACKING ${shortWallet(focusedTower.wallet)}` : "DRAG TO ORBIT · PINCH OR SCROLL TO ZOOM"}</small></div>
            </div>
            <div className="hud-buttons">
              <button className="hud-btn" onClick={resetCamera} title="Show the whole city"><Camera size={16} strokeWidth={2.6} /><span>RESET VIEW</span></button>
              <button className={`hud-btn ${soundOn ? "on" : ""}`} onClick={toggleSound} aria-label={soundOn ? "Mute" : "Sound on"}>{soundOn ? <Volume2 size={16} strokeWidth={2.6} /> : <VolumeX size={16} strokeWidth={2.6} />}<span>{soundOn ? "SOUND ON" : "SOUND OFF"}</span></button>
            </div>
          </div>

          {banner && (
            <div key={banner.key} className={`event-banner banner-${banner.tone}`}>
              <span className="banner-icon">{banner.tone === "attack" ? <Skull size={22} strokeWidth={2.6} /> : <Zap size={22} strokeWidth={2.6} />}</span>
              <div><b>{banner.title}</b><small>{banner.sub}</small></div>
            </div>
          )}

          {focusedTower && (
            <div className="focus-card">
              <div className="focus-head"><Crosshair size={15} strokeWidth={2.8} /><b>{shortWallet(focusedTower.wallet)}</b><button onClick={resetCamera} aria-label="Stop tracking"><X size={14} strokeWidth={3} /></button></div>
              <dl>
                <div><dt>STATUS</dt><dd className={focusedTower.status === "standing" ? "buy-text" : "sell-text"}>{focusedTower.status === "standing" ? "STANDING" : "RUINS"}</dd></div>
                <div><dt>FLOORS</dt><dd>{floors(focusedTower.height)}</dd></div>
                <div><dt>LOT</dt><dd>{String(focusedTower.slot + 1).padStart(2, "0")}</dd></div>
                <div><dt>TRADES</dt><dd>{focusedTower.tradeCount}</dd></div>
              </dl>
            </div>
          )}

          <div className="hud hud-bottom">
            <div className="hud-readout">
              <div><small>STANDING</small><b>{standing.length}<span>/{buildings.length}</span></b></div>
              <div><small>RUINS</small><b className="sell-text">{ruins}</b></div>
              <div className="hide-sm"><small>LAST EVENT</small><b className={feed[0]?.txType === "sell" ? "sell-text" : "buy-text"}>{feed[0] ? feed[0].txType.toUpperCase() : "—"}</b></div>
            </div>
            <div className="sim-buttons">
              <span>TEST THE CITY</span>
              <button className="sim-buy" onClick={() => simulateTrade("buy")}><ArrowDownRight size={16} strokeWidth={3} />SIM BUY</button>
              <button className="sim-sell" onClick={() => simulateTrade("sell")}><ArrowUpRight size={16} strokeWidth={3} />SIM SELL</button>
            </div>
          </div>
          {flash > 0 && <div key={flash} className="hit-vignette" aria-hidden />}
        </div>

        <aside className="feed" id="feed">
          <div className="feed-header">
            <div><span className="kicker">LIVE TRANSACTIONS</span><h2>THE FEED</h2></div>
            <StatusChip status={feedStatus} />
          </div>
          <ul className="feed-list">
            {feed.length === 0 ? (
              <li className="feed-empty"><Radio size={22} /><b>WAITING FOR THE FIRST TRADE</b><span>Every buy and sell shows up here, with what it did to the city.</span></li>
            ) : feed.map((item) => <FeedRow key={item.id} item={item} onFocus={focusWallet} />)}
          </ul>
          <div className="feed-foot"><span>{feedStatus === "live" ? "RELAY CONNECTED" : feedStatus === "demo" ? "DEMO EVENTS · NOT MARKET DATA" : "CHECK RELAY CONFIG"}</span><span>{String(feed.length).padStart(2, "0")}/{FEED_LIMIT}</span></div>
        </aside>

        <div className="statbar">
          <Stat label="TOWERS STANDING" tone="cyan" icon={<Building2 size={16} strokeWidth={2.6} />} value={standing.length.toLocaleString()} detail={<>{ruins} in ruins · {buildings.length} lots built</>} />
          <Stat label="SKYLINE PEAK" tone="violet" icon={<Layers size={16} strokeWidth={2.6} />} value={tallest ? String(floors(tallest.height)) : "0"} unit="FLOORS" detail={tallest?.claimed ? <>Owned by {shortWallet(tallest.wallet)}</> : "Unclaimed landmark"} />
          <Stat label="SESSION VOLUME" tone="lime" icon={<Activity size={16} strokeWidth={2.6} />} value={volume.toFixed(1)} unit="SOL" detail={<><span className="buy-text">{buyShare}% buys</span> · <span className="sell-text">{100 - buyShare}% sells</span> · {totalTrades} trades</>}>
            <div className="pressure"><i style={{ width: `${buyShare}%` }} /></div>
          </Stat>
          <Stat label="KAIJU STOMPS" tone="red" icon={<Flame size={16} strokeWidth={2.6} />} value={stompTotal.toLocaleString()} detail={<>{stomps.destroyed} destroyed · {stomps.damaged} damaged</>} />
        </div>
      </section>

      <section className="controls">
        <div className="card finder">
          <div className="card-kicker"><LocateFixed size={16} strokeWidth={2.6} />FIND YOUR TOWER</div>
          <p>Paste your wallet. The camera flies straight to your building.</p>
          <form onSubmit={submitWalletSearch} className="search">
            <Search size={18} strokeWidth={2.6} />
            <input value={walletQuery} onChange={(e) => setWalletQuery(e.target.value)} placeholder="Wallet address…" aria-label="Wallet address" spellCheck={false} autoComplete="off" />
            <button type="submit">FIND</button>
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((b) => (
                  <li key={b.id}><button type="button" onClick={() => focusWallet(b.wallet)}><span className="swatch" style={{ background: b.color }} />{shortWallet(b.wallet)}<em>{b.status === "standing" ? `${floors(b.height)} FL` : "RUINS"}</em></button></li>
                ))}
              </ul>
            )}
          </form>
          {sampleWallet && (
            <button className="sample" onClick={() => focusWallet(sampleWallet)}>Try the tallest tower: <b>{shortWallet(sampleWallet)}</b> <ArrowUpRight size={13} strokeWidth={3} /></button>
          )}
        </div>

        <div className="card legend">
          <div className="card-kicker"><Layers size={16} strokeWidth={2.6} />HOW THE CITY WORKS</div>
          <ul>
            <li><span className="legend-icon li-buy"><ArrowDownRight size={16} strokeWidth={3} /></span><div><b>BUY</b><small>A new tower rises, or your tower grows taller</small></div></li>
            <li><span className="legend-icon li-sell"><ArrowUpRight size={16} strokeWidth={3} /></span><div><b>SELL</b><small>The kaiju attacks. Big sells flatten a tower</small></div></li>
            <li><span className="legend-icon li-tag">0x</span><div><b>WALLET TAG</b><small>Owner floats above the rooftop</small></div></li>
            <li><span className="legend-icon li-ruin"><Flame size={16} strokeWidth={2.6} /></span><div><b>RUINS</b><small>Burning wreckage, rebuilt by the next buyers</small></div></li>
          </ul>
        </div>

        <div className="card kaiju" id="lore">
          <div className="kaiju-top"><div className="card-kicker"><Skull size={16} strokeWidth={2.6} />THE CITY&apos;S PROBLEM</div><span className="awake">AWAKE</span></div>
          <div className="kaiju-body">
            <KaijuArt />
            <div>
              <h3>GROG THE DESTROYER</h3>
              <p>He doesn&apos;t care about your conviction. He only follows the sells.</p>
            </div>
          </div>
          <div className="threat"><span>THREAT LEVEL</span><div><i style={{ width: `${threat}%` }} /></div><b>{threat}%</b></div>
          <div className="kaiju-last">{lastAttack ? <>Last strike: <b className="sell-text">{lastAttack.impact.label}</b>{lastAttack.impact.lot ? ` · Lot ${String(lastAttack.impact.lot).padStart(2, "0")}` : ""}</> : "Prowling the city limits…"}</div>
        </div>
      </section>

      <footer className="footer">
        <div className="brand"><BrandMark /><span className="brand-type"><strong>KAIJU<i>/</i>CITY</strong><small>BUILT BY THE MARKET</small></span></div>
        <p>The city is a visualization of trades. It is not a price, balance or PnL feed.</p>
        <span className="version">V0.2 · PROTOTYPE</span>
      </footer>

      {toast && <div className="toast"><Check size={16} strokeWidth={3} />{toast}</div>}
    </main>
    </div>
  );
}