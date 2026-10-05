// Read-only deletion planning inventory. No remote writes are implemented here.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { rest, rpc } from "../ingest/members-pgrest.mjs";
const project = "xosqzzsnhxcyehcnirpa";
const root = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc/inventory-v1");
await fs.mkdir(root, { recursive: true });
const lock = await fs.open(path.join(root, "inventory.lock"), "wx");
await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
async function save(file, value) {
  const b = Buffer.from(JSON.stringify(value));
  await fs.writeFile(path.join(root, file), b, { flag: "wx" });
  return { file, bytes: b.length, sha256: sha(b) };
}
const c = JSON.parse(
  await fs.readFile("C:/Users/firas/.codex/private/legal-source-compass.preview.json", "utf8"),
);
if (c.EXTERNAL_SUPABASE_URL !== `https://${project}.supabase.co`) throw Error("Wrong project");
const client = createClient(c.EXTERNAL_SUPABASE_URL, c.EXTERNAL_SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storage = client.storage.from("corpus-originals");
async function storageInventory() {
  let cursor,
    rows = 0,
    bytes = 0,
    page = 0;
  const refs = [];
  const seen = new Set();
  do {
    const { data, error } = await storage.listV2(
      { prefix: "", limit: 1000, with_delimiter: false, ...(cursor ? { cursor } : {}) },
      { signal: AbortSignal.timeout(60000) },
    );
    if (error || !data || data.folders.length)
      throw Error(`Storage listing failed ${error?.statusCode ?? "shape"}`);
    for (const o of data.objects) {
      const key = o.key ?? o.name;
      if (!key || seen.has(key) || !Number.isSafeInteger(o.metadata?.size) || o.metadata.size < 0)
        throw Error("Storage inventory conflict");
      seen.add(key);
      bytes += o.metadata.size;
    }
    refs.push(await save(`storage-${String(page++).padStart(4, "0")}.json`, data));
    rows += data.objects.length;
    if (data.hasNext && (!data.nextCursor || data.nextCursor === cursor))
      throw Error("Storage cursor not advancing");
    cursor = data.hasNext ? data.nextCursor : null;
    if (page % 40 === 0)
      console.log(JSON.stringify({ stage: "storage_inventory", objects: rows, bytes }));
  } while (cursor);
  return { rows, bytes, pages: refs };
}
async function artifactInventory() {
  let after = "",
    rows = 0,
    page = 0;
  const refs = [];
  for (;;) {
    const q = new URLSearchParams({
      select: "*",
      order: "route.asc",
      limit: "1000",
      ...(after ? { route: `gt.${after}` } : {}),
    });
    const r = await rest(`corpus_artifacts?${q}`);
    if (!Array.isArray(r.data)) throw Error("Invalid artifact page");
    if (!r.data.length) break;
    if (
      r.data.some(
        (x, i) => !x.route || (i > 0 && x.route <= r.data[i - 1].route) || x.route <= after,
      )
    )
      throw Error("Artifact keyset invalid");
    refs.push(await save(`artifacts-${String(page++).padStart(4, "0")}.json`, r.data));
    rows += r.data.length;
    after = r.data.at(-1).route;
  }
  return { rows, pages: refs };
}
async function pdfInventory() {
  let after = "",
    rows = 0,
    bytes = 0,
    page = 0;
  const refs = [];
  for (;;) {
    const r = await rpc("corpus_admin_pdf_dedup_index_v1", {
      p_kind: "objects",
      p_after: after,
      p_limit: 10000,
    });
    if (!Array.isArray(r.rows)) throw Error("Invalid PDF page");
    if (!r.rows.length) break;
    if (
      r.rows.some(
        (x, i) =>
          !/^\w{64}$/.test(x.sha256) ||
          x.sha256 <= after ||
          (i > 0 && x.sha256 <= r.rows[i - 1].sha256),
      )
    )
      throw Error("PDF keyset invalid");
    refs.push(await save(`pdf-objects-${String(page++).padStart(4, "0")}.json`, r));
    rows += r.rows.length;
    bytes += r.rows.reduce((s, x) => s + x.bytes, 0);
    after = r.last;
  }
  return { rows, bytes, pages: refs };
}
try {
  const started_at = new Date().toISOString();
  const catalog = await save(
    "catalog-before.json",
    (await rest("corpus_datasets?select=*&order=id.asc&limit=1000")).data,
  );
  const context = await save(
    "context-before.json",
    (await rest("corpus_context?select=*&limit=1000")).data,
  );
  const schema = await save("rest-schema-before.json", (await rest("")).data);
  const manifestFile = "src/lib/private-data/manifest.server.json",
    mb = await fs.readFile(manifestFile);
  const m = JSON.parse(mb);
  if (m.project_id !== project) throw Error("Manifest target mismatch");
  const app_manifest = await save("app-manifest-before.json", m);
  const [objects, artifacts, pdfs] = await Promise.all([
    storageInventory(),
    artifactInventory(),
    pdfInventory(),
  ]);
  const result = {
    schema: "owner-removal-inventory/v1",
    project,
    bucket: "corpus-originals",
    started_at,
    finished_at: new Date().toISOString(),
    catalog,
    context,
    rest_schema: schema,
    app_manifest,
    objects,
    artifacts,
    pdfs,
  };
  await save("manifest.json", result);
  console.log(
    JSON.stringify({
      complete: true,
      objects: objects.rows,
      bytes: objects.bytes,
      artifacts: artifacts.rows,
      pdf_objects: pdfs.rows,
      pdf_bytes: pdfs.bytes,
    }),
  );
} finally {
  await lock.close();
  await fs.unlink(path.join(root, "inventory.lock"));
}
