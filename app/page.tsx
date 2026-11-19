"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Camera, Check, ChevronUp,
  CircleHelp, Copy, ExternalLink, Flame, Globe2, LocateFixed, Maximize2,
  Radio, Search, Send, Sparkles, Volume2, VolumeX, X,
} from "lucide-react";
import type { CityBuilding, TradeEvent } from "@/lib/types";
import { makeDemoTrade, makeInitialBuildings, shortWallet } from "@/lib/demo-data";
import { formatSol, shortSignature, timeAgo } from "@/lib/format";
import { playTradeSound, setTradeSoundEnabled } from "@/lib/audio";

const CityScene = dynamic(() => import("@/components/CityScene"), { ssr: false, loading: () => <div className="scene-loading"><div className="loading-orb" /><span>BUILDING THE CITY…</span></div> });

const COLORS = ["#78c9c1", "#a5c3ad", "#d5b47b", "#7f9da9", "#b39bb2", "#d18c76"];
const START_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
const RELAY_URL = process.env.NEXT_PUBLIC_TRADE_RELAY_URL || "";
const MAX_BUILDINGS = 72;

function randomId() { return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function citySlot(index: number) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: (col - 1.5) * 4.5, z: (row - 1) * 4.4 };
}

function AppLogo() {
  return <div className="brand-mark"><span>K</span><i /><i /><i /></div>;
}

function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <div className="stat-card"><div className="stat-head"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{detail}</small></div>;
}

function TradeRow({ trade, onFocus }: { trade: TradeEvent; onFocus: (wallet: string) => void }) {
  const isBuy = trade.txType === "buy";
  return (
    <div className={`trade-row ${isBuy ? "trade-buy" : "trade-sell"}`}>
      <div className="trade-icon">{isBuy ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}</div>
      <div className="trade-main">
        <div className="trade-line"><b>{isBuy ? "BUY" : "SELL"}</b><span>{formatSol(trade.solAmount)}</span></div>
        <button className="wallet-link" onClick={() => onFocus(trade.traderPublicKey)}>{shortWallet(trade.traderPublicKey)}</button>
        <small>{shortSignature(trade.signature)} · {timeAgo(trade.timestamp)}</small>
      </div>
      <span className="trade-source">{trade.source === "live" ? "LIVE" : "DEMO"}</span>
    </div>
  );
}

export default function Home() {
  const [buildings, setBuildings] = useState<CityBuilding[]>(() => makeInitialBuildings());
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [focusedWallet, setFocusedWallet] = useState<string | null>(null);
  const [stompTarget, setStompTarget] = useState<{ x: number; z: number } | null>(null);
  const [stompPulse, setStompPulse] = useState(0);
  const [stompStrength, setStompStrength] = useState(1);
  const [walletQuery, setWalletQuery] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [feedStatus, setFeedStatus] = useState<"demo" | "connecting" | "live" | "offline">("demo");
  const [toast, setToast] = useState("");
  const [marketVolume, setMarketVolume] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [stompCount, setStompCount] = useState(0);
  const [cameraMode, setCameraMode] = useState<"city" | "wallet">("city");
  const [activeSection, setActiveSection] = useState("city");
  const buildingsRef = useRef(buildings);
  const demoCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundOnRef = useRef(soundOn);

  useEffect(() => { buildingsRef.current = buildings; }, [buildings]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  useEffect(() => {
    const sectionIds = ["city", "feed", "lore"];
    const sections = sectionIds.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    if (!("IntersectionObserver" in window) || sections.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-22% 0px -58% 0px", threshold: [0.05, 0.2, 0.45, 0.7] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const applyTrade = useCallback((trade: TradeEvent) => {
    let nextStomp: { x: number; z: number } | null = null;
    const next = buildingsRef.current.map((item) => ({ ...item }));
    if (trade.txType === "buy") {
      const index = next.length;
      const slot = citySlot(index);
      const height = Math.min(10.5, Math.max(1.35, 1.15 + trade.solAmount * 0.88));
      next.push({
        id: trade.id,
        wallet: trade.traderPublicKey,
        x: slot.x,
        z: slot.z,
        height,
        targetHeight: height,
        color: COLORS[index % COLORS.length],
        tradeCount: 1,
        lastSide: "buy",
        isFlattened: false,
      });
      // Keep the always-on city bounded: recycle the oldest wreck first.
      if (next.length > MAX_BUILDINGS) {
        const oldestWreck = next.findIndex((building) => building.isFlattened);
        next.splice(oldestWreck >= 0 ? oldestWreck : 0, 1);
      }
    } else {
      const exactIndex = next.findIndex((item) => item.wallet === trade.traderPublicKey && !item.isFlattened);
      let targetIndex = exactIndex;
      if (targetIndex < 0) {
        targetIndex = next.reduce((best, item, index) => !item.isFlattened && (best < 0 || item.height > next[best].height) ? index : best, -1);
      }
      if (targetIndex >= 0) {
        next[targetIndex].targetHeight = 0.12;
        next[targetIndex].isFlattened = true;
        next[targetIndex].lastSide = "sell";
        next[targetIndex].tradeCount += 1;
        nextStomp = { x: next[targetIndex].x, z: next[targetIndex].z };
      }
    }
    buildingsRef.current = next;
    setBuildings(next);
    setTrades((current) => [trade, ...current].slice(0, 14));
    setTotalTrades((value) => value + 1);
    setMarketVolume((value) => value + trade.solAmount);
    if (trade.txType === "sell") {
      setStompCount((value) => value + 1);
      setStompPulse((value) => value + 1);
      setStompStrength(Math.min(2.2, Math.max(0.65, trade.solAmount / 3)));
      if (nextStomp) setStompTarget(nextStomp);
    }
    if (soundOnRef.current) playTradeSound(trade.txType, trade.solAmount);
  }, []);

  // Demo mode keeps the world moving until a real relay URL is configured.
  useEffect(() => {
    if (RELAY_URL) return;
    setFeedStatus("demo");
    const interval = setInterval(() => {
      demoCount.current += 1;
      const event = makeDemoTrade(demoCount.current, buildingsRef.current);
      applyTrade(event);
    }, 2400 + Math.random() * 1200);
    return () => clearInterval(interval);
  }, [applyTrade]);

  // One browser connection to the project's relay; API credentials never reach this client.
  useEffect(() => {
    if (!RELAY_URL) return;
    setFeedStatus("connecting");
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(RELAY_URL);
        socket.onopen = () => setFeedStatus("connecting");
        socket.onmessage = (message) => {
          try {
            const payload = JSON.parse(String(message.data));
            if (payload.type === "status") {
              setFeedStatus(payload.status === "live" ? "live" : payload.status === "connecting" ? "connecting" : "offline");
              return;
            }
            if (payload.type === "trade" && (payload.txType === "buy" || payload.txType === "sell")) {
              const trade: TradeEvent = {
                id: payload.id || randomId(),
                txType: payload.txType,
                traderPublicKey: payload.traderPublicKey || "unknown-wallet",
                solAmount: Number(payload.solAmount || 0),
                tokenAmount: Number(payload.tokenAmount || 0),
                marketCapSol: Number(payload.marketCapSol || 0),
                signature: payload.signature,
                timestamp: Number(payload.timestamp || Date.now()),
                source: "live",
              };
              applyTrade(trade);
            }
          } catch { /* Ignore malformed relay messages. */ }
        };
        socket.onerror = () => setFeedStatus("offline");
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

  const activeBuildings = useMemo(() => buildings.filter((building) => !building.isFlattened).length, [buildings]);
  const cityPopulation = useMemo(() => buildings.length, [buildings]);

  const focusWallet = useCallback((wallet: string) => {
    const match = buildingsRef.current.find((building) => building.wallet.toLowerCase() === wallet.toLowerCase() || building.wallet.toLowerCase().startsWith(wallet.toLowerCase()));
    if (!match) {
      notify("No tower found for that wallet yet");
      return;
    }
    setFocusedWallet(match.wallet);
    setCameraMode("wallet");
    setWalletQuery(match.wallet);
    notify(`Camera locked on ${shortWallet(match.wallet)}`);
  }, [notify]);

  const submitWalletSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = walletQuery.trim();
    if (value) focusWallet(value);
  };

  const simulateTrade = (side: "buy" | "sell") => {
    const base = side === "buy" ? `whale${Math.random().toString(36).slice(2, 9)}` : (buildingsRef.current.find((b) => !b.isFlattened)?.wallet || "paperhands");
    const event: TradeEvent = {
      id: randomId(), txType: side, traderPublicKey: base,
      solAmount: Number((side === "buy" ? 0.8 + Math.random() * 8.8 : 0.4 + Math.random() * 6.5).toFixed(2)),
      timestamp: Date.now(), source: "demo",
    };
    applyTrade(event);
  };

  const copyMint = async () => {
    if (!START_MINT) { notify("Add NEXT_PUBLIC_TOKEN_MINT to show the contract address"); return; }
    try { await navigator.clipboard.writeText(START_MINT); notify("Contract address copied"); }
    catch { notify("Could not copy the contract address"); }
  };

  const resetCamera = () => { setFocusedWallet(null); setCameraMode("city"); setWalletQuery(""); };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setTradeSoundEnabled(next);
    if (next) notify("Trade audio enabled · turn up your volume");
  };
  const soldShare = cityPopulation ? Math.round((stompCount / Math.max(totalTrades, 1)) * 100) : 0;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand-lockup"><AppLogo /><div className="brand-type"><strong>KAIJU<span>/</span>CITY</strong><small>THE MARKET IS ALIVE</small></div></div>
        <nav className="topnav" aria-label="Main navigation"><a className={activeSection === "city" ? "nav-active" : ""} href="#city" aria-current={activeSection === "city" ? "location" : undefined}>CITY <span className="nav-dot" /></a><a className={activeSection === "feed" ? "nav-active" : ""} href="#feed" aria-current={activeSection === "feed" ? "location" : undefined}>TRADE FEED</a><a className={activeSection === "lore" ? "nav-active" : ""} href="#lore" aria-current={activeSection === "lore" ? "location" : undefined}>LORE</a></nav>
        <div className="top-actions">
          <a className="social-pill social-x" href={process.env.NEXT_PUBLIC_X_URL || "https://x.com"} target="_blank" rel="noreferrer" aria-label="Open X">𝕏</a>
          {process.env.NEXT_PUBLIC_TELEGRAM_URL && <a className="social-pill" href={process.env.NEXT_PUBLIC_TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="Open Telegram"><Send size={13} /></a>}
          <button className="ca-pill" onClick={copyMint}><span className="ca-label">CA</span><span className="ca-dot" />{START_MINT ? `${START_MINT.slice(0, 5)}…${START_MINT.slice(-4)}` : "CA NOT SET"}<Copy size={12} /></button>
          <a className="launch-button" href={START_MINT ? `https://pump.fun/coin/${START_MINT}` : "#city"} target={START_MINT ? "_blank" : undefined} rel="noreferrer">{START_MINT ? "TRADE TOKEN" : "LAUNCH SOON"}<ExternalLink size={13} /></a>
        </div>
      </header>

      <section className="hero-strip">
        <div><div className="eyebrow"><span className="eyebrow-line" /> SOLANA · ON-CHAIN CITY SIMULATOR</div><h1>EVERY TRADE <em>LEAVES A MARK.</em></h1><p>Buy the skyline. Sell the city. The chart has never looked this alive.</p></div>
        <div className="hero-right"><div className={`stream-status status-${feedStatus}`}><span className="status-pulse" />{feedStatus === "live" ? "LIVE ON-CHAIN" : feedStatus === "connecting" ? "CONNECTING RELAY" : feedStatus === "offline" ? "RELAY OFFLINE" : "DEMO STREAM"}</div><div className="hero-chain"><span className="solana-mark">◎</span> BUILT FOR SOLANA</div></div>
      </section>

      <section className="stats-grid">
        <StatCard label="CITY POPULATION" value={cityPopulation.toLocaleString()} detail={`${activeBuildings} towers still standing`} icon={<Globe2 size={15} />} />
        <StatCard label="TRADE VOLUME" value={`${marketVolume.toFixed(1)} SOL`} detail="Since this session started" icon={<Activity size={15} />} />
        <StatCard label="TOTAL TRADES" value={totalTrades.toLocaleString()} detail="Every trade changes the map" icon={<Radio size={15} />} />
        <StatCard label="KAIJU STOMPS" value={stompCount.toLocaleString()} detail={`${soldShare}% of session events were sells`} icon={<Flame size={15} />} />
      </section>

      <section className="workspace" id="city">
        <aside className="left-rail">
          <div className="panel-heading"><span>01 / CITY CONTROLS</span><span className="panel-live">● ACTIVE</span></div>
          <div className="finder-card">
            <div className="finder-title"><LocateFixed size={16} /><b>FIND YOUR TOWER</b></div>
            <p>Paste a wallet address. We’ll find your building and fly the camera straight to it.</p>
            <form onSubmit={submitWalletSearch} className="search-form"><Search size={15} /><input value={walletQuery} onChange={(e) => setWalletQuery(e.target.value)} placeholder="Wallet address…" aria-label="Wallet address" /><button aria-label="Find wallet" type="submit"><ArrowUpRight size={16} /></button></form>
            <div className="finder-foot"><span>TRY A KNOWN WALLET</span><button onClick={() => focusWallet(buildings[0]?.wallet || "")}>{shortWallet(buildings[0]?.wallet || "8xQmKp4rT9vL")} <ExternalLink size={10} /></button></div>
          </div>

          <div className="section-rule" />
          <div className="panel-heading"><span>02 / CITY LEGEND</span><CircleHelp size={14} /></div>
          <div className="legend-list">
            <div className="legend-row"><span className="legend-swatch buy-swatch" /><div><b>BUY SIGNAL</b><small>A new tower rises</small></div><span className="legend-arrow up">↗</span></div>
            <div className="legend-row"><span className="legend-swatch sell-swatch" /><div><b>SELL SIGNAL</b><small>The kaiju stomps</small></div><span className="legend-arrow down">↘</span></div>
            <div className="legend-row"><span className="legend-swatch wallet-swatch" /><div><b>WALLET TAG</b><small>Owner on the rooftop</small></div><span className="legend-tag">0x…</span></div>
          </div>

          <div className="kaiju-card" id="lore">
            <div className="kaiju-card-top"><span>THE CITY'S PROBLEM</span><span className="kaiju-status">AWAKE</span></div>
            <div className="kaiju-art">
              <div className="kaiju-shadow" />
              <svg className="kaiju-emoji" viewBox="0 0 160 100" role="img" aria-label="Grog, the city-stomping toad">
                <defs>
                  <linearGradient id="grog-skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#91c5a8" /><stop offset="1" stopColor="#397e75" /></linearGradient>
                  <linearGradient id="grog-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c1dfbd" /><stop offset="1" stopColor="#6fae93" /></linearGradient>
                </defs>
                <path d="M18 69 C13 54 23 40 39 38 C39 23 50 14 64 17 C72 18 78 24 81 31 C89 23 101 22 111 28 C124 35 131 47 136 63 C140 78 126 86 111 85 L47 85 C31 85 21 80 18 69Z" fill="url(#grog-skin)" stroke="#b6d9bd" strokeOpacity=".42" strokeWidth="2" />
                <path d="M31 69 C39 59 54 57 71 61 C88 55 111 58 126 70 C115 79 101 81 83 80 L49 80 C41 79 35 75 31 69Z" fill="#285b58" opacity=".72" />
                <ellipse cx="51" cy="33" rx="15" ry="16" fill="url(#grog-light)" />
                <ellipse cx="105" cy="32" rx="16" ry="17" fill="url(#grog-light)" />
                <ellipse cx="53" cy="34" rx="7" ry="9" fill="#f0e7c9" />
                <ellipse cx="106" cy="33" rx="7" ry="9" fill="#f0e7c9" />
                <ellipse cx="55" cy="35" rx="3.5" ry="5" fill="#142b31" />
                <ellipse cx="108" cy="34" rx="3.5" ry="5" fill="#142b31" />
                <path d="M67 65 C79 69 96 69 108 64" fill="none" stroke="#183d3e" strokeWidth="3" strokeLinecap="round" />
                <path d="M31 52 C23 57 21 66 25 73 M126 51 C137 57 139 67 133 74" fill="none" stroke="#a7d0b4" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" />
                <path d="M41 20 L47 10 L53 21 M101 18 L109 8 L115 21" fill="none" stroke="#d6b579" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="kaiju-scanline" />
            </div>
            <div className="kaiju-name">GROG THE DESTROYER</div>
            <p>He doesn’t care about your conviction. He only follows the sells.</p>
            <div className="kaiju-power"><span>STOMP POWER</span><div><i style={{ width: `${Math.min(100, 25 + stompCount * 6)}%` }} /></div><b>{Math.min(100, 25 + stompCount * 6)}%</b></div>
          </div>
        </aside>

        <section className="city-panel">
          <div className="city-panel-header"><div className="city-heading"><span className="city-live-dot" /><div><b>NEO TOKYO / SECTOR 07</b><small>{cameraMode === "wallet" ? "WALLET TRACKING ACTIVE" : "LIVE CITY VIEW · 3D SIMULATION"}</small></div></div><div className="scene-actions"><span className="scene-coords">X: 07 · Z: 24</span><button className="icon-button" onClick={resetCamera} title="Reset camera"><Camera size={15} /></button><button className={`sound-control ${soundOn ? "sound-enabled" : ""}`} onClick={toggleSound} title={soundOn ? "Mute trade sound effects" : "Enable trade sound effects"} aria-label={soundOn ? "Mute sound effects" : "Enable sound effects"}>{soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}<span>SOUND {soundOn ? "ON" : "OFF"}</span></button></div></div>
          <div className="scene-wrap"><CityScene buildings={buildings} focusedWallet={focusedWallet} stompTarget={stompTarget} stompPulse={stompPulse} stompStrength={stompStrength} />
            <div className="scene-overlay scene-overlay-top"><span><span className="overlay-dot" /> {feedStatus === "live" ? "ON-CHAIN SIGNAL" : "SIMULATION MODE"}</span><span>RENDER ENGINE / THREE.JS</span></div>
            <div className="scene-overlay scene-overlay-bottom"><div><small>SKYLINE STATUS</small><b>{activeBuildings} <span>/ {cityPopulation}</span></b></div><div><small>LAST EVENT</small><b>{trades[0] ? trades[0].txType.toUpperCase() : "AWAITING"}</b></div><div className="scene-hint"><Maximize2 size={12} /> DRAG TO ROTATE · SCROLL TO ZOOM</div></div>
            {focusedWallet && <div className="focus-chip"><span className="focus-pulse" /> TRACKING {shortWallet(focusedWallet)} <button onClick={resetCamera}><X size={12} /></button></div>}
          </div>
          <div className="scene-footer"><div className="scene-key"><span className="key-buy" /> BUY <span className="key-sell" /> SELL <span className="key-focus" /> YOUR TOWER</div><div className="scene-footer-note">CITY DATA IS A VISUALIZATION · NOT A PRICE OR PNL FEED</div></div>
        </section>

        <aside className="right-rail" id="feed">
          <div className="feed-header"><div><div className="panel-heading"><span>03 / LIVE TRANSACTIONS</span></div><h2>THE FEED<span>.</span></h2></div><div className={`feed-live ${feedStatus}`}><span />{feedStatus === "live" ? "LIVE" : feedStatus === "connecting" ? "LINKING" : feedStatus === "offline" ? "OFFLINE" : "DEMO"}</div></div>
          <div className="feed-subline"><span>RECENT ON-CHAIN ACTIVITY</span><span>{trades.length.toString().padStart(2, "0")} / 14</span></div>
          <div className="trade-list">
            {trades.length === 0 ? <div className="empty-feed"><div className="empty-bars"><i /><i /><i /><i /><i /></div><b>WAITING FOR THE FIRST TRADE</b><span>Every buy and sell will appear here.</span></div> : trades.map((trade) => <TradeRow key={trade.id} trade={trade} onFocus={focusWallet} />)}
          </div>
          <div className="feed-bottom"><span className="feed-connection"><span /> {feedStatus === "live" ? "RELAY CONNECTED" : feedStatus === "demo" ? "LOCAL DEMO EVENTS" : "CHECK RELAY CONFIG"}</span><span>BLOCK STREAM <b>●</b></span></div>
          <div className="test-controls"><span>TEST THE CITY</span><div><button onClick={() => simulateTrade("buy")}><ArrowDownRight size={13} /> SIM BUY</button><button onClick={() => simulateTrade("sell")}><ArrowUpRight size={13} /> SIM SELL</button></div></div>
        </aside>
      </section>

      <footer className="bottom-bar"><div className="footer-brand"><AppLogo /><span>KAIJU/CITY <small>BUILT BY THE MARKET</small></span></div><div className="footer-message"><Sparkles size={13} /> THE CITY NEVER SLEEPS. THE KAIJU NEVER BLINKS.</div><div className="footer-links"><a href="#city">BACK TO CITY <ChevronUp size={13} /></a><span>V 0.1.0 / PROTOTYPE</span></div></footer>
      {toast && <div className="toast"><Check size={14} />{toast}</div>}
    </main>
  );
}
