// S&P 500 trading multiples server.
// Pulls constituents + GICS sectors from Wikipedia, market data + consensus estimates
// from Yahoo Finance, computes LTM/NTM P/E and EV/EBITDA, caches to data/multiples.json.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { companyHistory, weeklyGrid } from "./history.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(ROOT, "data", "multiples.json");
const HIST_FILE = path.join(ROOT, "data", "history.json");
const HIST_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const SNAP_DIR = path.join(ROOT, "data", "snapshots");
const PORT = Number(process.env.PORT) || 3000;
const CONCURRENCY = 6;
const STALE_MS = 24 * 60 * 60 * 1000;

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

let store = { updatedAt: null, companies: [] };
let job = { running: false, done: 0, total: 0, errors: [] };
let history = { updatedAt: null, dates: [], series: {} };
let histJob = { running: false, done: 0, total: 0, errors: [] };

// ---------- S&P 500 constituents ----------
async function fetchConstituents() {
  const res = await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
    headers: { "User-Agent": "Mozilla/5.0 (sp500-multiples app)" },
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const rows = $("table#constituents tbody tr").toArray();
  const out = [];
  for (const tr of rows) {
    const td = $(tr).find("td");
    if (td.length < 4) continue;
    const symbol = $(td[0]).text().trim();
    out.push({
      ticker: symbol,
      yahoo: symbol.replace(/\./g, "-"), // BRK.B -> BRK-B
      name: $(td[1]).text().trim(),
      sector: $(td[2]).text().trim(),
      subIndustry: $(td[3]).text().trim(),
      cik: $(td[6]).text().trim(),
    });
  }
  if (out.length < 400) throw new Error(`Only parsed ${out.length} constituents`);
  return out;
}

// ---------- Multiples ----------
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null); // negative/zero denominator -> NM

// NTM = time-weighted blend of current fiscal year (0y) and next fiscal year (+1y) estimates.
// Weight on 0y = fraction of the current fiscal year still ahead of today.
function ntmBlend(fy0, fy1, fy0End) {
  if (fy0 == null && fy1 == null) return null;
  if (!fy0End) return fy1 ?? fy0;
  const monthsLeft = (new Date(fy0End) - Date.now()) / (1000 * 60 * 60 * 24 * 30.4375);
  const w = Math.min(1, Math.max(0, monthsLeft / 12));
  if (fy0 == null) return fy1;
  if (fy1 == null) return fy0;
  return w * fy0 + (1 - w) * fy1;
}

async function fetchCompany(c) {
  const r = await yf.quoteSummary(
    c.yahoo,
    { modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend"] },
    { validateResult: false },
  );
  const price = num(r.price?.regularMarketPrice);
  const marketCap = num(r.price?.marketCap) ?? num(r.summaryDetail?.marketCap);
  const ev = num(r.defaultKeyStatistics?.enterpriseValue);
  const ltmEps = num(r.defaultKeyStatistics?.trailingEps);
  const ltmEbitda = num(r.financialData?.ebitda);
  const ltmRevenue = num(r.financialData?.totalRevenue);

  const trend = r.earningsTrend?.trend ?? [];
  const fy0 = trend.find((t) => t.period === "0y");
  const fy1 = trend.find((t) => t.period === "+1y");
  const ntmEps = ntmBlend(num(fy0?.earningsEstimate?.avg), num(fy1?.earningsEstimate?.avg), fy0?.endDate);
  const ntmRevenue = ntmBlend(num(fy0?.revenueEstimate?.avg), num(fy1?.revenueEstimate?.avg), fy0?.endDate);
  // Yahoo has no consensus EBITDA: hold LTM EBITDA margin constant on NTM consensus revenue.
  const ntmEbitda =
    ltmEbitda != null && ltmRevenue > 0 && ntmRevenue != null ? ltmEbitda * (ntmRevenue / ltmRevenue) : null;

  return withDerived({
    ...c,
    currency: r.price?.currency ?? null,
    price,
    marketCap,
    ev,
    ltmEps,
    ntmEps,
    ltmEbitda,
    ntmEbitda,
    ltmRevenue,
    ntmRevenue,
    peLtm: ratio(price, ltmEps),
    peNtm: ratio(price, ntmEps),
    evEbitdaLtm: ratio(ev, ltmEbitda),
    evEbitdaNtm: ratio(ev, ntmEbitda),
  });
}

// EV/Revenue; left NM where Yahoo reports no EBITDA at all (banks, insurers), where EV isn't meaningful
function withDerived(c) {
  const evOk = c.ev != null && c.ltmEbitda != null;
  return { ...c, evRevLtm: evOk ? ratio(c.ev, c.ltmRevenue) : null, evRevNtm: evOk ? ratio(c.ev, c.ntmRevenue) : null };
}

async function withRetry(fn, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function refresh() {
  if (job.running) return;
  job = { running: true, done: 0, total: 0, errors: [], startedAt: new Date().toISOString() };
  try {
    const list = await withRetry(fetchConstituents);
    job.total = list.length;
    const results = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        try {
          results[i] = await withRetry(() => fetchCompany(list[i]));
        } catch (e) {
          job.errors.push(`${list[i].ticker}: ${e.message}`);
          results[i] = { ...list[i], error: e.message };
        }
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    store = { updatedAt: new Date().toISOString(), companies: results };
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store));
    // archive a full snapshot (incl. NTM) per day so any refreshed date can be recalled exactly
    await fs.mkdir(SNAP_DIR, { recursive: true });
    await fs.writeFile(path.join(SNAP_DIR, store.updatedAt.slice(0, 10) + ".json"), JSON.stringify(store));
    console.log(`Refreshed ${results.length} companies (${job.errors.length} errors)`);
    if (!history.updatedAt || Date.now() - new Date(history.updatedAt) > HIST_STALE_MS) refreshHistory();
  } catch (e) {
    job.errors.push(`Refresh failed: ${e.message}`);
    console.error(e);
  } finally {
    job.running = false;
  }
}

// ---------- History (weekly LTM multiples, ~5y) ----------
async function refreshHistory() {
  if (histJob.running || !store.companies.length) return;
  const list = store.companies.filter((c) => c.cik);
  histJob = { running: true, done: 0, total: list.length, errors: [] };
  try {
    const grid = weeklyGrid();
    const series = {};
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const c = list[next++];
        try {
          // match the snapshot: no EV/EBITDA history where today's EV/EBITDA isn't meaningful (banks, insurers)
          series[c.ticker] = await withRetry(() => companyHistory({ ...c, noEv: c.ltmEbitda == null,
            impliedShares: c.marketCap && c.price ? c.marketCap / c.price : null }, grid));
        } catch (e) {
          histJob.errors.push(`${c.ticker}: ${e.message}`);
        }
        histJob.done++;
        await new Promise((r) => setTimeout(r, 250)); // stay well under SEC's 10 req/s limit
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    history = { updatedAt: new Date().toISOString(), dates: grid.map((t) => new Date(t).toISOString().slice(0, 10)), series };
    await fs.writeFile(HIST_FILE, JSON.stringify(history));
    console.log(`History refreshed for ${Object.keys(series).length} companies (${histJob.errors.length} errors)`);
  } catch (e) {
    histJob.errors.push(`History refresh failed: ${e.message}`);
    console.error(e);
  } finally {
    histJob.running = false;
  }
}

// ---------- As-of-date data ----------
async function snapshotDates() {
  try {
    return (await fs.readdir(SNAP_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
  } catch {
    return [];
  }
}

// Saved snapshot for that exact date if one exists; otherwise rebuild LTM multiples from the weekly history
// using the last week on or before the date.
async function dataAsOf(date) {
  if ((await snapshotDates()).includes(date)) {
    const snap = JSON.parse(await fs.readFile(path.join(SNAP_DIR, date + ".json"), "utf8"));
    return { ...snap, companies: snap.companies.map(withDerived), source: "snapshot", asOf: date };
  }
  let i = -1;
  for (let k = 0; k < history.dates.length; k++) if (history.dates[k] <= date) i = k;
  if (i < 0) return { error: `No history on or before ${date}` };
  const at = (c, k) => history.series[c.ticker]?.[k]?.[i] ?? null;
  const companies = store.companies.map((c) => ({
    ticker: c.ticker, yahoo: c.yahoo, name: c.name, sector: c.sector, subIndustry: c.subIndustry, cik: c.cik,
    marketCap: at(c, "mc") != null ? at(c, "mc") * 1e6 : null,
    ev: at(c, "evd") != null ? at(c, "evd") * 1e6 : null,
    peLtm: at(c, "pe"), peNtm: null, evEbitdaLtm: at(c, "ev"), evEbitdaNtm: null,
    evRevLtm: at(c, "er"), evRevNtm: null,
  }));
  return { updatedAt: history.updatedAt, companies, source: "history", asOf: date, effectiveDate: history.dates[i] };
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (obj, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/api/data") {
    const date = url.searchParams.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < new Date().toISOString().slice(0, 10))
      return json({ ...(await dataAsOf(date)), job });
    return json({ ...store, source: "live", job });
  }
  if (url.pathname === "/api/dates")
    return json({ snapshots: await snapshotDates(), historyFrom: history.dates[0] ?? null, historyTo: history.dates.at(-1) ?? null });
  if (url.pathname === "/api/status") return json({ updatedAt: store.updatedAt, job, histJob, histUpdatedAt: history.updatedAt });
  if (url.pathname === "/api/history") return json({ ...history, histJob });
  if (url.pathname === "/api/history/refresh" && req.method === "POST") {
    refreshHistory();
    return json({ started: true });
  }
  if (url.pathname === "/api/refresh" && req.method === "POST") {
    refresh();
    return json({ started: true });
  }

  const file = path.join(ROOT, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(path.join(ROOT, "public"))) return json({ error: "forbidden" }, 403);
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    json({ error: "not found" }, 404);
  }
});

try {
  store = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  store.companies = store.companies.map(withDerived); // backfill metrics added after the cache was written
  console.log(`Loaded cache from ${store.updatedAt}`);
} catch {
  console.log("No cache yet");
}
try {
  history = JSON.parse(await fs.readFile(HIST_FILE, "utf8"));
} catch {}
if (store.updatedAt) {
  const snap = path.join(SNAP_DIR, store.updatedAt.slice(0, 10) + ".json");
  await fs.mkdir(SNAP_DIR, { recursive: true });
  await fs.access(snap).catch(() => fs.writeFile(snap, JSON.stringify(store)));
}
// histories built before market cap / EV were stored need a rebuild
const needHistory = !history.updatedAt || Date.now() - new Date(history.updatedAt) > HIST_STALE_MS ||
  !Object.values(history.series ?? {})[0]?.er;
// constituents from an older cache lack CIKs; a fresh pull adds them (and then triggers history)
if (!store.updatedAt || Date.now() - new Date(store.updatedAt) > STALE_MS || !store.companies[0]?.cik) refresh();
else if (needHistory) refreshHistory();

server.listen(PORT, () => console.log(`S&P 500 multiples app: http://localhost:${PORT}`));
