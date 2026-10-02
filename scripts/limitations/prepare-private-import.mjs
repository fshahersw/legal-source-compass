import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const root = resolve("public/data/limitations");
const output = resolve(process.argv[2] ?? "../private/legal-review-import-20261002");
await mkdir(output, { recursive: true });
const hash = (v) => createHash("sha256").update(v).digest("hex");
const files = {};
for (const name of [
  "sources",
  "rules",
  "coverage",
  "case-references",
  "publisher-overrides",
  "rejected-captures",
]) {
  const path = join(root, name + ".json"),
    bytes = await readFile(path),
    metadata = await stat(path);
  files[name] = {
    doc: JSON.parse(bytes.toString("utf8")),
    sha256: hash(bytes),
    mtime: metadata.mtime.toISOString(),
    path,
  };
}
const sourceById = new Map(files.sources.doc.sources.map((r) => [r.id, r]));
const rows = [],
  omitted = [];
function envelope(type, id, data, file, url, retrievedAt, provenance = {}) {
  if (!id || !/^https:\/\//.test(url) || !Number.isFinite(Date.parse(retrievedAt)))
    throw Error("Bad import provenance");
  const row = {
    schema_version: "1.0.0",
    source_system: "corpus-legal-review",
    entity_type: type,
    native_id: id,
    data,
    provenance: {
      record_sha256: hash(JSON.stringify(data)),
      source_url: url,
      source_sha256: files[file].sha256,
      hash_kind: "bundle_file_sha256",
      source_bundle: file + ".json",
      source_bundle_sha256: files[file].sha256,
      source_as_of: files[file].doc.snapshotDate,
      retrieved_at: retrievedAt,
      retrieval_kind: "derived_bundle_file_modified_at",
      pdf_downloads: 0,
      legal_review_scope:
        "conditional_statutory_baselines_and_selected_opinion_passages;not_complete_operative_law",
      ...provenance,
    },
  };
  if (Buffer.byteLength(JSON.stringify(row)) > 845000)
    throw Error("Unexpected oversized envelope " + id);
  rows.push(row);
}
for (const r of files.sources.doc.sources) {
  const bytes = await readFile(resolve("public" + r.textPath));
  if (hash(bytes) !== r.sha256 || bytes.length !== r.byteLength)
    throw Error("Source hash mismatch " + r.id);
  const data = {
    ...r,
    text: bytes.toString("utf8"),
    full_text_storage: {
      status: "included",
      sha256: r.sha256,
      byteLength: r.byteLength,
      bundlePath: r.textPath,
    },
  };
  if (Buffer.byteLength(JSON.stringify(data)) + 10000 > 840000) {
    delete data.text;
    data.full_text_storage.status = "file_locator_only";
    data.full_text_storage.note =
      "Exact text exceeds safe management-API single-record budget; full text is not in the database record.";
    omitted.push({ id: r.id, sha256: r.sha256, byteLength: r.byteLength, bundlePath: r.textPath });
  }
  envelope("statutory-sources", r.id, data, "sources", r.url, r.capturedAt, {
    source_sha256: r.sha256,
    hash_kind: "verified_text_file_sha256",
    retrieval_kind: "source_capture",
    verified_at: r.verifiedAt,
  });
}
for (const r of files.rules.doc.rules) {
  const s = r.sourceIds.map((id) => sourceById.get(id));
  if (s.some((v) => !v)) throw Error("Missing rule source");
  envelope("limitation-rules", r.id, r, "rules", s[0].url, files.rules.mtime, {
    source_urls: s.map((x) => x.url),
    source_text_hashes: s.map((x) => ({ id: x.id, sha256: x.sha256 })),
    review_version: r.ruleVersion,
    rule_computation: r.computation,
  });
}
for (const r of files.coverage.doc.coverage) {
  const url = r.publisherLinks?.[0]?.url ?? r.discoverySource;
  envelope("jurisdiction-coverage", r.state, r, "coverage", url, files.coverage.mtime, {
    source_urls: r.publisherLinks.map((p) => p.url),
  });
}
for (const r of files["case-references"].doc.cases) {
  const bytes = await readFile(resolve("public" + r.textPath));
  if (hash(bytes) !== r.sha256 || bytes.length !== r.byteLength)
    throw Error("Opinion hash mismatch");
  const data = {
    ...r,
    text: bytes.toString("utf8"),
    full_text_storage: {
      status: "included",
      sha256: r.sha256,
      byteLength: r.byteLength,
      bundlePath: r.textPath,
    },
  };
  if (Buffer.byteLength(JSON.stringify(data)) + 10000 > 840000) {
    delete data.text;
    data.full_text_storage.status = "file_locator_only";
    data.full_text_storage.note =
      "Full opinion text is not in database; exact bundle locator and hash retained.";
    omitted.push({ id: r.id, sha256: r.sha256, byteLength: r.byteLength, bundlePath: r.textPath });
  }
  envelope("judicial-references", r.id, data, "case-references", r.url, r.capturedAt, {
    source_sha256: r.sha256,
    hash_kind: "verified_opinion_text_file_sha256",
    retrieval_kind: "source_capture",
    copy_publisher: r.copyPublisher,
  });
}
for (const r of files["publisher-overrides"].doc.jurisdictions) {
  const url = r.publisherLinks[0]?.url;
  envelope(
    "publisher-routes",
    r.state,
    r,
    "publisher-overrides",
    url,
    files["publisher-overrides"].mtime,
    {
      source_urls: r.publisherLinks.map((p) => p.url),
      source_status: "publisher_route_metadata_not_captured_statutory_text",
    },
  );
}
for (const r of files["rejected-captures"].doc.captures) {
  envelope(
    "rejected-captures",
    r.id,
    r,
    "rejected-captures",
    r.requestedUrl,
    files["rejected-captures"].mtime,
    {
      retrieval_kind: "derived_rejection_audit_file_modified_at",
      source_status: "rejected_or_missing_content;not_authority",
    },
  );
}
const outputFile = join(output, "legal-review.jsonl");
await writeFile(outputFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const counts = Object.fromEntries(
  [...new Set(rows.map((r) => r.entity_type))].map((t) => [
    t,
    rows.filter((r) => r.entity_type === t).length,
  ]),
);
const manifest = {
  schemaVersion: "corpus-legal-import-preparation/1",
  preparedAt: new Date().toISOString(),
  runId: "494cfa52-74c5-42ac-a770-80e46b9a3035",
  projectId: "xosqzzsnhxcyehcnirpa",
  sourceSystem: "corpus-legal-review",
  records: rows.length,
  counts,
  omittedFullText: omitted,
  sourceBundles: Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, { sha256: v.sha256, actualModifiedAt: v.mtime }]),
  ),
  input: outputFile,
  inputSha256: hash(await readFile(outputFile)),
  pdfBinaries: 0,
  private: true,
};
await writeFile(join(output, "preparation.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest));
