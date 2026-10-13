# S&P 500 Trading Multiples

Local web app showing LTM and NTM P/E, EV/EBITDA and EV/Revenue for every S&P 500 constituent, with 25th percentile / median / 75th percentile by GICS sector.

```
npm install
npm start        # then open http://localhost:3000
```

- Data refreshes on startup if the cache (`public/data/latest.json`) is more than 24h old, or on demand with **Refresh data**.
- Constituents + GICS sectors: Wikipedia. Prices, EV, LTM financials, consensus estimates: Yahoo Finance (unofficial API, via `yahoo-finance2`).
- NTM EPS/revenue = time-weighted blend of current and next fiscal-year consensus.
- NTM EBITDA = LTM EBITDA margin x NTM consensus revenue (Yahoo has no consensus EBITDA).
- EV/Revenue = EV ÷ LTM revenue or NTM consensus revenue. EV-based multiples are NM for companies with no reported EBITDA (banks, insurers).
- Negative/zero denominators are NM; multiples above the on-screen caps (default 100x P/E, 50x EV/EBITDA, 30x EV/Revenue) are left out of the sector stats.

## Sector multiples over time

Weekly LTM P/E, EV/EBITDA and EV/Revenue by sector (median + 25th–75th band, with a 200-day / 40-week moving average of the median) over YTD / 1Y / 3Y / 5Y.

- Fundamentals: SEC EDGAR XBRL (`history.mjs`), point-in-time — a quarter only counts once it was filed. Prices + splits: Yahoo weekly chart.
- LTM = annual value, or four chained quarters (Q4 derived from 10-K less 9M YTD). EBITDA = operating income + D&A.
- Historical EV = price × diluted shares + debt − cash & ST investments + NCI.
- Built after the snapshot refresh (~2 min) and cached in `public/data/history.json` for 7 days.
- Set `SEC_USER_AGENT` (e.g. "Your Name you@example.com") — SEC asks for contact info in the user-agent.
- Limits: LTM only (no free historical NTM consensus), today's constituents (survivorship bias).

## As-of date

The **As of** picker in the header re-dates the whole page (sector tables, range chart, company table, history window, CSV export). Links are bookmarkable: `http://localhost:3000/?asof=2023-06-15`.

- **Saved snapshots** — every refresh archives the full dataset (incl. NTM) to `public/data/snapshots/YYYY-MM-DD.json`; picking one of those dates reproduces it exactly.
- **Any other past date** (back to ~Sep 2021) — rebuilt from the weekly SEC-filings history using the last week on or before that date: LTM P/E, LTM EV/EBITDA, LTM EV/Revenue, market cap and EV. NTM columns are hidden in this view (no free historical consensus).

## Valuation vs. history

A screen comparing each sector's current LTM median multiple (P/E, EV/EBITDA, EV/Revenue) with its own weekly median over the last 1, 3 or 5 years, ending at the as-of date.

- **Reading**: *Below history* / *Above history* = at least two multiples more than 5% from the window median in that direction and none the other way; *Mixed* = they disagree; *In line* otherwise.
- The bar shows where the current value sits between the window's low and high; the tick marks the window median.
- It is a valuation screen, not investment advice. History only goes back to ~Sep 2021, so longer windows are truncated for earlier as-of dates.

## Hosting as a static site (Vercel)

The page reads plain JSON files under `public/data/`, so `public/` can be hosted as a static site with no server. `vercel.json` tells Vercel to serve that folder as-is (no install or build step).

- **Update the hosted data:** run `npm run build:data` (add `-- --history` to force a history rebuild), then commit and push `public/data/`. Vercel redeploys on every push to `main`.
- **What differs from running locally:** there is no Refresh button on the hosted site, and it only shows the data that was last pushed. Past dates are rebuilt in the browser from `history.json`.
- `server.mjs` (local, with Refresh) and `build-data.mjs` (static build) share the same pipeline in `data.mjs`.

## Sector ideas from this screen

A rule-based card that names two sectors, each with the reasons for and against:

- **Top-ranked:** the sector furthest below its own 5-year median across LTM P/E, EV/EBITDA and EV/Revenue (it must read "Below history").
- **Bottom-ranked:** the sector furthest above its own 5-year median (it must read "Above history").
- **Reasons shown:** distance from its own history, P/E versus the S&P 500 and trend (multiples versus their 200-day average). Only the first decides the ranking; the rest are tagged as supporting it or pointing the other way.
- **Headlines:** recent Yahoo Finance headlines for each sector's SPDR ETF, pulled with each data refresh into `latest.json`. Not shown for past dates.
- **Track record:** in a backtest over September 2022–2026 neither ranking predicted returns. The top-ranked sector trailed the S&P 500 at every horizon tested, and the bottom-ranked sector went on to beat it over 26 and 52 weeks. The card states this. It is a mechanical screen, not investment advice.

## Illustrative sector allocation

The first section on the page. Enter a dollar amount and it splits it across the 11 sectors by a fixed rule:

- **Start** from each sector's share of total S&P 500 market value (companies with two listed share classes are counted once).
- **Tilt** by the sector ideas reading: 1.5x for "Below history", 0.5x for "Above history", unchanged otherwise; then rescale to 100%.
- **Track record:** in a backtest over September 2022–2026 the tilted allocation trailed the untilted market weights by 0.1%, 0.7% and 0.8% over 13, 26 and 52 weeks. The section states this.
- It is an arithmetic illustration, not investment advice. The amount entered stays in the browser.
