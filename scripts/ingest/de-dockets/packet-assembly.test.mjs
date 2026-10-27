import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCapture } from "./docketbird-capture.mjs";
import {
  DS_ENTRIES,
  SCHEMA,
  finish,
  masterLink,
  matterLink,
  clDocketUrl,
} from "./entries-packet.mjs";
import {
  assembleMdl,
  composeMatterPatch,
  partialMonths,
  splitOldestWindow,
  windowGap,
  FACT_CL,
  FACT_DB,
} from "./packet-assembly.mjs";
import { sheetEntries } from "./entries-packet.mjs";

const CASE = "njd-3:2026-md-03180";
const KEY = "njd:3:2026-md-03180";
const doc = (suffix, title, filing_date, extra = {}) => ({
  id: `${CASE}-${suffix}`,
  title,
  filing_date,
  restricted: false,
  primary_docket_sheet_number: /^\d{5}$/.test(suffix) ? Number(suffix) : null,
  downloaded: 1,
  canonical_url: `https://www.docketbird.com/court_documents?id=${CASE}-${suffix}`,
  ...extra,
});
const cap = (docs, entries_total, retrievedAt = "2026-10-27T14:00:00Z") =>
  normalizeCapture(
    JSON.stringify({ entries_total, entries_returned: docs.length, documents: docs }),
    { retrievedAt },
  );
const env = (run) => ({ run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl });
const target = {
  mdl: "3180",
  docket_key: KEY,
  court_id: "njd",
  docket_number: "3:26-md-03180",
  entries_docket_number: "3:26-md-3180",
  docketbird_case_id: CASE,
  docketbird_basis: "registry",
  cl_docket_ids: ["73443394"],
  cl_blocked: false,
  before: { rows: 10, max_date: "2026-10-02", max_entry_number: 37, providers: ["courtlistener"] },
};
const before = () => ({
  dataset: {
    3180: {
      rows: 10,
      max_date: "2026-10-02",
      w_text: 1,
      w_doc: 0,
      w_contact: 0,
      max_entry_number: 37,
      provider_rows: { courtlistener: 10 },
    },
  },
  matter_cells: { 3180: { entries_published: 10, entries_withheld: 1 } },
  matter_registry: {
    3180: {
      captures: [
        {
          provider: "courtlistener",
          docket_key: KEY,
          captured: 10,
          provider_total: 10,
          complete: true,
          observed_at: "2026-10-03T11:24:58.126Z",
        },
      ],
      entry_facts: [[FACT_CL, "10 / 10 (complete at capture)"]],
    },
  },
  existing_courtlistener_ids_since_max_date: { 3180: ["900"] },
});
const clRow = (id, entry_number, date_filed, description = "ORDER") => ({
  native_id: id,
  mdl: "3180",
  retrieved_at: "2026-10-27T15:00:00Z",
  payload_sha256: "x".repeat(64),
  data: {
    id: Number(id),
    docket: "https://www.courtlistener.com/api/rest/v4/dockets/73443394/",
    entry_number,
    date_filed,
    description,
    recap_documents: [],
  },
});
const recent = () =>
  cap(
    [
      doc("00040", "ORDER", "2026-10-22"),
      doc("00039", "NOTICE", "2026-10-10"),
      doc("00038", "MOTION", "2026-10-06"),
      doc("00036-t001", "Minute Entry", "2026-10-01", { downloaded: 0 }),
    ],
    54,
  );

test("only DocketBird entries above the published maximum are added; CourtListener rows are deduplicated", () => {
  const r = assembleMdl({
    t: target,
    before: before(),
    caps: [recent()],
    clRows: [
      clRow("900", 37, "2026-10-02"), // already published
      clRow("901", 38, "2026-10-06"), // same entry number as a DocketBird row of this packet
      clRow("902", null, "2026-10-03", "Minute entry"), // unnumbered, older than the first DocketBird row: added
      clRow("903", null, "2026-10-07", "Minute entry"), // unnumbered, on or after the first DocketBird row: skipped
      clRow("904", 41, "2026-10-24", null), // new and numbered: added, without text
    ],
    run: "run-1",
    entryEnv: env("run-1"),
  });
  const db = r.rows
    .filter((x) => x.item.cells.provider === "docketbird")
    .map((x) => x.item.cells.entry_number);
  const cl = r.rows
    .filter((x) => x.item.cells.provider === "courtlistener")
    .map((x) => x.item.cells.native_entry_id);
  assert.deepEqual(db.sort(), [38, 39, 40]);
  assert.deepEqual(cl.sort(), ["902", "904"]);
  const s = r.manifest.sources.courtlistener;
  assert.equal(s.already_published, 1);
  assert.equal(s.overlapping_docketbird, 2);
  assert.equal(s.new_entries, 2);
  assert.equal(s.new_entries_without_text, 1);
  assert.equal(r.manifest.after.rows, 15);
  assert.equal(r.manifest.gaps.length, 0);
  // the matter patch carries cells, both captures and the entry facts, each with the stored values it expects
  const m = r.matter;
  assert.deepEqual(m.expected_before, { entries_published: 10, entries_withheld: 1 });
  assert.deepEqual(m.set, { entries_published: 15, entries_withheld: 1 });
  const [dbCap, clCap] = m.registry_entries;
  assert.equal(dbCap.match, null);
  assert.equal(dbCap.set.provider, "docketbird");
  assert.equal(dbCap.set.captured, 3);
  assert.equal(dbCap.set.complete, false);
  assert.equal(dbCap.set.provider_total, null);
  assert.equal(dbCap.set.coverage.provider_documents_total, 54);
  assert.deepEqual(clCap.match, { captured: 10, observed_at: "2026-10-03T11:24:58.126Z" });
  assert.equal(clCap.set.captured, 12);
  assert.equal(clCap.set.complete, false);
  assert.deepEqual(m.entry_facts.expected, [[FACT_CL, "10 / 10 (complete at capture)"]]);
  assert.deepEqual(
    m.entry_facts.set.map((f) => f[0]),
    [FACT_CL, FACT_DB],
  );
});

test("an oldest window separated by a gap is held back and the gap and partial month are recorded", () => {
  const oldest = cap(
    [doc("00001", "TRANSFER ORDER", "2026-06-04"), doc("00002", "ORDER", "2026-06-11")],
    54,
  );
  const latest = cap(
    [doc("00040", "ORDER", "2026-10-22"), doc("00031", "ORDER", "2026-09-14")],
    54,
  );
  const t = {
    ...target,
    before: { rows: 0, max_date: null, max_entry_number: null, providers: [] },
  };
  const b = before();
  b.dataset[3180] = {
    rows: 0,
    max_date: null,
    w_text: 0,
    w_doc: 0,
    w_contact: 0,
    max_entry_number: null,
    provider_rows: {},
  };
  b.matter_cells[3180] = { entries_published: 0, entries_withheld: 0 };
  b.matter_registry[3180] = { captures: [], entry_facts: [[FACT_CL, "Not recorded"]] };
  const held = assembleMdl({ t, before: b, caps: [oldest, latest], run: "r", entryEnv: env("r") });
  assert.deepEqual(
    held.rows.map((x) => x.item.cells.entry_number).sort((a, c) => a - c),
    [31, 40],
  );
  assert.equal(held.heldRows.length, 2);
  assert.deepEqual(held.manifest.gaps, [
    {
      provider: "docketbird",
      kind: "between_oldest_and_newest_window",
      entry_numbers: { from: 3, to: 30 },
    },
  ]);
  const c = held.matter.registry_entries[0].set;
  assert.deepEqual(c.coverage.partial_months, ["2026-09"]);
  assert.equal(c.coverage.held_back_rows, 2);
  assert.match(c.qualification, /Entries 3–30 are not recorded/);
  const all = assembleMdl({
    t,
    before: b,
    caps: [oldest, latest],
    run: "r",
    includeOldest: true,
    entryEnv: env("r"),
  });
  assert.equal(all.rows.length, 4);
  assert.deepEqual(all.matter.registry_entries[0].set.coverage.partial_months, [
    "2026-06",
    "2026-09",
  ]);
});

test("a gap between the published rows and the newest window counts what CourtListener filled", () => {
  const latest = cap(
    [doc("00045", "ORDER", "2026-10-22"), doc("00043", "ORDER", "2026-10-07")],
    54,
  );
  const r = assembleMdl({
    t: target,
    before: before(),
    caps: [latest],
    clRows: [clRow("910", 38, "2026-10-03"), clRow("911", 40, "2026-10-05")],
    run: "r",
    entryEnv: env("r"),
  });
  const g = r.manifest.gaps.find((x) => x.kind === "between_published_and_newest_window");
  assert.deepEqual(g.entry_numbers, { from: 38, to: 42 });
  assert.equal(g.filled_from_courtlistener, 2);
  assert.equal(g.still_missing, 3);
  assert.deepEqual(r.matter.registry_entries[0].set.coverage.partial_months, ["2026-10"]);
});

test("window helpers", () => {
  const ws = [
    {
      sort: "chronological",
      min_number: 1,
      max_number: 10,
      min_date: "2020-01-02",
      max_date: "2020-03-04",
    },
    {
      sort: "recent",
      min_number: 50,
      max_number: 60,
      min_date: "2024-05-06",
      max_date: "2026-10-01",
    },
  ];
  assert.deepEqual(windowGap(ws), { from: 11, to: 49 });
  assert.equal(windowGap([ws[1]]), null);
  assert.equal(windowGap([{ ...ws[0], max_number: 49 }, ws[1]]), null);
  const e = sheetEntries([recent()]).entries;
  assert.equal(splitOldestWindow(e, [ws[1]]).held.length, 0);
  assert.deepEqual(
    partialMonths({
      windows: ws,
      gaps: [{ kind: "between_published_and_newest_window", still_missing: 0 }],
      publishedMaxDate: "2024-01-01",
    }),
    [],
  );
  assert.deepEqual(
    partialMonths({
      windows: ws,
      gaps: [{ kind: "between_published_and_newest_window", still_missing: 4 }],
      publishedMaxDate: "2024-03-30",
    }),
    ["2024-03", "2024-04", "2024-05"],
  );
});

test("composeMatterPatch applies once, is idempotent for the same run and refuses changed records", () => {
  const r = assembleMdl({
    t: target,
    before: before(),
    caps: [recent()],
    run: "run-1",
    entryEnv: env("run-1"),
  });
  const p = r.matter;
  const stored = {
    item: {
      cells: { mdl_number: "3180", entries_published: 10, entries_withheld: 1, other: "kept" },
    },
    detail: {
      facts: [
        ["MDL", "3180"],
        [FACT_CL, "10 / 10 (complete at capture)"],
        ["Court", "njd"],
      ],
      registry: {
        mdl: "3180",
        entries: [
          {
            provider: "courtlistener",
            docket_key: KEY,
            captured: 10,
            provider_total: 10,
            complete: true,
            observed_at: "2026-10-03T11:24:58.126Z",
          },
        ],
      },
    },
  };
  const out = composeMatterPatch(stored, p);
  assert.equal(out.state, "apply");
  assert.equal(out.item.cells.entries_published, 13);
  assert.equal(out.item.cells.other, "kept");
  assert.deepEqual(
    out.detail.facts.map((f) => f[0]),
    ["MDL", FACT_CL, FACT_DB, "Court"],
  );
  const dbCap = out.detail.registry.entries.find((e) => e.provider === "docketbird");
  assert.equal(dbCap.captured, 3);
  assert.equal(dbCap.previous_snapshot, undefined);
  assert.equal(out.detail.registry.mdl, "3180");
  // the CourtListener capture is untouched: no CourtListener rows were added
  assert.equal(
    out.detail.registry.entries.find((e) => e.provider === "courtlistener").captured,
    10,
  );
  // re-running against the patched record is a no-op
  assert.equal(composeMatterPatch({ item: out.item, detail: out.detail }, p).state, "done");
  // a record that changed since the snapshot is refused
  const moved = structuredClone(stored);
  moved.item.cells.entries_published = 11;
  assert.equal(composeMatterPatch(moved, p).state, "stale");
  const otherFacts = structuredClone(stored);
  otherFacts.detail.facts[1] = [FACT_CL, "11 / 11 (complete at capture)"];
  assert.equal(composeMatterPatch(otherFacts, p).state, "stale");
  const extraCapture = structuredClone(stored);
  extraCapture.detail.registry.entries.push({
    provider: "docketbird",
    docket_key: KEY,
    captured: 1,
  });
  assert.equal(composeMatterPatch(extraCapture, p).state, "stale");
});

test("an existing capture of the same provider is kept as previous_snapshot", () => {
  const r = assembleMdl({
    t: target,
    before: before(),
    caps: [],
    clRows: [clRow("920", 38, "2026-10-05")],
    run: "run-2",
    entryEnv: env("run-2"),
  });
  const stored = {
    item: { cells: { entries_published: 10, entries_withheld: 1 } },
    detail: {
      facts: [[FACT_CL, "10 / 10 (complete at capture)"]],
      registry: {
        entries: [{ ...before().matter_registry[3180].captures[0], refresh_run: "old" }],
      },
    },
  };
  const out = composeMatterPatch(stored, r.matter);
  assert.equal(out.state, "apply");
  const [c] = out.detail.registry.entries;
  assert.equal(c.captured, 11);
  assert.equal(c.refresh_run, "run-2");
  assert.equal(c.previous_snapshot.refresh_run, "old");
  assert.equal(c.previous_snapshot.captured, 10);
  assert.match(out.detail.facts[0][1], /^11 published; 1 added in an incremental pass/);
});
