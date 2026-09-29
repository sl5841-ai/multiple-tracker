# S&P 500 Trading Multiples

Local web app showing LTM and NTM P/E, EV/EBITDA and EV/Revenue for every S&P 500 constituent, with 25th percentile / median / 75th percentile by GICS sector.

```
npm install
npm start        # then open http://localhost:3000
```

- Data refreshes on startup if the cache (`data/multiples.json`) is more than 24h old, or on demand with **Refresh data**.
- Constituents + GICS sectors: Wikipedia. Prices, EV, LTM financials, consensus estimates: Yahoo Finance (unofficial API, via `yahoo-finance2`).
- NTM EPS/revenue = time-weighted blend of current and next fiscal-year consensus.
- NTM EBITDA = LTM EBITDA margin x NTM consensus revenue (Yahoo has no consensus EBITDA).
- EV/Revenue = EV ÷ LTM revenue or NTM consensus revenue. EV-based multiples are NM for companies with no reported EBITDA (banks, insurers).
- Negative/zero denominators are NM; multiples above the on-screen caps (default 100x P/E, 50x EV/EBITDA, 30x EV/Revenue) are left out of the sector stats.

## Sector multiples over time

Weekly LTM P/E, EV/EBITDA and EV/Revenue by sector (median + 25th–75th band) over YTD / 1Y / 3Y / 5Y.

- Fundamentals: SEC EDGAR XBRL (`history.mjs`), point-in-time — a quarter only counts once it was filed. Prices + splits: Yahoo weekly chart.
- LTM = annual value, or four chained quarters (Q4 derived from 10-K less 9M YTD). EBITDA = operating income + D&A.
- Historical EV = price × diluted shares + debt − cash & ST investments + NCI.
- Built after the snapshot refresh (~2 min) and cached in `data/history.json` for 7 days.
- Set `SEC_USER_AGENT` (e.g. "Your Name you@example.com") — SEC asks for contact info in the user-agent.
- Limits: LTM only (no free historical NTM consensus), today's constituents (survivorship bias).

## As-of date

The **As of** picker in the header re-dates the whole page (sector tables, range chart, company table, history window, CSV export). Links are bookmarkable: `http://localhost:3000/?asof=2023-06-15`.

- **Saved snapshots** — every refresh archives the full dataset (incl. NTM) to `data/snapshots/YYYY-MM-DD.json`; picking one of those dates reproduces it exactly.
- **Any other past date** (back to ~Sep 2021) — rebuilt from the weekly SEC-filings history using the last week on or before that date: LTM P/E, LTM EV/EBITDA, LTM EV/Revenue, market cap and EV. NTM shows NM (no free historical consensus).
