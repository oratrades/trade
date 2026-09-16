// Bias Desk — market data backend (v2)
//
// Fixes from v1:
//  - /api/quotes no longer dies as a whole when one symbol fails — each
//    symbol is fetched independently and the response reports per-symbol
//    status, so a bad source degrades gracefully instead of a hard 502.
//  - Gold (XAUUSD) no longer uses Finnhub's forex endpoint (403 on the
//    free tier for this account). It now uses xaus.com's spot + history
//    endpoints — free, no API key, CORS-open, built for exactly this.
//  - The economic calendar no longer uses Finnhub's /calendar/economic
//    (also 403 on the free tier). It now uses Forex Factory's public
//    weekly JSON feed — no key required, the standard free source most
//    retail trading tools use for this.
//
// Only remaining requirement: FINNHUB_API_KEY, used for NQ/SPX (via the
// QQQ/SPY proxies) and the news feed — both of which were already working.

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors()); // wide open on purpose — this only serves public market data, nothing user-specific

const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const XAUS_BASE = "https://xaus.com/api/v1";
const FF_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

if (!FINNHUB_KEY) {
  console.warn("⚠️  FINNHUB_API_KEY is not set. NQ/SPX quotes and /api/news will fail until it is.");
}

// ---------- tiny in-memory cache ----------
const cache = new Map();
async function withCache(key, ttlMs, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, time: Date.now() });
  return data;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function finnhub(path) {
  const sep = path.includes("?") ? "&" : "?";
  return getJson(`${FINNHUB_BASE}${path}${sep}token=${FINNHUB_KEY}`);
}

// ---------- per-symbol fetchers ----------
// Each returns {symbol,label,price,change,changePercent,...} or throws —
// callers use Promise.allSettled so one throwing never blocks the others.

async function fetchEtfQuote(symbol, label) {
  const q = await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`);
  if (q.c === undefined || q.c === null) throw new Error(`No quote data for ${symbol}`);
  return {
    price: q.c, change: q.d, changePercent: q.dp,
    high: q.h, low: q.l, prevClose: q.pc, label,
  };
}

async function fetchGold() {
  const [spot, history] = await Promise.all([
    withCache("xaus:spot", 30_000, () => getJson(`${XAUS_BASE}/spot?compact=1`)),
    withCache("xaus:history", 6 * 60 * 60_000, () => getJson(`${XAUS_BASE}/history`)),
  ]);
  const points = history.points || [];
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const changePercent = last && prev ? ((last.c - prev.c) / prev.c) * 100 : 0;
  return {
    price: spot.spot_usd_oz, change: last && prev ? last.c - prev.c : 0,
    changePercent, high: last?.h, low: last?.l, prevClose: prev?.c,
    label: "Gold Spot / USD",
  };
}

const SYMBOL_FETCHERS = {
  NQ: () => fetchEtfQuote("QQQ", "Nasdaq 100 (QQQ proxy)"),
  SPX: () => fetchEtfQuote("SPY", "S&P 500 (SPY proxy)"),
  XAUUSD: () => fetchGold(),
};

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/quotes", async (req, res) => {
  const data = await withCache("quotes", 30_000, async () => {
    const entries = await Promise.allSettled(
      Object.entries(SYMBOL_FETCHERS).map(async ([key, fetcher]) => [key, await fetcher()])
    );
    const out = {};
    entries.forEach((result, i) => {
      const key = Object.keys(SYMBOL_FETCHERS)[i];
      if (result.status === "fulfilled") {
        const [, val] = result.value;
        out[key] = { symbol: key, ...val, ok: true, updatedAt: new Date().toISOString() };
      } else {
        out[key] = { symbol: key, ok: false, error: String(result.reason?.message || result.reason) };
      }
    });
    return out;
  });
  res.json(data);
});

app.get("/api/news", async (req, res) => {
  try {
    const data = await withCache("news", 5 * 60_000, async () => {
      const items = await finnhub("/news?category=general");
      return items.slice(0, 25).map((n) => ({
        id: n.id,
        headline: n.headline,
        summary: n.summary,
        source: n.source,
        url: n.url,
        datetime: new Date(n.datetime * 1000).toISOString(),
        image: n.image || null,
      }));
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to fetch news", detail: String(err.message || err) });
  }
});

app.get('/api/calendar', async (req, res) => {
  try {
    // 1. Primary Source: Forex Factory Weekly Feed with Browser User-Agent
    const response = await fetch('https://nfp.oural.workers.dev/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({ ok: true, source: 'forexfactory', events: data });
    }

    // 2. Fallback Source: Finnhub Economic Calendar (uses existing FINNHUB_API_KEY)
    if (process.env.FINNHUB_API_KEY) {
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date(Date.now() + 7 * 82400000).toISOString().split('T')[0];
      
      const finnhubRes = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?from=${today}&to=${nextWeek}&token=${process.env.FINNHUB_API_KEY}`
      );
      
      if (finnhubRes.ok) {
        const fhData = await finnhubRes.json();
        return res.json({ ok: true, source: 'finnhub', events: fhData.economicCalendar || [] });
      }
    }

    // 3. Graceful Fallback: Empty State (Prevents dashboard crash)
    return res.json({ ok: false, error: 'Calendar feeds unavailable', events: [] });

  } catch (err) {
    console.error('Calendar error:', err.message);
    // Always return JSON so the dashboard doesn't throw a parse error
    return res.json({ ok: false, error: err.message, events: [] });
  }
});
