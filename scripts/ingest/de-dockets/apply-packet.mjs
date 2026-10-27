// LEAD ONLY. Applies a de-dockets packet to production. Workers never run this with --execute.
// Default is a dry run that checks the packet hashes and prints what would be written.
//   node --use-system-ca scripts/ingest/de-dockets/apply-packet.mjs --packet=<acq>/packets/<run> [--execute] [--optional-release --owner-decision="<quote and date>"]
// Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (as scripts/enrichment/corpus_writer.py); never logged.
// Steps with --execute:
//   1. refuse if any row id of the upsert file already exists in sw_docket_entries_v1 (the packet only adds rows);
//   2. upsert the rows (resolution=merge-duplicates), batches of 500; rows are never deleted;
//   3. read every row back and compare detail.provenance.projection_row_sha256;
//   4. set corpus_datasets.imported_records to the exact stored count and bump the listing filter option counts (mdl, year, availability);
//   5. patch sw_matters_v1 item.cells.entries_published / entries_withheld, only where the stored values still equal expected_before.
// --optional-release replaces step 1-3 input with the release-text-mentions file (rows that already exist are updated). It needs an owner decision.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.packet) throw new Error("--packet is required");
const dir = path.resolve(args.packet);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const f of manifest.files) {
  const body = fs.readFileSync(path.join(dir, f.file));
  if (sha(body) !== f.sha256) throw new Error(`packet file changed since build: ${f.file}`);
}
const release = args["optional-release"] === "true";
if (release && (!args["owner-decision"] || args["owner-decision"] === "true"))
  throw new Error('--optional-release needs --owner-decision="<the owner\'s words and date>"');
const entriesFile = release
  ? "sw_docket_entries_v1.release-text-mentions.jsonl"
  : "sw_docket_entries_v1.upsert.jsonl";
const rows = fs
  .readFileSync(path.join(dir, entriesFile), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const matters = release
  ? []
  : JSON.parse(fs.readFileSync(path.join(dir, "sw_matters_v1.cells-patch.json"), "utf8"));
const DS = "sw_docket_entries_v1";
if (rows.some((r) => r.dataset !== DS)) throw new Error("packet holds a row of another dataset");
console.log(
  JSON.stringify({
    mode: args.execute ? "execute" : "dry-run",
    run: manifest.run,
    file: entriesFile,
    rows: rows.length,
    matters: matters.length,
    release,
  }),
);
if (!args.execute) process.exit(0);

const base = (process.env.EXTERNAL_SUPABASE_URL ?? "").replace(/\/$/, "") + "/rest/v1/";
const key = process.env.EXTERNAL_SUPABASE_KEY ?? "";
if (!/^https:\/\//.test(base) || !key)
  throw new Error("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set");
async function call(method, p, body, prefer = "return=minimal") {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + p, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: prefer,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (res.ok)
      return { data: text ? JSON.parse(text) : null, range: res.headers.get("content-range") };
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${method} ${p.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  }
}
const inList = (ids) => `(${ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",")})`;
const count = async () =>
  Number(
    (
      await call(
        "GET",
        `corpus_records?select=id&dataset=eq.${DS}&limit=1`,
        undefined,
        "count=exact",
      )
    ).range
      .split("/")
      .pop(),
  );

const before = await count();
if (!release) {
  for (let i = 0; i < rows.length; i += 100) {
    const { data } = await call(
      "GET",
      `corpus_records?select=id&dataset=eq.${DS}&id=in.${encodeURIComponent(inList(rows.slice(i, i + 100).map((r) => r.id)))}`,
    );
    if (data.length)
      throw new Error(
        `refusing: ${data.length} packet ids already exist (first ${data[0].id}); rebuild the packet against the current dataset`,
      );
  }
}
for (let i = 0; i < rows.length; i += 500)
  await call(
    "POST",
    "corpus_records",
    rows.slice(i, i + 500),
    "return=minimal,resolution=merge-duplicates",
  );
let mismatched = 0;
for (let i = 0; i < rows.length; i += 100) {
  const part = rows.slice(i, i + 100);
  const { data } = await call(
    "GET",
    `corpus_records?select=id,h:detail->provenance->>projection_row_sha256&dataset=eq.${DS}&id=in.${encodeURIComponent(inList(part.map((r) => r.id)))}`,
  );
  const got = new Map(data.map((d) => [d.id, d.h]));
  for (const r of part)
    if (got.get(r.id) !== r.detail.provenance.projection_row_sha256) mismatched++;
}
if (mismatched)
  throw new Error(`read-back mismatch on ${mismatched} rows; dataset counts not updated`);
const after = await count();
const meta =
  (await call("GET", `corpus_datasets?select=metadata&id=eq.${DS}`)).data[0]?.metadata ?? {};
if (!release) {
  const bump = (name, value, label) => {
    const f = meta.listing?.filters?.find((x) => x.name === name);
    if (!f?.options) return;
    const o = f.options.find((x) => x.value === value);
    if (o) o.count = (o.count ?? 0) + 1;
    else f.options.push({ value, label, count: 1 });
  };
  for (const r of rows) {
    bump("mdl", r.filters.mdl, `MDL ${r.filters.mdl}`);
    bump("year", r.filters.year || "undated", r.filters.year || "undated");
    bump("availability", r.filters.availability, r.filters.availability);
  }
  meta.de_dockets_runs = [
    ...(meta.de_dockets_runs ?? []),
    { run: manifest.run, applied_at: new Date().toISOString(), rows_added: rows.length },
  ];
}
await call("PATCH", `corpus_datasets?id=eq.${DS}`, {
  imported_records: after,
  metadata: meta,
  updated_at: new Date().toISOString(),
});
const matterResults = [];
for (const p of matters) {
  const { data } = await call(
    "GET",
    `corpus_records?select=item&dataset=eq.sw_matters_v1&id=eq.${encodeURIComponent(p.id)}`,
  );
  const item = data[0]?.item;
  if (!item) {
    matterResults.push({ id: p.id, skipped: "not found" });
    continue;
  }
  const stale = Object.entries(p.expected_before).some(([k, v]) => (item.cells?.[k] ?? null) !== v);
  if (stale) {
    matterResults.push({ id: p.id, skipped: "stored cells changed since the packet was built" });
    continue;
  }
  item.cells = { ...item.cells, ...p.set };
  await call("PATCH", `corpus_records?dataset=eq.sw_matters_v1&id=eq.${encodeURIComponent(p.id)}`, {
    item,
  });
  matterResults.push({ id: p.id, ...p.set });
}
console.log(
  JSON.stringify({
    applied: true,
    rows: rows.length,
    dataset_rows_before: before,
    dataset_rows_after: after,
    matters_patched: matterResults.filter((m) => !m.skipped).length,
    matters_skipped: matterResults.filter((m) => m.skipped),
  }),
);
