# Bias Desk — backend

A small, free-tier-only backend that fetches live market data and news from
Finnhub, caches it in memory, and serves it as clean JSON. It does **not**
call any AI model or store any of your data — it's just a proxy with a cache.

Prices for NQ and SPX are approximated with their tracking ETFs (QQQ and SPY)
because no free provider gives real CME futures or raw index ticks. Good
enough for a bias read; not for anything execution-critical. See "Upgrading
later" below if you ever want the real thing.

## What this needs, and where it's free

| Piece | Provider | Cost | Why |
|---|---|---|---|
| Prices (NQ/SPX via ETF proxy, XAUUSD) | Finnhub | Free (personal/non-commercial tier) | One key covers stocks, forex, and news |
| News | Finnhub | Free (same key) | Bundled with the same account |
| Economic calendar | Finnhub | Free (same key) | Bundled with the same account |
| Hosting | Render.com | Free web service | Sleeps after 15 min idle — first request after that takes ~30–60s to wake up. Fine for personal use. |

No credit card required anywhere in this list, and no Anthropic/Claude API
key needed here — the AI bias scoring happens inside the dashboard artifact
itself, which already has free access to Claude for that (same way your
journal's AI analysis works).

## Setup

### 1. Get a free Finnhub key (~2 minutes)
1. Go to https://finnhub.io/register and sign up (no card).
2. Confirm your email — your API key appears on your dashboard immediately.
3. Keep that key private. Don't paste it into a chat, a public repo, or
   anywhere else — you'll enter it directly into Render in step 3.

### 2. Push this folder to a GitHub repo
Render deploys from a Git repo. Create a new repo (public or private, either
is fine) and push everything in this `backend/` folder to it.

### 3. Deploy to Render (~3 minutes)
1. Go to https://dashboard.render.com and sign up (no card for the free tier).
2. Click **New +** → **Web Service**, connect the repo you just pushed.
3. Render should auto-detect `render.yaml`. If asked, confirm:
   - Build command: `npm install`
   - Start command: `npm start`
4. When prompted for `FINNHUB_API_KEY`, paste the key from step 1 — this
   goes straight into Render's encrypted environment variable store, not
   into your code.
5. Click **Deploy**. After the build finishes you'll get a URL like
   `https://bias-desk-backend.onrender.com`.

### 4. Confirm it's alive
Visit `https://your-app.onrender.com/api/health` — you should see `{"ok":true}`.
Then try `/api/quotes`, `/api/news`, and `/api/calendar` to confirm real data
comes back.

## What to hand back to me

Just the deployed URL (e.g. `https://bias-desk-backend.onrender.com`) —
**not** the Finnhub key itself. I'll point the dashboard artifact's Overview
and News pages at that URL instead of the mock data. The key stays only in
Render's environment variables, where it belongs.

## Optional: keep it from sleeping

Render's free tier spins down after 15 minutes with no traffic. For a
personal dashboard this is usually fine — you just eat one slow load per
session. If it bugs you, a free account at https://uptimerobot.com pinging
`/api/health` every 5–10 minutes will keep it warm. Not required.

## Upgrading later

If you ever want real CME futures ticks for NQ instead of the QQQ proxy, or
need to remove the "personal use only" ceiling on Finnhub, the next steps
would be:
- Databento or CME direct for real futures data (paid, usage-based)
- Finnhub's paid tier, or Polygon.io, to remove the non-commercial
  restriction if you ever monetize this
- A paid Render instance (or Fly.io/Railway) to remove the cold-start sleep

None of that is needed to use this yourself — it only matters if this ever
becomes a product other people pay for.
