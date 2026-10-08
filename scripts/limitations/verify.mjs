import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const rootArgument = process.argv.slice(2).find((argument) => argument.startsWith("--root="));
if (rootArgument === "--root=") throw new Error("--root requires a directory");
const root = path.resolve(rootArgument?.slice("--root=".length) ?? "private/data/limitations");
const isPdf = (capture) =>
  capture?.contentType?.split(";")[0].trim().toLowerCase() === "application/pdf";
function verifyRawMetadata(capture, id) {
  if (capture === undefined) return;
  if (
    !capture ||
    !/^[a-f0-9]{64}$/.test(capture.sha256) ||
    !Number.isSafeInteger(capture.byteLength) ||
    capture.byteLength < 1 ||
    typeof capture.contentType !== "string" ||
    !capture.contentType.trim() ||
    typeof capture.retrievedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(capture.retrievedAt) ||
    !Number.isFinite(Date.parse(capture.retrievedAt)) ||
    new Date(capture.retrievedAt).toISOString().slice(0, 19) !== capture.retrievedAt.slice(0, 19)
  )
    throw new Error(`Invalid raw-capture metadata: ${id}`);
}
const sourcePath = path.join(root, "sources.json");
const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
const ids = new Set();
for (const source of snapshot.sources) {
  if (ids.has(source.id)) throw new Error(`Duplicate source ${source.id}`);
  ids.add(source.id);
  verifyRawMetadata(source.rawCapture, source.id);
  if (!source.url.startsWith("https://")) throw new Error(`Unexpected source URL ${source.id}`);
  // A link to a PDF whose stored bytes are not a PDF is honest only when the record says how the
  // text actually arrived: an extraction intermediary returns JSON or plain text for a PDF page,
  // and the raw capture is kept exactly as that intermediary produced it. A direct capture of a
  // PDF still has to hold PDF bytes, and an intermediary claim still has to match the bytes.
  if (/\.pdf(?:$|\?)/i.test(source.url) && !isPdf(source.rawCapture)) {
    const declaredIntermediary = /extraction intermediary/i.test(source.method ?? "");
    const wrappedType = source.rawCapture?.contentType?.split(";")[0].trim().toLowerCase();
    if (!declaredIntermediary || !["application/json", "text/plain", "text/html"].includes(wrappedType))
      throw new Error(`Unexpected source URL ${source.id}`);
  }
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
  verifyRawMetadata(reference.rawCapture, reference.id);
  if (
    !reference.url.startsWith("https://") ||
    typeof reference.pdfDownloaded !== "boolean" ||
    (reference.pdfDownloaded &&
      (!reference.officialPdfUrl?.startsWith("https://") || !isPdf(reference.rawCapture))) ||
    (!reference.pdfDownloaded && isPdf(reference.rawCapture))
  )
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
    rawCaptureMetadata: "validated; raw bytes require separate receipt verification",
    declaredOfficialPdfCaptures: snapshot.sources.filter((s) => isPdf(s.rawCapture)).length,
    declaredJudicialPdfCaptures: judicial.cases.filter((c) => c.pdfDownloaded).length,
  }),
);
