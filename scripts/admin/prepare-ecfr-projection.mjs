/** Prepare bounded, pinned metadata-only SQL files; performs no database/network access. */
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECTION_VERSION,
  HIERARCHY_QUALIFICATION,
  NOTES_QUALIFICATION,
  esc,
  sha,
  nativeSignature,
  observationSignature,
  planSlices,
  projectSql,
  verifySql,
  publishSql,
} from "./ecfr-projection-v2.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((s, i, a) => (s.startsWith("--") ? [s.slice(2), a[i + 1]] : []))
    .filter((x) => x.length),
);
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(args.run ?? "") ||
  !args.output ||
  !args.receipt
)
  throw Error(
    "Require --run UUID --receipt normalized-receipt.json --output private-directory [--batch-size 10000]",
  );
const pageSize = Number(args["batch-size"] ?? 10000);
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000)
  throw Error("Batch size must be 1..10000");
const receiptBytes = await fs.readFile(args.receipt);
const receipt = JSON.parse(receiptBytes);
if (
  receipt.pdf_downloads !== 0 ||
  receipt.complete_title_trees !== 49 ||
  receipt.reserved_titles.join(",") !== "35"
)
  throw Error("Incomplete dated title inventory");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const template = await fs.readFile(
  path.join(repo, "database/contracts/ecfr-expected-records-v2.sql"),
  "utf8",
);
const implementation = await fs.readFile(
  fileURLToPath(new URL("./ecfr-projection-v2.mjs", import.meta.url)),
);
const generator = await fs.readFile(fileURLToPath(import.meta.url));
const configs = [
  {
    dataset: "ecfr_hierarchy",
    type: "hierarchy-nodes",
    schema: "ecfr-hierarchy-metadata/1",
    label: "Dated national eCFR hierarchy — September 30, 2026",
    qualification: HIERARCHY_QUALIFICATION,
    columns: [
      ["title_number", "CFR title"],
      ["node_type", "Node type"],
      ["node_identifier", "Native identifier"],
      ["reserved", "Reserved"],
      ["snapshot_as_of", "Snapshot"],
    ],
    facets: ["title_number", "node_type", "reserved", "snapshot_as_of"],
  },
  {
    dataset: "ecfr_authority_notes",
    type: "part-authority-notes",
    schema: "ecfr-authority-notes/1.1",
    label: "Selected eCFR authority and source notes",
    qualification: NOTES_QUALIFICATION,
    columns: [
      ["title_number", "CFR title"],
      ["part_number", "Part"],
      ["snapshot_as_of", "Snapshot"],
      ["historical_scope", "Historical snapshot"],
    ],
    facets: ["title_number", "part_number", "snapshot_as_of", "historical_scope"],
  },
];
const labels = {
  title_number: "CFR title",
  node_type: "Node type",
  reserved: "Reserved",
  snapshot_as_of: "Dated snapshot",
  part_number: "Part",
  historical_scope: "Historical snapshot",
};
const originals = [],
  facets = {},
  source = [];
for (const c of configs) {
  const filename = path.join(path.dirname(args.receipt), c.type + ".jsonl");
  const hash = createHash("sha256");
  const stream = createReadStream(filename);
  stream.on("data", (b) => hash.update(b));
  const counts = new Map(c.facets.map((k) => [k, new Map()]));
  const ids = [];
  let bytes = 0;
  stream.on("data", (b) => (bytes += b.length));
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (
      r.source_system !== "ecfr" ||
      r.entity_type !== c.type ||
      r.schema_version !== c.schema ||
      !r.native_id ||
      !/^[-a-zA-Z0-9_:/%.]+$/.test(r.native_id) ||
      !/^https:\/\/www\.ecfr\.gov\//.test(r.provenance?.source_url ?? "") ||
      !/^[0-9a-f]{64}$/.test(r.provenance?.record_sha256 ?? "")
    )
      throw Error("Unrecognized source envelope: " + c.type);
    ids.push({
      native_id: r.native_id,
      payload_sha256: r.provenance.record_sha256,
      observation: [
        r.native_id,
        r.provenance.record_sha256,
        r.provenance.source_url,
        r.provenance.source_sha256 ?? null,
        r.provenance.source_as_of ?? null,
        r.provenance.retrieved_at ?? null,
        r.provenance.derivation ?? null,
        r.provenance.hash_kind ?? null,
        r.provenance.http_status ?? null,
      ],
    });
    for (const [key, values] of counts) {
      const v = r.data[key];
      if (v === null || v === undefined) continue;
      if (!["string", "number", "boolean"].includes(typeof v))
        throw Error("Non-scalar facet: " + key);
      const text = String(v);
      values.set(text, (values.get(text) ?? 0) + 1);
    }
  }
  const fileSha = hash.digest("hex");
  if (fileSha !== receipt.files[c.type].sha256 || ids.length !== receipt.files[c.type].records)
    throw Error("Original file receipt mismatch: " + c.type);
  const slices = planSlices(ids, c.dataset === "ecfr_authority_notes" ? ids.length : pageSize);
  const sorted = [...ids].sort((a, b) =>
    Buffer.compare(Buffer.from(a.native_id), Buffer.from(b.native_id)),
  );
  source.push({
    ...c,
    records: ids.length,
    first: sorted[0].native_id,
    last: sorted.at(-1).native_id,
    signature: nativeSignature(sorted),
    observation_signature: observationSignature(sorted),
    slices,
  });
  facets[c.dataset] = [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, values]) => ({
      name,
      label: labels[name],
      type: "select",
      options: [...values]
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(([value, count]) => ({ value, label: value, count })),
    }));
  originals.push({ entity_type: c.type, records: ids.length, bytes, sha256: fileSha });
}
if (source[0].records !== receipt.nodes || source[1].records !== receipt.part_authority_snapshots)
  throw Error("Dataset totals mismatch");
const pin = {
  schema_version: PROJECTION_VERSION,
  run_id: args.run,
  page_size: pageSize,
  originals,
  normalized_receipt_sha256: sha(receiptBytes),
  row_template_sha256: sha(template),
  implementation_sha256: sha(implementation),
  generator_sha256: sha(generator),
  source: source.map((s) => ({
    dataset: s.dataset,
    type: s.type,
    schema: s.schema,
    records: s.records,
    first: s.first,
    last: s.last,
    signature: s.signature,
    observation_signature: s.observation_signature,
    slices: s.slices,
  })),
};
const plan = sha(JSON.stringify(pin));
const output = path.join(args.output, "bounded-v2", plan);
await fs.mkdir(output, { recursive: true });
const files = [];
async function save(name, content) {
  const target = path.join(output, name);
  // An identical regeneration is safe; a changed artifact never overwrites an old plan.
  try {
    const old = await fs.readFile(target, "utf8");
    if (old !== content) throw Error("Refuse changed existing artifact: " + target);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await fs.writeFile(target, content, "utf8");
  }
  files.push({ file: name, bytes: Buffer.byteLength(content), sha256: sha(content) });
}
const registrations = source
  .map(
    (s) =>
      `(${esc(s.dataset)},${esc(s.label)},false,${s.records},0,${esc(
        JSON.stringify({
          schema_version: "ecfr-metadata-view/2",
          source_system: "ecfr",
          projection_run_id: args.run,
          projection_plan_sha256: plan,
          aliases: [s.dataset],
          qualification: s.qualification,
          listing: {
            columns: s.columns.map(([key, label]) => ({ key, label })),
            filters: facets[s.dataset],
          },
        }),
      )}::jsonb)`,
  )
  .join(",\n");
await save(
  "register-v2.sql",
  `insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata)values ${registrations}
on conflict(id)do update set label=excluded.label,ready=false,expected_records=excluded.expected_records,imported_records=0,metadata=excluded.metadata,updated_at=now()
returning id,ready,expected_records,metadata->>'projection_plan_sha256'projection_plan_sha256;\n`,
);
const allSlices = [];
for (let i = 0; i < source[0].slices.length; i++) {
  const scopes = [{ ...source[0], ...source[0].slices[i] }];
  if (i === 0) scopes.push({ ...source[1], ...source[1].slices[0] });
  allSlices.push(
    ...scopes.map((s) => ({
      dataset: s.dataset,
      ...source.find((x) => x.dataset === s.dataset).slices.find((x) => x.lower === s.lower),
    })),
  );
  const name = String(i + 1).padStart(3, "0");
  await save("project-v2-" + name + ".sql", projectSql(args.run, plan, scopes, template));
  await save("verify-v2-" + name + ".sql", verifySql(args.run, plan, scopes, template));
}
await save("publish-v2.sql", publishSql(args.run, plan, source, allSlices, facets));
await save("filter-facets-v2.json", JSON.stringify(facets, null, 2) + "\n");
await save(
  "README-v2.txt",
  `Prepared only; no SQL was executed by this generator.
Apply private corpus-ingest-projection-slices-v2.sql and canonical-integer-jsonb-v1.sql migrations first; run canonical vectors.
Run register-v2.sql once. It holds both datasets and writes pinned original facet definitions.
Execute project-v2-NNN.sql, inspect guard_passed/written_records, then execute its separate verify-v2-NNN.sql.
The verifier appends one private receipt per dataset/range, including failures; every receipt must report verified=true.
Do not combine batches into one transaction. Respect connector pacing and stop on disk/read-only/timeout failures.
Notes are projected and verified only in slice001. Hierarchy ordinals are the original native-ID C ordering.
Run publish-v2.sql only after all batches reconcile. It recomputes every current public full-field slice hash,
matches the latest verified receipt for the exact source-pinned plan, and requires contiguous complete coverage,
source identity/version/cleanup status, unique native public IDs/ordinals, counts, metadata and pinned facets.
An interrupted/failed/missing slice, changed public row, wrong plan, changed source identity or quarantined native entity keeps ready=false.
Prior v1 artifacts, source envelopes, private observations and versions are never overwritten.
Native topology and heading counts are publisher metadata, not a current operative-law census.
No PDF bytes are collected.\n`,
);
await save(
  "manifest-v2.json",
  JSON.stringify({ ...pin, plan_sha256: plan, slices: allSlices, files }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    schema_version: PROJECTION_VERSION,
    output,
    plan_sha256: plan,
    batches: source[0].slices.length,
    nodes: source[0].records,
    notes: source[1].records,
    database_executed: false,
  }),
);
