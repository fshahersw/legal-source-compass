import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { directoryQuality, registryQuality } from "../src/lib/corpus/quality.ts";
import { STATES } from "../src/lib/corpus/geo.ts";

const inputs = ["atlas-import-bundle.json", "registry_v06_1.jsonl", "corpus/insights.json"];
const bytes = inputs.map((p) => readFileSync(`private/data/${p}`));
const [atlas, insights] = [JSON.parse(bytes[0]), JSON.parse(bytes[2])];
const entries = [];
let invalidLines = 0;
for (const line of bytes[1]
  .toString("utf8")
  .split("\n")
  .filter((l) => l.trim())) {
  try {
    const row = JSON.parse(line);
    if (typeof row.id !== "string" || typeof row.url !== "string") {
      invalidLines++;
      continue;
    }
    for (const key of [
      "parent_id",
      "jurisdiction",
      "record_category",
      "verified_date",
      "http_status",
    ])
      row[key] = row[key] == null ? "" : String(row[key]);
    entries.push(row);
  } catch {
    invalidLines++;
  }
}
const report = {
  schemaVersion: 1,
  qualification:
    "Computed from bundled files only. Source counts are URLs; occurrences are mentions; case rows are a saved catalog. HTTP observations are historical. No national completeness, legal currency, outcome probabilities or identity merges are inferred.",
  assembledOn: atlas.meta.assembledOn,
  inputs: inputs.map((path, i) => ({
    path,
    bytes: bytes[i].length,
    sha256: createHash("sha256").update(bytes[i]).digest("hex"),
  })),
  directory: directoryQuality(
    atlas.directorySources.map((s) => ({
      ...s,
      headings: s.categories,
      occurrences: s.occurrences.length,
    })),
  ),
  registry: { ...registryQuality(entries), invalidLines },
  cases: {
    rows: insights.matters.length,
    scopedDockets: insights.masters.length,
    recordedCitationEdges: insights.citation_edges,
    withoutState: insights.matters.filter((r) => !r.state).length,
    withoutRecognizedState: insights.matters.filter((r) => !STATES.some((s) => s.usps === r.state))
      .length,
    qualification: insights.qualification,
  },
};
const output = "private/data/quality/bundled-audit.json";
const serialized = JSON.stringify(report, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== serialized)
    throw new Error("Bundled audit is stale. Run npm run audit:corpus.");
  console.log("Bundled audit matches the original file bytes.");
} else {
  mkdirSync("private/data/quality", { recursive: true });
  writeFileSync(output, serialized);
  console.log(
    JSON.stringify({
      output,
      directory: report.directory.rows,
      registry: report.registry.rows,
      cases: report.cases.rows,
      sourceIssues: report.directory.issues.length,
      orphanParents: report.registry.orphanParentIds.length,
    }),
  );
}
