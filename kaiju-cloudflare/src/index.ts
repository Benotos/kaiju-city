import { DurableObject } from "cloudflare:workers";
import { type Trade, tradeFromFeedEvent, tradesFromLogs } from "./decode";

interface Env {
  RELAY: DurableObjectNamespace<KaijuRelay>;
  KAIJU_MINT: string;
  /** Optional: comma list of sources to run. Default: all three. */
  SOURCES?: string;
  /** Optional secret: Solana RPC WebSocket URL (e.g. Helius). Defaults to the public RPC. */
  SOLANA_WS_URL?: string;
  /** Optional secret: PumpPortal API key (only needed for PumpPortal's PumpSwap data). */
  PUMPPORTAL_API_KEY?: string;
}

type RelayStatus = "connecting" | "live" | "offline" | "needs-config";
type SourceName = "chain" | "pumpdev" | "pumpportal";
type SourceStatus = "idle" | "connecting" | "open" | "retrying";

const ALL_SOURCES: SourceName[] = ["chain", "pumpdev", "pumpportal"];
const PUBLIC_SOLANA_WS = "wss://api.mainnet-beta.solana.com";
const BASE58_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SEEN = 5_000;
const HEARTBEAT_MS = 25_000;
const MAX_NOTES = 12;
const MAX_BACKOFF_MS = 60_000;

type Source = {
  name: SourceName;
  socket: WebSocket | null;
  status: SourceStatus;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  keepAlive: ReturnType<typeof setInterval> | null;
  connectedAt: number;
  messages: number;
  trades: number;
  firstToDeliver: number;
  lastMessageAt: number;
  lastError: string;
};

function newSource(name: SourceName): Source {
  return { name, socket: null, status: "idle", attempt: 0, timer: null, keepAlive: null, connectedAt: 0, messages: 0, trades: 0, firstToDeliver: 0, lastMessageAt: 0, lastError: "" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/health") return new Response("Not found", { status: 404 });
    if (url.pathname === "/health" && request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const id = env.RELAY.idFromName(env.KAIJU_MINT?.trim() || "unconfigured");
    return env.RELAY.get(id).fetch(request);
  },
};

/**
 * One Durable Object per mint. It reads the token's trades from several
 * independent providers at the same time and de-duplicates them by
 * transaction signature, so the city keeps moving if any one provider fails.
 */
export class KaijuRelay extends DurableObject<Env> {
  private readonly clients = new Set<WebSocket>();
  private readonly sources = new Map<SourceName, Source>();
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private status: RelayStatus = "offline";
  private tradesForwarded = 0;
  private lastTradeAt = 0;
  private notes: { at: string; text: string }[] = [];

  private mint(): string {
    return this.env.KAIJU_MINT?.trim() || "";
  }

  private enabledSources(): SourceName[] {
    const raw = this.env.SOURCES?.trim();
    if (!raw) return ALL_SOURCES;
    const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
    return ALL_SOURCES.filter((s) => wanted.includes(s));
  }

  private note(text: string): void {
    this.notes.unshift({ at: new Date().toISOString(), text: text.slice(0, 300) });
    if (this.notes.length > MAX_NOTES) this.notes.length = MAX_NOTES;
  }

  /* ----------------------------- browsers ----------------------------- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return this.health();
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Kaiju City live trade relay. Connect with a WebSocket or open /health.", {
        status: 426,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.clients.add(server);
    server.addEventListener("close", () => this.handleClientDisconnect(server));
    server.addEventListener("error", () => this.handleClientDisconnect(server));
    this.send(server, { type: "status", status: this.status });

    this.startSources();
    this.startHeartbeat();
    return new Response(null, { status: 101, webSocket: client });
  }

  private health(): Response {
    const ago = (t: number) => (t ? `${Math.round((Date.now() - t) / 1000)}s ago` : "never");
    const sources: Record<string, unknown> = {};
    for (const s of this.sources.values()) {
      sources[s.name] = {
        status: s.status,
        connectedFor: s.connectedAt ? `${Math.round((Date.now() - s.connectedAt) / 1000)}s` : "not connected",
        messages: s.messages,
        trades: s.trades,
        deliveredFirst: s.firstToDeliver,
        lastMessage: ago(s.lastMessageAt),
        lastError: s.lastError || null,
      };
    }
    return Response.json({
      ok: true,
      status: this.status,
      mint: this.mint() || null,
      clients: this.openClientCount(),
      tradesForwarded: this.tradesForwarded,
      lastTrade: ago(this.lastTradeAt),
      enabledSources: this.enabledSources(),
      sources,
      notes: this.notes,
    });
  }

  private openClientCount(): number {
    let n = 0;
    for (const c of this.clients) if (c.readyState === WebSocket.OPEN) n++;
    return n;
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  private broadcast(payload: Record<string, unknown>): void {
    const encoded = JSON.stringify(payload);
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(encoded);
      } catch {
        /* ignore */
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (this.openClientCount() > 0) this.broadcast({ type: "ping", t: Date.now() });
    }, HEARTBEAT_MS);
  }

  private handleClientDisconnect(client: WebSocket): void {
    this.clients.delete(client);
    if (this.openClientCount() > 0) return;
    // Nobody is watching: close every upstream connection to save resources.
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const s of this.sources.values()) this.stopSource(s);
    this.status = "offline";
  }

  /* ------------------------------ status ------------------------------ */

  private refreshStatus(): void {
    let next: RelayStatus = "offline";
    const states = [...this.sources.values()].map((s) => s.status);
    if (states.includes("open")) next = "live";
    else if (states.includes("connecting") || states.includes("retrying")) next = "connecting";
    if (next !== this.status) {
      this.status = next;
      this.broadcast({ type: "status", status: next });
    }
  }

  /* ------------------------------ sources ----------------------------- */

  private startSources(): void {
    const mint = this.mint();
    if (!BASE58_MINT_PATTERN.test(mint)) {
      this.status = "needs-config";
      this.broadcast({ type: "status", status: "needs-config" });
      this.note("KAIJU_MINT is missing or not a valid Solana address.");
      return;
    }
    for (const name of this.enabledSources()) {
      let source = this.sources.get(name);
      if (!source) {
        source = newSource(name);
        this.sources.set(name, source);
      }
      if (source.status === "idle") this.openSource(source);
    }
    this.refreshStatus();
  }

  private sourceUrl(name: SourceName): string {
    if (name === "chain") return this.env.SOLANA_WS_URL?.trim() || PUBLIC_SOLANA_WS;
    if (name === "pumpdev") return "wss://pumpdev.io/ws";
    const key = this.env.PUMPPORTAL_API_KEY?.trim();
    return key ? `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(key)}` : "wss://pumpportal.fun/api/data";
  }

  private subscribeMessage(name: SourceName): string {
    if (name === "chain") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [{ mentions: [this.mint()] }, { commitment: "confirmed" }],
      });
    }
    return JSON.stringify({ method: "subscribeTokenTrade", keys: [this.mint()] });
  }

  private openSource(source: Source): void {
    if (this.openClientCount() === 0) {
      source.status = "idle";
      return;
    }
    if (source.timer) {
      clearTimeout(source.timer);
      source.timer = null;
    }
    source.status = "connecting";
    this.refreshStatus();

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.sourceUrl(source.name));
    } catch (error) {
      source.lastError = `Could not open socket: ${String(error)}`;
      this.retry(source);
      return;
    }
    source.socket = socket;

    socket.addEventListener("open", () => {
      if (source.socket !== socket) {
        socket.close(1000, "superseded");
        return;
      }
      source.status = "open";
      source.attempt = 0;
      source.connectedAt = Date.now();
      source.lastError = "";
      this.note(`${source.name}: connected`);
      try {
        socket.send(this.subscribeMessage(source.name));
      } catch (error) {
        source.lastError = `Subscribe failed: ${String(error)}`;
        socket.close(1011, "subscribe failed");
        return;
      }
      // Some RPCs drop idle sockets; a harmless request every 30s keeps it open.
      if (source.name === "chain") {
        let n = 1000;
        source.keepAlive = setInterval(() => {
          try {
            socket.send(JSON.stringify({ jsonrpc: "2.0", id: n++, method: "getHealth" }));
          } catch {
            /* close handler will retry */
          }
        }, 30_000);
      }
      this.refreshStatus();
    });

    socket.addEventListener("message", (message: MessageEvent) => {
      if (source.socket !== socket) return;
      source.messages += 1;
      source.lastMessageAt = Date.now();
      this.handleMessage(source, message.data);
    });

    socket.addEventListener("error", () => {
      try {
        socket.close(1011, "error");
      } catch {
        /* already closing */
      }
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      if (source.socket !== socket) return;
      source.socket = null;
      source.connectedAt = 0;
      if (source.keepAlive) {
        clearInterval(source.keepAlive);
        source.keepAlive = null;
      }
      source.lastError = `closed (code ${event.code})${event.reason ? `: ${event.reason}` : ""}`;
      this.note(`${source.name}: ${source.lastError}`);
      this.retry(source);
    });
  }

  private retry(source: Source): void {
    if (this.openClientCount() === 0) {
      source.status = "idle";
      this.refreshStatus();
      return;
    }
    source.status = "retrying";
    const delay = Math.min(MAX_BACKOFF_MS, 1_500 * 2 ** source.attempt) + Math.floor(Math.random() * 750);
    source.attempt = Math.min(source.attempt + 1, 6);
    source.timer = setTimeout(() => {
      source.timer = null;
      this.openSource(source);
    }, delay);
    this.refreshStatus();
  }

  private stopSource(source: Source): void {
    if (source.timer) clearTimeout(source.timer);
    if (source.keepAlive) clearInterval(source.keepAlive);
    source.timer = null;
    source.keepAlive = null;
    const socket = source.socket;
    source.socket = null;
    source.status = "idle";
    source.connectedAt = 0;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try {
        socket.close(1000, "no viewers");
      } catch {
        /* ignore */
      }
    }
  }

  /* ----------------------------- messages ----------------------------- */

  private handleMessage(source: Source, raw: unknown): void {
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : String(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      data = parsed as Record<string, unknown>;
    } catch {
      this.note(`${source.name}: non-JSON message`);
      return;
    }

    if (source.name === "chain") {
      if (data.method === "logsNotification") {
        const value = (data.params as { result?: { value?: { signature?: string; err?: unknown; logs?: string[] } } } | undefined)?.result?.value;
        if (!value?.signature || value.err || !Array.isArray(value.logs)) return;
        for (const trade of tradesFromLogs(value.signature, value.logs, this.mint())) this.forward(source, trade);
        return;
      }
      // Subscription reply or error. Ignore keep-alive replies.
      if (typeof data.id === "number" && data.id >= 1000) return;
      this.note(`chain: ${JSON.stringify(data)}`);
      return;
    }

    const trade = tradeFromFeedEvent(data, this.mint());
    if (trade) {
      this.forward(source, trade);
      return;
    }
    // Not a trade for our mint: surface control messages (subscribe replies, errors).
    if (!("txType" in data) && !("signature" in data)) this.note(`${source.name}: ${JSON.stringify(data)}`);
  }

  private forward(source: Source, trade: Trade): void {
    source.trades += 1;
    if (this.seen.has(trade.key)) return;
    this.seen.add(trade.key);
    this.seenOrder.push(trade.key);
    if (this.seenOrder.length > MAX_SEEN) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
    source.firstToDeliver += 1;
    this.tradesForwarded += 1;
    this.lastTradeAt = Date.now();
    this.broadcast({
      type: "trade",
      id: trade.key,
      txType: trade.txType,
      traderPublicKey: trade.traderPublicKey,
      solAmount: trade.solAmount,
      tokenAmount: trade.tokenAmount,
      marketCapSol: trade.marketCapSol,
      signature: trade.signature,
      timestamp: trade.timestamp,
      provider: source.name,
    });
  }
}