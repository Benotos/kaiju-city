import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || process.env.RELAY_PORT || 8787);
const MINT = (process.env.KAIJU_MINT || "").trim();
const API_KEY = (process.env.PUMPPORTAL_API_KEY || "").trim();
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MAX_REMEMBERED_SIGNATURES = 10_000;

type RelayStatus = "connecting" | "live" | "offline" | "needs-config";

type PumpPortalTrade = Record<string, unknown> & {
  mint?: unknown;
  txType?: unknown;
  side?: unknown;
  traderPublicKey?: unknown;
  wallet?: unknown;
  solAmount?: unknown;
  quoteAmount?: unknown;
  quoteMint?: unknown;
  tokenAmount?: unknown;
  baseAmount?: unknown;
  marketCapSol?: unknown;
  marketCapQuote?: unknown;
  signature?: unknown;
  timestamp?: unknown;
};

const clients = new Set<WebSocket>();
const seenSignatures = new Set<string>();

let upstream: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let shuttingDown = false;
let upstreamStatus: RelayStatus = "connecting";

function isBase58Address(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
    }

    const parsedDate = Date.parse(value);
    return Number.isFinite(parsedDate) ? parsedDate : Date.now();
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value < 1_000_000_000_000 ? value * 1000 : value);
  }

  return Date.now();
}

function sendToClients(payload: Record<string, unknown>) {
  const encoded = JSON.stringify(payload);

  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    try {
      client.send(encoded);
    } catch (error) {
      console.warn("[relay] Could not send to a browser client:", error);
      clients.delete(client);
    }
  }
}

function setStatus(status: RelayStatus) {
  upstreamStatus = status;
  sendToClients({
    type: "status",
    status,
    mint: MINT || null,
    provider: "pumpportal",
  });
}

function rememberSignature(signature: string): boolean {
  if (seenSignatures.has(signature)) return false;

  seenSignatures.add(signature);
  if (seenSignatures.size > MAX_REMEMBERED_SIGNATURES) {
    const oldest = seenSignatures.values().next().value;
    if (oldest) seenSignatures.delete(oldest);
  }

  return true;
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;

  const backoff = Math.min(30_000, 1_500 * 2 ** reconnectAttempt++);
  const jitter = Math.floor(Math.random() * 500);
  const delay = backoff + jitter;

  console.warn(`[relay] Reconnecting in ${delay}ms.`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectUpstream();
  }, delay);
}

function handleTrade(event: PumpPortalTrade) {
  // PumpPortal's token-trade subscription is mint-scoped. Keep this strict so
  // a message for another token can never affect this city's trade feed.
  if (typeof event.mint !== "string" || event.mint !== MINT) return;

  const txType = String(event.txType || event.side || "").toLowerCase();
  if (txType !== "buy" && txType !== "sell") return;

  const traderPublicKey = String(event.traderPublicKey || event.wallet || "").trim();
  if (!traderPublicKey) return;

  const quoteMint = typeof event.quoteMint === "string" ? event.quoteMint : "";
  const isSolQuoted = quoteMint === WSOL_MINT;

  // solAmount is PumpPortal's SOL-denominated amount. quoteAmount is only a
  // valid fallback when the quote asset is wrapped SOL; never label another
  // quote asset as SOL in the website UI.
  const solAmount = finiteNonNegative(event.solAmount)
    ?? (isSolQuoted ? finiteNonNegative(event.quoteAmount) : null);

  if (solAmount === null || solAmount <= 0) {
    console.warn("[relay] Ignored trade with no valid SOL amount.");
    return;
  }

  const tokenAmount = finiteNonNegative(event.tokenAmount ?? event.baseAmount) ?? 0;
  const marketCapSol = finiteNonNegative(event.marketCapSol)
    ?? (isSolQuoted ? finiteNonNegative(event.marketCapQuote) : null)
    ?? 0;

  const signature = typeof event.signature === "string" && event.signature.trim() !== ""
    ? event.signature.trim()
    : undefined;

  if (signature && !rememberSignature(signature)) return;

  sendToClients({
    type: "trade",
    id: signature || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    txType,
    traderPublicKey,
    solAmount,
    tokenAmount,
    marketCapSol,
    signature,
    timestamp: normalizeTimestamp(event.timestamp),
    source: "live",
    mint: MINT,
  });
}

const httpServer = createServer((request, response) => {
  const pathname = request.url?.split("?")[0];

  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      status: upstreamStatus,
      upstreamConnected: upstream?.readyState === WebSocket.OPEN,
      mint: MINT || null,
      clients: clients.size,
    }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Kaiju City live Solana trade relay\n");
});

const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false });

wss.on("connection", (client) => {
  clients.add(client);
  client.send(JSON.stringify({
    type: "status",
    status: upstreamStatus,
    mint: MINT || null,
    provider: "pumpportal",
  }));

  client.on("close", () => clients.delete(client));
  client.on("error", () => clients.delete(client));
});

function connectUpstream() {
  if (shuttingDown) return;

  if (!MINT || !isBase58Address(MINT) || !API_KEY) {
    const missing = [
      !MINT || !isBase58Address(MINT) ? "KAIJU_MINT (valid Solana mint address)" : null,
      !API_KEY ? "PUMPPORTAL_API_KEY" : null,
    ].filter(Boolean).join(", ");

    console.error(`[relay] Missing or invalid configuration: ${missing}.`);
    setStatus("needs-config");
    return;
  }

  setStatus("connecting");
  const url = `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(API_KEY)}`;
  console.log(`[relay] Connecting to PumpPortal for mint ${MINT}.`);

  const socket = new WebSocket(url);
  upstream = socket;

  connectTimeout = setTimeout(() => {
    if (socket.readyState === WebSocket.CONNECTING) {
      console.error("[relay] PumpPortal connection timed out.");
      socket.terminate();
    }
  }, 15_000);

  socket.on("open", () => {
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }

    reconnectAttempt = 0;
    socket.send(JSON.stringify({
      method: "subscribeTokenTrade",
      keys: [MINT],
    }));

    setStatus("live");
    console.log(`[relay] Subscribed to token trades for ${MINT}.`);
  });

  socket.on("message", (raw) => {
    let event: PumpPortalTrade;

    try {
      event = JSON.parse(raw.toString()) as PumpPortalTrade;
    } catch {
      console.warn("[relay] Ignored a non-JSON PumpPortal message.");
      return;
    }

    handleTrade(event);
  });

  socket.on("error", (error) => {
    console.error("[relay] PumpPortal WebSocket error:", error.message);
  });

  socket.on("close", (code, reason) => {
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }

    if (upstream === socket) upstream = null;

    console.warn(`[relay] PumpPortal connection closed (${code}): ${reason.toString()}`);
    if (shuttingDown) return;

    setStatus("offline");
    scheduleReconnect();
  });
}

httpServer.listen(PORT, () => {
  console.log(`[relay] WebSocket relay listening on :${PORT}.`);
  connectUpstream();
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (connectTimeout) clearTimeout(connectTimeout);

  upstream?.close(1000, "relay shutting down");
  for (const client of clients) client.close(1001, "relay shutting down");

  wss.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
