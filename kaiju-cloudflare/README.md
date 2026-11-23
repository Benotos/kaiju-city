# Kaiju City live trade relay (Cloudflare Worker)

Streams one token's buys and sells to the Kaiju City site. It reads from **three independent sources at once** and de-duplicates by transaction signature, so the city keeps moving if any one provider goes down:

| Source | What it is | Needs |
| --- | --- | --- |
| `chain` | Reads pump.fun / PumpSwap trade events straight from Solana (`logsSubscribe`) | Nothing (uses the public RPC). Optional `SOLANA_WS_URL` secret for a faster, more reliable RPC such as Helius |
| `pumpdev` | PumpDev's free WebSocket feed | Nothing |
| `pumpportal` | PumpPortal's WebSocket feed | Nothing for pump.fun tokens. Optional `PUMPPORTAL_API_KEY` secret for PumpSwap data |

Upstream connections open when the first visitor arrives and close when the last one leaves.

## Deploy

From this folder:

```bash
npm install
npx wrangler login        # first time only
npm run deploy
```

The token is set by `KAIJU_MINT` in `wrangler.jsonc`.

## Optional secrets (recommended for launch)

A dedicated RPC is the most reliable source. Create a free Helius account, copy your mainnet **WebSocket** URL (`wss://mainnet.helius-rpc.com/?api-key=...`), then:

```bash
npx wrangler secret put SOLANA_WS_URL
```

PumpPortal key (only if you want PumpPortal's PumpSwap data):

```bash
npx wrangler secret put PUMPPORTAL_API_KEY
```

Never put keys in `wrangler.jsonc`, the Next.js app, Vercel, or any `NEXT_PUBLIC_` variable.

To run only some sources, set a `SOURCES` var, e.g. `"SOURCES": "chain,pumpdev"`.

## Check it

Open `https://<your-worker>.workers.dev/health` while the site is open. You'll see each source's status, how many messages and trades it has delivered, its last error, and recent notes.

## Test with another token

```bash
npx wrangler deploy --var KAIJU_MINT:<mint>
```

A plain `npm run deploy` switches back to the mint in `wrangler.jsonc`.