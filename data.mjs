// Data pipeline shared by the local server (server.mjs) and the static build (build-data.mjs).
// Universe: S&P 500 members (GICS sectors from Wikipedia) plus every other US-listed common stock with a market cap
// of at least $300M (Nasdaq's symbol directory; Yahoo sector mapped to GICS names). History covers the S&P 500 only.
// Market data + consensus estimates come from Yahoo Finance;
// computes LTM/NTM multiples, and writes everything as static JSON under public/data/ so the page
// can be hosted with or without a server.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { companyHistory, weeklyGrid } from "./history.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(ROOT, "public", "data");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");
const HIST_FILE = path.join(DATA_DIR, "history.json");
const DATES_FILE = path.join(DATA_DIR, "dates.json");
const SNAP_DIR = path.join(DATA_DIR, "snapshots");
const CONCURRENCY = 8;
const MIN_CAP = 300e6; // market-cap floor for companies outside the S&P 500

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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

// ---------- Other US-listed common stocks ----------
// Nasdaq Trader's symbol directory lists every NYSE / Nasdaq / NYSE American security, with ETF and test-issue flags.
const SYMDIR = "https://www.nasdaqtrader.com/dynamic/SymDir/";
const NOT_COMMON = /warrant|\bright|\bunits?\b|preferred|\bnotes? due|debenture|%|subordinated|trust preferred|beneficial interest|closed[- ]end|\bfund\b/i;
const SHELL = /acquisition (corp|co\b|company|inc|ltd|limited|holdings)|blank check|\bspac\b/i;

async function fetchListed() {
  const out = [];
  for (const [file, symCol] of [["nasdaqlisted.txt", "Symbol"], ["otherlisted.txt", "ACT Symbol"]]) {
    const res = await fetch(SYMDIR + file, { headers: { "User-Agent": "Mozilla/5.0 (sp500-multiples app)" } });
    if (!res.ok) throw new Error(`Nasdaq symbol directory HTTP ${res.status}`);
    const lines = (await res.text()).trim().split(/\r?\n/);
    const head = lines[0].split("|");
    for (const line of lines.slice(1)) {
      if (line.startsWith("File Creation")) continue;
      const r = Object.fromEntries(line.split("|").map((v, i) => [head[i], v]));
      const ticker = r[symCol], name = r["Security Name"] ?? "";
      if (r.ETF !== "N" || r["Test Issue"] !== "N") continue;
      if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker) || NOT_COMMON.test(name) || SHELL.test(name)) continue;
      out.push({ ticker, yahoo: ticker.replace(/\./g, "-"), name: name.replace(/\s+-\s+.*$|\s+(Class [A-Z] )?(Common Stock|Ordinary Shares|Common Shares).*$/i, "").trim() });
    }
  }
  if (out.length < 2000) throw new Error(`Only parsed ${out.length} listed stocks`);
  return out;
}

// Yahoo's sector names -> the matching GICS sector names used for S&P 500 members
const YAHOO_SECTOR = {
  Technology: "Information Technology", Healthcare: "Health Care", "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer Discretionary", "Consumer Defensive": "Consumer Staples", "Basic Materials": "Materials",
  "Communication Services": "Communication Services", Industrials: "Industrials", Energy: "Energy",
  "Real Estate": "Real Estate", Utilities: "Utilities",
};

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
    { modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend", "assetProfile"] },
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

  const outside = !c.sp500;
  return withDerived({
    ...c,
    ...(outside ? { sector: YAHOO_SECTOR[r.assetProfile?.sector] ?? null, subIndustry: r.assetProfile?.industry ?? "" } : {}),
    currency: r.price?.currency ?? null,
    financialCurrency: r.financialData?.financialCurrency ?? null,
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
export function withDerived(c) {
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

// ---------- Sector news ----------
// Recent headlines per sector, looked up through each sector's SPDR ETF ticker (Yahoo has no sector news feed).
const SECTOR_ETF = { "Communication Services": "XLC", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP", Energy: "XLE",
  Financials: "XLF", "Health Care": "XLV", Industrials: "XLI", "Information Technology": "XLK", Materials: "XLB",
  "Real Estate": "XLRE", Utilities: "XLU" };

async function fetchSectorNews() {
  const news = {};
  for (const [sector, etf] of Object.entries(SECTOR_ETF)) {
    try {
      const r = await withRetry(() => yf.search(etf, { newsCount: 6, quotesCount: 0 }, { validateResult: false }));
      news[sector] = (r.news ?? []).map((n) => ({
        title: String(n.title ?? ""), publisher: String(n.publisher ?? ""), link: String(n.link ?? ""),
        time: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : null,
      })).filter((n) => n.title && n.link.startsWith("https://"));
    } catch {
      news[sector] = []; // headlines are optional; never fail the snapshot over them
    }
  }
  return news;
}

// ---------- Stored files ----------
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
};
export const loadStore = () => readJson(LATEST_FILE, { updatedAt: null, companies: [] });
export const loadHistory = () => readJson(HIST_FILE, { updatedAt: null, dates: [], series: {} });

export async function writeDatesIndex() {
  const files = await fs.readdir(SNAP_DIR).catch(() => []);
  const snapshots = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
  await fs.writeFile(DATES_FILE, JSON.stringify({ snapshots }));
}

// ---------- Snapshot (today's multiples) ----------
// job: optional progress object { done, total, errors } mutated as the pull runs
export async function buildSnapshot(job = { done: 0, total: 0, errors: [] }) {
  const sp = (await withRetry(fetchConstituents)).map((c) => ({ ...c, sp500: true }));
  const inSp = new Set(sp.map((c) => c.ticker));
  const others = (await withRetry(fetchListed)).filter((c) => !inSp.has(c.ticker)).map((c) => ({ ...c, sp500: false }));
  const list = [...sp, ...others];
  job.total = list.length;
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      try {
        results[i] = await withRetry(() => fetchCompany(list[i]));
      } catch (e) {
        // outside the S&P 500, a failed lookup just drops the company (many thin listings have no Yahoo data)
        if (list[i].sp500) job.errors.push(`${list[i].ticker}: ${e.message}`);
        results[i] = { ...list[i], error: e.message };
      }
      job.done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // a mostly-failed pull (e.g. the data source blocking this machine) must not overwrite good data
  if (job.errors.length > sp.length / 2) throw new Error(`Snapshot pull failed for ${job.errors.length}/${sp.length} S&P 500 tickers`);
  // keep S&P 500 members as-is; other companies need USD financials, a known sector, a market cap >= $300M, and not a shell
  const keep = results.filter((c) => c.sp500 || (!c.error && c.sector && c.marketCap >= MIN_CAP &&
    c.financialCurrency === "USD" && c.subIndustry !== "Shell Companies"));
  const store = { updatedAt: new Date().toISOString(), companies: keep.map(compact), news: await fetchSectorNews(),
    universe: { minCap: MIN_CAP, sp500: sp.length, others: keep.length - sp.length, othersChecked: others.length,
      othersLookupFailed: results.filter((c) => !c.sp500 && c.error).length } };
  await fs.mkdir(SNAP_DIR, { recursive: true });
  await fs.writeFile(LATEST_FILE, JSON.stringify(store));
  // archive a full snapshot (incl. NTM) per day so any refreshed date can be recalled exactly
  await fs.writeFile(path.join(SNAP_DIR, store.updatedAt.slice(0, 10) + ".json"), JSON.stringify(store));
  await writeDatesIndex();
  return store;
}

// trim floats to 6 significant digits; the universe is ~8x the S&P 500, so this keeps the JSON files small
function compact(c) {
  const o = {};
  for (const [k, v] of Object.entries(c)) if (v != null && k !== "yahoo") o[k] = typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v;
  return o;
}

// ---------- History (weekly LTM multiples, ~5y) ----------
// S&P 500 members only (older stores have no sp500 flag; they were S&P-only)
export async function buildHistory(store, job = { done: 0, total: 0, errors: [] }) {
  const list = store.companies.filter((c) => c.cik && c.sp500 !== false).map((c) => ({ ...c, yahoo: c.yahoo ?? c.ticker.replace(/\./g, "-") }));
  job.total = list.length;
  const grid = weeklyGrid();
  const series = {};
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const c = list[next++];
      try {
        // match the snapshot: no EV multiples history where today's EV isn't meaningful (banks, insurers)
        series[c.ticker] = await withRetry(() => companyHistory({ ...c, noEv: c.ltmEbitda == null,
          impliedShares: c.marketCap && c.price ? c.marketCap / c.price : null }, grid));
      } catch (e) {
        job.errors.push(`${c.ticker}: ${e.message}`);
      }
      job.done++;
      await new Promise((r) => setTimeout(r, 250)); // stay well under SEC's 10 req/s limit
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (job.errors.length > list.length / 2) throw new Error(`History build failed for ${job.errors.length}/${list.length} tickers`);
  const history = { updatedAt: new Date().toISOString(), dates: grid.map((t) => new Date(t).toISOString().slice(0, 10)), series };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HIST_FILE, JSON.stringify(history));
  return history;
}
