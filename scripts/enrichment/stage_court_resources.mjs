#!/usr/bin/env node
/** Stage one reviewed court snapshot and all immutable source evidence in private storage.
 * --descriptor=private/...staging.json --captures=private/... --review=private/...json --identity=private/...json
 * --out=private/... [--execute] [--activate]
 * Activation changes only the court-resource entry in the local manifest, never deployed law rules.
 * Credentials are environment-only; no database projections or held collections are modified.
 */
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { courtResourceSnapshotSchema } from "../../src/lib/courts/resourceSnapshot.ts";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const NAME = "court-resources/official-links.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validSha = (value) => /^[a-f0-9]{64}$/.test(value ?? "");

export function validateDescriptor(descriptor, body, review) {
  const entry = descriptor.entry;
  if (
    descriptor.schema !== "court-resource-staging/1" ||
    descriptor.publication !== "not_published" ||
    descriptor.file !== NAME ||
    !validSha(entry?.sha256) ||
    entry.bytes !== body.length ||
    body.length < 1 ||
    body.length > 16 * 1024 ** 2 ||
    sha(body) !== entry.sha256 ||
    entry.storage_key !==
      `atlas-private-data/sha256/${entry.sha256.slice(0, 2)}/${entry.sha256}.bin` ||
    sha(review) !== descriptor.reviewSha256
  )
    throw Error("INVALID_REVIEWED_DESCRIPTOR");
  const parsed = courtResourceSnapshotSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw Error("INVALID_BUNDLE_SCHEMA");
  const bundle = parsed.data;
  const decisions = JSON.parse(review);
  if (
    bundle.schema !== "court-resources/1" ||
    bundle.release !== descriptor.release ||
    decisions.schema !== "court-resource-review/1" ||
    decisions.release !== bundle.release ||
    !Array.isArray(decisions.decisions) ||
    !decisions.reviewer ||
    !decisions.reviewed_at ||
    !Array.isArray(bundle.resources) ||
    bundle.resources.length !== descriptor.resources ||
    !bundle.resources.length ||
    bundle.resources.length > 5000
  )
    throw Error("INVALID_BUNDLE_IDENTITY");
  for (const row of bundle.resources) {
    if (
      !validSha(row.provenance?.receiptSha256) ||
      !validSha(row.provenance?.responseSha256) ||
      row.review?.decision !== "approved" ||
      row.review.reviewer !== decisions.reviewer ||
      row.review.reviewedAt !== decisions.reviewed_at ||
      !decisions.decisions.some(
        (decision) =>
          decision.decision === "approve" &&
          decision.court_id === row.courtId &&
          decision.court_system === row.courtSystem &&
          decision.url === row.url &&
          decision.label === row.label &&
          decision.kind === row.kind &&
          decision.note === row.review.note &&
          decision.receipt_sha256 === row.provenance.receiptSha256,
      )
    )
      throw Error("REVIEW_MISMATCH");
  }
  return bundle;
}

export function validateIdentity(bundle, review, identityBytes) {
  const decisions = JSON.parse(review);
  const evidence = decisions.identity_evidence;
  if (!validSha(evidence?.sha256) || sha(identityBytes) !== evidence.sha256)
    throw Error("IDENTITY_HASH_MISMATCH");
  const identity = JSON.parse(identityBytes);
  if (
    identity.contract !== "corpus_detail" ||
    evidence.contract !== identity.contract ||
    evidence.retrieved_at !== identity.retrieved_at ||
    !Array.isArray(identity.records) ||
    !Array.isArray(evidence.records)
  )
    throw Error("INVALID_IDENTITY_EVIDENCE");
  const host = (value) => {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  for (const row of bundle.resources) {
    const records = identity.records.filter((record) => record.id === row.courtId);
    const reviewed = evidence.records.filter((record) => record.court_id === row.courtId);
    if (records.length !== 1 || reviewed.length !== 1) throw Error("AMBIGUOUS_COURT_IDENTITY");
    const record = records[0],
      match = reviewed[0];
    const data = record.data;
    const facts = new Map(Array.isArray(data?.facts) ? data.facts : []);
    if (
      record.status !== 200 ||
      data?.id !== row.courtId ||
      facts.get("CourtListener court id") !== row.courtId ||
      facts.get("System") !== row.courtSystem ||
      match.recorded_native_id !== row.courtId ||
      match.court_system !== row.courtSystem ||
      match.recorded_title !== data.title ||
      match.source_homepage !== row.provenance.sourcePage ||
      !match.match ||
      !data.links?.some((link) => host(link.url) === host(row.provenance.sourcePage))
    )
      throw Error("COURT_IDENTITY_MISMATCH");
  }
  return identity;
}

export function validateCaptureReceipt(bundle, receiptSha, rawReceipt) {
  if (sha(rawReceipt) !== receiptSha) throw Error("RECEIPT_HASH_MISMATCH");
  const receipt = JSON.parse(rawReceipt);
  if (
    !validSha(receipt.response_sha256) ||
    !validSha(receipt.text_sha256) ||
    receipt.status !== "captured" ||
    receipt.identity_reviewed !== true ||
    receipt.publication !== "not_published" ||
    !Array.isArray(receipt.anchors)
  )
    throw Error("INVALID_CAPTURE_RECEIPT");
  for (const row of bundle.resources.filter(
    (resource) => resource.provenance.receiptSha256 === receiptSha,
  ))
    if (
      row.courtId !== receipt.court_id ||
      row.courtName !== receipt.court_name ||
      row.provenance.responseSha256 !== receipt.response_sha256 ||
      row.provenance.sourcePage !== receipt.final_url ||
      row.provenance.sourceRecord !== receipt.source_record ||
      row.provenance.capturedAt !== receipt.retrieved_at ||
      !receipt.anchors.some(
        (anchor) =>
          anchor.url === row.url &&
          anchor.label === row.label &&
          typeof anchor.href_as_published === "string" &&
          !/\s/.test(anchor.href_as_published),
      )
    )
      throw Error("SOURCE_ANCHOR_MISMATCH");
  return receipt;
}

export function verifyRawSources(captures, review, bundle) {
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON]]
    : [["python3"], ["python"], ["py", "-3"]];
  const python = candidates.find(([command, ...args]) => {
    const check = spawnSync(
      command,
      [...args, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"],
      { timeout: 10000, stdio: "ignore" },
    );
    return !check.error && check.status === 0;
  });
  if (!python) throw Error("PYTHON_3_10_REQUIRED_FOR_RAW_EVIDENCE_CHECK");
  const [command, ...args] = python;
  const check = spawnSync(
    command,
    [
      ...args,
      "-B",
      "-X",
      "utf8",
      "scripts/enrichment/build_court_resource_bundle.py",
      `--captures=${captures}`,
      `--review=${review}`,
      `--verify-bundle=${bundle}`,
    ],
    { timeout: 60000, encoding: "utf8", maxBuffer: 64 * 1024 },
  );
  if (check.error || check.status !== 0) throw Error("RAW_EVIDENCE_REBUILD_FAILED");
  const result = JSON.parse(check.stdout);
  if (result.status !== "verified_against_raw_sources") throw Error("RAW_EVIDENCE_REBUILD_FAILED");
  return result;
}

export function parseArguments(values) {
  const argumentsList = values.map((arg) => {
    const at = arg.indexOf("=");
    if (!arg.startsWith("--")) throw Error("INVALID_ARGUMENT");
    return at < 0 ? [arg.slice(2), true] : [arg.slice(2, at), arg.slice(at + 1)];
  });
  const args = Object.fromEntries(argumentsList);
  if (argumentsList.length !== Object.keys(args).length) throw Error("DUPLICATE_ARGUMENT");
  for (const key of Object.keys(args))
    if (
      !["descriptor", "captures", "review", "identity", "out", "execute", "activate"].includes(key)
    )
      throw Error("INVALID_ARGUMENT");
  for (const key of ["execute", "activate"])
    if (args[key] !== undefined && args[key] !== true) throw Error("INVALID_BOOLEAN_FLAG");
  if (args.activate && !args.execute) throw Error("ACTIVATION_REQUIRES_EXECUTE");
  return args;
}

async function boundedBytes(response, limit) {
  if (!response.body) throw Error("EMPTY_STORAGE_RESPONSE");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw Error("STORAGE_SIZE_MISMATCH");
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export async function putVerified(url, headers, key, bytes, fetcher = fetch) {
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${key}`;
  const request = (extra) =>
    fetcher(endpoint, { headers, redirect: "error", signal: AbortSignal.timeout(45000), ...extra });
  let response = await request({});
  let created = false;
  if (response.status === 404 || response.status === 400) {
    // Supabase Storage uses HTTP 400 for its structured object-not-found response.
    const errorBody = await boundedBytes(response, 8192);
    let problem;
    try {
      problem = JSON.parse(errorBody);
    } catch {
      throw Error("UNEXPECTED_STORAGE_ERROR");
    }
    if (!["404", 404].includes(problem.statusCode) && problem.error !== "not_found")
      throw Error("UNEXPECTED_STORAGE_ERROR");
    response = await request({
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream", "x-upsert": "false" },
      body: bytes,
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 409) throw Error(`STORAGE_UPLOAD_${response.status}`);
    created = response.ok;
    response = await request({});
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`STORAGE_READBACK_${response.status}`);
  }
  const back = await boundedBytes(response, bytes.length);
  if (back.length !== bytes.length || sha(back) !== sha(bytes))
    throw Error("STORAGE_HASH_MISMATCH");
  return { storage_key: key, sha256: sha(bytes), bytes: bytes.length, created, verified: true };
}

export async function uploadWithJournal(files, url, headers, out, fetcher = fetch) {
  await mkdir(out, { recursive: true });
  const journal = resolve(out, `${randomUUID()}.objects.jsonl`);
  await writeFile(
    journal,
    JSON.stringify({
      schema: "court-resource-object-journal/1",
      startedAt: new Date().toISOString(),
    }) + "\n",
    { flag: "wx" },
  );
  const objects = [];
  for (const [storageKey, bytes] of files) {
    const intent = { storage_key: storageKey, sha256: sha(bytes), bytes: bytes.length };
    // An intent survives even if a successful upload is followed by a failed readback.
    await appendFile(journal, JSON.stringify({ ...intent, status: "verification_pending" }) + "\n");
    try {
      const object = await putVerified(url, headers, storageKey, bytes, fetcher);
      await appendFile(journal, JSON.stringify({ ...object, status: "verified" }) + "\n");
      objects.push(object);
    } catch (error) {
      await appendFile(
        journal,
        JSON.stringify({ ...intent, status: "failed_or_unverified" }) + "\n",
      );
      throw error;
    }
  }
  return { objects, journal };
}

async function privatePath(value) {
  if (!value) throw Error("PRIVATE_PATH_REQUIRED");
  const root = resolve("private"),
    path = resolve(value);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw Error("PRIVATE_PATH_REQUIRED");
  const { assertNoSymlinkPath } = await import("../verification/fetch-private-fixtures.mjs");
  await assertNoSymlinkPath(path);
  return path;
}

export async function main() {
  const args = parseArguments(process.argv.slice(2));
  const descriptorPath = await privatePath(args.descriptor),
    reviewPath = await privatePath(args.review);
  const captures = await privatePath(args.captures),
    out = await privatePath(args.out);
  const identityPath = await privatePath(args.identity);
  const descriptor = JSON.parse(await readFile(descriptorPath));
  if (!validSha(descriptor.entry?.sha256)) throw Error("INVALID_DESCRIPTOR_SHA");
  const bundlePath = await privatePath(
    resolve(dirname(descriptorPath), `${descriptor.entry.sha256}.json`),
  );
  const body = await readFile(bundlePath);
  const review = await readFile(reviewPath);
  const bundle = validateDescriptor(descriptor, body, review);
  const identityBytes = await readFile(identityPath);
  validateIdentity(bundle, review, identityBytes);
  verifyRawSources(captures, reviewPath, bundlePath);
  const files = new Map([[descriptor.entry.storage_key, body]]);
  const evidence = (bytes) => {
    const hash = sha(bytes);
    const key = `court-resources/evidence/sha256/${hash}`;
    files.set(key, bytes);
    return key;
  };
  evidence(review);
  evidence(await readFile(descriptorPath));
  evidence(identityBytes);
  for (const receiptSha of new Set(bundle.resources.map((row) => row.provenance.receiptSha256))) {
    const rawReceipt = await readFile(
      await privatePath(resolve(captures, "receipts", `${receiptSha}.json`)),
    );
    const receipt = validateCaptureReceipt(bundle, receiptSha, rawReceipt);
    evidence(rawReceipt);
    for (const [directory, hash, extension] of [
      ["raw", receipt.response_sha256, "raw"],
      ["text", receipt.text_sha256, "txt"],
    ]) {
      const raw = await readFile(
        await privatePath(resolve(captures, directory, `${hash}.${extension}`)),
      );
      if (sha(raw) !== hash || (directory === "raw" && raw.length !== receipt.response_bytes))
        throw Error("CAPTURE_HASH_MISMATCH");
      evidence(raw);
    }
  }
  const result = {
    schema: "court-resource-storage-readback/1",
    release: descriptor.release,
    resources: bundle.resources.length,
    publication: "not_deployed",
    descriptor,
    objects: [],
    activated: false,
    checkedAt: new Date().toISOString(),
  };
  if (args.execute) {
    const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
    const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
    if (url !== `https://${PROJECT}.supabase.co` || !key)
      throw Error("CORPUS_SERVER_CREDENTIALS_REQUIRED");
    const headers = {
      apikey: key,
      ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
    };
    const bucket = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!bucket.ok || (await bucket.json()).public !== false)
      throw Error("PRIVATE_BUCKET_REQUIRED");
    const uploaded = await uploadWithJournal(files, url, headers, out);
    result.objects = uploaded.objects;
    result.objectJournal = uploaded.journal;
    if (args.activate) {
      const manifestPath = "src/lib/private-data/manifest.server.json";
      const before = await readFile(manifestPath);
      const manifest = JSON.parse(before);
      if (manifest.project_id !== PROJECT || manifest.bucket !== BUCKET)
        throw Error("MANIFEST_PROJECT_MISMATCH");
      await mkdir(out, { recursive: true });
      await writeFile(resolve(out, `${sha(before)}.manifest-before.json`), before, { flag: "wx" });
      manifest.files[NAME] = descriptor.entry;
      manifest.created_at = new Date().toISOString();
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      result.activated = true;
      result.previousManifestSha256 = sha(before);
    }
  }
  await mkdir(out, { recursive: true });
  const encoded = JSON.stringify(result, null, 2) + "\n";
  await writeFile(resolve(out, `${sha(encoded)}.readback.json`), encoded, { flag: "wx" });
  console.log(
    JSON.stringify({
      resources: result.resources,
      objectsVerified: result.objects.length,
      activated: result.activated,
      publication: result.publication,
    }),
  );
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
