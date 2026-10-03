/** Public acquisition evidence: hashes and aggregate metadata only, never private filesystem paths. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((s, i, a) => (s.startsWith("--") ? [s.slice(2), a[i + 1]] : []))
    .filter((x) => x.length),
);
if (!args.cache || !args.output)
  throw Error("Require --cache private-directory --output public-receipt.json");
const manifest = JSON.parse(await fs.readFile(`${args.cache}/manifest.json`, "utf8"));
const receipt = JSON.parse(await fs.readFile(`${args.cache}/normalized-receipt.json`, "utf8"));
const originals = [];
for (const [sourceId, s] of Object.entries(manifest.sources)) {
  const bytes = await fs.readFile(`${args.cache}/${s.file}`);
  if (
    !s.complete ||
    s.http_status !== 200 ||
    bytes.length !== s.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== s.sha256
  )
    throw Error(`Original evidence mismatch: ${sourceId}`);
  originals.push({
    sourceId,
    url: s.url,
    retrievedAt: s.retrieved_at,
    bytes: s.bytes,
    sha256: s.sha256,
  });
}
const notes = (await fs.readFile(`${args.cache}/part-authority-notes.jsonl`, "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
if (
  originals.length !== 86 ||
  notes.length !== 36 ||
  notes.some((n) => n.schema_version !== "ecfr-authority-notes/1.1")
)
  throw Error("Unexpected source-note schema or inventory");
const output = {
  schemaVersion: "ecfr-acquisition-quality/1",
  capturedAt: manifest.created_at,
  metadataOnly: true,
  pdfDownloads: 0,
  sourceAsOf: receipt.source_as_of,
  titleInventory: receipt.title_inventory,
  reservedTitles: receipt.reserved_titles,
  completeTitleTrees: receipt.complete_title_trees,
  nodes: receipt.nodes,
  nodeTypes: receipt.node_type_counts,
  parentEdges: receipt.parent_edges,
  unidentifiedHeadingMetadataRetained: receipt.unidentified_heading_metadata_retained,
  selectedPartSnapshots: notes.length,
  sectionHeadingRecords: notes.reduce((n, r) => n + r.data.sections.length, 0),
  nativeSectionCitationNotes: notes.reduce(
    (n, r) => n + r.data.sections.reduce((a, s) => a + s.citation_notes.length, 0),
    0,
  ),
  normalizedFiles: receipt.files,
  originals,
  qualification:
    "This receipt verifies original acquisition and normalization. Database import, public projection and deployment have separate reconciliation receipts. Dated eCFR editorial metadata is authoritative but unofficial; technical receipt/title-currentness dates do not establish provision effective dates. No complete provisions, incorporated standards or case-specific applicability are certified.",
};
await fs.writeFile(args.output, JSON.stringify(output, null, 2) + "\n");
console.log(
  JSON.stringify({
    sources: originals.length,
    nodes: receipt.nodes,
    notes: notes.length,
    citationNotes: output.nativeSectionCitationNotes,
  }),
);
