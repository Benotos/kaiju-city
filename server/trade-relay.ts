import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { WebSocket, WebSocketServer } from "ws";
import { createServer } from "node:http";

const PORT = Number(process.env.RELAY_PORT || 8787);
const MINT = process.env.KAIJU_MINT;
const API_KEY = process.env.PUMPPORTAL_API_KEY;
const clients = new Set<WebSocket>();
const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, upstream: upstream?.readyState === WebSocket.OPEN, clients: clients.size }));
    return;
  }
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Kaiju City trade relay\n");
});
const wss = new WebSocketServer({ server: httpServer });
let upstream: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let shuttingDown = false;
let upstreamStatus: "connecting" | "live" | "offline" | "needs-config" = "connecting";

function sendToClients(payload: Record<string, unknown>) {
  const encoded = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

wss.on("connection", (client) => {
  clients.add(client);
  client.send(JSON.stringify({ type: "status", status: upstreamStatus }));
  client.on("close", () => clients.delete(client));
  client.on("error", () => clients.delete(client));
});

function connectUpstream() {
  if (shuttingDown) return;
  if (!MINT || !API_KEY) {
    console.warn("[relay] Missing KAIJU_MINT or PUMPPORTAL_API_KEY. Relay is online but not streaming trades.");
    upstreamStatus = "needs-config";
    sendToClients({ type: "status", status: upstreamStatus });
    return;
  }

  const url = `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(API_KEY)}`;
  console.log("[relay] Connecting to PumpPortal data stream…");
  upstreamStatus = "connecting";
  sendToClients({ type: "status", status: upstreamStatus });
  upstream = new WebSocket(url);

  upstream.on("open", () => {
    reconnectAttempt = 0;
    console.log(`[relay] Connected. Subscribing to ${MINT}.`);
    upstreamStatus = "live";
    upstream?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [MINT] }));
    sendToClients({ type: "status", status: upstreamStatus });
  });

  upstream.on("message", (raw) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      console.warn("[relay] Ignored a non-JSON upstream message.");
      return;
    }

    const side = String(event.txType || event.side || "").toLowerCase();
    if (side !== "buy" && side !== "sell") return;

    const wallet = String(event.traderPublicKey || event.wallet || "");
    if (!wallet) return;

    const rawSolAmount = Number(event.solAmount ?? event.quoteAmount ?? 0);
    const solAmount = Number.isFinite(rawSolAmount) ? Math.max(0, rawSolAmount) : 0;
    const tokenAmount = Number(event.tokenAmount ?? event.baseAmount ?? 0);
    const marketCapSol = Number(event.marketCapSol ?? event.marketCapQuote ?? 0);

    sendToClients({
      type: "trade",
      id: String(event.signature || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      txType: side,
      traderPublicKey: wallet,
      solAmount,
      tokenAmount: Number.isFinite(tokenAmount) ? tokenAmount : 0,
      marketCapSol: Number.isFinite(marketCapSol) ? marketCapSol : 0,
      signature: typeof event.signature === "string" ? event.signature : undefined,
      timestamp: Date.now(),
    });
  });

  upstream.on("error", (error) => {
    console.error("[relay] Upstream websocket error:", error.message);
  });

  upstream.on("close", (code, reason) => {
    console.warn(`[relay] Upstream closed (${code}): ${reason.toString()}`);
    upstream = null;
    upstreamStatus = "offline";
    sendToClients({ type: "status", status: upstreamStatus });
    if (shuttingDown) return;
    const delay = Math.min(30_000, 1_500 * 2 ** reconnectAttempt++);
    reconnectTimer = setTimeout(connectUpstream, delay);
  });
}

httpServer.listen(PORT, () => {
  console.log(`[relay] WebSocket relay listening on :${PORT}`);
  connectUpstream();
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  upstream?.close(1000, "relay shutting down");
  for (const client of clients) client.close(1001, "relay shutting down");
  wss.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
