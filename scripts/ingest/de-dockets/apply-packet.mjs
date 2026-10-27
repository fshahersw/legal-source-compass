// LEAD ONLY. Applies a de-dockets packet to production. Workers never run this with --execute.
// Default is a dry run that checks the packet hashes and prints what would be written.
//   node --use-system-ca scripts/ingest/de-dockets/apply-packet.mjs --packet=<acq>/packets/<run> [--execute]
//   node --use-system-ca scripts/ingest/de-dockets/apply-packet.mjs --packet=<acq>/packets/<run> --optional-release --owner-decision="<quote and date>" [--execute]
// Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (as scripts/enrichment/corpus_writer.py); never logged.
// Steps with --execute (default packet):
//   1. read the packet ids back: an id that exists with the packet's projection_row_sha256 is already applied (a resumed run) and is skipped;
//      an id that exists with any other hash stops the run (the dataset changed; rebuild the packet from a fresh snapshot-before.sql);
//   2. insert the missing rows in batches of 500 (resolution=merge-duplicates); rows are never deleted;
//   3. read every row back and compare detail.provenance.projection_row_sha256;
//   4. set corpus_datasets.imported_records to the exact stored count and set the listing filter option counts of every mdl, year and
//      availability value the packet touches to their exact stored counts (idempotent, so a resumed run cannot double count);
//   5. patch each sw_matters_v1 record (cells, registry.entries captures, entry facts) only where the stored values still equal the values the
//      packet was built against; a record this run already patched is reported as done.
// A failed run is resumed by running the same command again.
// --optional-release (needs an owner decision): every row of the release file must already exist (the default packet applied first); the rows
// are updated, then entries_withheld of each affected matter is recounted from the dataset and patched where the stored cells still hold the
// default packet's values.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { composeMatterPatch } from "./packet-assembly.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.packet) throw new Error("--packet is required");
const dir = path.resolve(args.packet);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
if (manifest.schema_version !== "de-dockets-packet/2")
  throw new Error(
    `packet ${manifest.run} is ${manifest.schema_version}; only de-dockets-packet/2 packets are applied (rebuild it)`,
  );
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const f of manifest.files) {
  const body = fs.readFileSync(path.join(dir, f.file));
  if (sha(body) !== f.sha256) throw new Error(`packet file changed since build: ${f.file}`);
}
const release = args["optional-release"] === "true";
if (release && (!args["owner-decision"] || args["owner-decision"] === "true"))
  throw new Error('--optional-release needs --owner-decision="<the owner\'s words and date>"');
const readJsonl = (name) =>
  fs
    .readFileSync(path.join(dir, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const rows = readJsonl(
  release
    ? "sw_docket_entries_v1.release-text-mentions.jsonl"
    : "sw_docket_entries_v1.upsert.jsonl",
);
const matters = JSON.parse(
  fs.readFileSync(path.join(dir, "sw_matters_v1.cells-patch.json"), "utf8"),
);
const DS = "sw_docket_entries_v1";
if (rows.some((r) => r.dataset !== DS)) throw new Error("packet holds a row of another dataset");
console.log(
  JSON.stringify({
    mode: args.execute ? "execute" : "dry-run",
    run: manifest.run,
    release,
    rows: rows.length,
    matters: release ? "entries_withheld recount of affected matters" : matters.length,
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
const countWhere = async (filter = "") =>
  Number(
    (
      await call(
        "GET",
        `corpus_records?select=id&dataset=eq.${DS}${filter}&limit=1`,
        undefined,
        "count=exact",
      )
    ).range
      .split("/")
      .pop(),
  );
async function storedHashes(list) {
  const got = new Map();
  for (let i = 0; i < list.length; i += 100) {
    const { data } = await call(
      "GET",
      `corpus_records?select=id,h:detail->provenance->>projection_row_sha256&dataset=eq.${DS}&id=in.${encodeURIComponent(inList(list.slice(i, i + 100).map((r) => r.id)))}`,
    );
    for (const d of data) got.set(d.id, d.h);
  }
  return got;
}

const before = await countWhere();
// 1. what is already there
const existing = await storedHashes(rows);
let todo;
if (release) {
  const missing = rows.filter((r) => !existing.has(r.id));
  if (missing.length)
    throw new Error(
      `refusing: ${missing.length} release rows do not exist yet (first ${missing[0].id}); apply the default packet first`,
    );
  todo = rows.filter((r) => existing.get(r.id) !== r.detail.provenance.projection_row_sha256);
} else {
  const conflicts = rows.filter(
    (r) => existing.has(r.id) && existing.get(r.id) !== r.detail.provenance.projection_row_sha256,
  );
  if (conflicts.length)
    throw new Error(
      `refusing: ${conflicts.length} packet ids exist with different content (first ${conflicts[0].id}); rebuild the packet from a fresh snapshot-before.sql`,
    );
  todo = rows.filter((r) => !existing.has(r.id));
}
console.log(
  JSON.stringify({
    step: "check",
    already_applied: rows.length - todo.length,
    to_write: todo.length,
  }),
);
// 2. write
for (let i = 0; i < todo.length; i += 500)
  await call(
    "POST",
    "corpus_records",
    todo.slice(i, i + 500),
    "return=minimal,resolution=merge-duplicates",
  );
// 3. read back
const back = await storedHashes(rows);
const mismatched = rows.filter(
  (r) => back.get(r.id) !== r.detail.provenance.projection_row_sha256,
).length;
if (mismatched)
  throw new Error(`read-back mismatch on ${mismatched} rows; re-run the same command to resume`);
// 4. dataset count and exact listing option counts
const after = await countWhere();
const meta =
  (await call("GET", `corpus_datasets?select=metadata&id=eq.${DS}`)).data[0]?.metadata ?? {};
for (const name of ["mdl", "year", "availability"]) {
  const f = meta.listing?.filters?.find((x) => x.name === name);
  if (!f?.options) continue;
  const values = new Set(
    rows.map((r) => (name === "year" ? r.filters.year || "undated" : r.filters[name])),
  );
  for (const value of values) {
    const stored = await countWhere(
      value === "undated" && name === "year"
        ? `&filters->>year=eq.`
        : `&filters->>${name}=eq.${encodeURIComponent(value)}`,
    );
    const o = f.options.find((x) => x.value === value);
    if (o) o.count = stored;
    else if (stored)
      f.options.push({ value, label: name === "mdl" ? `MDL ${value}` : value, count: stored });
  }
  f.options.sort(
    (a, b) => (b.count ?? 0) - (a.count ?? 0) || String(a.value).localeCompare(String(b.value)),
  );
}
const runs = meta.de_dockets_runs ?? [];
if (!runs.some((r) => r.run === manifest.run && r.release === release))
  meta.de_dockets_runs = [
    ...runs,
    {
      run: manifest.run,
      release,
      owner_decision: release ? args["owner-decision"] : undefined,
      applied_at: new Date().toISOString(),
      rows: rows.length,
    },
  ];
await call("PATCH", `corpus_datasets?id=eq.${DS}`, {
  imported_records: after,
  metadata: meta,
  updated_at: new Date().toISOString(),
});
// 5. matters
const matterResults = [];
const getMatter = async (id) =>
  (
    await call(
      "GET",
      `corpus_records?select=item,detail&dataset=eq.sw_matters_v1&id=eq.${encodeURIComponent(id)}`,
    )
  ).data[0];
const putMatter = (id, body) =>
  call("PATCH", `corpus_records?dataset=eq.sw_matters_v1&id=eq.${encodeURIComponent(id)}`, body);
if (!release) {
  for (const p of matters) {
    const stored = await getMatter(p.id);
    if (!stored) {
      matterResults.push({ id: p.id, skipped: "not found" });
      continue;
    }
    const r = composeMatterPatch(stored, p);
    if (r.state === "done") matterResults.push({ id: p.id, done: "already applied by this run" });
    else if (r.state === "stale") matterResults.push({ id: p.id, skipped: r.reason });
    else {
      await putMatter(p.id, { item: r.item, detail: r.detail });
      matterResults.push({ id: p.id, ...p.set });
    }
  }
} else {
  const mdls = [...new Set(rows.map((r) => r.filters.mdl))];
  for (const mdl of mdls) {
    const p = matters.find((x) => x.id === `sw-matter:${mdl}`);
    const stored = p && (await getMatter(p.id));
    if (!stored) {
      matterResults.push({ id: `sw-matter:${mdl}`, skipped: "not found" });
      continue;
    }
    const withheld = await countWhere(
      `&filters->>mdl=eq.${mdl}&filters->>description_withheld=eq.true`,
    );
    const cells = stored.item?.cells ?? {};
    if (cells.entries_withheld === withheld) {
      matterResults.push({ id: p.id, done: "entries_withheld already equals the dataset" });
      continue;
    }
    if (
      cells.entries_published !== p.set.entries_published ||
      cells.entries_withheld !== p.set.entries_withheld
    ) {
      matterResults.push({ id: p.id, skipped: "stored cells are not the default packet's values" });
      continue;
    }
    await putMatter(p.id, {
      item: { ...stored.item, cells: { ...cells, entries_withheld: withheld } },
    });
    matterResults.push({ id: p.id, entries_withheld: withheld });
  }
}
console.log(
  JSON.stringify({
    applied: true,
    release,
    rows: rows.length,
    written_now: todo.length,
    dataset_rows_before: before,
    dataset_rows_after: after,
    matters_patched: matterResults.filter((m) => !m.skipped && !m.done).length,
    matters_done_earlier: matterResults.filter((m) => m.done).length,
    matters_skipped: matterResults.filter((m) => m.skipped),
  }),
);
