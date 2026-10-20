// Vercel serverless function: GET /api/news?symbols=AAPL,MSFT -> up to 3 recent headlines per ticker.
import { getNews, parseSymbols } from "./_news.mjs";

export default async function handler(req, res) {
  const symbols = parseSymbols(new URL(req.url, "http://localhost").searchParams.get("symbols"));
  if (!symbols.length) return res.status(400).json({ error: "No valid ticker symbols" });
  const results = await getNews(symbols);
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800"); // headlines are cached at the edge for 10 minutes
  res.status(200).json({ results });
}
