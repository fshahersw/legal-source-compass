// Builds the de-dockets republish packet (dry-run only: this script never writes to the database).
//   node scripts/ingest/de-dockets/build-entries-packet.mjs --acq=<private acq dir> [--run=<uuid>] [--before=<file>] [--targets=<file>]
//                                                           [--include-oldest-windows]
// Reads   <acq>/docketbird-sheets/*.json (landed connector captures), <acq>/courtlistener-entries.jsonl (collected CourtListener entries),
//         the master targets (default master-targets-2026-10-27.json; regenerate with snapshot-targets.sql) and the before snapshot
//         (default before-counts-2026-10-27.json; regenerate with snapshot-before.sql whenever the dataset or the matters changed).
// Writes  <acq>/packets/<run>/sw_docket_entries_v1.upsert.jsonl          rows to add under the current publication rule
//         <acq>/packets/<run>/sw_docket_entries_v1.release-text-mentions.jsonl  OPTIONAL: the same new rows rebuilt under the 2026-10-23 rule,
//                                                                            only those whose description changes (not applied by default)
//         <acq>/packets/<run>/sw_docket_entries_v1.held-oldest-windows.jsonl     HELD, review only: oldest-window rows separated from the newest
//                                                                            window by a gap (published only with --include-oldest-windows)
//         <acq>/packets/<run>/sw_matters_v1.cells-patch.json             per matter: entries_published / entries_withheld, the registry.entries
//                                                                            captures and the entry facts, each with the values expected before
//         <acq>/packets/<run>/manifest.json                              per-MDL before/after counts, provider windows, gaps, file hashes
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sha256 } from "../members-publish-rules.mjs";
import {
  DS_ENTRIES,
  SCHEMA,
  finish,
  masterLink,
  matterLink,
  clDocketUrl,
} from "./entries-packet.mjs";
import { assembleMdl } from "./packet-assembly.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.acq) throw new Error("--acq is required");
const acq = path.resolve(args.acq);
const run = args.run ?? randomUUID();
const includeOldest = args["include-oldest-windows"] === "true";
const targetsFile = path.resolve(args.targets ?? path.join(here, "master-targets-2026-10-27.json"));
const beforeFile = path.resolve(args.before ?? path.join(here, "before-counts-2026-10-27.json"));
const targets = JSON.parse(fs.readFileSync(targetsFile, "utf8")).targets;
const before = JSON.parse(fs.readFileSync(beforeFile, "utf8"));
if (!before.matter_registry)
  throw new Error(
    "the before snapshot has no matter_registry section; regenerate it with snapshot-before.sql",
  );

// ---- landed captures by case ----
const sheetDir = path.join(acq, "docketbird-sheets");
const capturesByCase = new Map();
for (const f of fs.existsSync(sheetDir)
  ? fs.readdirSync(sheetDir).filter((f) => f.endsWith(".json"))
  : []) {
  const cap = JSON.parse(fs.readFileSync(path.join(sheetDir, f), "utf8"));
  if (cap.schema_version !== "de-dockets-docketbird-capture/1") continue;
  const list = capturesByCase.get(cap.case_id) ?? [];
  list.push(cap);
  capturesByCase.set(cap.case_id, list);
}
// ---- collected CourtListener entries by MDL ----
const clFile = path.join(acq, "courtlistener-entries.jsonl");
const clByMdl = new Map();
for (const line of fs.existsSync(clFile)
  ? fs.readFileSync(clFile, "utf8").split("\n").filter(Boolean)
  : []) {
  const r = JSON.parse(line);
  const list = clByMdl.get(r.mdl) ?? [];
  list.push(r);
  clByMdl.set(r.mdl, list);
}

const entryEnv = { run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl };
const out = {
  upsert: [],
  release: [],
  held: [],
  matters: [],
  manifest: {
    schema_version: "de-dockets-packet/2",
    run,
    built_at: new Date().toISOString(),
    dataset: DS_ENTRIES,
    database_writes: 0,
    inputs: {
      targets: { file: path.basename(targetsFile), sha256: sha256(fs.readFileSync(targetsFile)) },
      before: {
        file: path.basename(beforeFile),
        sha256: sha256(fs.readFileSync(beforeFile)),
        read_at: before.read_at_registry ?? before.read_at,
      },
    },
    rule_default: "show as published, current §6.0 rule (exclusion pattern applied)",
    rule_optional:
      "2026-10-23 night rule: exclusion pattern not applied; provider restriction and contact fields still withhold",
    oldest_windows: includeOldest ? "published" : "held back (gap to the newest window)",
    mdls: {},
  },
};
const seenIds = new Set();
for (const t of targets) {
  const r = assembleMdl({
    t,
    before,
    caps: capturesByCase.get(t.docketbird_case_id) ?? [],
    clRows: clByMdl.get(t.mdl) ?? [],
    run,
    includeOldest,
    seenIds,
    entryEnv,
  });
  out.upsert.push(...r.rows);
  out.release.push(...r.releaseRows);
  out.held.push(...r.heldRows);
  if (r.matter) out.matters.push(r.matter);
  out.manifest.mdls[t.mdl] = r.manifest;
}

out.upsert.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
const dir = path.join(acq, "packets", run);
fs.mkdirSync(dir, { recursive: true });
const write = (name, body) => {
  fs.writeFileSync(path.join(dir, name), body);
  return { file: name, sha256: sha256(body), bytes: Buffer.byteLength(body) };
};
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
out.manifest.files = [
  {
    ...write("sw_docket_entries_v1.upsert.jsonl", jsonl(out.upsert)),
    rows: out.upsert.length,
    applies: "default",
  },
  {
    ...write("sw_docket_entries_v1.release-text-mentions.jsonl", jsonl(out.release)),
    rows: out.release.length,
    applies: "optional, only with an explicit owner decision",
  },
  {
    ...write("sw_docket_entries_v1.held-oldest-windows.jsonl", jsonl(out.held)),
    rows: out.held.length,
    applies:
      "never by apply-packet.mjs; review only (rebuild with --include-oldest-windows to publish)",
  },
  {
    ...write("sw_matters_v1.cells-patch.json", JSON.stringify(out.matters, null, 1)),
    rows: out.matters.length,
    applies: "default",
  },
];
const byProvider = (p) => out.upsert.filter((r) => r.item.cells.provider === p).length;
out.manifest.totals = {
  before_rows: Object.values(out.manifest.mdls).reduce((s, m) => s + m.before.rows, 0),
  added_rows: out.upsert.length,
  added_docketbird: byProvider("docketbird"),
  added_courtlistener: byProvider("courtlistener"),
  added_withheld: out.upsert.filter((r) => r.item.cells.description_withheld).length,
  held_oldest_window_rows: out.held.length,
  optional_release_rows: out.release.length,
  availability: out.upsert.reduce(
    (a, r) => ((a[r.item.cells.availability] = (a[r.item.cells.availability] ?? 0) + 1), a),
    {},
  ),
  existing_withheld_text_release_estimate: before.withheld_text_release_estimate,
};
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(out.manifest, null, 1));
console.log(
  JSON.stringify({
    run,
    dir,
    ...out.manifest.totals,
    existing_withheld_text_release_estimate: undefined,
  }),
);
for (const [mdl, m] of Object.entries(out.manifest.mdls))
  console.log(
    [
      mdl,
      m.before.rows,
      "+" + m.added.rows,
      "=" + m.after.rows,
      "withheld+" + m.added.withheld,
      "held " + (m.held_back?.rows ?? 0),
      "max " + m.before.max_date + "->" + m.after.max_date,
      m.gaps
        .map(
          (g) =>
            g.kind + (g.entry_numbers ? `[${g.entry_numbers.from}-${g.entry_numbers.to}]` : ""),
        )
        .join(";"),
    ].join(" "),
  );
