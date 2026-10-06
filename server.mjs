// Local server for the S&P 500 trading multiples app.
// Serves public/ (the page plus the static JSON under public/data/) and adds a refresh API on top.
// The same public/ folder can be hosted as a plain static site (see build-data.mjs).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, buildHistory, loadStore, loadHistory } from "./data.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;
const STALE_MS = 24 * 60 * 60 * 1000;
const HIST_STALE_MS = 7 * 24 * 60 * 60 * 1000;

let store = await loadStore();
let history = await loadHistory();
let job = { running: false, done: 0, total: 0, errors: [] };
let histJob = { running: false, done: 0, total: 0, errors: [] };

const stale = (iso, ms) => !iso || Date.now() - new Date(iso) > ms;

async function refresh() {
  if (job.running) return;
  job = { running: true, done: 0, total: 0, errors: [] };
  try {
    store = await buildSnapshot(job);
    console.log(`Refreshed ${store.companies.length} companies (${job.errors.length} errors)`);
    if (stale(history.updatedAt, HIST_STALE_MS)) refreshHistory();
  } catch (e) {
    job.errors.push(`Refresh failed: ${e.message}`);
    console.error(e);
  } finally {
    job.running = false;
  }
}

async function refreshHistory() {
  if (histJob.running || !store.companies.length) return;
  histJob = { running: true, done: 0, total: 0, errors: [] };
  try {
    history = await buildHistory(store, histJob);
    console.log(`History refreshed for ${Object.keys(history.series).length} companies (${histJob.errors.length} errors)`);
  } catch (e) {
    histJob.errors.push(`History refresh failed: ${e.message}`);
    console.error(e);
  } finally {
    histJob.running = false;
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (obj, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/api/status") return json({ updatedAt: store.updatedAt, job, histJob, histUpdatedAt: history.updatedAt });
  if (url.pathname === "/api/refresh" && req.method === "POST") {
    refresh();
    return json({ started: true });
  }
  if (url.pathname === "/api/history/refresh" && req.method === "POST") {
    refreshHistory();
    return json({ started: true });
  }

  const file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return json({ error: "forbidden" }, 403);
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    json({ error: "not found" }, 404);
  }
});

if (stale(store.updatedAt, STALE_MS)) refresh();
else if (stale(history.updatedAt, HIST_STALE_MS)) refreshHistory();

server.listen(PORT, () => console.log(`S&P 500 multiples app: http://localhost:${PORT}`));
