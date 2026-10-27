// Builds the de-dockets republish packet (dry-run only: this script never writes to the database).
//   node scripts/ingest/de-dockets/build-entries-packet.mjs --acq=<private acq dir> [--run=<uuid>]
// Reads   <acq>/docketbird-sheets/*.json (landed connector captures), <acq>/courtlistener-entries.jsonl (collected CourtListener entries),
//         master-targets-2026-10-27.json and before-counts-2026-10-27.json (frozen read-only SELECT results).
// Writes  <acq>/packets/<run>/sw_docket_entries_v1.upsert.jsonl          rows to add under the current publication rule
//         <acq>/packets/<run>/sw_docket_entries_v1.release-text-mentions.jsonl  OPTIONAL: the same new rows rebuilt under the 2026-10-23 rule,
//                                                                            only those whose description changes (not applied by default)
//         <acq>/packets/<run>/sw_matters_v1.cells-patch.json             entries_published / entries_withheld per matter, with the expected values before
//         <acq>/packets/<run>/manifest.json                              per-MDL before/after counts, provider windows, gaps, file hashes
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeEntryRecord } from "../members-entry-record.mjs";
import { sha256 } from "../members-publish-rules.mjs";
import {
  DS_ENTRIES,
  SCHEMA,
  finish,
  masterLink,
  matterLink,
  clDocketUrl,
  sheetEntries,
  selectNew,
  gapAfterPublished,
  docketbirdEntryRecord,
  tally,
} from "./entries-packet.mjs";

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
const targets = JSON.parse(
  fs.readFileSync(path.join(here, "master-targets-2026-10-27.json"), "utf8"),
).targets;
const before = JSON.parse(
  fs.readFileSync(path.join(here, "before-counts-2026-10-27.json"), "utf8"),
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

const out = {
  upsert: [],
  release: [],
  matters: [],
  manifest: {
    schema_version: "de-dockets-packet/1",
    run,
    built_at: new Date().toISOString(),
    dataset: DS_ENTRIES,
    database_writes: 0,
    rule_default: "show as published, current §6.0 rule (exclusion pattern applied)",
    rule_optional:
      "2026-10-23 night rule: exclusion pattern not applied; provider restriction and contact fields still withhold",
    mdls: {},
  },
};
const ids = new Set();
for (const t of targets) {
  const ctx = {
    mdl: t.mdl,
    docket_key: t.docket_key,
    docket_number: t.entries_docket_number ?? t.docket_number,
    court_id: t.court_id,
    docketbird_case_id: t.docketbird_case_id,
  };
  const b = before.dataset[t.mdl];
  const maxNum = t.before.max_entry_number;
  const m = {
    before: { rows: b.rows, max_date: b.max_date, withheld: b.w_text + b.w_doc + b.w_contact },
    sources: {},
    added: null,
    after: null,
    gaps: [],
  };
  const rows = [];
  const releaseRows = [];
  // DocketBird
  const caps = capturesByCase.get(t.docketbird_case_id) ?? [];
  if (caps.length) {
    const { entries, windows, stats } = sheetEntries(caps);
    const fresh = selectNew(entries, maxNum);
    for (const e of fresh) {
      const { rec } = docketbirdEntryRecord(e, ctx, { run });
      if (ids.has(rec.id)) continue;
      ids.add(rec.id);
      rows.push(rec);
      const alt = docketbirdEntryRecord(e, ctx, { run, releaseTextMentions: true }).rec;
      if (alt.item.cells.description_withheld !== rec.item.cells.description_withheld)
        releaseRows.push(alt);
    }
    const gap = gapAfterPublished(windows, maxNum);
    if (gap)
      m.gaps.push({
        provider: "docketbird",
        kind: "between_published_and_newest_window",
        entry_numbers: gap,
      });
    const chrono = windows.filter((w) => w.sort === "chronological" && w.max_number != null);
    const recent = windows.filter((w) => w.sort === "recent" && w.min_number != null);
    if (chrono.length && recent.length) {
      const hi = Math.max(...chrono.map((w) => w.max_number)),
        lo = Math.min(...recent.map((w) => w.min_number));
      if (lo > hi + 1)
        m.gaps.push({
          provider: "docketbird",
          kind: "between_oldest_and_newest_window",
          entry_numbers: { from: hi + 1, to: lo - 1 },
        });
    }
    if (!chrono.length && maxNum == null)
      m.gaps.push({
        provider: "docketbird",
        kind: "older_than_newest_window",
        note: "only the newest window was read",
      });
    m.sources.docketbird = {
      case_id: t.docketbird_case_id,
      basis: t.docketbird_basis,
      windows,
      stats,
      entries_in_windows: entries.length,
      new_entries: fresh.length,
    };
  } else {
    m.sources.docketbird = {
      case_id: t.docketbird_case_id,
      windows: [],
      note: "no capture: the connector did not answer for this docket (timed out)",
    };
  }
  // CourtListener (incremental collection)
  const clRows = clByMdl.get(t.mdl) ?? [];
  if (clRows.length) {
    const existing = new Set(before.existing_courtlistener_ids_since_max_date[t.mdl] ?? []);
    // An entry already added from the DocketBird sheet (same docket, same entry number) is not added twice; an unnumbered CourtListener entry
    // is added only when it is older than the first DocketBird row added for the MDL (from that date on the sheet's text entries stand for it).
    const dbRows = rows.filter((r) => r.item.cells.provider === "docketbird");
    const dbNumbers = new Set(
      dbRows.filter((r) => r.item.cells.entry_number != null).map((r) => r.item.cells.entry_number),
    );
    const dbRecentMin =
      dbRows
        .map((r) => r.item.cells.date_filed)
        .filter(Boolean)
        .sort()[0] ?? null;
    let added = 0,
      skippedOverlap = 0;
    for (const r of clRows) {
      if (existing.has(r.native_id)) continue;
      const n = Number.isInteger(r.data.entry_number) ? r.data.entry_number : null;
      if (
        (n != null && dbNumbers.has(n)) ||
        (n == null && dbRecentMin && (r.data.date_filed ?? "9999") >= dbRecentMin)
      ) {
        skippedOverlap++;
        continue;
      }
      const { rec } = makeEntryRecord(
        r,
        { ...ctx, no_registry_links: false },
        { run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl },
      );
      if (ids.has(rec.id)) continue;
      ids.add(rec.id);
      rows.push(rec);
      added++;
    }
    m.sources.courtlistener = {
      docket: t.cl_docket_ids[0],
      fetched: clRows.length,
      already_published: clRows.length - added - skippedOverlap,
      overlapping_docketbird: skippedOverlap,
      new_entries: added,
      dates: [
        clRows
          .map((r) => r.data.date_filed)
          .filter(Boolean)
          .sort()[0] ?? null,
        clRows
          .map((r) => r.data.date_filed)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      ],
    };
    const g = m.gaps.find((x) => x.kind === "between_published_and_newest_window");
    if (g) {
      const got = new Set(
        rows
          .filter(
            (r) => r.item.cells.provider === "courtlistener" && r.item.cells.entry_number != null,
          )
          .map((r) => r.item.cells.entry_number),
      );
      let missing = 0;
      for (let k = g.entry_numbers.from; k <= g.entry_numbers.to; k++) if (!got.has(k)) missing++;
      g.filled_from_courtlistener = g.entry_numbers.to - g.entry_numbers.from + 1 - missing;
      g.still_missing = missing;
    }
  }
  const addedTally = tally(rows);
  m.added = addedTally;
  m.after = {
    rows: b.rows + addedTally.rows,
    withheld: m.before.withheld + addedTally.withheld,
    max_date: [b.max_date, addedTally.max_date].filter(Boolean).sort().at(-1) ?? null,
  };
  // CourtListener rows are rebuilt by the registry projector, which reads the lake text; here they are only counted for the optional rule.
  const clTextIds = rows
    .filter(
      (r) =>
        r.item.cells.provider === "courtlistener" &&
        r.item.cells.description_withheld === "sealed_or_restricted_text",
    )
    .map((r) => r.id);
  m.optional_release = {
    docketbird_rows_changed: releaseRows.length,
    courtlistener_text_withheld_ids: clTextIds,
  };
  out.upsert.push(...rows);
  out.release.push(...releaseRows);
  const cellsBefore = before.matter_cells[t.mdl];
  if (cellsBefore)
    out.matters.push({
      id: `sw-matter:${t.mdl}`,
      expected_before: cellsBefore,
      set: { entries_published: m.after.rows, entries_withheld: m.after.withheld },
    });
  out.manifest.mdls[t.mdl] = m;
}

out.upsert.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
const dir = path.join(acq, "packets", run);
fs.mkdirSync(dir, { recursive: true });
const write = (name, body) => {
  fs.writeFileSync(path.join(dir, name), body);
  return { file: name, sha256: sha256(body), bytes: Buffer.byteLength(body) };
};
out.manifest.files = [
  {
    ...write(
      "sw_docket_entries_v1.upsert.jsonl",
      out.upsert.map((r) => JSON.stringify(r)).join("\n") + (out.upsert.length ? "\n" : ""),
    ),
    rows: out.upsert.length,
    applies: "default",
  },
  {
    ...write(
      "sw_docket_entries_v1.release-text-mentions.jsonl",
      out.release.map((r) => JSON.stringify(r)).join("\n") + (out.release.length ? "\n" : ""),
    ),
    rows: out.release.length,
    applies: "optional, only with an explicit owner decision",
  },
  {
    ...write("sw_matters_v1.cells-patch.json", JSON.stringify(out.matters, null, 1)),
    rows: out.matters.length,
    applies: "default",
  },
];
out.manifest.totals = {
  before_rows: Object.values(out.manifest.mdls).reduce((s, m) => s + m.before.rows, 0),
  added_rows: out.upsert.length,
  added_withheld: out.upsert.filter((r) => r.item.cells.description_withheld).length,
  optional_release_rows: out.release.length,
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
      "max " + m.before.max_date + "->" + m.after.max_date,
      m.gaps
        .map(
          (g) =>
            g.kind + (g.entry_numbers ? `[${g.entry_numbers.from}-${g.entry_numbers.to}]` : ""),
        )
        .join(";"),
    ].join(" "),
  );
