// Read-only recovery export of the exclusively Open US Law outline.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { rest } from "../ingest/members-pgrest.mjs";
const root = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc/outline-backup-v1");
const specs = {
  corpus_law_collections: { count: 224, keys: ["state", "kind"] },
  corpus_law_nodes: { count: 196458, keys: ["id"] },
  corpus_law_segments: { count: 818617, keys: ["node", "lo"] },
};
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
if (process.argv.slice(2).join(" ") !== "--execute") throw Error("READ_ONLY_EXECUTE_REQUIRED");
await fs.mkdir(root, { recursive: true });
const lock = await fs.open(path.join(root, "backup.lock"), "wx");
await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
async function save(file, data) {
  const b = Buffer.from(JSON.stringify(data));
  const h = await fs.open(path.join(root, file), "wx");
  try {
    await h.writeFile(b);
    await h.sync();
  } finally {
    await h.close();
  }
  if (sha(await fs.readFile(path.join(root, file))) !== sha(b))
    throw Error("BACKUP_READBACK_MISMATCH");
  return { file, sha256: sha(b), bytes: b.length };
}
async function backup(table, spec) {
  const n = await rest(`${table}?select=${spec.keys.join(",")}&limit=1`, { prefer: "count=exact" });
  if (Number(n.headers.get("content-range")?.split("/")[1]) !== spec.count)
    throw Error("OUTLINE_COUNT_CHANGED");
  let after = null,
    count = 0;
  const pages = [];
  for (;;) {
    const q = new URLSearchParams({
      select: "*",
      order: spec.keys.map((k) => `${k}.asc`).join(","),
      limit: "1000",
    });
    if (after) {
      if (spec.keys.length === 1) q.set(spec.keys[0], `gt.${after[spec.keys[0]]}`);
      else {
        const [a, b] = spec.keys;
        q.set("or", `(${a}.gt.${after[a]},and(${a}.eq.${after[a]},${b}.gt.${after[b]}))`);
      }
    }
    const { data } = await rest(`${table}?${q}`);
    if (!Array.isArray(data)) throw Error("OUTLINE_SHAPE_INVALID");
    if (!data.length) break;
    for (const r of data) {
      if (
        after &&
        !spec.keys.some(
          (k, i) => spec.keys.slice(0, i).every((p) => r[p] === after[p]) && r[k] > after[k],
        )
      )
        throw Error("OUTLINE_ORDER_INVALID");
      after = r;
    }
    count += data.length;
    if (count > spec.count) throw Error("OUTLINE_COUNT_EXCEEDED");
    pages.push({
      ...(await save(`${table}-${String(pages.length).padStart(4, "0")}.json`, data)),
      rows: data.length,
      first: spec.keys.map((k) => data[0][k]),
      last: spec.keys.map((k) => data.at(-1)[k]),
    });
    if (count % 100000 === 0) console.log(JSON.stringify({ table, backed_up: count }));
  }
  if (count !== spec.count) throw Error("OUTLINE_BACKUP_INCOMPLETE");
  const receipt = { table, rows: count, keys: spec.keys, pages };
  await save(`${table}-complete.json`, receipt);
  console.log(JSON.stringify({ table, backed_up: count, complete: true }));
  return receipt;
}
try {
  const outcomes = await Promise.allSettled(Object.entries(specs).map(([t, s]) => backup(t, s)));
  if (outcomes.some((x) => x.status === "rejected")) throw Error("OUTLINE_BACKUP_FAILED");
  const context = await rest("corpus_context?key=eq.law_outline&select=*");
  if (context.data.length !== 1) throw Error("OUTLINE_CONTEXT_CHANGED");
  await save("manifest.json", {
    schema: "owner-openus-outline-backup/1",
    project: "xosqzzsnhxcyehcnirpa",
    completed_at: new Date().toISOString(),
    tables: outcomes.map((x) => x.value),
    context: await save("law_outline.json", context.data),
  });
} finally {
  await lock.close();
  await fs.unlink(path.join(root, "backup.lock"));
}
