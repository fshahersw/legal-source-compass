// Print a read-only dry-run SELECT for database/contracts/release-held-artifacts-20261027.sql.
// It reuses the contract's own evaluation (statement 1) verbatim, so the dry run and the release cannot drift apart.
// Usage: node scripts/admin/held-artifact-release-dryrun.mjs [summary|hosts|routes] > dryrun.sql   (then run it read-only)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT = path.join(root, "database/contracts/release-held-artifacts-20261027.sql");

/** The contract's statement-1 query (the body of "create temporary table har_eval ... as"), without the trailing semicolon. */
export function evaluationQuery(raw = fs.readFileSync(CONTRACT, "utf8")) {
  const sql = raw.replace(/\r\n/g, "\n");
  const start = sql.indexOf("create temporary table har_eval on commit drop as\n");
  const endMarker = "group by h.route, h.family, h.sha256, h.bytes;";
  const end = sql.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Contract statement 1 not found");
  return sql.slice(start + "create temporary table har_eval on commit drop as\n".length, end + endMarker.length - 1);
}

export function dryRunSql(mode = "summary", sql) {
  const q = evaluationQuery(sql);
  const head = "begin read only;\nset local statement_timeout = '290s';\n";
  if (mode === "summary")
    return `${head}select family, decision, count(*) as routes, sum(bytes) as bytes, count(*) filter (where inherited) as inherited\nfrom (\n${q}\n) e group by rollup (family, decision) order by family nulls last, decision nulls last;\ncommit;\n`;
  if (mode === "hosts")
    return `${head}select decision, unnest(provenance) as host, count(*) as routes from (select decision, hosts as provenance from (\n${q}\n) e) x group by 1, 2 order by 1, 3 desc;\ncommit;\n`;
  if (mode === "routes")
    return `${head}select route, family, sha256, bytes, hosts, classes, via, inherited, decision from (\n${q}\n) e order by route;\ncommit;\n`;
  throw new Error(`Unknown mode ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(dryRunSql(process.argv[2] ?? "summary"));
}
