import { DurableObject } from "cloudflare:workers";
import { type Trade, tradeFromFeedEvent, tradesFromLogs } from "./decode";
import { type HolderSnapshot, fetchHolders, httpRpcUrl } from "./holders";

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
/** Recent trades kept (and persisted) so a reload or new visitor sees the feed immediately. */
const HISTORY_LIMIT = 150;
const HISTORY_SAVE_DELAY_MS = 4_000;
/** Holder list refresh while visitors are watching. */
const HOLDERS_REFRESH_MS = 60_000;
const MAX_HOLDERS = 1600;

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
    const routes = ["/", "/health", "/holder", "/holders"];
    if (!routes.includes(url.pathname)) return new Response("Not found", { status: 404 });
    if (url.pathname !== "/" && request.method !== "GET") return new Response("Method not allowed", { status: 405 });
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
  private history: Record<string, unknown>[] = [];
  private historySaveTimer: ReturnType<typeof setTimeout> | null = null;
  private holders: HolderSnapshot | null = null;
  /** Full ranked holder list (memory only), for lookups beyond the towers shown. */
  private allHolders: [string, number][] = [];
  private holderRank = new Map<string, number>();
  private holdersTimer: ReturnType<typeof setInterval> | null = null;
  private holdersLoading = false;
  private holdersError = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore recent trades from durable storage before handling any request.
    ctx.blockConcurrencyWhile(async () => {
      try {
        const savedHolders = await ctx.storage.get<HolderSnapshot>("holders");
        if (savedHolders && Array.isArray(savedHolders.holders) && (!savedHolders.mint || savedHolders.mint === this.env.KAIJU_MINT?.trim())) {
          this.holders = savedHolders;
          this.holderRank = new Map(savedHolders.holders.map(([w], i) => [w, i]));
        }
        const saved = await ctx.storage.get<Record<string, unknown>[]>("history");
        if (Array.isArray(saved)) {
          this.history = saved.slice(-HISTORY_LIMIT);
          for (const t of this.history) if (typeof t.id === "string") this.remember(t.id);
        }
      } catch (error) {
        console.warn("[relay] Could not load trade history:", error);
      }
    });
  }

  private remember(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > MAX_SEEN) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
    return true;
  }

  private recordHistory(payload: Record<string, unknown>): void {
    this.history.push(payload);
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    if (this.historySaveTimer) return;
    this.historySaveTimer = setTimeout(() => {
      this.historySaveTimer = null;
      this.ctx.storage.put("history", this.history).catch((error) => console.warn("[relay] Could not save history:", error));
    }, HISTORY_SAVE_DELAY_MS);
  }

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
    if (url.pathname === "/holder") return this.holderLookup(url.searchParams.get("wallet") ?? "");
    if (url.pathname === "/holders") return this.holderTop();
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Stomp City live trade relay. Connect with a WebSocket or open /health.", {
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
    // Holders first (they define the city), then recent trades for the feed.
    if (this.holders) this.send(server, { type: "holders", ...this.holders });
    if (this.history.length) this.send(server, { type: "history", trades: this.history });

    this.startSources();
    this.startHolders();
    this.startHeartbeat();
    return new Response(null, { status: 101, webSocket: client });
  }

  private json(body: unknown): Response {
    return Response.json(body, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
  }

  /** Rank and balance for any wallet, including holders outside the towers shown. */
  private holderLookup(wallet: string): Response {
    wallet = wallet.trim();
    if (!this.holders) return this.json({ ok: false, error: "holder list not loaded yet" });
    const list = this.allHolders.length ? this.allHolders : this.holders.holders;
    const exact = this.holderRank.get(wallet);
    const index = exact ?? list.findIndex(([w]) => wallet.length >= 4 && w.toLowerCase().startsWith(wallet.toLowerCase()));
    if (index === undefined || index < 0) {
      const excluded = this.holders.excluded.find((e) => e.owner === wallet);
      return this.json({ ok: true, holding: false, excluded: excluded ?? null, total: this.holders.total, updatedAt: this.holders.updatedAt });
    }
    const [w, amount] = list[index];
    return this.json({
      ok: true,
      holding: true,
      wallet: w,
      amount,
      rank: index + 1,
      total: this.holders.total,
      pctOfSupply: this.holders.supply ? (amount / this.holders.supply) * 100 : null,
      shownAsTower: index < this.holders.holders.length,
      updatedAt: this.holders.updatedAt,
    });
  }

  private holderTop(): Response {
    if (!this.holders) return this.json({ ok: false, error: "holder list not loaded yet" });
    const supply = this.holders.supply || 1;
    return this.json({
      ok: true,
      mint: this.holders.mint,
      supply: this.holders.supply,
      decimals: this.holders.decimals,
      totalHolders: this.holders.total,
      updatedAt: new Date(this.holders.updatedAt).toISOString(),
      excluded: this.holders.excluded,
      top: (this.allHolders.length ? this.allHolders : this.holders.holders).slice(0, 50).map(([wallet, amount], i) => ({ rank: i + 1, wallet, amount, pct: +((amount / supply) * 100).toFixed(4) })),
    });
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
      historyStored: this.history.length,
      holders: this.holders
        ? {
            count: this.holders.total,
            sent: this.holders.holders.length,
            lastRefresh: ago(this.holders.updatedAt),
            topHolder: this.holders.holders[0] ? { wallet: this.holders.holders[0][0], amount: this.holders.holders[0][1] } : null,
            top5: this.holders.holders.slice(0, 5).map(([w, a]) => `${w} ${a}`),
            excluded: this.holders.excluded,
            error: this.holdersError || null,
          }
        : { count: 0, error: this.holdersError || (this.env.SOLANA_WS_URL ? "loading" : "SOLANA_WS_URL secret not set") },
      lastTrade: ago(this.lastTradeAt),
      enabledSources: this.enabledSources(),
      chainEndpoint: this.chainEndpointLabel(),
      sources,
      notes: this.notes,
    });
  }

  private chainEndpointLabel(): string {
    const raw = this.env.SOLANA_WS_URL?.trim();
    if (!raw) return "public Solana RPC (no SOLANA_WS_URL secret set)";
    try {
      const url = new URL(raw);
      return `custom: ${url.protocol}//${url.host}${url.searchParams.has("api-key") ? " (api-key present)" : " (no api-key in URL)"}`;
    } catch {
      return "SOLANA_WS_URL is set but is not a valid URL - re-enter it";
    }
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
    if (this.holdersTimer) {
      clearInterval(this.holdersTimer);
      this.holdersTimer = null;
    }
    this.status = "offline";
  }

  /* ------------------------------ holders ----------------------------- */

  private startHolders(): void {
    if (!this.env.SOLANA_WS_URL?.trim()) return;
    const stale = !this.holders || Date.now() - this.holders.updatedAt > HOLDERS_REFRESH_MS * 0.75;
    if (stale) void this.refreshHolders();
    if (!this.holdersTimer) {
      this.holdersTimer = setInterval(() => {
        if (this.openClientCount() > 0) void this.refreshHolders();
      }, HOLDERS_REFRESH_MS);
    }
  }

  private async refreshHolders(): Promise<void> {
    const rpcUrl = this.env.SOLANA_WS_URL?.trim();
    if (!rpcUrl || this.holdersLoading) return;
    this.holdersLoading = true;
    try {
      const fetched = await fetchHolders(httpRpcUrl(rpcUrl), this.mint(), MAX_HOLDERS);
      const { all, ...snapshot } = fetched;
      this.allHolders = all ?? snapshot.holders;
      this.holderRank = new Map(this.allHolders.map(([w], i) => [w, i]));
      this.holders = snapshot;
      this.holdersError = "";
      this.broadcast({ type: "holders", ...snapshot });
      await this.ctx.storage.put("holders", snapshot);
    } catch (error) {
      this.holdersError = String(error).slice(0, 200);
      this.note(`holders: ${this.holdersError}`);
    } finally {
      this.holdersLoading = false;
    }
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
    this.dial(source).catch((error) => {
      source.lastError = `connect failed: ${String(error).slice(0, 160)}`;
      this.note(`${source.name}: ${source.lastError}`);
      this.retry(source);
    });
  }

  /**
   * Opens the upstream socket with fetch() + Upgrade so a refused connection
   * reports the provider's real HTTP status (401, 403, 429, 502...) instead
   * of a generic "failed to establish" error.
   */
  private async dial(source: Source): Promise<void> {
    const url = this.sourceUrl(source.name).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    const response = await fetch(url, { headers: { Upgrade: "websocket", "User-Agent": "stomp-city-relay/1.0" } });
    const socket = response.webSocket;
    if (!socket) {
      let body = "";
      try {
        body = (await response.text()).replace(/\s+/g, " ").slice(0, 140);
      } catch {
        /* ignore */
      }
      source.lastError = `refused: HTTP ${response.status}${body ? ` ${body}` : ""}`;
      this.note(`${source.name}: ${source.lastError}`);
      this.retry(source);
      return;
    }
    if (this.openClientCount() === 0) {
      socket.accept();
      socket.close(1000, "no viewers");
      source.status = "idle";
      return;
    }
    socket.accept();
    source.socket = socket;
    source.status = "open";
    source.attempt = 0;
    source.connectedAt = Date.now();
    source.lastError = "";
    this.note(`${source.name}: connected`);

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

    try {
      socket.send(this.subscribeMessage(source.name));
    } catch (error) {
      source.lastError = `subscribe failed: ${String(error)}`;
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
    if (!this.remember(trade.key)) return;
    source.firstToDeliver += 1;
    this.tradesForwarded += 1;
    this.lastTradeAt = Date.now();
    // Some feeds send token amounts in raw base units (x10^6). One trade can
    // never exceed total supply, so anything larger is rescaled.
    const supply = this.holders?.supply || 1_000_000_000;
    if (trade.tokenAmount > supply * 1.01) trade.tokenAmount = trade.tokenAmount / 1e6;
    const payload = {
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
    };
    this.recordHistory(payload);
    this.broadcast(payload);
  }
}