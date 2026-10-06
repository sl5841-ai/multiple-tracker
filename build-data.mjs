// Builds the static data files under public/data/ that the hosted site serves.
//   node build-data.mjs            snapshot always; history only when it is more than 7 days old
//   node build-data.mjs --history  force a history rebuild too
import { buildSnapshot, buildHistory, loadHistory } from "./data.mjs";

const forceHistory = process.argv.includes("--history");
const HIST_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const job = { done: 0, total: 0, errors: [] };
const store = await buildSnapshot(job);
console.log(`Snapshot: ${store.companies.length} companies, ${job.errors.length} errors`);

const history = await loadHistory();
if (forceHistory || !history.updatedAt || Date.now() - new Date(history.updatedAt) > HIST_STALE_MS) {
  const hjob = { done: 0, total: 0, errors: [] };
  const h = await buildHistory(store, hjob);
  console.log(`History: ${Object.keys(h.series).length} companies, ${hjob.errors.length} errors`);
} else {
  console.log(`History is current (${history.updatedAt}), skipped`);
}
