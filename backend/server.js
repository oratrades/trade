// Bias Desk — market data backend
//
// This server does exactly one job: fetch prices/news/calendar from Finnhub,
// cache them briefly in memory, and hand back clean JSON. It does NOT call
// any AI model — the bias scoring happens in the frontend artifact itself,
// which already has free access to the Claude API for that (see the journal
// AI analysis feature — same mechanism).
//
// Requires: FINNHUB_API_KEY (free, personal/non-commercial tier at finnhub.io)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors()); // wide open on purpose — this only serves public market data, nothing user-specific

const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE = "https://finnhub.io/api/v1";

if (!FINNHUB_KEY) {
  console.warn("⚠️  FINNHUB_API_KEY is not set. /api/quotes, /api/news and /api/calendar will fail until it is.");
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

async function finnhub(path) {
  const url = `${FINNHUB_BASE}${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${path} failed: ${res.status}`);
  return res.json();
}

// Symbols we track. NQ and SPX are approximated with liquid ETFs since no
// free provider gives real CME futures / raw index ticks — see README.
const SYMBOL_MAP = {
  NQ: { finnhubSymbol: "QQQ", kind: "stock", label: "Nasdaq 100 (QQQ proxy)" },
  SPX: { finnhubSymbol: "SPY", kind: "stock", label: "S&P 500 (SPY proxy)" },
  XAUUSD: { finnhubSymbol: "OANDA:XAU_USD", kind: "forex", label: "Gold Spot / USD" },
};

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/quotes", async (req, res) => {
  try {
    const data = await withCache("quotes", 30_000, async () => {
      const entries = await Promise.all(
        Object.entries(SYMBOL_MAP).map(async ([key, meta]) => {
          const q = await finnhub(`/quote?symbol=${encodeURIComponent(meta.finnhubSymbol)}`);
          return [key, {
            symbol: key,
            label: meta.label,
            price: q.c,
            change: q.d,
            changePercent: q.dp,
            high: q.h,
            low: q.l,
            prevClose: q.pc,
            updatedAt: new Date().toISOString(),
          }];
        })
      );
      return Object.fromEntries(entries);
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to fetch quotes", detail: String(err.message || err) });
  }
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

app.get("/api/calendar", async (req, res) => {
  try {
    const data = await withCache("calendar", 60 * 60_000, async () => {
      const today = new Date();
      const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const result = await finnhub(`/calendar/economic?from=${fmt(today)}&to=${fmt(in7)}`);
      const events = (result.economicCalendar || [])
        .filter((e) => e.country === "US" && (e.impact === "high" || e.impact === "medium"))
        .map((e) => ({
          time: e.time,
          name: e.event,
          impact: e.impact,
          actual: e.actual,
          estimate: e.estimate,
          prev: e.prev,
        }));
      return events;
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to fetch calendar", detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Bias Desk backend listening on port ${PORT}`);
});
