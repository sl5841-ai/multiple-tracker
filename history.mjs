// Historical LTM multiples (weekly, ~5 years) per company.
// Fundamentals: SEC EDGAR XBRL companyfacts (point-in-time: a quarter counts only once it was filed).
// Prices + split history: Yahoo Finance weekly chart.
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const SEC_UA = process.env.SEC_USER_AGENT || "sp500-multiples-app research@localhost.localdomain";
const DAY = 86400000;
const YEARS = 5;

const d = (s) => new Date(s + "T00:00:00Z").getTime();
const days = (a, b) => Math.round((b - a) / DAY);

// ---------- EDGAR fact helpers ----------
const FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT", "10-QT"]);

// All facts for a tag, deduped per period: value from the latest filing (restated),
// availability from the earliest filing.
// adj(val, filedTime) restates per-share / share values into today's share basis.
function facts(cf, tag, unit, adj = (v) => v) {
  const units = cf.facts?.["us-gaap"]?.[tag]?.units;
  if (!units) return null;
  const list = units[unit] ?? Object.values(units)[0];
  if (!Array.isArray(list)) return null;
  const byKey = new Map();
  for (const f of list) {
    if (!FORMS.has(f.form)) continue;
    const key = (f.start ?? "") + "|" + f.end;
    const cur = byKey.get(key);
    const val = adj(f.val, d(f.filed));
    if (!cur) byKey.set(key, { start: f.start ? d(f.start) : null, end: d(f.end), val, filed: d(f.filed), avail: d(f.filed) });
    else {
      if (d(f.filed) > cur.filed) { cur.val = val; cur.filed = d(f.filed); }
      cur.avail = Math.min(cur.avail, d(f.filed));
    }
  }
  return [...byKey.values()];
}

// Quarterly (≈3-month) values from direct 3M facts, or differences of YTD facts sharing a fiscal-year start.
function quarters(fs) {
  const q = new Map(); // end -> {start,end,val,avail}
  const dur = fs.filter((f) => f.start != null);
  for (const f of dur) {
    const n = days(f.start, f.end);
    if (n >= 80 && n <= 100) q.set(f.end, { start: f.start, end: f.end, val: f.val, avail: f.avail });
  }
  const byStart = new Map();
  for (const f of dur) {
    const n = days(f.start, f.end);
    if (n < 80 || n > 380) continue;
    if (!byStart.has(f.start)) byStart.set(f.start, []);
    byStart.get(f.start).push(f);
  }
  for (const list of byStart.values()) {
    list.sort((a, b) => a.end - b.end);
    for (let i = 1; i < list.length; i++) {
      const gap = days(list[i - 1].end, list[i].end);
      if (gap < 80 || gap > 100 || q.has(list[i].end)) continue;
      q.set(list[i].end, {
        start: list[i - 1].end + DAY, end: list[i].end,
        val: list[i].val - list[i - 1].val, avail: Math.max(list[i].avail, list[i - 1].avail),
      });
    }
  }
  return q;
}

// LTM series: {end, val, avail}[] — annual facts directly, otherwise four chained quarters.
function ltm(fs) {
  if (!fs) return [];
  const out = new Map();
  for (const f of fs) {
    if (f.start != null) {
      const n = days(f.start, f.end);
      if (n >= 350 && n <= 380) out.set(f.end, { end: f.end, val: f.val, avail: f.avail });
    }
  }
  const q = quarters(fs);
  const ends = [...q.keys()].sort((a, b) => a - b);
  const findPrev = (start) => {
    for (const e of ends) if (Math.abs(days(e, start - DAY)) <= 7) return q.get(e);
    return null;
  };
  for (const e of ends) {
    if (out.has(e)) continue;
    let cur = q.get(e), sum = cur.val, avail = cur.avail, ok = true;
    for (let k = 0; k < 3; k++) {
      cur = findPrev(cur.start);
      if (!cur) { ok = false; break; }
      sum += cur.val; avail = Math.max(avail, cur.avail);
    }
    if (ok) out.set(e, { end: e, val: sum, avail });
  }
  return [...out.values()].sort((a, b) => a.end - b.end);
}

// First tag (in order) that yields a series; per-period fallback across tags.
function ltmFirst(cf, tags, unit, adj) {
  const m = new Map();
  for (const t of tags) for (const p of ltm(facts(cf, t, unit, adj))) if (!m.has(p.end)) m.set(p.end, p);
  return m;
}
function instants(cf, tags, unit = "USD") {
  const m = new Map();
  for (const t of tags) for (const f of facts(cf, t, unit) ?? []) if (f.start == null && !m.has(f.end)) m.set(f.end, f);
  return m;
}
// Shares: shortest-duration diluted weighted average ending at each period end
function shares(cf, adj) {
  const m = new Map();
  for (const t of ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]) {
    for (const f of facts(cf, t, "shares", adj) ?? []) {
      if (f.start == null) continue;
      const cur = m.get(f.end);
      if (!cur || (cur.tag === t && f.end - f.start < cur.end - cur.start)) m.set(f.end, { ...f, tag: t });
    }
  }
  return m;
}

// ---------- per-company quarterly fundamentals ----------
function fundamentals(cf, splitFactorAfter) {
  const eps = ltmFirst(cf, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares", (v, filed) => v / splitFactorAfter(filed));
  const opInc = ltmFirst(cf, ["OperatingIncomeLoss"], "USD");
  const pretax = ltmFirst(cf, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], "USD");
  const interest = ltmFirst(cf, ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"], "USD");
  const da = ltmFirst(cf, ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization", "DepreciationAmortizationAndOther"], "USD");
  // fallback when D&A is only reported in pieces (e.g. MSFT)
  const dep = ltmFirst(cf, ["Depreciation"], "USD");
  const amort = ltmFirst(cf, ["AmortizationOfIntangibleAssets"], "USD");
  for (const [e, p] of dep) {
    if (da.has(e)) continue;
    const a = amort.get(e);
    da.set(e, { end: e, val: p.val + (a?.val ?? 0), avail: Math.max(p.avail, a?.avail ?? 0) });
  }
  // D&A disclosed only annually: carry the latest annual figure forward (up to ~1y) to the quarters in between
  const daPts = [...da.values()].sort((a, b) => a.end - b.end);
  for (const e of [...opInc.keys(), ...pretax.keys()]) {
    if (da.has(e)) continue;
    const p = daPts.filter((x) => x.end < e && e - x.end <= 370 * DAY).at(-1);
    if (p) da.set(e, { end: e, val: p.val, avail: p.avail });
  }
  const ni = ltmFirst(cf, ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"], "USD");
  const sh = shares(cf, (v, filed) => v * splitFactorAfter(filed));

  const ltNon = instants(cf, ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"]);
  const ltTot = instants(cf, ["LongTermDebt"]);
  const ltCur = instants(cf, ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"]);
  const debtCur = instants(cf, ["DebtCurrent"]);
  const stb = instants(cf, ["ShortTermBorrowings", "CommercialPaper"]);
  const cash = instants(cf, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const sti = instants(cf, ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"]);
  const nci = instants(cf, ["MinorityInterest"]);
  const v = (m, e) => m.get(e)?.val;

  const rev = ltmFirst(cf, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"], "USD");
  const ends = new Set([...eps.keys(), ...opInc.keys(), ...pretax.keys(), ...rev.keys(), ...ni.keys()]);
  const rows = [];
  for (const e of [...ends].sort((a, b) => a - b)) {
    const ep = eps.get(e);
    let ebit = v(opInc, e), ebitAvail = opInc.get(e)?.avail;
    if (ebit == null && v(pretax, e) != null && v(interest, e) != null) {
      ebit = v(pretax, e) + v(interest, e);
      ebitAvail = Math.max(pretax.get(e).avail, interest.get(e).avail);
    }
    const ebitda = ebit != null && v(da, e) != null ? ebit + v(da, e) : null;
    const s = sh.get(e);
    let debt = null;
    if (v(ltNon, e) != null) debt = v(ltNon, e) + (v(debtCur, e) ?? (v(ltCur, e) ?? 0) + (v(stb, e) ?? 0));
    else if (v(ltTot, e) != null) debt = v(ltTot, e) + (v(stb, e) ?? 0);
    else if (v(debtCur, e) != null || v(stb, e) != null) debt = v(debtCur, e) ?? v(stb, e);
    const netDebt = debt == null && v(cash, e) == null ? null
      : (debt ?? 0) - (v(cash, e) ?? 0) - (v(sti, e) ?? 0) + (v(nci, e) ?? 0);
    rows.push({
      end: e,
      eps: ep ? ep.val : null,
      epsAvail: ep?.avail,
      ebitda,
      ebitdaAvail: ebitda != null ? Math.max(ebitAvail, da.get(e).avail) : null,
      shares: s ? s.val : null,
      netDebt,
      revenue: v(rev, e) ?? null,
      revenueAvail: rev.get(e)?.avail ?? null,
      ni: v(ni, e) ?? null,
      niAvail: ni.get(e)?.avail ?? null,
    });
  }
  return rows;
}

// ---------- fetchers ----------
async function secFactsOne(cik) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, {
    headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  return res.json();
}

// Companies re-registered under a new CIK (holding-company reorganizations): older filings live under the predecessor.
const PREDECESSOR_CIKS = { XOM: ["34088"] };

async function secFacts(cik, ticker) {
  const cf = await secFactsOne(cik);
  for (const old of PREDECESSOR_CIKS[ticker] ?? []) {
    const prev = await secFactsOne(old);
    const gaap = (cf.facts ??= {})["us-gaap"] ??= {};
    for (const [tag, def] of Object.entries(prev.facts?.["us-gaap"] ?? {})) {
      if (!gaap[tag]) { gaap[tag] = def; continue; }
      for (const [unit, list] of Object.entries(def.units)) gaap[tag].units[unit] = [...(gaap[tag].units[unit] ?? []), ...list];
    }
  }
  return cf;
}

export function weeklyGrid(now = Date.now()) {
  const out = [];
  let t = now - YEARS * 365.25 * DAY - 14 * DAY;
  t -= ((new Date(t).getUTCDay() + 2) % 7) * DAY; // back up to a Friday
  for (; t <= now; t += 7 * DAY) out.push(Math.floor(t / DAY) * DAY);
  return out;
}

// c.noEv: skip EV multiples (e.g. banks/insurers, where they are not meaningful)
// c.impliedShares: today's market cap ÷ price, used when EDGAR has no usable share count (multi-class companies)
export async function companyHistory(c, grid) {
  const [cf, chart] = await Promise.all([
    secFacts(c.cik, c.ticker),
    yf.chart(c.yahoo, { period1: new Date(grid[0] - 30 * DAY), interval: "1wk", events: "split" }, { validateResult: false }),
  ]);
  const splits = (chart.events?.splits ?? []).map((s) => ({ t: new Date(s.date).getTime(), r: s.numerator / s.denominator }));
  const splitFactorAfter = (t) => splits.reduce((f, s) => (s.t > t ? f * s.r : f), 1);
  const rows = fundamentals(cf, splitFactorAfter);
  // Multi-class issuers report shares / EPS per class only (dimensional facts that companyfacts omits):
  // fall back to implied total shares, and to P/E = market cap ÷ LTM net income.
  const current = (has) => rows.some((r) => has(r) && grid[grid.length - 1] - r.end < 270 * DAY);
  if (!current((r) => r.shares != null) && c.impliedShares) for (const r of rows) r.shares = c.impliedShares;
  if (!current((r) => r.eps != null))
    for (const r of rows) { r.eps = r.ni != null && r.shares ? r.ni / r.shares : null; r.epsAvail = r.niAvail; }
  const quotes = (chart.quotes ?? []).filter((q) => q.close != null).map((q) => ({ t: new Date(q.date).getTime(), p: q.close }));

  // mc / evd: market cap and enterprise value in $mm (for the as-of-date company table)
  const pe = [], ev = [], mc = [], evd = [], er = [];
  let qi = 0;
  for (const t of grid) {
    while (qi + 1 < quotes.length && quotes[qi + 1].t <= t) qi++;
    const price = quotes[qi] && quotes[qi].t <= t && t - quotes[qi].t < 21 * DAY ? quotes[qi].p : null;
    // latest period whose data had been filed by date t (no look-ahead)
    let epsRow = null, evRow = null, shRow = null, revRow = null;
    for (const r of rows) {
      if (r.revenue != null && r.revenueAvail <= t && r.shares != null) revRow = r;
      if (r.shares != null && (r.epsAvail ?? r.ebitdaAvail ?? r.end + 45 * DAY) <= t) shRow = r;
      if (r.eps != null && r.epsAvail <= t) epsRow = r;
      if (r.ebitda != null && r.ebitdaAvail <= t && r.shares != null) evRow = r;
    }
    const fresh = (r) => r && t - r.end < 270 * DAY; // ignore stale fundamentals
    pe.push(price != null && fresh(epsRow) && epsRow.eps > 0 ? +(price / epsRow.eps).toFixed(2) : price != null && fresh(epsRow) ? -1 : null);
    if (!c.noEv && price != null && fresh(evRow)) {
      const evv = price * evRow.shares + (evRow.netDebt ?? 0);
      ev.push(evRow.ebitda > 0 && evv > 0 ? +(evv / evRow.ebitda).toFixed(2) : -1);
    } else ev.push(null);
    if (!c.noEv && price != null && fresh(revRow)) {
      const evv = price * revRow.shares + (revRow.netDebt ?? 0);
      er.push(revRow.revenue > 0 && evv > 0 ? +(evv / revRow.revenue).toFixed(2) : -1);
    } else er.push(null);
    if (price != null && fresh(shRow)) {
      const cap = price * shRow.shares;
      mc.push(Math.round(cap / 1e6));
      evd.push(shRow.netDebt != null ? Math.round((cap + shRow.netDebt) / 1e6) : null);
    } else { mc.push(null); evd.push(null); }
  }
  return { pe, ev, mc, evd, er };
}
