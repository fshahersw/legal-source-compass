import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = "private/data/research";
const manifest = JSON.parse(await readFile(`${root}/source-manifest.json`, "utf8"));
const captures = [
  {
    id: "doj-state-resources",
    file: "doj-resources.json",
    page: "https://www.justice.gov/jmd/ls/state",
  },
  {
    id: "mdl-court-research",
    file: "mdl-research.json",
    page: "https://www.scd.uscourts.gov/mdl-2873/orders.asp",
  },
];
for (const capture of captures) {
  const bytes = await readFile(`${root}/raw/${capture.file}`);
  const data = JSON.parse(bytes.toString("utf8"));
  if (
    bytes.length > 10_000_000 ||
    data.pages.some((p) => (p.status ?? p.metadata?.statusCode) !== 200 || !p.markdown)
  )
    throw new Error(`${capture.id}: invalid capture`);
  manifest.sources = manifest.sources.filter((s) => s.id !== capture.id);
  manifest.sources.push({
    ...capture,
    url: capture.page,
    fetchedAt: data.capturedAt,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    captureType: "Retrieved markdown and source metadata",
    pages: data.pages.length,
  });
}
await writeFile(`${root}/source-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${manifest.sources.length} hashed source downloads and research captures`);
