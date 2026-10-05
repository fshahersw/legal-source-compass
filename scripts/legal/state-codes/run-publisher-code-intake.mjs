// Private, resumable intake for the reviewed Texas publisher packet. Dry-run
// is the default. A deployed contract and an actual matching open run must exist
// before the first object upload. This runner never opens/closes a database run,
// changes a public collection, releases holds, or activates calculator rules.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";
import { ensurePublisherObject, publisherObjectKey } from "./publisher-code-storage.mjs";

const PROJECT = "xosqzzsnhxcyehcnirpa",
  SOURCE = "texas-legislature-code";
const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = (code) => {
  throw new Error(code);
};
const digest = (value) => hashBytes(canonicalIntegerJson(value));
async function privatePath(file, existing = true) {
  const root = await fs.realpath("private");
  const resolved = existing
    ? await fs.realpath(file)
    : path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("PRIVATE_PATH_REQUIRED");
  return resolved;
}
async function readPinned(file, expected, bytes) {
  const body = await fs.readFile(await privatePath(file));
  if (hashBytes(body) !== expected || (bytes !== undefined && body.length !== bytes))
    fail("PINNED_FILE_CHANGED");
  return body;
}
export async function loadPublisherPacket(folder, expectedHash) {
  if (!HASH.test(expectedHash ?? "")) fail("MANIFEST_HASH_REQUIRED");
  const root = await privatePath(folder);
  const manifestBytes = await readPinned(path.join(root, "manifest.json"), expectedHash);
  const manifest = JSON.parse(manifestBytes);
  if (
    digest(manifest) !== expectedHash ||
    manifest.schema_version !== "publisher-code-private-packet/1" ||
    manifest.project_id !== PROJECT ||
    manifest.source_system !== SOURCE ||
    manifest.parser !== "texas-publisher-html/5" ||
    manifest.registered !== false ||
    manifest.published !== false ||
    manifest.cloud_verified !== false ||
    manifest.assets?.file !== "assets.json" ||
    !Array.isArray(manifest.batches) ||
    manifest.batches.length < 1 ||
    manifest.batches.length > 10000
  )
    fail("PRIVATE_PACKET_REQUIRED");
  const assets = JSON.parse(
    await readPinned(path.join(root, "assets.json"), manifest.assets.sha256),
  );
  if (
    !Array.isArray(assets) ||
    assets.length < 1 ||
    assets.length > 20000 ||
    digest(assets) !== manifest.assets.sha256 ||
    assets.length !== manifest.assets.unique_objects ||
    new Set(assets.map((a) => a.sha256)).size !== assets.length
  )
    fail("ASSET_PLAN_MISMATCH");
  let assetBytes = 0;
  for (const asset of assets) {
    publisherObjectKey(asset.sha256);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 25 * 1024 * 1024)
      fail("ASSET_SIZE_LIMIT");
    await readPinned(asset.path, asset.sha256, asset.bytes);
    assetBytes += asset.bytes;
  }
  if (assetBytes !== manifest.assets.unique_bytes) fail("ASSET_TOTAL_MISMATCH");
  const loadBatch = async (index) => {
    const b = manifest.batches[index];
    if (
      !b ||
      b.file !== `batch-${String(index).padStart(5, "0")}.json` ||
      !Number.isSafeInteger(b.records) ||
      b.records < 1 ||
      b.records > 500 ||
      !Number.isSafeInteger(b.bytes) ||
      b.bytes < 1 ||
      b.bytes > 1900000
    )
      fail("BOUNDED_BATCH_REQUIRED");
    const rows = JSON.parse(await readPinned(path.join(root, b.file), b.sha256, b.bytes));
    if (!Array.isArray(rows) || rows.length !== b.records || digest(rows) !== b.sha256)
      fail("BATCH_HASH_OR_COUNT_MISMATCH");
    return rows;
  };
  const counts = {},
    identities = new Set();
  for (let index = 0; index < manifest.batches.length; index++) {
    for (const row of await loadBatch(index)) {
      const d = row.data,
        p = row.provenance;
      if (
        row.source_system !== SOURCE ||
        row.schema_version !== "publisher-code-evidence/1" ||
        !["code-chapter-document", "code-section-occurrence"].includes(row.entity_type) ||
        typeof row.native_id !== "string" ||
        !row.native_id ||
        row.native_id.length > 512 ||
        d?.jurisdiction !== "TX" ||
        d.publisher_native_entity !== false ||
        d.public_projection_allowed !== false ||
        d.calculation_activation_allowed !== false ||
        d.current_law_verified !== false ||
        p?.record_hash_codec !== "canonical-integer-jsonb/1" ||
        p.parser !== manifest.parser ||
        digest(d) !== p.record_sha256
      )
        fail("ROW_IDENTITY_OR_PRIVATE_GATE_MISMATCH");
      const identity = JSON.stringify([row.source_system, row.entity_type, row.native_id]);
      if (identities.has(identity)) fail("DUPLICATE_NATIVE_OCCURRENCE");
      identities.add(identity);
      counts[row.entity_type] = (counts[row.entity_type] ?? 0) + 1;
    }
  }
  if (canonicalIntegerJson(counts) !== canonicalIntegerJson(manifest.counts))
    fail("PACKET_RECORD_COUNTS_MISMATCH");
  return {
    manifest,
    manifestHash: expectedHash,
    assets,
    loadBatch,
    counts,
    records: identities.size,
  };
}

export function publisherCredentials(cfg) {
  if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) fail("WRONG_PROJECT");
  const token = cfg.EXTERNAL_SUPABASE_KEY;
  if (typeof token !== "string") fail("SERVICE_CREDENTIAL_REQUIRED");
  if (token.startsWith("ey")) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    } catch {
      fail("SERVICE_CREDENTIAL_REQUIRED");
    }
    if (claims.role !== "service_role" || claims.ref !== PROJECT)
      fail("SERVICE_CREDENTIAL_REQUIRED");
  } else if (!token.startsWith("sb_secret_")) fail("SERVICE_CREDENTIAL_REQUIRED");
  return {
    url: cfg.EXTERNAL_SUPABASE_URL,
    headers: {
      apikey: token,
      ...(!token.startsWith("sb_") ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}
function validateReadback(receipt, asset) {
  if (
    receipt?.project_id !== PROJECT ||
    receipt.private_only !== true ||
    receipt.bucket !== "corpus-originals" ||
    receipt.sha256 !== asset.sha256 ||
    receipt.bytes !== asset.bytes ||
    receipt.readback_sha256 !== asset.sha256 ||
    receipt.readback_bytes !== asset.bytes ||
    receipt.object_key !== publisherObjectKey(asset.sha256) ||
    receipt.http_status !== 200 ||
    receipt.verification_method !== "authenticated-whole-object-get-sha256" ||
    !Number.isFinite(Date.parse(receipt.verified_at)) ||
    receipt.test_only === true ||
    receipt.actual_cloud_verification === false
  )
    fail("REAL_WHOLE_OBJECT_RECEIPT_REQUIRED");
  if (
    asset.kind === "chapter_text_derivative" &&
    (receipt.readback_text_encoding !== "utf-8" ||
      !Number.isSafeInteger(receipt.readback_text_code_points) ||
      receipt.readback_text_code_points < 1 ||
      receipt.readback_text_code_points > asset.bytes)
  )
    fail("VERIFIED_TEXT_CODE_POINT_COUNT_REQUIRED");
  return receipt;
}
function validateStatus(status, packet, runId) {
  const s = status?.scope;
  if (
    status?.contract !== "publisher-code-progress/1" ||
    status.run_exists !== true ||
    status.run_id !== runId ||
    status.manifest_sha256 !== packet.manifestHash ||
    status.private_only !== true ||
    status.published !== false ||
    s?.source_system !== SOURCE ||
    s.contract !== "publisher-code-intake/1" ||
    s.jurisdiction !== "TX" ||
    s.packet_manifest_sha256 !== packet.manifestHash ||
    s.private_only !== true ||
    s.public_projection_allowed !== false ||
    s.calculation_activation_allowed !== false ||
    !["running", "partial", "completed"].includes(status.run_status) ||
    !Array.isArray(status.batches) ||
    typeof status.registered !== "boolean" ||
    !Number.isSafeInteger(status.objects) ||
    status.objects < 0
  )
    fail("ACTUAL_PINNED_PRIVATE_RUN_REQUIRED");
  if (
    status.batches.some(
      (b, i) =>
        b.index !== i ||
        b.sha256 !== packet.manifest.batches[i]?.sha256 ||
        b.records !== packet.manifest.batches[i]?.records,
    )
  )
    fail("DATABASE_BATCH_RECEIPT_CONFLICT");
  if (!status.registered && (status.batches.length || status.objects))
    fail("DATABASE_UNREGISTERED_STATE_CONFLICT");
  if (
    status.registered &&
    (status.objects !== packet.assets.length ||
      status.object_bytes !== packet.manifest.assets.unique_bytes ||
      status.objects_missing_from_private_catalog !== 0)
  )
    fail("REGISTERED_PRIVATE_OBJECTS_MISMATCH");
  return status;
}
function batchVerified(proof, runId, index, batch) {
  return (
    proof?.contract === "publisher-code-progress/1" &&
    proof.run_id === runId &&
    proof.batch_index === index &&
    proof.sha256 === batch.sha256 &&
    proof.expected === batch.records &&
    proof.matched === batch.records &&
    proof.receipt_present === true &&
    proof.receipt_matches === true &&
    proof.verified === true &&
    proof.private_only === true &&
    proof.published === false
  );
}

export async function runPublisherIntake({
  packet,
  runId,
  credentials,
  record,
  priorReadbacks = [],
  maxObjects = 500,
  maxBatches = 25,
  fetcher = fetch,
  ensureObject = ensurePublisherObject,
}) {
  if (
    !UUID.test(runId ?? "") ||
    typeof record !== "function" ||
    !Number.isSafeInteger(maxObjects) ||
    maxObjects < 1 ||
    maxObjects > 20000 ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > 10000
  )
    fail("BOUNDED_INTAKE_AND_JOURNAL_REQUIRED");
  credentials = publisherCredentials({
    EXTERNAL_SUPABASE_URL: credentials?.url,
    EXTERNAL_SUPABASE_KEY: credentials?.headers?.apikey,
  });
  const rpc = async (name, body) => {
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 16 * 1024 * 1024) fail("RPC_PAYLOAD_LIMIT");
    await record({
      state: "rpc_pending",
      rpc: name,
      body_sha256: hashBytes(payload),
      batch_index: body.p_batch_index ?? null,
    });
    const response = await fetcher(`${credentials.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...credentials.headers, "Content-Type": "application/json" },
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    });
    await record({ state: "rpc_http_response", rpc: name, http_status: response.status });
    if (!response.ok) {
      await response.body?.cancel();
      fail("PUBLISHER_RPC_REJECTED");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) fail("RPC_RESPONSE_LIMIT");
      chunks.push(Buffer.from(chunk));
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      fail("RPC_RESPONSE_UNREADABLE");
    }
    await record({ state: "rpc_result", rpc: name, result: value });
    return value;
  };
  const statusCall = async () =>
    validateStatus(
      await rpc("corpus_publisher_code_status_v1", {
        p_run: runId,
        p_manifest_sha256: packet.manifestHash,
      }),
      packet,
      runId,
    );
  let status = await statusCall(); // Required before any Storage write.
  const readbacks = new Map();
  for (const r of priorReadbacks) {
    const asset = packet.assets.find((a) => a.sha256 === r.sha256);
    if (!asset) fail("PRIOR_RECEIPT_OUTSIDE_PACKET");
    readbacks.set(r.sha256, validateReadback(r, asset));
  }
  let objectsVerifiedThisPass = 0,
    batchesWrittenThisPass = 0,
    batchesVerified = 0;
  const freshObjectHashes = new Set();
  const summary = (extra) => ({
    project_id: PROJECT,
    run_id: runId,
    manifest_sha256: packet.manifestHash,
    objects_verified_this_pass: objectsVerifiedThisPass,
    object_receipts_available: readbacks.size,
    batches_written_this_pass: batchesWrittenThisPass,
    batches_verified: batchesVerified,
    private_only: true,
    published: false,
    database_run_completed_by_runner: false,
    ...extra,
  });
  if (!status.registered) {
    if (status.run_status === "completed") fail("CLOSED_UNREGISTERED_RUN");
    for (const asset of packet.assets) {
      if (readbacks.has(asset.sha256)) continue;
      if (objectsVerifiedThisPass >= maxObjects)
        return summary({ state: "object_pass_cap", complete: false });
      const bytes = await readPinned(asset.path, asset.sha256, asset.bytes);
      const receipt = await ensureObject({ asset, bytes, credentials, record, fetcher });
      validateReadback(receipt, asset);
      await record({ state: "publisher_object_receipt", receipt });
      readbacks.set(asset.sha256, receipt);
      freshObjectHashes.add(asset.sha256);
      objectsVerifiedThisPass++;
    }
  }
  // Old local receipts can track an interrupted upload pass, but cannot alone
  // authorize registration or further intake. Re-read all previously verified
  // objects in this invocation. Missing/corrupt objects stop without repair.
  // This bounded refresh can read at most the packet's complete asset plan.
  for (const asset of packet.assets) {
    if (freshObjectHashes.has(asset.sha256)) continue;
    const bytes = await readPinned(asset.path, asset.sha256, asset.bytes);
    const receipt = await ensureObject({
      asset,
      bytes,
      credentials,
      record,
      fetcher,
      allowUpload: false,
    });
    validateReadback(receipt, asset);
    await record({ state: "publisher_object_receipt", receipt });
    readbacks.set(asset.sha256, receipt);
    freshObjectHashes.add(asset.sha256);
    objectsVerifiedThisPass++;
  }
  if (!status.registered) {
    const result = await rpc("corpus_publisher_code_register_v1", {
      p_run: runId,
      p_manifest: packet.manifest,
      p_assets: packet.assets,
      p_readbacks: packet.assets.map((a) => readbacks.get(a.sha256)),
    });
    if (
      result.registered_packet !== packet.manifestHash ||
      result.objects !== packet.assets.length ||
      result.bytes !== packet.manifest.assets.unique_bytes ||
      result.published !== false
    )
      fail("REGISTRATION_ACK_MISMATCH");
    status = await statusCall();
    if (!status.registered) fail("REGISTRATION_NOT_OBSERVED");
  }
  for (let index = 0; index < packet.manifest.batches.length; index++) {
    const b = packet.manifest.batches[index],
      rows = await packet.loadBatch(index);
    const body = { p_run: runId, p_batch_index: index, p_rows: rows };
    const proof = await rpc("corpus_publisher_code_verify_batch_v1", body);
    if (batchVerified(proof, runId, index, b)) {
      batchesVerified++;
      continue;
    }
    if (
      proof?.contract !== "publisher-code-progress/1" ||
      proof.run_id !== runId ||
      proof.batch_index !== index ||
      proof.sha256 !== b.sha256 ||
      proof.expected !== b.records ||
      proof.matched !== 0 ||
      proof.receipt_present !== false ||
      proof.verified !== false
    )
      fail("PARTIAL_OR_CONFLICTING_BATCH_REQUIRES_AUDIT");
    if (status.run_status === "completed") fail("CLOSED_INCOMPLETE_RUN");
    if (batchesWrittenThisPass >= maxBatches)
      return summary({ state: "batch_pass_cap", complete: false });
    // Unknown or rejected acknowledgements stop immediately. On a later resume,
    // the read-only exact-version proof resolves a committed-but-unacknowledged
    // batch without another mutation. No blind retries occur in this process.
    const result = await rpc("corpus_publisher_code_intake_v1", body);
    if (result.received !== rows.length) fail("INTAKE_ACK_MISMATCH");
    batchesWrittenThisPass++;
    if (!batchVerified(await rpc("corpus_publisher_code_verify_batch_v1", body), runId, index, b))
      fail("POST_INTAKE_VERSION_PROOF_FAILED");
    batchesVerified++;
  }
  status = await statusCall();
  if (
    status.batches.length !== packet.manifest.batches.length ||
    canonicalIntegerJson(status.observation_counts) !== canonicalIntegerJson(packet.counts)
  )
    fail("FINAL_DATABASE_COUNTS_MISMATCH");
  return summary({
    state: "private_intake_verified",
    complete: true,
    records_verified: packet.records,
    final_status: status,
  });
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const n = x.indexOf("=");
      return n < 0 ? [x.slice(2), true] : [x.slice(2, n), x.slice(n + 1)];
    }),
  );
  if (!args.packet || !args["manifest-sha256"]) fail("PACKET_AND_MANIFEST_ARGUMENTS_REQUIRED");
  const packet = await loadPublisherPacket(String(args.packet), String(args["manifest-sha256"]));
  if (args.execute !== true) {
    if (args.execute !== undefined) fail("LITERAL_EXECUTE_FLAG_REQUIRED");
    console.log(
      JSON.stringify({
        state: "local_packet_verified",
        network_requests: 0,
        database_writes: 0,
        records: packet.records,
        assets: packet.assets.length,
        batches: packet.manifest.batches.length,
        manifest_sha256: packet.manifestHash,
      }),
    );
    return;
  }
  if (!UUID.test(args.run ?? "") || !args.output || !args.credentials)
    fail("RUN_OUTPUT_CREDENTIALS_REQUIRED");
  const credentials = publisherCredentials(
    JSON.parse(await fs.readFile(String(args.credentials), "utf8")),
  );
  const output = await privatePath(path.resolve(String(args.output)), false);
  try {
    await fs.mkdir(output);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await privatePath(output);
  const identity = { project_id: PROJECT, run_id: args.run, manifest_sha256: packet.manifestHash };
  const identityFile = path.join(output, "identity.json");
  try {
    await fs.writeFile(identityFile, canonicalIntegerJson(identity), { flag: "wx" });
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      canonicalIntegerJson(JSON.parse(await fs.readFile(identityFile, "utf8"))) !==
        canonicalIntegerJson(identity)
    )
      fail("EXISTING_OUTPUT_IDENTITY_MISMATCH");
  }
  const lockPath = path.join(output, "intake.lock"),
    nonce = randomUUID();
  const lock = await fs.open(lockPath, "wx");
  let journal, record;
  try {
    await lock.writeFile(
      JSON.stringify({
        ...identity,
        pid: process.pid,
        nonce,
        created_at: new Date().toISOString(),
      }),
    );
    await lock.sync();
    const journalPath = path.join(output, "journal.jsonl");
    let prior = [];
    try {
      const data = await fs.readFile(journalPath, "utf8");
      if (data && !data.endsWith("\n")) fail("TRUNCATED_JOURNAL_REQUIRES_AUDIT");
      prior = data
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const event of prior)
      if (event.run_id !== args.run || event.manifest_sha256 !== packet.manifestHash)
        fail("JOURNAL_IDENTITY_MISMATCH");
    journal = await fs.open(journalPath, "a");
    record = async (event) => {
      await journal.writeFile(
        JSON.stringify({ ...event, ...identity, at: new Date().toISOString() }) + "\n",
      );
      await journal.sync();
    };
    await record({ state: "attempt_started", nonce, pid: process.pid });
    const result = await runPublisherIntake({
      packet,
      runId: args.run,
      credentials,
      record,
      priorReadbacks: prior
        .filter((e) => e.state === "publisher_object_receipt")
        .map((e) => e.receipt),
      maxObjects: Number(args["max-objects"] ?? 500),
      maxBatches: Number(args["max-batches"] ?? 25),
    });
    await record({ state: "attempt_finished", nonce, summary: result });
    await fs.writeFile(
      path.join(output, `result-${nonce}.json`),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    if (record) {
      try {
        await record({
          state: "attempt_stopped",
          nonce,
          error_code: /^[A-Z_]+$/.test(error.message)
            ? error.message
            : "UNKNOWN_OUTCOME_REQUIRES_AUDIT",
        });
      } catch {
        /* Keep the original failure; a damaged journal must be audited. */
      }
    }
    throw error;
  } finally {
    await journal?.close();
    await lock.close();
    const held = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (held.nonce === nonce) await fs.unlink(lockPath);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "PUBLISHER_INTAKE_STOPPED_CHECK_PRIVATE_EVIDENCE",
    );
    process.exitCode = 1;
  });
