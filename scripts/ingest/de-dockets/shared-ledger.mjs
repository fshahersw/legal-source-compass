// Records de-dockets CourtListener requests in the shared rate ledger of scripts/ingest/courtlistener-client.mjs
// (<cache>/rate-ledger.json, {"timestamps": [epoch ms, ...]}, entries older than 24 h are pruned by that client).
// The live usage API stays authoritative for quota; the ledger lets the other collectors pace against these requests too.
//   node scripts/ingest/de-dockets/shared-ledger.mjs --from=<acq>/courtlistener-ledger.jsonl --to=<cache>/rate-ledger.json [--execute]
// Dry run by default. Refuses while another collector holds <cache>/api-collector.lock; a request already in the ledger (same ms) is not added twice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Merges request times (ISO strings) into a ledger object; returns {ledger, added}. Pure. */
export function mergeLedger(ledger, isoTimes) {
  const have = new Set(ledger?.timestamps ?? []);
  const add = isoTimes
    .map((t) => Date.parse(t))
    .filter((ms) => Number.isFinite(ms) && !have.has(ms));
  const timestamps = [...have, ...new Set(add)].sort((a, b) => a - b);
  return { ledger: { ...(ledger ?? {}), timestamps }, added: new Set(add).size };
}

/** Appends one request time to the shared ledger file (used by collect-courtlistener.mjs --shared-ledger). */
export function appendSharedLedger(file, iso) {
  const current = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { timestamps: [] };
  const { ledger } = mergeLedger(current, [iso]);
  fs.writeFileSync(file, JSON.stringify(ledger));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const i = a.indexOf("=");
      return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
    }),
  );
  if (!args.from || !args.to) throw new Error("--from and --to are required");
  const to = path.resolve(args.to);
  if (fs.existsSync(path.join(path.dirname(to), "api-collector.lock")))
    throw new Error(
      "another CourtListener collector holds the lock; run this when it has finished",
    );
  const times = fs
    .readFileSync(path.resolve(args.from), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).at);
  const current = fs.existsSync(to) ? JSON.parse(fs.readFileSync(to, "utf8")) : { timestamps: [] };
  const { ledger, added } = mergeLedger(current, times);
  console.log(
    JSON.stringify({
      mode: args.execute ? "execute" : "dry-run",
      requests: times.length,
      added,
      ledger: to,
    }),
  );
  if (args.execute) fs.writeFileSync(to, JSON.stringify(ledger));
}
