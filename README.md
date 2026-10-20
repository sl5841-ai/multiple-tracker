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

- **Cheapest vs. its own history:** the sector furthest below its own 5-year median across LTM P/E, EV/EBITDA and EV/Revenue (it must read "Below history").
- **Most expensive vs. its own history:** the sector furthest above its own 5-year median (it must read "Above history").
- **Reasons shown:** distance from its own history, P/E versus the S&P 500 and trend (multiples versus their 200-day average). Only the first decides the ranking; the rest are tagged as supporting it or pointing the other way.
- **Headlines:** recent Yahoo Finance headlines for each sector's SPDR ETF, pulled with each data refresh into `latest.json`. Not shown for past dates.
- **Track record:** in a backtest over September 2022–2026 neither ranking predicted returns. The cheapest sector trailed the S&P 500 at every horizon tested, and the most expensive sector went on to beat it over 26 and 52 weeks. The card states this. It is a mechanical screen, not investment advice.

## Sector allocation

In the News & allocation tab, a chart compares three things for each sector:

- **Screen's allocation:** each sector's share of S&P 500 market value, tilted 1.5x for "Above history" and 0.5x for "Below history", rescaled to 100%, with dollar amounts for the amount entered. The direction and size were calibrated on the 2022–2026 backtest (multipliers 0–3 tested; best 0x/3x, softened to 0.5x/1.5x).
- **Market weight:** the untilted S&P 500 share, shown as a tick.
- **Your holdings:** when holdings with market values are entered, their mix by sector. ETFs, funds and stocks the app does not cover are grouped as "ETFs & other". A button fills the amount with the holdings total.
- **Track record:** against untilted market weights the tilt returned +0.15%, +0.53% and +0.68% over 13, 26 and 52 weeks (ahead on 60%, 62% and 83% of dates), and multipliers chosen on 2022–2024 also beat market weights on 2025–2026. One regime, about four years; the section states this. It is an arithmetic illustration, not investment advice; holdings and amounts stay in the browser.
- The same numbers are available as a table under "Show as table".

## News for your holdings

The first section on the page. Add holdings by hand (ticker and current market value) and it shows up to 3 recent headlines per ticker, up to 20 tickers.

- **Headlines:** `/api/news?symbols=AAPL,MSFT` returns them from Yahoo Finance's search endpoint. On Vercel this is the serverless function `api/news.js`; locally `server.mjs` serves the same route. Both use `api/_news.mjs`. Only ticker symbols are sent; market values stay in the browser, and nothing is stored.
- For covered stocks, each ticker card also shows its sector and that sector's reading from the sector ideas section.
- **Sentiment:** each headline is tagged Positive, Negative or Neutral by a finance word list in `api/_sentiment.mjs` (with handling for "not" and "despite"), and flagged when it doesn't name the company. Headline wording only; not a forecast.
- The market values feed the "Your holdings" series in the sector allocation chart.

## Stock universe

A switch in the header chooses **S&P 500** or **All US $300M+** for the sections built on today's data: sector benchmarks, sector ranges and the Companies table (holdings news also recognizes the wider list).

- **S&P 500:** constituents and official GICS sectors from Wikipedia.
- **All US $300M+:** adds every other NYSE, Nasdaq and NYSE American common stock (including ADRs) with a market cap of at least $300M, from Nasdaq Trader's symbol directory. Sectors come from Yahoo Finance, mapped to the matching GICS names. Shell companies (SPACs) and companies reporting in a non-USD currency are left out. About 2,900 companies in total.
- **S&P 500 only:** sector charts over time, valuation vs. history, sector ideas, the allocation and past dates, since history is rebuilt from SEC filings for S&P 500 members only.
- The full data build now takes about 7 minutes (~5,400 Yahoo lookups).
