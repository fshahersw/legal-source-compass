// Offline interruption/recovery tests. All files and receipts are synthetic;
// injected transports make no network requests and cannot reach production.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";
import {
  loadPublisherPacket,
  requestPublisherRpc,
  runPublisherIntake,
  publisherCredentials,
} from "./run-publisher-code-intake.mjs";

const PROJECT = "xosqzzsnhxcyehcnirpa",
  RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const credentials = publisherCredentials({
  EXTERNAL_SUPABASE_URL: `https://${PROJECT}.supabase.co`,
  EXTERNAL_SUPABASE_KEY: "sb_secret_offline_fixture_not_a_real_key",
});
const canonical = (v) => Buffer.from(canonicalIntegerJson(v));
const hash = (v) => hashBytes(canonical(v));
async function fixture(t) {
  const privateRoot = path.resolve("private");
  await fs.mkdir(path.join(privateRoot, "tools"), { recursive: true });
  const folder = await fs.mkdtemp(path.join(privateRoot, "tools", "publisher-runner-test-"));
  const relative = path.relative(privateRoot, folder);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("TEST_DIRECTORY_OUTSIDE_PRIVATE");
  t.after(() => fs.rm(folder, { recursive: true, force: false }));
  const assets = [];
  for (const [i, text] of ["synthetic archive", "synthetic chapter text"].entries()) {
    const file = path.join(folder, `asset-${i}`),
      bytes = Buffer.from(text);
    await fs.writeFile(file, bytes);
    assets.push({
      path: file,
      sha256: hashBytes(bytes),
      bytes: bytes.length,
      kind: i ? "chapter_text_derivative" : "publisher_archive",
    });
  }
  const rows = ["code-chapter-document", "code-section-occurrence"].map((type, i) => {
    const data = {
      jurisdiction: "TX",
      publisher_native_entity: false,
      public_projection_allowed: false,
      calculation_activation_allowed: false,
      current_law_verified: false,
      label: `fixture ${i}`,
    };
    return {
      source_system: "texas-legislature-code",
      schema_version: "publisher-code-evidence/1",
      entity_type: type,
      native_id: `fixture:${i}`,
      data,
      provenance: {
        record_hash_codec: "canonical-integer-jsonb/1",
        parser: "texas-publisher-html/5",
        record_sha256: hash(data),
      },
    };
  });
  const batches = [];
  for (const [i, row] of rows.entries()) {
    const file = `batch-${String(i).padStart(5, "0")}.json`,
      bytes = canonical([row]);
    await fs.writeFile(path.join(folder, file), bytes);
    batches.push({ file, bytes: bytes.length, sha256: hashBytes(bytes), records: 1 });
  }
  await fs.writeFile(path.join(folder, "assets.json"), canonical(assets));
  const manifest = {
    schema_version: "publisher-code-private-packet/1",
    project_id: PROJECT,
    source_system: "texas-legislature-code",
    parser: "texas-publisher-html/5",
    registered: false,
    published: false,
    cloud_verified: false,
    counts: { "code-chapter-document": 1, "code-section-occurrence": 1 },
    batches,
    assets: {
      file: "assets.json",
      sha256: hash(assets),
      unique_objects: 2,
      unique_bytes: assets.reduce((n, a) => n + a.bytes, 0),
    },
  };
  await fs.writeFile(path.join(folder, "manifest.json"), canonical(manifest));
  return { folder, manifest, packet: await loadPublisherPacket(folder, hash(manifest)) };
}
function server(packet, options = {}) {
  const events = [],
    calls = [],
    uploaded = [],
    written = new Set();
  let registered = options.registered ?? false,
    lostAck = options.lostAck ?? false;
  const record = async (e) => events.push(e);
  const status = () => ({
    contract: "publisher-code-progress/1",
    run_exists: true,
    run_id: RUN,
    run_status: options.closed ? "completed" : "running",
    manifest_sha256: packet.manifestHash,
    private_only: true,
    published: false,
    registered,
    scope: {
      source_system: "texas-legislature-code",
      contract: "publisher-code-intake/1",
      jurisdiction: "TX",
      packet_manifest_sha256: packet.manifestHash,
      private_only: true,
      public_projection_allowed: false,
      calculation_activation_allowed: false,
    },
    objects: registered ? packet.assets.length : 0,
    object_bytes: registered ? packet.manifest.assets.unique_bytes : 0,
    objects_missing_from_private_catalog: 0,
    batches: [...written]
      .sort()
      .map((i) => ({ index: i, sha256: packet.manifest.batches[i].sha256, records: 1 })),
    observation_counts: Object.fromEntries(
      [...written].map((i) => [i ? "code-section-occurrence" : "code-chapter-document", 1]),
    ),
  });
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, `https://${PROJECT}.supabase.co`);
    const name = new URL(url).pathname.split("/").at(-1),
      body = JSON.parse(init.body);
    calls.push({ name, body });
    let value;
    if (name === "corpus_publisher_code_status_v1") {
      if (options.statusHttp) return new Response("{}", { status: options.statusHttp });
      value = options.statusOverride ? options.statusOverride(status()) : status();
    } else if (name === "corpus_publisher_code_register_v1") {
      assert.equal(body.p_readbacks.length, 2);
      registered = true;
      value = {
        registered_packet: packet.manifestHash,
        objects: 2,
        bytes: packet.manifest.assets.unique_bytes,
        published: false,
      };
    } else if (name === "corpus_publisher_code_verify_batch_v1") {
      const i = body.p_batch_index,
        present = written.has(i);
      value = {
        contract: "publisher-code-progress/1",
        run_id: RUN,
        batch_index: i,
        sha256: packet.manifest.batches[i].sha256,
        expected: 1,
        matched: present ? 1 : 0,
        receipt_present: present,
        receipt_matches: present,
        verified: present,
        private_only: true,
        published: false,
      };
      if (options.corruptProof) value = options.corruptProof(value);
    } else if (name === "corpus_publisher_code_intake_v1") {
      assert.equal(written.has(body.p_batch_index), false, "No duplicate mutation allowed");
      written.add(body.p_batch_index);
      if (options.transportFailure) throw options.transportFailure;
      if (options.responseReadFailure) {
        const error = options.responseReadFailure;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        );
      }
      if (lostAck) {
        lostAck = false;
        throw Object.assign(new Error("synthetic transport failure after commit"), {
          cause: Object.assign(new Error(), { code: "ECONNRESET" }),
        });
      }
      value = { received: 1, published: false };
    } else throw Error("Unexpected RPC");
    return Response.json(value);
  };
  const ensureObject = async ({ asset, bytes, allowUpload }) => {
    assert.equal(hashBytes(bytes), asset.sha256);
    if (options.failRefresh && allowUpload === false)
      throw Error("SYNTHETIC_STORED_OBJECT_CHANGED");
    if (!uploaded.includes(asset.sha256)) uploaded.push(asset.sha256);
    return {
      project_id: PROJECT,
      private_only: true,
      bucket: "corpus-originals",
      object_key: `state-codes/sha256/${asset.sha256.slice(0, 2)}/${asset.sha256}`,
      sha256: asset.sha256,
      bytes: asset.bytes,
      readback_sha256: asset.sha256,
      readback_bytes: asset.bytes,
      http_status: 200,
      verification_method: "authenticated-whole-object-get-sha256",
      verified_at: "2026-10-05T17:00:00Z",
      ...(asset.kind === "chapter_text_derivative"
        ? {
            readback_text_encoding: "utf-8",
            readback_text_code_points: [...bytes.toString("utf8")].length,
          }
        : {}),
    };
  };
  return { events, calls, uploaded, written, record, fetcher, ensureObject };
}
const run = (packet, s, options = {}) =>
  runPublisherIntake({
    packet,
    runId: RUN,
    credentials,
    record: s.record,
    fetcher: s.fetcher,
    ensureObject: s.ensureObject,
    ...options,
  });

test("preflight detects changed files and rejects a packet directory outside private", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.folder, f.manifest.batches[1].file), " ");
  await assert.rejects(loadPublisherPacket(f.folder, f.packet.manifestHash), /PINNED_FILE_CHANGED/);
  await assert.rejects(
    loadPublisherPacket(path.resolve("scripts"), f.packet.manifestHash),
    /PRIVATE_PATH_REQUIRED/,
  );
});
test("no object write occurs before actual open private run and RPC availability checks", async (t) => {
  const { packet } = await fixture(t);
  for (const options of [
    { statusHttp: 404 },
    { statusHttp: 403 },
    { statusHttp: 429 },
    { statusOverride: (s) => ({ ...s, run_exists: false }) },
    { statusOverride: (s) => ({ ...s, scope: { ...s.scope, public_projection_allowed: true } }) },
  ]) {
    const s = server(packet, options);
    await assert.rejects(run(packet, s));
    assert.equal(s.uploaded.length, 0);
    assert.equal(s.written.size, 0);
    assert.equal(s.calls.length, 1);
  }
});
test("bounded upload resumes from actual retained receipts and verifies every imported batch", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet);
  assert.equal((await run(packet, s, { maxObjects: 1 })).state, "object_pass_cap");
  assert.equal(s.uploaded.length, 1);
  assert.equal(s.written.size, 0);
  const priorReadbacks = s.events
    .filter((e) => e.state === "publisher_object_receipt")
    .map((e) => e.receipt);
  assert.equal(
    (await run(packet, s, { priorReadbacks, maxObjects: 1, maxBatches: 1 })).state,
    "batch_pass_cap",
  );
  assert.equal(s.uploaded.length, 2);
  assert.deepEqual([...s.written], [0]);
  const complete = await run(packet, s);
  assert.equal(complete.state, "private_intake_verified");
  assert.equal(complete.records_verified, 2);
  assert.equal(s.uploaded.length, 2);
  assert.equal(complete.database_run_completed_by_runner, false);
  assert.equal(complete.published, false);
});
test("unknown post-commit acknowledgement stops and later exact proof prevents repeat mutation", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet, { registered: true, lostAck: true });
  await assert.rejects(run(packet, s), /UNKNOWN_OUTCOME_REQUIRES_AUDIT/);
  assert.deepEqual([...s.written], [0]);
  const diagnostic = s.events.find((event) => event.state === "rpc_transport_outcome_unknown");
  assert.equal(diagnostic.rpc, "corpus_publisher_code_intake_v1");
  assert.equal(diagnostic.error_name, "Error");
  assert.equal(diagnostic.error_cause_code, "ECONNRESET");
  assert.equal((await run(packet, s)).complete, true);
  assert.equal(
    s.calls.filter(
      (c) => c.name === "corpus_publisher_code_intake_v1" && c.body.p_batch_index === 0,
    ).length,
    1,
  );
});

test("RPC transport and response-read diagnostics are allowlisted and stop after one ambiguous write", async (t) => {
  const { packet } = await fixture(t);
  const secret = "Bearer DO_NOT_LOG https://attacker.invalid/private-key";
  for (const [option, state, errorName, causeCode] of [
    [
      {
        transportFailure: Object.assign(new Error(secret), {
          name: secret,
          code: "EHOSTUNREACH",
          cause: Object.assign(new Error(secret), { code: "ECONNRESET" }),
        }),
      },
      "rpc_transport_outcome_unknown",
      "UnknownError",
      "ECONNRESET",
      "EHOSTUNREACH",
    ],
    [
      {
        responseReadFailure: Object.assign(new TypeError(secret), {
          cause: Object.assign(new Error(secret), { code: "UND_ERR_SOCKET" }),
        }),
      },
      "rpc_response_read_outcome_unknown",
      "TypeError",
      "UND_ERR_SOCKET",
      undefined,
    ],
  ]) {
    const s = server(packet, { registered: true, ...option });
    await assert.rejects(run(packet, s), /UNKNOWN_OUTCOME_REQUIRES_AUDIT/);
    assert.deepEqual([...s.written], [0]);
    assert.equal(
      s.calls.filter((call) => call.name === "corpus_publisher_code_intake_v1").length,
      1,
    );
    const diagnostic = s.events.find((event) => event.state === state);
    assert.equal(diagnostic.error_name, errorName);
    assert.equal(diagnostic.error_cause_code, causeCode);
    assert.equal(diagnostic.error_code, option.transportFailure?.code);
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
});

test("isolated RPC request pins host, POST method, verified TLS signal, and disables socket pooling", async () => {
  let observed;
  const fakeRequest = (url, options, onResponse) => {
    observed = { url: String(url), options };
    const req = new EventEmitter();
    req.setTimeout = (milliseconds, callback) => {
      observed.timeout = milliseconds;
      observed.onTimeout = callback;
    };
    req.end = (body) => {
      observed.body = body;
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      response.destroy = (error) => response.emit("error", error);
      onResponse(response);
      response.emit("data", Buffer.from('{"ok":true}'));
      response.emit("end");
    };
    req.destroy = (error) => req.emit("error", error);
    return req;
  };
  const response = await requestPublisherRpc(
    `https://${PROJECT}.supabase.co/rest/v1/rpc/corpus_publisher_code_status_v1`,
    {
      method: "POST",
      headers: { apikey: "synthetic-only" },
      body: "{}",
      signal: AbortSignal.timeout(90000),
    },
    fakeRequest,
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.agent, false);
  assert.equal(observed.options.rejectUnauthorized, true);
  assert.equal(observed.timeout, 90000);
  assert.ok(observed.options.signal instanceof AbortSignal);
  assert.equal(observed.options.headers["Content-Length"], "2");
  assert.equal(observed.body, "{}");
  assert.equal(observed.url.includes(PROJECT), true);
  assert.throws(
    () =>
      requestPublisherRpc(
        "https://wrong.supabase.co/rest/v1/rpc/status",
        { method: "POST", body: "{}" },
        fakeRequest,
      ),
    /PINNED_PUBLISHER_RPC_REQUEST_REQUIRED/,
  );
  for (const invalidUrl of [
    `https://${PROJECT}.supabase.co:8443/rest/v1/rpc/corpus_publisher_code_status_v1`,
    `https://${PROJECT}.supabase.co/rest/v1/rpc/unreviewed_v1`,
    `https://${PROJECT}.supabase.co/rest/v1/rpc/corpus_publisher_code_status_v1?redirect=1`,
  ]) {
    assert.throws(
      () => requestPublisherRpc(invalidUrl, { method: "POST", body: "{}" }, fakeRequest),
      /PINNED_PUBLISHER_RPC_REQUEST_REQUIRED/,
    );
  }
});

test("isolated RPC rejects bodyless statuses and incomplete or aborted responses without hanging", async () => {
  const requestWithResponse = (status, emitResponseEvents) =>
    requestPublisherRpc(
      `https://${PROJECT}.supabase.co/rest/v1/rpc/corpus_publisher_code_status_v1`,
      { method: "POST", headers: {}, body: "{}", signal: AbortSignal.timeout(90000) },
      (url, options, onResponse) => {
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.end = () => {
          const response = new EventEmitter();
          response.statusCode = status;
          response.headers = {};
          response.complete = false;
          response.destroy = (error) => response.emit("error", error);
          onResponse(response);
          emitResponseEvents(response);
        };
        req.destroy = (error) => req.emit("error", error);
        return req;
      },
    );
  for (const status of [204, 205, 304])
    await assert.rejects(
      requestWithResponse(status, (response) => response.emit("end")),
      TypeError,
    );
  await assert.rejects(
    requestWithResponse(200, (response) => response.emit("close")),
    /RPC_RESPONSE_CLOSED_EARLY/,
  );
  await assert.rejects(
    requestWithResponse(200, (response) => response.emit("aborted")),
    /RPC_RESPONSE_ABORTED/,
  );
});
test("conflicting partial batch proof and simulated prior readbacks stop before mutation", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet, {
      registered: true,
      corruptProof: (p) => ({ ...p, matched: 1, verified: false }),
    });
  await assert.rejects(run(packet, s), /PARTIAL_OR_CONFLICTING_BATCH/);
  assert.equal(s.written.size, 0);
  const other = server(packet);
  const receipt = await other.ensureObject({
    asset: packet.assets[0],
    bytes: await fs.readFile(packet.assets[0].path),
  });
  await assert.rejects(
    run(packet, other, { priorReadbacks: [{ ...receipt, test_only: true }] }),
    /REAL_WHOLE_OBJECT_RECEIPT/,
  );
  assert.equal(other.written.size, 0);
});
test("wrong project credentials and incomplete completed runs cannot write", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet, { closed: true, registered: true });
  await assert.rejects(run(packet, s), /CLOSED_INCOMPLETE_RUN/);
  assert.equal(s.written.size, 0);
  await assert.rejects(
    run(packet, s, { credentials: { ...credentials, url: "https://wrong.supabase.co" } }),
    /WRONG_PROJECT/,
  );
});
test("journal write failure prevents the pending request or upload", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet);
  await assert.rejects(
    run(packet, s, {
      record: async () => {
        throw Error("disk write failed");
      },
    }),
    /disk write failed/,
  );
  assert.equal(s.calls.length, 0);
  assert.equal(s.uploaded.length, 0);
});
test("old receipts or registered metadata cannot conceal changed Storage bytes", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet, { registered: true, failRefresh: true });
  await assert.rejects(run(packet, s), /STORED_OBJECT_CHANGED/);
  assert.equal(s.written.size, 0);
  const other = server(packet, { failRefresh: true });
  const receipts = [];
  for (const asset of packet.assets)
    receipts.push(await other.ensureObject({ asset, bytes: await fs.readFile(asset.path) }));
  await assert.rejects(run(packet, other, { priorReadbacks: receipts }), /STORED_OBJECT_CHANGED/);
  assert.equal(
    other.calls.some((c) => c.name === "corpus_publisher_code_register_v1"),
    false,
  );
});

test("parallel read-only object refresh drains in-flight checks and blocks registration on one missing object", async (t) => {
  const { packet } = await fixture(t),
    s = server(packet);
  const priorReadbacks = [];
  for (const asset of packet.assets)
    priorReadbacks.push(
      await s.ensureObject({ asset, bytes: await fs.readFile(asset.path), allowUpload: false }),
    );
  let active = 0,
    maxActive = 0,
    completed = 0;
  const ensureObject = async (args) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (args.asset.sha256 === packet.assets[1].sha256)
        throw new Error("PUBLISHER_READ_ONLY_OBJECT_MISSING");
      const receipt = await s.ensureObject(args);
      completed++;
      return receipt;
    } finally {
      active--;
    }
  };
  await assert.rejects(
    run(packet, { ...s, ensureObject }, { priorReadbacks }),
    /PUBLISHER_READ_ONLY_OBJECT_MISSING/,
  );
  assert.equal(maxActive, 2);
  assert.equal(completed, 1, "the successful sibling finishes before the pass stops");
  assert.equal(active, 0, "all in-flight checks have drained before return");
  assert.deepEqual(
    s.calls.map((call) => call.name),
    ["corpus_publisher_code_status_v1"],
  );
  assert.equal(s.written.size, 0);
});
