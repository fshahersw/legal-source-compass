// Incremental, read-only CourtListener docket-entries collection for registry master dockets (workstream de-dockets).
// For each target MDL it reads docket-entries of the exact CourtListener master docket id filed on or after the MDL's latest captured date,
// pages through the cursor, and keeps every raw response content-addressed in <acq>/courtlistener-raw plus one normalized line per entry in
// <acq>/courtlistener-entries.jsonl ({native_id, data, payload_sha256, retrieved_at, source_url}, the lake-row shape makeEntryRecord reads).
// Quota: the live usage API is authoritative (the account is shared). The run stops when the daily remaining count reaches --reserve or after
// --max-requests requests. Credentials: COURTLISTENER_API_KEY from the environment only; never logged.
//   node --use-system-ca scripts/ingest/de-dockets/collect-courtlistener.mjs --acq=<dir> --mdls=2741,2804,2873 [--max-requests=25] [--reserve=40]
//        [--shared-ledger=<courtlistener-client cache>/rate-ledger.json] [--execute]
import fs from "node:fs";
import path from "node:path";
import { CourtListener, Stop } from "../gap-fill/clients.mjs";
import { sha256 } from "./docketbird-capture.mjs";
import { appendSharedLedger } from "./shared-ledger.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.acq || !args.mdls) throw new Error("--acq and --mdls are required");
const acq = path.resolve(args.acq);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const targets = JSON.parse(
  fs.readFileSync(path.join(here, "master-targets-2026-10-27.json"), "utf8"),
).targets;
const wanted = String(args.mdls).split(",").filter(Boolean);
// Optional explicit windows (--window=<mdl>:<from>:<to>, repeatable with commas) close a gap between published rows and a provider window.
const windows = new Map(
  String(args.window ?? "")
    .split(",")
    .filter(Boolean)
    .map((w) => {
      const [m, from, to] = w.split(":");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        throw new Error(`bad --window ${w}`);
      return [m, { from, to }];
    }),
);
const plan = wanted
  .map((m) => targets.find((t) => t.mdl === m))
  .filter(Boolean)
  .filter((t) => !t.cl_blocked && t.cl_docket_ids.length === 1 && t.before.max_date)
  .map((t) => ({
    mdl: t.mdl,
    docket: t.cl_docket_ids[0],
    since: windows.get(t.mdl)?.from ?? t.before.max_date,
    until: windows.get(t.mdl)?.to ?? null,
  }));
if (!args.execute) {
  console.log(JSON.stringify({ state: "dry-run", plan, database_writes: 0 }));
  process.exit(0);
}

const cl = new CourtListener({
  cacheDir: path.join(acq, "courtlistener-raw"),
  token: process.env.COURTLISTENER_API_KEY,
  maxRequests: Number(args["max-requests"] ?? 25),
  reserve: Number(args.reserve ?? 40),
});
const out = path.join(acq, "courtlistener-entries.jsonl");
const ledger = path.join(acq, "courtlistener-ledger.jsonl");
// --shared-ledger=<cache>/rate-ledger.json also records each request in the shared ledger of courtlistener-client.mjs.
const sharedLedger = args["shared-ledger"] ? path.resolve(args["shared-ledger"]) : null;
if (sharedLedger && fs.existsSync(path.join(path.dirname(sharedLedger), "api-collector.lock")))
  throw new Error(
    "another CourtListener collector holds the shared lock; run when it has finished",
  );
const seen = new Set(
  fs.existsSync(out)
    ? fs
        .readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l).native_id)
    : [],
);
const summary = [];
try {
  for (const p of plan) {
    let next = `https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=${p.docket}&date_filed__gte=${p.since}${p.until ? `&date_filed__lte=${p.until}` : ""}`;
    const s = {
      mdl: p.mdl,
      docket: p.docket,
      since: p.since,
      until: p.until,
      pages: 0,
      entries: 0,
      new_entries: 0,
      complete: false,
    };
    summary.push(s);
    while (next) {
      const { data, receipt } = await cl.get(next);
      if (sharedLedger) appendSharedLedger(sharedLedger, receipt.retrieved_at);
      fs.appendFileSync(
        ledger,
        JSON.stringify({
          at: receipt.retrieved_at,
          url: next,
          status: receipt.http_status,
          sha256: receipt.source_sha256,
        }) + "\n",
      );
      if (!data || !Array.isArray(data.results)) throw new Stop("UNEXPECTED_BODY", next);
      for (const item of data.results) {
        const docketId = String(item.docket ?? "").match(/\/dockets\/(\d+)\//)?.[1];
        if (docketId !== p.docket) throw new Stop("DOCKET_MISMATCH", `${docketId} != ${p.docket}`);
        s.entries++;
        const nativeId = String(item.id);
        if (seen.has(nativeId)) continue;
        seen.add(nativeId);
        s.new_entries++;
        fs.appendFileSync(
          out,
          JSON.stringify({
            native_id: nativeId,
            mdl: p.mdl,
            data: item,
            payload_sha256: sha256(JSON.stringify(item)),
            retrieved_at: receipt.retrieved_at,
            source_url: next,
            source_sha256: receipt.source_sha256,
          }) + "\n",
        );
      }
      s.pages++;
      next = data.next ?? null;
    }
    s.complete = true;
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  summary.push({ stopped: e.message });
}
const usage =
  cl.usage?.current_usage
    ?.filter((x) => x.scope === "user")
    .map((x) => ({ rate: x.rate, remaining: x.remaining })) ?? null;
console.log(JSON.stringify({ requests: cl.requests, usage_after: usage, summary }));
fs.writeFileSync(
  path.join(acq, "courtlistener-summary.json"),
  JSON.stringify({ at: new Date().toISOString(), requests: cl.requests, summary }, null, 1),
);
