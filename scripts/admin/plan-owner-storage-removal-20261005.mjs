#!/usr/bin/env node
// Offline, read-only removal-plan generator for the owner-approved storage scope.
// It consumes only the immutable inventory-v1 files; it performs no HTTP or DB I/O.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryDir = path.join(
  root,
  "private/audit-2026-10-05/owner-removal-openus-cpsc/inventory-v1",
);
const outputDir = path.join(
  root,
  "private/audit-2026-10-05/owner-removal-openus-cpsc/storage-plan-v1",
);
const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const outputFiles = [
  "storage-plan-v1.json",
  "eligible-objects.jsonl",
  "protected-objects.jsonl",
  "ambiguous-pdf-objects.jsonl",
  "README.md",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function readVerified(entry) {
  const file = path.join(inventoryDir, entry.file);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Inventory page integrity mismatch: ${entry.file}`);
  }
  return bytes;
}
function loadPages(section, parseRows) {
  const expected = manifest[section];
  const rows = [];
  for (const page of expected.pages ?? [])
    rows.push(...parseRows(JSON.parse(readVerified(page).toString("utf8"))));
  if (rows.length !== expected.rows)
    throw new Error(`${section} row-count mismatch: ${rows.length} != ${expected.rows}`);
  return rows;
}
function addReason(map, key, reason) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(reason);
}
function jsonlBuffer(rows) {
  return Buffer.from(
    rows.map((x) => JSON.stringify(x)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

if (fs.existsSync(outputDir)) {
  if (!process.argv.includes("--replace-output"))
    throw new Error(`Refusing to overwrite plan output: ${outputDir}`);
  const resolvedOutput = path.resolve(outputDir);
  const allowedParent = path.resolve(root, "private/audit-2026-10-05/owner-removal-openus-cpsc");
  if (!resolvedOutput.startsWith(allowedParent + path.sep))
    throw new Error("Plan output path escaped the designated private audit folder.");
  const existing = fs.readdirSync(resolvedOutput);
  if (existing.some((file) => !outputFiles.includes(file)))
    throw new Error("Refusing to replace output folder containing unrecognized files.");
  for (const file of existing) fs.unlinkSync(path.join(resolvedOutput, file));
} else fs.mkdirSync(outputDir, { recursive: false });
const manifestBytes = fs.readFileSync(path.join(inventoryDir, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.project !== PROJECT || manifest.bucket !== BUCKET)
  throw new Error("Inventory target project/bucket mismatch.");
const appEntry = manifest.app_manifest;
const appBytes = readVerified(appEntry);
const app = JSON.parse(appBytes.toString("utf8"));
if (app.project_id !== PROJECT || app.bucket !== BUCKET)
  throw new Error("App manifest target mismatch.");

const storageRows = loadPages("objects", (value) => value.objects ?? []);
const artifacts = loadPages("artifacts", (value) => value);
const pdfObjects = loadPages("pdfs", (value) => value.rows ?? []);
const storageByKey = new Map();
for (const obj of storageRows) {
  if (!obj.name || storageByKey.has(obj.name))
    throw new Error(`Missing or duplicate storage object key: ${obj.name ?? "<empty>"}`);
  storageByKey.set(obj.name, obj);
}
const errors = [];
const protectedReasons = new Map();
const manifestKeys = new Set(
  Object.values(app.files ?? {})
    .map((row) => row.storage_key)
    .filter(Boolean),
);
const artifactKeys = new Set(artifacts.map((row) => row.object_key).filter(Boolean));
const readyArtifactKeys = new Set(
  artifacts
    .filter((row) => row.ready === true)
    .map((row) => row.object_key)
    .filter(Boolean),
);
const pdfHashes = new Set(pdfObjects.map((row) => row.sha256).filter(Boolean));
const pdfKeys = new Set(
  pdfObjects.map((row) => {
    if (row.storage_key) return row.storage_key;
    if (!/^[a-f0-9]{64}$/i.test(row.sha256 ?? ""))
      throw new Error(`Invalid PDF registry SHA: ${row.sha256}`);
    // corpus-pdf-assets-v1 constrains registered PDFs to this canonical key form.
    return `seeger-weiss/pdf-sha256/${row.sha256.slice(0, 2)}/${row.sha256}.pdf`;
  }),
);

function requirePresent(keys, reason) {
  for (const key of keys) {
    if (!storageByKey.has(key)) errors.push(`${reason}: missing storage key ${key}`);
    else addReason(protectedReasons, key, reason);
  }
}
requirePresent(manifestKeys, "active_app_manifest_dependency");
requirePresent(readyArtifactKeys, "ready_artifact_app_dependency");
requirePresent(pdfKeys, "registered_matter_pdf_bytes");
const pdfSizeMismatches = [];
for (const row of pdfObjects) {
  const key =
    row.storage_key ?? `seeger-weiss/pdf-sha256/${row.sha256.slice(0, 2)}/${row.sha256}.pdf`;
  const actual = storageByKey.get(key);
  if (
    actual &&
    Number(actual.metadata?.size ?? actual.metadata?.contentLength) !== Number(row.bytes)
  ) {
    pdfSizeMismatches.push({
      key,
      registry_bytes: Number(row.bytes),
      storage_bytes: Number(actual.metadata?.size ?? actual.metadata?.contentLength),
    });
  }
}
for (const artifact of artifacts) {
  if (!artifact.object_key || !storageByKey.has(artifact.object_key))
    errors.push(
      `artifact route ${artifact.route ?? "<unknown>"}: missing object key ${artifact.object_key ?? "<empty>"}`,
    );
}

const artifactByKey = new Map();
for (const artifact of artifacts) {
  const key = artifact.object_key;
  if (!key) continue;
  if (!artifactByKey.has(key)) artifactByKey.set(key, []);
  artifactByKey.get(key).push(artifact);
  if (pdfHashes.has(artifact.sha256))
    addReason(protectedReasons, key, "artifact_same_sha256_as_registered_pdf");
  if (artifact.route?.startsWith("/supplement-files/court_documents/") && isPdfArtifact(artifact)) {
    addReason(protectedReasons, key, "court_document_pdf_route");
  }
  if (artifact.route?.startsWith("/mdl-files/") && isPdfArtifact(artifact)) {
    addReason(protectedReasons, key, "mdl_pdf_route");
  }
  if (artifact.route?.startsWith("/files/") && artifact.ready !== true && isPdfArtifact(artifact)) {
    addReason(protectedReasons, key, "held_opaque_file_pdf_unresolved_matter_status");
  }
}

function isPdfArtifact(row) {
  return /pdf/i.test(row.mime ?? "") || /\.pdf(?:$|[?#])/i.test(row.filename ?? "");
}

// Match embedded full SHA-256 tokens in current storage keys to registry hashes.
// This catches aliases such as full-matter-audit keys without protecting the whole prefix.
for (const obj of storageRows) {
  const tokens = obj.name.match(/[a-f0-9]{64}/gi) ?? [];
  if (tokens.some((token) => pdfHashes.has(token.toLowerCase()))) {
    addReason(protectedReasons, obj.name, "storage_key_embeds_registered_pdf_sha256");
  }
}

const fileNames = Object.keys(app.files ?? {});
const bundleProof = {
  entries: fileNames.length,
  unique_keys: manifestKeys.size,
  all_present: [...manifestKeys].every((key) => storageByKey.has(key)),
};
const readyProof = {
  routes: artifacts.filter((a) => a.ready === true).length,
  unique_keys: readyArtifactKeys.size,
  all_present: [...readyArtifactKeys].every((key) => storageByKey.has(key)),
};
const pdfProof = {
  rows: pdfObjects.length,
  unique_keys: pdfKeys.size,
  all_present: [...pdfKeys].every((key) => storageByKey.has(key)),
};

// Explicit active evidence namespaces named by the owner.
for (const obj of storageRows) {
  if (obj.name.startsWith("state-codes/"))
    addReason(protectedReasons, obj.name, "active_state_codes_dependency");
  if (obj.name.startsWith("legal-authority-raw/"))
    addReason(protectedReasons, obj.name, "legal_authority_raw_dependency");
}

// Same-hash aliases are protected above. Unknown PDFs are held unless their sole
// artifact identity is an explicitly labeled science-document route and that hash
// is not a registered matter PDF. Ready science artifacts remain protected as app deps.
const ambiguousPdfKeys = new Set();
for (const obj of storageRows) {
  const key = obj.name;
  const artifactAliases = artifactByKey.get(key) ?? [];
  const mime = String(obj.metadata?.mimetype ?? "").toLowerCase();
  const nameLooksPdf = /\.pdf$/i.test(key);
  const artifactLooksPdf = artifactAliases.some(isPdfArtifact);
  const pdfLike = mime.includes("pdf") || nameLooksPdf || artifactLooksPdf;
  if (!pdfLike || protectedReasons.has(key)) continue;
  const scienceOnly =
    artifactAliases.length > 0 &&
    artifactAliases.every(
      (a) =>
        a.route?.startsWith("/supplement-files/agency_science_documents/") &&
        isPdfArtifact(a) &&
        !pdfHashes.has(a.sha256),
    );
  if (scienceOnly) continue;
  addReason(protectedReasons, key, "unknown_pdf_matter_status_conservative_hold");
  ambiguousPdfKeys.add(key);
}

const courtPdfArtifacts = artifacts.filter(
  (a) => a.route?.startsWith("/supplement-files/court_documents/") && isPdfArtifact(a),
);
const mdlPdfArtifacts = artifacts.filter(
  (a) => a.route?.startsWith("/mdl-files/") && isPdfArtifact(a),
);
const courtKeys = new Set(courtPdfArtifacts.map((a) => a.object_key));
const mdlKeys = new Set(mdlPdfArtifacts.map((a) => a.object_key));

if (!bundleProof.all_present || !readyProof.all_present || !pdfProof.all_present)
  errors.push("Required app/PDF dependency missing from inventory storage listing.");
if (pdfSizeMismatches.length)
  errors.push(`Registered PDF byte-size mismatch for ${pdfSizeMismatches.length} canonical keys.`);
for (const key of [...courtKeys, ...mdlKeys])
  if (!storageByKey.has(key)) errors.push(`Required route PDF missing from storage: ${key}`);
if (errors.length) throw new Error(`Refusing to emit plan: ${errors.slice(0, 25).join("; ")}`);

const protectedRows = [];
const eligibleRows = [];
for (const obj of storageRows) {
  const entry = {
    bucket_id: BUCKET,
    key: obj.name,
    id: obj.id ?? null,
    version: obj.version ?? null,
    bytes: Number(obj.metadata?.size ?? obj.metadata?.contentLength ?? 0),
    mimetype: obj.metadata?.mimetype ?? null,
    is_delete_marker: obj.is_delete_marker ?? false,
  };
  if (protectedReasons.has(obj.name)) {
    protectedRows.push({ ...entry, reasons: [...protectedReasons.get(obj.name)].sort() });
  } else {
    eligibleRows.push({ ...entry, reasons: [] });
  }
}
const sumBytes = (rows) =>
  rows.reduce((sum, row) => sum + (Number.isFinite(row.bytes) ? row.bytes : 0), 0);
const stateCodeKeys = storageRows
  .filter((x) => x.name.startsWith("state-codes/"))
  .map((x) => x.name);
const legalAuthorityKeys = storageRows
  .filter((x) => x.name.startsWith("legal-authority-raw/"))
  .map((x) => x.name);
const artifactPdfShaMatches = artifacts.filter((a) => pdfHashes.has(a.sha256));
const targetNameArtifacts = artifacts.filter((a) =>
  /open[_ -]?us[_ -]?law|openuslaw|cpsc[_ -]?injury|neiss/i.test(
    `${a.route} ${a.filename} ${a.object_key}`,
  ),
);
const bulkFileArtifacts = artifacts.filter((a) => a.route?.startsWith("/bulk-files/us_"));
const outputBuffers = {
  eligible: jsonlBuffer(eligibleRows),
  protected: jsonlBuffer(protectedRows),
  ambiguous_pdf: jsonlBuffer(
    [...ambiguousPdfKeys].sort().map((key) => {
      const obj = storageByKey.get(key);
      return {
        bucket_id: BUCKET,
        key,
        id: obj.id ?? null,
        version: obj.version ?? null,
        bytes: Number(obj.metadata?.size ?? obj.metadata?.contentLength ?? 0),
        reasons: [...protectedReasons.get(key)].sort(),
      };
    }),
  ),
};
const plan = {
  schema: "owner-storage-removal-plan/v1",
  created_at: new Date().toISOString(),
  mode: "read_only_plan_only_no_mutations",
  inventory: {
    project: manifest.project,
    bucket: manifest.bucket,
    started_at: manifest.started_at,
    finished_at: manifest.finished_at,
    manifest_sha256: sha256(manifestBytes),
    verified_pages: {
      objects: manifest.objects.pages,
      artifacts: manifest.artifacts.pages,
      pdfs: manifest.pdfs.pages,
      app_manifest: appEntry,
    },
  },
  totals: {
    storage_objects: storageRows.length,
    protected: { objects: protectedRows.length, bytes: sumBytes(protectedRows) },
    eligible: { objects: eligibleRows.length, bytes: sumBytes(eligibleRows) },
    ambiguous_pdf_objects: ambiguousPdfKeys.size,
    missing_dependencies: 0,
  },
  protected: protectedRows,
  eligible: eligibleRows,
  output_lists: {
    eligible: {
      file: "eligible-objects.jsonl",
      rows: eligibleRows.length,
      bytes: outputBuffers.eligible.length,
      sha256: sha256(outputBuffers.eligible),
    },
    protected: {
      file: "protected-objects.jsonl",
      rows: protectedRows.length,
      bytes: outputBuffers.protected.length,
      sha256: sha256(outputBuffers.protected),
    },
    ambiguous_pdfs: {
      file: "ambiguous-pdf-objects.jsonl",
      rows: ambiguousPdfKeys.size,
      bytes: outputBuffers.ambiguous_pdf.length,
      sha256: sha256(outputBuffers.ambiguous_pdf),
    },
  },
  dependency_proofs: {
    current_manifest: bundleProof,
    ready_artifacts: readyProof,
    registered_pdfs: pdfProof,
    registered_pdf_size_mismatches: pdfSizeMismatches,
    court_document_pdf: {
      routes: courtPdfArtifacts.length,
      unique_keys: courtKeys.size,
      all_present: [...courtKeys].every((key) => storageByKey.has(key)),
    },
    mdl_pdf: {
      routes: mdlPdfArtifacts.length,
      unique_keys: mdlKeys.size,
      all_present: [...mdlKeys].every((key) => storageByKey.has(key)),
    },
    state_codes: {
      keys: stateCodeKeys.length,
      bytes: stateCodeKeys.reduce((n, k) => n + Number(storageByKey.get(k).metadata?.size || 0), 0),
    },
    legal_authority_raw: {
      keys: legalAuthorityKeys.length,
      bytes: legalAuthorityKeys.reduce(
        (n, k) => n + Number(storageByKey.get(k).metadata?.size || 0),
        0,
      ),
    },
    artifact_sha_aliases_to_registered_pdf: {
      rows: artifactPdfShaMatches.length,
      unique_keys: new Set(artifactPdfShaMatches.map((a) => a.object_key)).size,
    },
    direct_target_name_artifact_matches: targetNameArtifacts.map((a) => ({
      route: a.route,
      object_key: a.object_key,
      sha256: a.sha256,
      bytes: a.bytes,
      mime: a.mime,
      ready: a.ready,
    })),
    us_law_bulk_file_routes: {
      routes: bulkFileArtifacts.length,
      ready_routes: bulkFileArtifacts.filter((a) => a.ready).length,
      note: "Route family is a separate bulk-file group; it is not proof that these are the open_us_law corpus_records dataset.",
    },
  },
  classification: {
    eligible_means_unreferenced_by_the_protected_sets_above_not_a_delete_command: true,
    science_pdf_rule:
      "only a non-ready artifact key whose every artifact route is explicitly agency_science_documents and whose hash is not in the matter PDF registry may be eligible",
    unknown_pdf_rule:
      "preserve as ambiguous unless exact science route classification or a protected dependency resolves it",
    limitations: [
      "No table-level record deletions are included.",
      "Storage objects are classified only from inventory-v1, artifact routes, bundle manifest, PDF registry, and explicit dependency prefixes.",
      "The plan does not execute or authorize a deletion; parent must reconcile intended dataset scope and use a guarded executor.",
    ],
  },
};

fs.writeFileSync(
  path.join(outputDir, "storage-plan-v1.json"),
  JSON.stringify(plan, null, 2) + "\n",
  { flag: "wx" },
);
fs.writeFileSync(path.join(outputDir, "eligible-objects.jsonl"), outputBuffers.eligible, {
  flag: "wx",
});
fs.writeFileSync(path.join(outputDir, "protected-objects.jsonl"), outputBuffers.protected, {
  flag: "wx",
});
fs.writeFileSync(path.join(outputDir, "ambiguous-pdf-objects.jsonl"), outputBuffers.ambiguous_pdf, {
  flag: "wx",
});
const md = `# Offline storage removal plan\n\nGenerated: ${plan.created_at}\nInventory manifest SHA-256: \`${plan.inventory.manifest_sha256}\`\n\nNo network, database, storage API, or mutation was performed.\n\n- Inventory objects: ${storageRows.length.toLocaleString()}\n- Protected objects: ${protectedRows.length.toLocaleString()} (${sumBytes(protectedRows).toLocaleString()} bytes)\n- Eligible objects under these protection rules: ${eligibleRows.length.toLocaleString()} (${sumBytes(eligibleRows).toLocaleString()} bytes)\n- Ambiguous PDF objects additionally held: ${ambiguousPdfKeys.size.toLocaleString()}\n- Current manifest: ${bundleProof.entries.toLocaleString()} entries / ${bundleProof.unique_keys.toLocaleString()} distinct present keys\n- Ready artifacts: ${readyProof.routes.toLocaleString()} routes / ${readyProof.unique_keys.toLocaleString()} distinct present keys\n- Registered PDFs: ${pdfProof.rows.toLocaleString()} rows / ${pdfProof.unique_keys.toLocaleString()} distinct present keys\n- Court-document PDFs: ${courtPdfArtifacts.length.toLocaleString()} routes / ${courtKeys.size.toLocaleString()} keys\n- MDL PDFs: ${mdlPdfArtifacts.length.toLocaleString()} routes / ${mdlKeys.size.toLocaleString()} keys\n- State-code evidence objects: ${stateCodeKeys.length.toLocaleString()}\n- Legal-authority raw evidence objects: ${legalAuthorityKeys.length.toLocaleString()}\n\n\`eligible-objects.jsonl\` is a candidate inventory only, not a deletion instruction. Review dataset scope and shared aliases before any later action.\n`;
fs.writeFileSync(path.join(outputDir, "README.md"), md, { flag: "wx" });
console.log(
  JSON.stringify(
    { outputDir, totals: plan.totals, dependency_proofs: plan.dependency_proofs },
    null,
    2,
  ),
);
