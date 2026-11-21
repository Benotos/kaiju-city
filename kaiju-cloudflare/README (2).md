# Kaiju City Cloudflare trade relay

This is a separate Cloudflare Worker project for Kaiju City's live Solana trade feed. It does not modify the Next.js application.

## 1. Install and sign in

From this folder, run:

```bash
npm install
npx wrangler login
```

A browser window will open so you can authorize Wrangler with your Cloudflare account.

## 2. Add the PumpPortal API key as a Cloudflare secret

Run this command and paste your API key only when Wrangler prompts you:

```bash
npx wrangler secret put PUMPPORTAL_API_KEY
```

Do not add this API key to the Next.js app, Vercel, `wrangler.jsonc`, or any `NEXT_PUBLIC_` variable.

The test mint is already set in `wrangler.jsonc`:

```text
DUZrwdjEthcJ99ZiRXr31UuqTohoTg7VjTEyfGdBpump
```

## 3. Deploy the relay

```bash
npm run deploy
```

Wrangler will print a URL similar to:

```text
https://kaiju-city-live-relay.<your-account-subdomain>.workers.dev
```

Keep that public URL. The WebSocket URL is the same address with `wss://` instead of `https://`.

## 4. Set the Vercel environment variables

In the Kaiju City Vercel project, open **Settings → Environment Variables** and add:

```text
NEXT_PUBLIC_TOKEN_MINT=DUZrwdjEthcJ99ZiRXr31UuqTohoTg7VjTEyfGdBpump
NEXT_PUBLIC_TRADE_RELAY_URL=wss://kaiju-city-live-relay.<your-account-subdomain>.workers.dev
```

Replace `<your-account-subdomain>` with the actual subdomain printed by Wrangler. Do not include `https://` in the WebSocket variable; use `wss://`.

Redeploy the Vercel site after adding the variables.

## 5. Verify

Open this URL in a browser:

```text
https://kaiju-city-live-relay.<your-account-subdomain>.workers.dev/health
```

Expected once the site has at least one viewer connected:

- `ok`: `true`
- `status`: `live`
- `upstreamConnected`: `true`
- `mint`: the test mint above
- `clients`: one or more connected browser tabs

The relay starts its PumpPortal connection when the first browser connects, and closes it after the last browser disconnects. PumpPortal provides new live events; this relay does not backfill historical trades.

## Local testing (optional)

Set the secret for local development in a `.dev.vars` file in this folder (never commit it):

```text
PUMPPORTAL_API_KEY=your_key_here
```

Then run:

```bash
npm run dev
```

The local WebSocket URL is normally `ws://localhost:8787`; the health endpoint is `http://localhost:8787/health`.

## Cost note

The client WebSockets use the standard Durable Object WebSocket API so the DO can manage the outbound PumpPortal socket reliably for the initial test. Cloudflare bills Durable Object duration while standard WebSocket connections keep an object active. Check Workers & Durable Objects usage in the Cloudflare dashboard during testing, and set an account spending limit if you enable one. Free-plan quotas are not a guarantee that sustained production traffic will remain free.
