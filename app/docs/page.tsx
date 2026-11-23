import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: "Docs — Stomp City",
  description: "How Stomp City works: one tower per holder, buys build, sells wake the kaiju.",
};

const MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
const X_URL = process.env.NEXT_PUBLIC_X_URL || "";
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "towers", label: "Towers & holders" },
  { id: "kaiju", label: "The kaiju" },
  { id: "find-your-tower", label: "Find your tower" },
  { id: "live-data", label: "Live data" },
  { id: "token", label: "Token" },
  { id: "faq", label: "FAQ" },
  { id: "links", label: "Links" },
  { id: "disclaimer", label: "Disclaimer" },
];

function Brand() {
  return (
    <a className="docs-brand" href="/" aria-label="Stomp City home">
      <span className="docs-mark" aria-hidden>
        <svg viewBox="0 0 40 40">
          <rect x="4" y="16" width="7" height="20" rx="1" />
          <rect x="13" y="6" width="8" height="30" rx="1" />
          <rect x="23" y="12" width="6" height="24" rx="1" />
          <rect x="31" y="20" width="5" height="16" rx="1" />
        </svg>
      </span>
      <b>
        STOMP<i>/</i>CITY
      </b>
      <span className="docs-tag">DOCS</span>
    </a>
  );
}

export default function Docs() {
  return (
    <div className="docs">
      <header className="docs-top">
        <Brand />
        <nav aria-label="Docs navigation" className="docs-top-links">
          <a href="/">Open the city</a>
          {X_URL && (
            <a href={X_URL} target="_blank" rel="noreferrer">
              X
            </a>
          )}
          {TELEGRAM_URL && (
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
              Telegram
            </a>
          )}
        </nav>
      </header>

      <div className="docs-body">
        <aside className="docs-side">
          <p className="docs-side-title">ON THIS PAGE</p>
          <nav aria-label="Sections">
            {SECTIONS.map((s, i) => (
              <a key={s.id} href={`#${s.id}`}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="docs-main">
          <section id="overview" className="docs-hero">
            <p className="docs-kicker">DOCUMENTATION</p>
            <h1>
              Every trade <em>leaves a mark.</em>
            </h1>
            <p className="docs-lead">
              Stomp City is a living 3D city built from a Solana token&apos;s on-chain activity. Every holder gets a tower, sized by how
              much they hold. Buys make towers grow. Sells wake the kaiju, who stomps the seller&apos;s tower. The skyline is the holder list,
              drawn as a city, updating in real time.
            </p>
            <div className="docs-cards">
              <div className="docs-card">
                <b>One tower per holder</b>
                <span>The bigger the bag, the taller the tower. The top holder owns the tallest building.</span>
              </div>
              <div className="docs-card">
                <b className="up">Buys build</b>
                <span>A new holder&apos;s tower rises from the ground. Existing holders&apos; towers grow taller.</span>
              </div>
              <div className="docs-card">
                <b className="down">Sells stomp</b>
                <span>The kaiju walks to the seller&apos;s tower and attacks it. Sell out and it falls.</span>
              </div>
            </div>
          </section>

          <section id="how-it-works">
            <h2>How it works</h2>
            <ol className="docs-steps">
              <li>
                <b>Read the chain.</b> A relay reads every holder&apos;s balance of the token straight from Solana and refreshes it about
                every minute.
              </li>
              <li>
                <b>Build the city.</b> Each holder wallet becomes one tower on its own lot. The largest holders sit in the centre and form
                the high-rise core; smaller holders spread out into the districts around it.
              </li>
              <li>
                <b>Watch live trades.</b> Buys and sells stream in as they happen and change the city instantly: towers rise, grow, get hit
                or collapse.
              </li>
              <li>
                <b>Stay in sync.</b> The next on-chain refresh corrects every height to the exact balance, so the city always matches the
                real holder list.
              </li>
            </ol>
          </section>

          <section id="towers">
            <h2>Towers &amp; holders</h2>
            <h3>Height</h3>
            <p>
              Tower height follows each wallet&apos;s balance and rank. A bigger balance is always a taller tower, so the skyline reads like
              the holder leaderboard: the tallest building is the top holder, the lowest buildings are the smallest bags.
            </p>
            <h3>Architecture</h3>
            <p>
              Towers come in several building styles: setback slabs, round towers with domes, hex towers with pyramid roofs, needles with
              spires, stepped towers and twin towers. The top holders get the most detailed buildings, with neon trims and rooftop beacons.
            </p>
            <h3>Wallet tags</h3>
            <p>
              The top holders always carry a wallet tag above their roof. Every tower near the camera shows its tag too, so wherever you
              fly, the buildings around you are labelled. Tap any tower to see its wallet, rank and share of supply.
            </p>
            <h3>Who is not a holder</h3>
            <p>
              Addresses that aren&apos;t people are left out of the city: liquidity pools, the pump.fun bonding curve, burn addresses and
              other program-controlled vaults. That way the &quot;top holder&quot; is always a real wallet.
            </p>
            <h3>Ruins</h3>
            <p>Holders who sell their whole bag leave burning ruins behind. If they buy back in, their tower is rebuilt.</p>
          </section>

          <section id="kaiju">
            <h2>The kaiju</h2>
            <p>
              The kaiju prowls the edge of the city. When a sell lands, it charges to the seller&apos;s tower, sometimes leaping across the
              skyline, and stomps it. The bigger the sell, the bigger the hit: shockwaves, debris, fire and, on heavy sells, an atomic
              breath.
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Sell</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Partial sell</td>
                  <td>The tower is hit and loses floors in proportion to what was sold.</td>
                </tr>
                <tr>
                  <td>Sell everything</td>
                  <td>The tower collapses into smoking ruins.</td>
                </tr>
                <tr>
                  <td>Seller not in the city</td>
                  <td>The kaiju roars, but there&apos;s nothing to stomp.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="find-your-tower">
            <h2>Find your tower</h2>
            <p>
              Paste your wallet address into <b>Find your tower</b> on the home page. Suggestions appear as you type, with each wallet&apos;s
              rank and share of supply. Pick yours and the camera flies straight to your building.
            </p>
            <p>
              The city draws up to 1,600 towers. If you hold but sit outside that range, the search still finds you and tells you your
              exact rank.
            </p>
            <h3>Controls</h3>
            <ul>
              <li>Drag to orbit, scroll or pinch to zoom.</li>
              <li>Tap a tower to focus it.</li>
              <li>
                <b>Reset view</b> flies back to the full skyline.
              </li>
            </ul>
          </section>

          <section id="live-data">
            <h2>Live data</h2>
            <p>
              Trades are read from several independent sources at the same time, including the Solana chain itself, and duplicates are
              removed by transaction signature. If one source goes down, the city keeps moving on the others.
            </p>
            <p>
              Recent trades are kept, so the feed is never empty when you open or reload the page. Each live trade in the feed links to
              its transaction on Solscan.
            </p>
            <p className="docs-note">
              The city is a visualization of on-chain activity. It is not a price feed, a portfolio tracker or financial data.
            </p>
          </section>

          <section id="token">
            <h2>Token</h2>
            <dl className="docs-facts">
              <div>
                <dt>Ticker</dt>
                <dd>[TICKER]</dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>Solana</dd>
              </div>
              <div>
                <dt>Contract address</dt>
                <dd className="mono">{MINT || "[CONTRACT ADDRESS]"}</dd>
              </div>
              <div>
                <dt>Total supply</dt>
                <dd>[TOTAL SUPPLY]</dd>
              </div>
              <div>
                <dt>Launch</dt>
                <dd>[LAUNCH PLATFORM / DATE]</dd>
              </div>
              <div>
                <dt>Taxes</dt>
                <dd>[BUY / SELL TAX]</dd>
              </div>
            </dl>
            <p className="docs-note">Always check the contract address against the official links before buying.</p>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <details>
              <summary>Why don&apos;t I see my tower?</summary>
              <p>
                Balances refresh about every minute, so a new buy can take a moment to show at its exact height. Search your wallet: if
                you&apos;re outside the 1,600 towers drawn, search still shows your rank.
              </p>
            </details>
            <details>
              <summary>Why is the holder count different from other sites?</summary>
              <p>
                Stomp City leaves out pools, bonding curves, burn addresses and program vaults, which some trackers count as holders.
              </p>
            </details>
            <details>
              <summary>Does the site need my wallet?</summary>
              <p>No. Stomp City only reads public on-chain data. It never asks you to connect a wallet or sign anything.</p>
            </details>
            <details>
              <summary>Does it work on mobile?</summary>
              <p>Yes. On phones the city uses a lighter rendering mode so it stays smooth.</p>
            </details>
            <details>
              <summary>Where do I buy or sell?</summary>
              <p>
                The BUY and SELL buttons on the city open the token on pump.fun. Check the contract address matches the one in the Token
                section before you trade.
              </p>
            </details>
          </section>

          <section id="links">
            <h2>Links</h2>
            <ul className="docs-links">
              <li>
                <a href="/">Website: the live city</a>
              </li>
              <li>{X_URL ? <a href={X_URL} target="_blank" rel="noreferrer">X</a> : <span>X: [LINK]</span>}</li>
              <li>{TELEGRAM_URL ? <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a> : <span>Telegram: [LINK]</span>}</li>
              <li>
                {MINT ? (
                  <a href={`https://solscan.io/token/${MINT}`} target="_blank" rel="noreferrer">
                    Token on Solscan
                  </a>
                ) : (
                  <span>Solscan: [LINK]</span>
                )}
              </li>
            </ul>
          </section>

          <section id="disclaimer">
            <h2>Disclaimer</h2>
            <p className="docs-small">
              Stomp City is an art and entertainment project that visualizes public on-chain data. Nothing on this site is financial
              advice. Crypto assets are highly volatile and you can lose everything you put in. Do your own research and never invest more
              than you can afford to lose. Stomp City never asks for private keys, seed phrases or wallet connections.
            </p>
          </section>

          <footer className="docs-foot">
            <span>STOMP/CITY</span>
            <a href="/">Back to the city →</a>
          </footer>
        </main>
      </div>
    </div>
  );
}