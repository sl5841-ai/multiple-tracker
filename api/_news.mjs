// Latest headlines per ticker, shared by the Vercel function (api/news.js) and the local server.
// Only ticker symbols come in; the request goes to a fixed Yahoo Finance host.
import YahooFinance from "yahoo-finance2";
import { headlineSentiment, mentionsCompany } from "./_sentiment.mjs";
import { isMajorNews } from "./_newsfilter.mjs";

// Yahoo's earnings data needs a session cookie and crumb, which yahoo-finance2 handles; the news search does not.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Latest reported quarter: EPS actual vs consensus estimate, plus the next scheduled report date. null for ETFs and funds.
async function earningsFor(symbol) {
  try {
    const r = await yf.quoteSummary(symbol.replace(/\./g, "-"), { modules: ["earningsHistory", "calendarEvents"] }, { validateResult: false });
    const last = (r.earningsHistory?.history ?? []).filter((h) => num(h.epsActual) != null && num(h.epsEstimate) != null).at(-1);
    const next = (r.calendarEvents?.earnings?.earningsDate ?? []).map((d) => new Date(d)).filter((d) => d > Date.now()).sort((a, b) => a - b)[0];
    if (!last && !next) return null;
    return {
      quarterEnd: last?.quarter ? new Date(last.quarter).toISOString().slice(0, 10) : null,
      epsActual: num(last?.epsActual),
      epsEstimate: num(last?.epsEstimate),
      surprisePct: num(last?.surprisePercent) != null ? last.surprisePercent * 100 : null,
      nextReport: next ? next.toISOString().slice(0, 10) : null,
    };
  } catch {
    return null; // earnings are optional; never fail the news over them
  }
}

const SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
export const MAX_SYMBOLS = 20;
const PER_TICKER = 3;
const SYMBOL_RE = /^[A-Z0-9]{1,6}([.\-][A-Z0-9]{1,3})?$/;

// "aapl, BRK.B msft" -> ["AAPL", "BRK.B", "MSFT"]; drops anything that isn't a plausible ticker
export function parseSymbols(raw) {
  const out = [];
  for (const t of String(raw ?? "").toUpperCase().split(/[\s,;]+/)) {
    if (SYMBOL_RE.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

async function search(query) {
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=20&enableFuzzyQuery=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sp500-multiples app)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function newsFor(symbol) {
  const q = symbol.replace(/\./g, "-"); // Yahoo writes BRK.B as BRK-B
  const [j, earnings] = await Promise.all([search(q), earningsFor(symbol)]);
  const quote = (j.quotes ?? []).find((x) => String(x.symbol).toUpperCase() === q);
  let raw = j.news ?? [];
  // some share-class tickers (e.g. BRK-B) return no stories; retry with the company name
  const name = quote ? String(quote.shortname ?? quote.longname ?? "") : "";
  if (!raw.length && name) raw = (await search(name.replace(/\b(Inc|Corp|Co|Ltd|plc|New)\b\.?/gi, "").trim())).news ?? [];
  const items = raw
    .map((n) => ({
      title: String(n.title ?? ""),
      publisher: String(n.publisher ?? ""),
      link: String(n.link ?? ""),
      time: Number.isFinite(n.providerPublishTime) ? new Date(n.providerPublishTime * 1000).toISOString() : null,
      related: (n.relatedTickers ?? []).map((t) => String(t).toUpperCase()).includes(q),
    }))
    // major news only: commentary, listicles and market wraps are dropped (see _newsfilter.mjs)
    .filter((n) => n.title && n.link.startsWith("https://") && isMajorNews(n))
    .map((n) => ({ ...n, about: mentionsCompany(n.title, symbol, name) }))
    .filter((n) => n.about); // only stories that name the company or ticker
  // prefer stories that name the company, then ones Yahoo tags with this ticker, then newest first
  items.sort((a, b) => b.about - a.about || b.related - a.related || String(b.time).localeCompare(String(a.time)));
  return {
    symbol,
    found: !!quote,
    name,
    earnings,
    // sentiment is scored from the headline wording; "about" says whether the headline names this company at all
    news: items.slice(0, PER_TICKER).map(({ related, ...n }) => ({ ...n, ...headlineSentiment(n.title) })),
  };
}

export async function getNews(symbols) {
  return Promise.all(symbols.map((s) => newsFor(s).catch((e) => ({ symbol: s, found: false, name: "", news: [], error: e.message }))));
}
