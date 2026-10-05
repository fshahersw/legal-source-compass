// Read-only citation/byte mapping. Never updates rules, changes legal review
// dates, activates a calculation, or substitutes a section for its subsections.
import fs from "node:fs/promises";
import path from "node:path";
import { hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";
import { loadPublisherPacket } from "./run-publisher-code-intake.mjs";

const [outputArg] = process.argv.slice(2);
if (!outputArg) throw Error("NEW_PRIVATE_OUTPUT_REQUIRED");
const privateRoot = await fs.realpath("private"),
  output = path.resolve(outputArg);
const parent = await fs.realpath(path.dirname(output)),
  relative = path.relative(privateRoot, parent);
if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("PRIVATE_OUTPUT_REQUIRED");
await fs.mkdir(output);
const manifestPath = "src/lib/private-data/manifest.server.json",
  manifestBytes = await fs.readFile(manifestPath),
  bundle = JSON.parse(manifestBytes);
if (bundle.project_id !== "xosqzzsnhxcyehcnirpa") throw Error("WRONG_BUNDLE_PROJECT");
const bundleInput = async (name) => {
  const file = `private/audit-2026-10-05/state-law-restoration/before/${name}.json`;
  const bytes = await fs.readFile(file),
    pinned = bundle.files[`limitations/${name}.json`];
  if (hashBytes(bytes) !== pinned?.sha256 || bytes.length !== pinned.bytes)
    throw Error("SHIPPED_BUNDLE_INPUT_MISMATCH");
  return { file, sha256: hashBytes(bytes), value: JSON.parse(bytes) };
};
const rules = await bundleInput("rules"),
  sources = await bundleInput("sources");
if (rules.value.ruleVersion !== "2026-10-05.1") throw Error("REVIEWED_RULE_RELEASE_REQUIRED");
const source = sources.value.sources.find((s) => s.id === "tx-cp16");
if (!source || source.state !== "TX") throw Error("EXACT_TEXAS_SOURCE_REQUIRED");
const sourceUrl = new URL(source.url);
if (
  sourceUrl.hostname !== "statutes.capitol.texas.gov" ||
  sourceUrl.searchParams.get("code") !== "CP" ||
  sourceUrl.searchParams.get("chapter") !== "CP.16" ||
  sourceUrl.searchParams.get("artSec") !== "16.003"
)
  throw Error("SOURCE_NATIVE_CODE_AND_CHAPTER_MISMATCH");
const sourceTextPath = path.join("private", source.textPath.replace(/^\//, ""));
const sourceTextBytes = await fs.readFile(sourceTextPath);
if (hashBytes(sourceTextBytes) !== source.sha256 || sourceTextBytes.length !== source.byteLength)
  throw Error("REVIEWED_SOURCE_TEXT_CHANGED");
const packet = await loadPublisherPacket(
  "private/audit-2026-10-05/full-state-codes/tx/private-intake-v3",
  "87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da",
);
const selectedRules = rules.value.rules.filter((r) => r.jurisdiction === "TX");
const joins = selectedRules.map((rule) => {
  if (rule.sourceIds.length !== 1 || rule.sourceIds[0] !== source.id)
    throw Error("RULE_SOURCE_SCOPE_CHANGED");
  const sections = [...new Set(rule.pinpoint.match(/(?<![\d.])16\.\d{3,4}(?![\d.])/g) ?? [])];
  if (!sections.length || !/^Tex\. Civ\. Prac\. & Rem\. Code/.test(rule.pinpoint))
    throw Error("EXPLICIT_REVIEWED_PINPOINT_REQUIRED");
  return {
    rule_id: rule.id,
    computation: rule.computation,
    pinpoint: rule.pinpoint,
    source_id: source.id,
    native_citation_keys: sections.map((s) => `CP:${s}`),
    subsection_mapping: "Not inferred; original pinpoint retained for legal review",
  };
});
const wanted = new Set(joins.flatMap((j) => j.native_citation_keys));
const chapterRows = [],
  matches = new Map([...wanted].map((k) => [k, []]));
for (let i = 0; i < packet.manifest.batches.length; i++) {
  const batch = packet.manifest.batches[i];
  for (const row of await packet.loadBatch(i)) {
    if (row.entity_type === "code-chapter-document" && row.native_id === "CP:cp.16.htm")
      chapterRows.push(row);
    if (
      row.entity_type === "code-section-occurrence" &&
      matches.has(row.data.native_citation_key)
    ) {
      matches
        .get(row.data.native_citation_key)
        .push({ row, batch_index: i, batch_sha256: batch.sha256 });
    }
  }
}
if (chapterRows.length !== 1 || [...matches.values()].some((rows) => rows.length !== 1))
  throw Error("AMBIGUOUS_OR_MISSING_EXACT_CITATION");
const chapter = chapterRows[0];
const asset = packet.assets.find((a) => a.sha256 === chapter.data.text_sha256);
if (!asset || chapter.data.code !== "CP" || chapter.data.publisher_member !== "cp.16.htm")
  throw Error("CHAPTER_BINDING_MISMATCH");
const chapterBytes = await fs.readFile(asset.path);
if (
  hashBytes(chapterBytes) !== chapter.data.text_sha256 ||
  chapterBytes.length !== chapter.data.text_bytes
)
  throw Error("CHAPTER_TEXT_CHANGED");
const chapterText = new TextDecoder("utf-8", { fatal: true }).decode(chapterBytes),
  points = Array.from(chapterText);
if (!chapterText.includes("CHAPTER 16. LIMITATIONS"))
  throw Error("PUBLISHER_CHAPTER_HEADING_MISMATCH");
const mapped = [];
for (const [citation, hits] of matches) {
  const { row, batch_index, batch_sha256 } = hits[0],
    d = row.data,
    span = d.text_span;
  if (
    d.chapter_identity !== chapter.native_id ||
    d.text_derivative_sha256 !== chapter.data.text_sha256 ||
    row.provenance.raw_member_sha256 !== chapter.provenance.raw_member_sha256 ||
    row.provenance.source_sha256 !== chapter.provenance.source_sha256 ||
    span.unit !== "unicode_code_points" ||
    span.start < 0 ||
    span.end > points.length ||
    span.start >= span.end
  )
    throw Error("EXACT_PARENT_OR_SPAN_MISMATCH");
  const text = points.slice(span.start, span.end).join(""),
    bytes = Buffer.from(text);
  if (hashBytes(bytes) !== d.text_sha256 || !text.includes(`Sec. ${d.native_section_anchor}.`))
    throw Error("SECTION_TEXT_HASH_OR_HEADING_MISMATCH");
  const file = `${d.native_section_anchor}.txt`;
  await fs.writeFile(path.join(output, file), bytes, { flag: "wx" });
  mapped.push({
    native_citation_key: citation,
    source_occurrence_id: row.native_id,
    chapter_identity: chapter.native_id,
    payload_sha256: row.provenance.record_sha256,
    section_text_sha256: d.text_sha256,
    section_text_bytes: bytes.length,
    text_file: file,
    text_span: span,
    chapter_text_sha256: chapter.data.text_sha256,
    archive_sha256: row.provenance.source_sha256,
    raw_member_sha256: row.provenance.raw_member_sha256,
    source_url: row.provenance.source_url,
    publisher_member: row.provenance.publisher_member,
    retrieved_at: row.provenance.retrieved_at,
    publisher_section_url: d.publisher_section_url,
    batch_index,
    batch_sha256,
  });
}
const evidence = {
  schema_version: "publisher-code-calculator-citation-map/1",
  created_at: new Date().toISOString(),
  project_id: bundle.project_id,
  private_only: true,
  published: false,
  calculator_changed: false,
  current_law_verified_by_this_mapping: false,
  scope:
    "Exact section-level native citation and byte mapping for the six Texas rules in protected release .1. No subsection interpretation, new legal review date or rule activation.",
  bundle_manifest_sha256: hashBytes(manifestBytes),
  rules: { file: rules.file, sha256: rules.sha256, version: rules.value.ruleVersion },
  sources: { file: sources.file, sha256: sources.sha256 },
  existing_reviewed_source: {
    id: source.id,
    url: source.url,
    text_path: sourceTextPath,
    sha256: source.sha256,
  },
  packet_manifest_sha256: packet.manifestHash,
  joins,
  mapped_sections: mapped,
  counts: {
    rules: joins.length,
    rule_section_associations: joins.reduce((n, j) => n + j.native_citation_keys.length, 0),
    unique_sections: mapped.length,
  },
};
if (
  evidence.counts.rules !== 6 ||
  evidence.counts.rule_section_associations !== 7 ||
  evidence.counts.unique_sections !== 4
)
  throw Error("REVIEWED_MAPPING_SCOPE_CHANGED");
const bytes = Buffer.from(JSON.stringify(evidence, null, 2) + "\n");
await fs.writeFile(path.join(output, "citation-map.json"), bytes, { flag: "wx" });
console.log(
  JSON.stringify({
    private_only: true,
    published: false,
    output,
    sha256: hashBytes(bytes),
    ...evidence.counts,
  }),
);
