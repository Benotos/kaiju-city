# Kaiju City

A browser-based 3D Solana trading city. Buys add wallet-tagged towers; sells trigger the kaiju to flatten a tower. The interface runs in demo mode out of the box and can connect to a separate PumpPortal relay for real token trades.

## What's included

- Next.js App Router + TypeScript app
- Three.js city scene using React Three Fiber
- Procedural low-poly kaiju character, animated skyline, roof wallet tags, orbit controls and wallet camera focus
- Demo trade generator and manual **SIM BUY / SIM SELL** controls
- Live trade feed client
- Separate Node WebSocket relay so the PumpPortal API key is not exposed in the browser
- Responsive dashboard UI and optional synthesized buy/sell sound effects

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The example environment keeps `NEXT_PUBLIC_TRADE_RELAY_URL` blank, so the site starts in demo mode.

## Enable the real Solana trade feed

1. Create a PumpPortal Data API key and configure the linked wallet as required by PumpPortal.
2. For local testing, add `KAIJU_MINT`, `PUMPPORTAL_API_KEY`, and `NEXT_PUBLIC_TRADE_RELAY_URL=ws://localhost:8787` to `.env.local`. Start `npm run relay` in one terminal and `npm run dev` in another.
3. For production, deploy the relay service separately from the Next.js frontend. Railway is configured with `railway.toml`; any persistent Node host that supports WebSockets also works.
4. Set these **server-only** relay variables on the relay host:

   ```env
   KAIJU_MINT=YOUR_SOLANA_TOKEN_MINT
   PUMPPORTAL_API_KEY=YOUR_PUMPPORTAL_API_KEY
   RELAY_PORT=8787
   ```

5. Set this variable on the Next.js frontend host:

   ```env
   NEXT_PUBLIC_TRADE_RELAY_URL=wss://YOUR-RELAY-HOST
   NEXT_PUBLIC_TOKEN_MINT=YOUR_SOLANA_TOKEN_MINT
   NEXT_PUBLIC_X_URL=https://x.com/YOUR_ACCOUNT
   NEXT_PUBLIC_TELEGRAM_URL=https://t.me/YOUR_GROUP
   ```

   Leave either social URL blank to hide that social link.

6. Redeploy both services. The status indicator should switch to `LIVE ON-CHAIN` when the relay has an active PumpPortal connection.

The relay uses one upstream PumpPortal WebSocket and subscribes to the configured mint with `subscribeTokenTrade`. Do not create a new upstream socket for each browser visitor. PumpPortal currently documents trade subscriptions as metered at **0.01 SOL per 10,000 trade messages**, and says a linked wallet with at least **0.02 SOL** is required. Confirm current provider terms and fees before enabling a production feed.

Provider docs: https://pumpportal.fun/data-api/real-time/ and https://pumpportal.fun/fees/

## Deployment layout

- **Frontend:** Vercel (Next.js)
- **Trade relay:** Railway or another persistent Node/WebSocket host

Vercel serverless functions are not used as the persistent upstream WebSocket process. The browser connects to the relay, never directly to PumpPortal, so the PumpPortal API key remains private.

## Current prototype limitations

- Demo trades are random visual events and are not market data.
- A sell flattens the seller's active tower when one exists; otherwise the largest standing tower is selected as the visual target.
- The 3D animation is illustrative. It is not a portfolio, balance, execution, or PnL display.
- Wallet-to-tower indexing is in-memory for this prototype. Add persistent event storage and historical replay before production use.
- Only the configured Solana mint is streamed. A production launch should decide whether to support PumpSwap migration, multiple pools, reconnect replay, and RPC backfill.
