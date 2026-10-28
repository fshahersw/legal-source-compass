// Builds the dry-run packet for the large_text_assets release (large-text-assets-release/2026-10-27.1) from a saved
// read-only survey: the JSON array produced by the per-row query in database/contracts/verify-large-text-assets-release-20261027.sql
// ("per-row survey"), either bare or inside the SQL tool's result envelope. Writes rows.json and release-packet.json.
// Usage: node scripts/admin/large-text-assets-release-packet.mjs <survey file> <out dir>
import fs from "node:fs";

/** Pull the survey row array out of a bare JSON array or a tool result envelope. */
export function parseSurvey(raw) {
  let text = raw.trim();
  if (text.startsWith("[")) return JSON.parse(text);
  try {
    text = JSON.parse(text).result ?? text;
  } catch {
    /* not an envelope */
  }
  const m = /<untrusted-data-[^>]+>\s*(\[.*\])\s*<\/untrusted-data/s.exec(text);
  if (!m) throw new Error("survey rows not found");
  const outer = JSON.parse(m[1]);
  const first = Object.values(outer[0] ?? {})[0];
  return typeof first === "string" ? JSON.parse(first) : outer;
}

/** The contract's selection rule, row by row. */
export function decide(row) {
  const present = row.routes.filter((x) => x.object_present).length;
  const complete = row.routes.length > 0 && present === row.routes.length;
  if (row.host === "olls.info")
    return { decision: "held", rule: "statute_source_official_publisher_only", stored_text_present: complete };
  if (complete) return { decision: "released", rule: "official_publisher_and_stored_text_present", stored_text_present: true };
  return { decision: "held", rule: "stored_text_missing", stored_text_present: false };
}

export function buildPacket(rows) {
  const out = rows.map((r) => ({ ...r, ...decide(r) }));
  const count = (k) => out.reduce((a, r) => ((a[r[k]] = (a[r[k]] ?? 0) + 1), a), {});
  const hosts = {};
  for (const r of out) {
    const h = (hosts[r.host] ??= { rows: 0, released: 0, held: 0, routes: 0, objects_present: 0, text_bytes: 0 });
    h.rows += 1;
    h[r.decision] += 1;
    h.routes += r.routes.length;
    h.objects_present += r.routes.filter((x) => x.object_present).length;
    h.text_bytes += Number(r.utf8_bytes ?? 0);
  }
  return {
    rows: out,
    packet: {
      key: "dataset-large-text-assets",
      release: "large-text-assets-release/2026-10-27.1",
      totals: { rows: out.length, by_decision: count("decision"), by_rule: count("rule"), by_category: count("category") },
      hosts,
      contract: "database/contracts/large-text-assets-release-20261027.sql",
      rollback: "database/contracts/large-text-assets-release-20261027.rollback.sql",
      verify: "database/contracts/verify-large-text-assets-release-20261027.sql",
      test: "scripts/admin/large-text-assets-release.contract.test.mjs",
    },
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [src, outDir] = process.argv.slice(2);
  if (!src || !outDir) throw new Error("usage: large-text-assets-release-packet.mjs <survey file> <out dir>");
  const { rows, packet } = buildPacket(parseSurvey(fs.readFileSync(src, "utf8")));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/rows.json`, JSON.stringify(rows, null, 1) + "\n");
  fs.writeFileSync(`${outDir}/release-packet.json`, JSON.stringify(packet, null, 1) + "\n");
  console.log(JSON.stringify(packet.totals));
}
