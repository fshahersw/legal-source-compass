import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  planSlices,
  nativeSignature,
  observationSignature,
  projectSql,
  verifySql,
  publishSql,
  esc,
} from "./ecfr-projection-v2.mjs";
const template = await readFile(
  new URL("../../database/contracts/ecfr-expected-records-v2.sql", import.meta.url),
  "utf8",
);
const run = "4cccf130-063b-4c6f-84ad-96bbfcfa0d84";
const plan = "b".repeat(64);
function row(id, hash = "a".repeat(64)) {
  return {
    native_id: id,
    payload_sha256: hash,
    observation: [
      id,
      hash,
      "https://www.ecfr.gov/api/versioner/v1/structure/2026-09-30/title-1.json",
      "c".repeat(64),
      "2026-09-30",
      "2026-10-02T10:21:51.535Z",
      "publisher-tree",
      "sorted-key-compact-utf8-json",
      200,
    ],
  };
}
function scope(rows, dataset = "ecfr_hierarchy", size = 2) {
  const sorted = [...rows].sort((a, b) =>
    Buffer.compare(Buffer.from(a.native_id), Buffer.from(b.native_id)),
  );
  const config = {
    dataset,
    type: dataset === "ecfr_hierarchy" ? "hierarchy-nodes" : "part-authority-notes",
    schema: dataset === "ecfr_hierarchy" ? "ecfr-hierarchy-metadata/1" : "ecfr-authority-notes/1.1",
  };
  const slices = planSlices(rows, size);
  return {
    ...config,
    records: rows.length,
    first: sorted[0].native_id,
    last: sorted.at(-1).native_id,
    signature: nativeSignature(sorted),
    observation_signature: observationSignature(sorted),
    slices,
  };
}
test("native byte identity and C ordering survive uneven, contiguous slices", () => {
  const rows = [row("t/😀"), row("t/é"), row("t/é"), row("t/10"), row("t/2")];
  const p = planSlices(rows, 2);
  assert.deepEqual(
    p.map(({ lower, upper, first, last, records }) => ({ lower, upper, first, last, records })),
    [
      { lower: 0, upper: 2, first: "t/10", last: "t/2", records: 2 },
      { lower: 2, upper: 4, first: "t/é", last: "t/é", records: 2 },
      { lower: 4, upper: 5, first: "t/😀", last: "t/😀", records: 1 },
    ],
  );
  assert.notEqual(p[1].first, p[1].last);
});
test("unchanged IDs cannot conceal altered payload or retrieval evidence", () => {
  const before = [row("t/part-1"), row("t/part-2")];
  const payload = [row("t/part-1", "d".repeat(64)), row("t/part-2")];
  assert.notEqual(planSlices(before, 2)[0].signature, planSlices(payload, 2)[0].signature);
  const observation = structuredClone(before);
  observation[0].observation[3] = "e".repeat(64);
  assert.equal(nativeSignature(before), nativeSignature(observation));
  assert.notEqual(
    planSlices(before, 2)[0].observation_signature,
    planSlices(observation, 2)[0].observation_signature,
  );
});
test("duplicates and unsafe page sizes never form a projection plan", () => {
  assert.throws(() => planSlices([row("same"), row("same", "b".repeat(64))], 2), /Duplicate/);
  for (const size of [0, -1, 1.5, NaN, 10001])
    assert.throws(() => planSlices([row("one")], size), /Page size/);
});
test("a full-size page and final remainder cover every identity exactly once", () => {
  const rows = Array.from({ length: 10001 }, (_, i) =>
    row("title-1/node-" + String(i).padStart(5, "0")),
  );
  const p = planSlices(rows, 10000);
  assert.equal(p.length, 2);
  assert.deepEqual(
    p.map((s) => [s.lower, s.upper, s.records]),
    [
      [0, 10000, 10000],
      [10000, 10001, 1],
    ],
  );
  assert.equal(
    p.reduce((a, s) => a + s.records, 0),
    rows.length,
  );
});
test("SQL literal escaping retains exact publisher tokens and prevents quote injection", () => {
  assert.equal(esc("title-1/appendix-O'Brien"), "'title-1/appendix-O''Brien'");
  const c = scope([row("title-1/appendix-O'Brien")]);
  const s = { ...c, ...c.slices[0] };
  const q = projectSql(run, plan, [s], template);
  assert.ok(q.includes("'title-1/appendix-O''Brien'"));
  assert.ok(q.includes("replace(replace(n.data->>'parent_native_id','%','%25'),'/','%2F')"));
  assert.equal(q.includes("__PARENT_TOKEN__"), false);
});
test("independent verifier compares every public column and canonical native neighbor data", () => {
  const c = scope([row("title-1"), row("title-1/part-1")]);
  const q = verifySql(run, plan, [{ ...c, ...c.slices[0] }], template);
  const columns = [
    "dataset",
    "id",
    "category",
    "state",
    "title",
    "source_url",
    "ordinal",
    "item",
    "detail",
    "text",
    "filters",
    "county_geoids",
  ];
  for (const alias of ["e", "a"])
    assert.ok(q.includes("row(" + columns.map((k) => alias + "." + k).join(",") + ")"));
  assert.ok(q.includes("canonical_integer_jsonb_sha256_v1(data)"));
  assert.ok(q.includes("from child_versions"));
  assert.ok(q.includes("from parent_versions"));
  assert.ok(q.includes("actual_observation_signature=s.expected_observation_signature"));
  assert.ok(q.includes("insert into corpus_ingest.projection_slice_checks_v2"));
  assert.equal(q.includes("do update"), false);
  assert.ok(q.includes("not cd.ready"));
});
test("publication requires current complete rows, contiguous receipts, original signatures and exact facets", () => {
  const c = scope([row("title-1"), row("title-1/part-1"), row("title-1/part-2")]);
  const n = scope([row("notes-1")], "ecfr_authority_notes");
  const all = [
    ...c.slices.map((s) => ({ ...s, dataset: c.dataset })),
    ...n.slices.map((s) => ({ ...s, dataset: n.dataset })),
  ];
  const q = publishSql(run, plan, [c, n], all, { ecfr_hierarchy: [], ecfr_authority_notes: [] });
  for (const required of [
    "lag(upper_ordinal,1,0::bigint)",
    "bool_and(lower_ordinal=previous_upper)",
    "c.expected_fullfield_signature=h.fullfield_signature",
    "tc.verified_slice_receipts=rc.slices",
    "pc.unique_ids=s.expected_records",
    "pc.unique_ordinals=s.expected_records",
    "sc.actual_signature=s.expected_signature",
    "sc.actual_observation_signature=s.expected_observation_signature",
    "d.metadata->'listing'->'filters'=ef.filters",
    "ready=c.verified",
  ])
    assert.ok(q.includes(required), required);
  assert.ok(q.includes("check_id desc"));
  assert.equal(q.includes("jsonb_pretty"), false);
  assert.equal(q.includes("from page"), false);
});
