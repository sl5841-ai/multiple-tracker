# Is It Expensive Yet?

Valuation multiples for every US sector, today and back to 2010. The app shows LTM and NTM P/E, EV/EBITDA and EV/Revenue for every US-listed common stock worth $300M or more (about 2,700, including the S&P 500), with 25th percentile / median / 75th percentile by sector, plus sector history back to 2010 for the S&P 500.

Live: https://multiple-tracker.vercel.app

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

Weekly LTM P/E, EV/EBITDA and EV/Revenue by sector (median + 25th–75th band, with a 200-day / 40-week moving average of the median) over YTD / 1Y / 3Y / 5Y / 10Y / since 2010. History starts in January 2010, when SEC XBRL financial data begins; coverage is thinner in 2010–2011 (about 180–350 companies with a P/E) than from 2012 on.

- Fundamentals: SEC EDGAR XBRL (`history.mjs`), point-in-time — a quarter only counts once it was filed. Prices + splits: Yahoo weekly chart.
- LTM = annual value, or four chained quarters (Q4 derived from 10-K less 9M YTD). EBITDA = operating income + D&A.
- Historical EV = price × diluted shares + debt − cash & ST investments + NCI.
- Built after the snapshot refresh (~2 min) and cached in `public/data/history.json` for 7 days.
- Set `SEC_USER_AGENT` (e.g. "Your Name you@example.com") — SEC asks for contact info in the user-agent.
- Limits: LTM only (no free historical NTM consensus), today's constituents (survivorship bias, which grows the further back you go), nothing before 2010.

## As-of date

The **As of** picker in the header re-dates the whole page (sector tables, range chart, company table, history window, CSV export). Links are bookmarkable: `http://localhost:3000/?asof=2023-06-15`.

- **Saved snapshots** — every refresh archives the full dataset (incl. NTM) to `public/data/snapshots/YYYY-MM-DD.json`; picking one of those dates reproduces it exactly.
- **Any other past date** (back to January 2010) — rebuilt from the weekly SEC-filings history using the last week on or before that date: LTM P/E, LTM EV/EBITDA, LTM EV/Revenue, market cap and EV. NTM columns are hidden in this view (no free historical consensus).

## Valuation vs. history

A screen comparing each sector's current LTM median multiple (P/E, EV/EBITDA, EV/Revenue) with its own weekly median over the last 1, 3 or 5 years, ending at the as-of date.

- **Reading**: *Below history* / *Above history* = at least two multiples more than 5% from the window median in that direction and none the other way; *Mixed* = they disagree; *In line* otherwise.
- The bar shows where the current value sits between the window's low and high; the tick marks the window median.
- It is a valuation screen, not investment advice. History goes back to January 2010, so longer windows are truncated for earlier as-of dates.

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
- **Track record (July 2011–2026):** both the cheapest and the most expensive sector trailed the S&P 500 on average; the cheapest by more (3.1% vs 0.8% over 26 weeks). The card states this. It is a mechanical screen, not investment advice.

## Sector allocation

In the My portfolio section, a chart compares three things for each sector:

- **Backtest-based allocation:** each sector's share of the market value of all covered US stocks ($300M+), tilted 1.5x for "Above history" and 0.5x for "Below history" (readings from S&P 500 history), rescaled to 100%. Shown as percentages. The direction comes from the 2011–2026 backtest; round multipliers are kept because finer tuning did not hold up out of sample.
- **Your holdings:** when holdings with market values are entered, their mix by sector. ETFs, funds and stocks the app does not cover are grouped as "ETFs & other".
- **Track record (July 2011–2026):** against untilted market weights the tilt returned +0.04%, +0.18% and +0.30% over 13, 26 and 52 weeks (ahead on 55%, 58% and 58% of dates), about the size of its margin of error. It held in 2011–2015, 2016–2019 and 2023–2026 and reversed in 2020–2022; finer-tuned multipliers did not hold up out of sample. The section states this.
- The same numbers are available as a table under "Show as table".

## News for your holdings

The first section on the page. Add holdings by hand (ticker and current market value) and it shows up to 3 recent headlines per ticker, up to 20 tickers.

- **Headlines:** `/api/news?symbols=AAPL,MSFT` returns them from Yahoo Finance's search endpoint. On Vercel this is the serverless function `api/news.js`; locally `server.mjs` serves the same route. Both use `api/_news.mjs`. Only ticker symbols are sent; market values stay in the browser, and nothing is stored.
- For covered stocks, each ticker card also shows its sector and that sector's reading from the sector ideas section.
- **Sentiment:** each headline is tagged Positive, Negative or Neutral by a finance word list in `api/_sentiment.mjs` (with handling for "not" and "despite"), and flagged when it doesn't name the company. Headline wording only; not a forecast.
- The market values feed the "Your holdings" series in the sector allocation chart.

## Stock universe

- **Today's data** (sector benchmarks, sector ranges, the Companies table, holdings lookups): every NYSE, Nasdaq and NYSE American common stock with a market cap of at least $300M, including the S&P 500 and USD-reporting ADRs, from Nasdaq Trader's symbol directory. S&P 500 members keep official GICS sectors from Wikipedia; the rest use Yahoo Finance's sector mapped to the matching GICS name. Shell companies (SPACs) and non-USD reporters are left out. About 2,700 companies.
- **History back to 2010** (sector charts over time, valuation vs. history, sector ideas, the allocation and past dates): S&P 500 members only, since history is rebuilt from SEC filings for those companies.
- The full data build takes about 7 minutes (~5,400 Yahoo lookups).

## Layout

- **Verdict panel** at the top answers "Is the market expensive right now?" from the S&P 500's median LTM P/E, EV/EBITDA and EV/Revenue against their own 5-year median: "No — cheaper than usual" (more than 10% below), "Not really" (3–10% below), "About normal" (within 3%), "A little" (3–10% above), "Yes" (10–20% above), "Very" (more than 20% above). Four tiles show the median P/E, median EV/EBITDA, and the cheapest and priciest sectors against their own history.
- **Sections**, in order: My portfolio (opens first), Sector valuations, Cheap or pricey vs. history, Charts and trends, Company screener. They're listed in a left sidebar on wide screens and a scrolling bar on narrow ones; each has its own link (e.g. `/#companies`).
