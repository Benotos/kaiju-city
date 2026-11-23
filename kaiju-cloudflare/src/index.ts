import { DurableObject } from "cloudflare:workers";

interface Env {
  RELAY: DurableObjectNamespace<KaijuRelay>;
  KAIJU_MINT: string;
  PUMPPORTAL_API_KEY?: string;
}

type RelayStatus = "connecting" | "live" | "offline" | "needs-config";

type PumpPortalEvent = Record<string, unknown>;

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const BASE58_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SEEN_SIGNATURES = 5_000;
const HEARTBEAT_MS = 25_000;
const MAX_NOTES = 8;

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // PumpPortal timestamps may be seconds or milliseconds.
    return value < 1_000_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
  }

  if (typeof value === "string") {
    const numeric = finiteNumber(value);
    if (numeric !== null && numeric > 0) {
      return numeric < 1_000_000_000_000 ? Math.round(numeric * 1_000) : Math.round(numeric);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Date.now();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/health" && request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const mint = env.KAIJU_MINT || "unconfigured";
    const id = env.RELAY.idFromName(mint);
    return env.RELAY.get(id).fetch(request);
  },
};

/**
 * One Durable Object instance owns one PumpPortal connection and fans trades
 * out to every connected Kaiju City browser tab.
 *
 * We use the standard DO WebSocket API here rather than hibernation because
 * this object also holds an outbound PumpPortal WebSocket. Standard accepted
 * client sockets keep the DO resident while the site is connected. This is
 * simple and predictable for the initial live-token test, but DO duration
 * usage should be watched in the Cloudflare dashboard.
 */
export class KaijuRelay extends DurableObject<Env> {
  private upstream: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private status: RelayStatus = "offline";
  private readonly clients = new Set<WebSocket>();
  private readonly seenSignatures = new Set<string>();
  private readonly signatureOrder: string[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  // Diagnostics shown on /health so we can see what PumpPortal actually sends.
  private stats = {
    connectedAt: 0,
    messagesReceived: 0,
    tradesForwarded: 0,
    otherMintMessages: 0,
    lastMessageAt: 0,
    lastTradeAt: 0,
  };
  /** Recent non-trade messages from PumpPortal (subscription replies, errors). */
  private notes: { at: string; text: string }[] = [];

  private mint(): string {
    return this.env.KAIJU_MINT?.trim() || "";
  }

  private note(text: string): void {
    this.notes.unshift({ at: new Date().toISOString(), text: text.slice(0, 300) });
    if (this.notes.length > MAX_NOTES) this.notes.length = MAX_NOTES;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const ago = (t: number) => (t ? `${Math.round((Date.now() - t) / 1000)}s ago` : "never");
      return Response.json({
        ok: true,
        status: this.status,
        upstreamConnected: this.upstream?.readyState === WebSocket.OPEN,
        mint: this.mint() || null,
        clients: this.openClientCount(),
        apiKeySet: Boolean(this.env.PUMPPORTAL_API_KEY?.trim()),
        upstreamConnectedFor: this.stats.connectedAt ? ago(this.stats.connectedAt).replace(" ago", "") : "not connected",
        messagesReceived: this.stats.messagesReceived,
        tradesForwarded: this.stats.tradesForwarded,
        otherMintMessages: this.stats.otherMintMessages,
        lastMessage: ago(this.stats.lastMessageAt),
        lastTrade: ago(this.stats.lastTradeAt),
        pumpPortalNotes: this.notes,
      });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response(
        "Kaiju City live trade relay. Connect with a WebSocket or open /health.",
        { status: 426, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Standard accept keeps this Durable Object active for the life of the
    // browser connection, so its outbound PumpPortal socket remains managed.
    server.accept();
    this.clients.add(server);
    server.addEventListener("close", () => this.handleClientDisconnect(server));
    server.addEventListener("error", () => this.handleClientDisconnect(server));

    this.sendToSocket(server, { type: "status", status: this.status });
    this.connectUpstream();
    this.startHeartbeat();

    return new Response(null, { status: 101, webSocket: client });
  }

  private openClientCount(): number {
    return [...this.clients].filter((socket) => socket.readyState === WebSocket.OPEN).length;
  }

  private sendToSocket(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.warn("[kaiju-relay] Could not send to a browser socket:", error);
    }
  }

  private broadcast(payload: Record<string, unknown>): void {
    const encoded = JSON.stringify(payload);
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(encoded);
      } catch (error) {
        console.warn("[kaiju-relay] Browser socket send failed:", error);
      }
    }
  }

  private setStatus(status: RelayStatus): void {
    this.status = status;
    this.broadcast({ type: "status", status });
  }

  private connectUpstream(): void {
    if (this.openClientCount() === 0) return;

    const mint = this.mint();
    const apiKey = this.env.PUMPPORTAL_API_KEY?.trim() || "";

    if (!BASE58_MINT_PATTERN.test(mint) || !apiKey) {
      console.warn("[kaiju-relay] Missing or invalid KAIJU_MINT / PUMPPORTAL_API_KEY.");
      this.setStatus("needs-config");
      return;
    }

    if (
      this.upstream &&
      (this.upstream.readyState === WebSocket.CONNECTING ||
        this.upstream.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus("connecting");

    const endpoint = `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(apiKey)}`;
    let socket: WebSocket;

    try {
      socket = new WebSocket(endpoint);
    } catch (error) {
      console.error("[kaiju-relay] Could not create PumpPortal socket:", error);
      this.upstream = null;
      this.setStatus("offline");
      this.scheduleReconnect();
      return;
    }

    this.upstream = socket;

    socket.addEventListener("open", () => {
      if (this.upstream !== socket) {
        socket.close(1000, "Superseded relay connection");
        return;
      }

      this.reconnectAttempt = 0;
      this.stats.connectedAt = Date.now();
      this.note("Connected to PumpPortal, subscription sent.");
      console.log(`[kaiju-relay] PumpPortal connected. Subscribing to ${mint}.`);

      try {
        socket.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
        this.setStatus("live");
      } catch (error) {
        console.error("[kaiju-relay] Subscription failed:", error);
        socket.close(1011, "Subscription failed");
      }
    });

    socket.addEventListener("message", (message: MessageEvent) => {
      if (this.upstream !== socket) return;
      this.handlePumpPortalMessage(message.data);
    });

    socket.addEventListener("error", (error) => {
      console.error("[kaiju-relay] PumpPortal WebSocket error:", error);
      // Force the close handler to perform the normal reconnect path.
      try {
        socket.close(1011, "PumpPortal socket error");
      } catch {
        // The close event may already be in progress.
      }
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      if (this.upstream !== socket) return;
      console.warn(`[kaiju-relay] PumpPortal closed (${event.code}): ${event.reason}`);
      this.note(`PumpPortal closed the connection (code ${event.code})${event.reason ? `: ${event.reason}` : ""}`);
      this.stats.connectedAt = 0;
      this.upstream = null;
      this.setStatus("offline");
      this.scheduleReconnect();
    });
  }

  private handlePumpPortalMessage(raw: unknown): void {
    let event: PumpPortalEvent;
    try {
      const decoded = typeof raw === "string" ? raw : String(raw);
      const parsed: unknown = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      event = parsed as PumpPortalEvent;
    } catch {
      const text = typeof raw === "string" ? raw : "[binary message]";
      console.warn("[kaiju-relay] Non-JSON PumpPortal message:", text);
      this.note(`Non-JSON: ${text}`);
      return;
    } finally {
      this.stats.messagesReceived += 1;
      this.stats.lastMessageAt = Date.now();
    }

    // Anything without a trade side is a control message (subscription reply,
    // error, rate-limit notice). Keep it visible on /health and in the logs.
    const side = String(event.txType ?? event.side ?? "").toLowerCase();
    if (side !== "buy" && side !== "sell") {
      const text = JSON.stringify(event);
      console.log("[kaiju-relay] PumpPortal message:", text);
      this.note(text);
      return;
    }

    // Never forward trades from another mint, even if the upstream sends one.
    if (String(event.mint ?? "").trim() !== this.mint()) {
      this.stats.otherMintMessages += 1;
      return;
    }

    const traderPublicKey = String(event.traderPublicKey ?? event.wallet ?? "").trim();
    if (!traderPublicKey) return;

    let solAmount = finiteNumber(event.solAmount);
    if (solAmount === null) {
      const quoteAmount = finiteNumber(event.quoteAmount);
      const quoteMint = String(event.quoteMint ?? "");
      // Only treat quoteAmount as SOL when the quote mint is wrapped SOL.
      if (quoteAmount !== null && quoteMint === WRAPPED_SOL_MINT) {
        solAmount = quoteAmount;
      }
    }

    if (solAmount === null || solAmount <= 0) return;

    const signature = typeof event.signature === "string" ? event.signature : undefined;
    if (signature) {
      if (this.seenSignatures.has(signature)) return;
      this.seenSignatures.add(signature);
      this.signatureOrder.push(signature);
      if (this.signatureOrder.length > MAX_SEEN_SIGNATURES) {
        const oldest = this.signatureOrder.shift();
        if (oldest) this.seenSignatures.delete(oldest);
      }
    }

    const tokenAmount = finiteNumber(event.tokenAmount ?? event.baseAmount) ?? 0;
    const marketCapSol = finiteNumber(event.marketCapSol ?? event.marketCapQuote) ?? 0;

    this.stats.tradesForwarded += 1;
    this.stats.lastTradeAt = Date.now();
    console.log(`[kaiju-relay] ${side} ${solAmount} SOL by ${traderPublicKey}`);
    this.broadcast({
      type: "trade",
      id: signature || crypto.randomUUID(),
      txType: side,
      traderPublicKey,
      solAmount,
      tokenAmount,
      marketCapSol,
      signature,
      timestamp: normalizeTimestamp(event.timestamp),
    });
  }

  private scheduleReconnect(): void {
    if (this.openClientCount() === 0 || this.reconnectTimer) return;

    const exponential = Math.min(30_000, 1_500 * 2 ** this.reconnectAttempt);
    const jitter = Math.floor(Math.random() * 500);
    const delay = exponential + jitter;
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectUpstream();
    }, delay);
  }

  /** Keeps idle browser connections alive while the token is quiet. */
  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (this.openClientCount() === 0) return;
      this.broadcast({ type: "ping", t: Date.now() });
    }, HEARTBEAT_MS);
  }

  private handleClientDisconnect(client: WebSocket): void {
    this.clients.delete(client);
    if (this.openClientCount() > 0) return;

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const previous = this.upstream;
    this.upstream = null;
    if (previous && previous.readyState < WebSocket.CLOSING) {
      try {
        previous.close(1000, "No Kaiju City viewers connected");
      } catch {
        // Ignore a socket that is already closing.
      }
    }

    this.status = "offline";
  }
}