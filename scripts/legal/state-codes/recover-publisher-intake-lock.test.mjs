// Uses only temporary private directories and injected process probes.
import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recoverPublisherIntakeLock } from "./recover-publisher-intake-lock.mjs";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NONCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECOVERY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MANIFEST = "d".repeat(64);

async function fixture(t, { nonce = NONCE } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "publisher-lock-recovery-"));
  const privateRoot = path.join(root, "private"),
    outputDirectory = path.join(privateRoot, "run");
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(
    JSON.stringify({
      project_id: PROJECT,
      run_id: RUN,
      manifest_sha256: MANIFEST,
      pid: 987654321,
      nonce,
      created_at: "2026-10-05T18:00:00.000Z",
    }),
  );
  const lockPath = path.join(outputDirectory, "intake.lock");
  await fs.writeFile(lockPath, bytes, { mode: 0o600 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const call = (options) =>
    recoverPublisherIntakeLock({
      outputDirectory,
      privateDirectory: privateRoot,
      runId: RUN,
      manifestSha256: MANIFEST,
      nonce: NONCE,
      id: () => RECOVERY,
      now: () => "2026-10-05T18:01:00.000Z",
      ...options,
    });
  return { root, privateRoot, outputDirectory, lockPath, bytes, call };
}

const dead = () => {
  const error = new Error("gone");
  error.code = "ESRCH";
  throw error;
};
const errorWithCode = (code) => () => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

test("read-only default recognizes only the exact matching dead lock and preserves bytes", async (t) => {
  const f = await fixture(t);
  const result = await f.call({ kill: dead });
  assert.equal(result.state, "stale_lock_candidate");
  assert.equal(result.execute, false);
  assert.deepEqual(await fs.readFile(f.lockPath), f.bytes);
  await assert.rejects(fs.stat(path.join(f.outputDirectory, "intake-recovery.lock")), {
    code: "ENOENT",
  });
});

test("output directory outside the private root is rejected", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "intake.lock"), f.bytes);
  await assert.rejects(
    recoverPublisherIntakeLock({
      outputDirectory: outside,
      privateDirectory: f.privateRoot,
      runId: RUN,
      manifestSha256: MANIFEST,
      nonce: NONCE,
      kill: dead,
    }),
    { message: "PRIVATE_PATH_REQUIRED" },
  );
});

test("live process fails closed without changing the lock", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.call({ kill: () => {} }), { message: "LOCK_PROCESS_LIVE" });
  assert.deepEqual(await fs.readFile(f.lockPath), f.bytes);
});

test("permission-denied and unknown process probes fail closed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.call({ kill: errorWithCode("EPERM") }), {
    message: "LOCK_PROCESS_STATE_UNCERTAIN",
  });
  await assert.rejects(f.call({ kill: errorWithCode("EACCES") }), {
    message: "LOCK_PROCESS_STATE_UNCERTAIN",
  });
  assert.deepEqual(await fs.readFile(f.lockPath), f.bytes);
});

test("unexpected process-probe errors fail closed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.call({ kill: errorWithCode("EIO") }), {
    message: "LOCK_PROCESS_STATE_UNCERTAIN",
  });
  assert.deepEqual(await fs.readFile(f.lockPath), f.bytes);
});

test("different requested nonce never recovers the lock", async (t) => {
  const f = await fixture(t, { nonce: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  await assert.rejects(f.call({ kill: dead, execute: true }), {
    message: "LOCK_IDENTITY_MISMATCH",
  });
  assert.deepEqual(await fs.readFile(f.lockPath), f.bytes);
});

test("explicit recovery preserves beforeimage and moves exact bytes to a unique path", async (t) => {
  const f = await fixture(t);
  const result = await f.call({ kill: dead, execute: true });
  assert.equal(result.state, "recovered");
  assert.equal(result.recovered_sha256.length, 64);
  assert.deepEqual(await fs.readFile(result.beforeimage_path), f.bytes);
  assert.deepEqual(await fs.readFile(result.recovered_path), f.bytes);
  await assert.rejects(fs.stat(f.lockPath), { code: "ENOENT" });
  const evidence = JSON.parse(await fs.readFile(result.prepared_evidence_path, "utf8"));
  assert.equal(evidence.state, "prepared");
  const completed = JSON.parse(
    await fs.readFile(
      path.join(path.dirname(result.recovered_path), `intake-lock-${RECOVERY}.recovered.json`),
      "utf8",
    ),
  );
  assert.equal(completed.state, "recovered");
  await assert.rejects(fs.stat(path.join(f.outputDirectory, "intake-recovery.lock")), {
    code: "ENOENT",
  });
});

test("lock bytes changed after initial read are not moved", async (t) => {
  const f = await fixture(t);
  const id = () => {
    const changed = Buffer.from(
      JSON.stringify({
        project_id: PROJECT,
        run_id: RUN,
        manifest_sha256: MANIFEST,
        pid: 987654321,
        nonce: NONCE,
        created_at: "2026-10-05T18:00:01.000Z",
      }),
    );
    fsSync.writeFileSync(f.lockPath, changed);
    return RECOVERY;
  };
  await assert.rejects(f.call({ kill: dead, execute: true, id }), {
    message: "LOCK_CHANGED_BEFORE_RECOVERY",
  });
  assert.equal((await fs.readFile(f.lockPath, "utf8")).includes("18:00:01"), true);
});
