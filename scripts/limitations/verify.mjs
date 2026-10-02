import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve("public/data/limitations");
const sourcePath = path.join(root, "sources.json");
const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
const ids = new Set();
for (const source of snapshot.sources) {
  if (ids.has(source.id)) throw new Error(`Duplicate source ${source.id}`);
  ids.add(source.id);
  if (!source.url.startsWith("https://") || /\.pdf(?:$|\?)/i.test(source.url))
    throw new Error(`Unexpected source URL ${source.id}`);
  const bytes = await readFile(path.join(root, "text", `${source.id}.txt`));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (process.argv.includes("--update")) {
    source.sha256 = hash;
    source.byteLength = bytes.length;
  } else if (source.sha256 !== hash || source.byteLength !== bytes.length) {
    throw new Error(`Source checksum mismatch: ${source.id}`);
  }
  if (bytes.length > 10_000_000) throw new Error(`Source too large ${source.id}`);
}
if (process.argv.includes("--update"))
  await writeFile(sourcePath, `${JSON.stringify(snapshot, null, 2)}\n`);
const casesPath = path.join(root, "case-references.json");
const judicial = JSON.parse(await readFile(casesPath, "utf8"));
const caseIds = new Set();
for (const reference of judicial.cases) {
  if (caseIds.has(reference.id)) throw new Error(`Duplicate judicial reference ${reference.id}`);
  caseIds.add(reference.id);
  if (!reference.url.startsWith("https://") || reference.pdfDownloaded !== false)
    throw new Error(`Invalid judicial provenance ${reference.id}`);
  const bytes = await readFile(path.join(root, "opinion-text", `${reference.id}.txt`));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (process.argv.includes("--update")) {
    reference.sha256 = hash;
    reference.byteLength = bytes.length;
  } else if (reference.sha256 !== hash || reference.byteLength !== bytes.length) {
    throw new Error(`Judicial checksum mismatch: ${reference.id}`);
  }
  if (bytes.length > 10_000_000) throw new Error(`Judicial source too large ${reference.id}`);
}
if (process.argv.includes("--update"))
  await writeFile(casesPath, `${JSON.stringify(judicial, null, 2)}\n`);
console.log(
  JSON.stringify({
    sources: ids.size,
    stateJurisdictions: new Set(
      snapshot.sources.filter((s) => s.state !== "US").map((s) => s.state),
    ).size,
    federalStatutes: snapshot.sources.filter((s) => s.state === "US").length,
    judicialReferences: caseIds.size,
    checksums: "passed",
    pdfBinaries: 0,
  }),
);
