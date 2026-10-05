// Explicit, fail-closed recovery for a publisher intake lock left by a crash.
// Read-only by default. It never contacts Supabase or changes a run.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code) => {
  throw new Error(code);
};

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function privateDirectory(directory, privateRoot) {
  const root = await fs.realpath(privateRoot);
  const resolved = await fs.realpath(directory);
  if (!inside(root, resolved)) fail("PRIVATE_PATH_REQUIRED");
  return { root, directory: resolved };
}

function validateLockBytes(bytes, expected) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("LOCK_UNREADABLE");
  }
  const keys = ["project_id", "run_id", "manifest_sha256", "pid", "nonce", "created_at"];
  if (
    JSON.stringify(Object.keys(value ?? {})) !== JSON.stringify(keys) ||
    JSON.stringify(value) !== bytes.toString("utf8") ||
    value.project_id !== PROJECT ||
    value.run_id !== expected.runId ||
    value.manifest_sha256 !== expected.manifestSha256 ||
    value.nonce !== expected.nonce ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1 ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    fail("LOCK_IDENTITY_MISMATCH");
  return value;
}

function processState(pid, kill) {
  try {
    kill(pid, 0);
    return "live";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    if (error?.code === "EPERM") return "unknown";
    return "error";
  }
}

async function readRegularLock(lockPath) {
  const before = await fs.lstat(lockPath);
  if (!before.isFile() || before.isSymbolicLink()) fail("LOCK_NOT_REGULAR_FILE");
  const handle = await fs.open(lockPath, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      fail("LOCK_CHANGED_DURING_READ");
    const bytes = await handle.readFile();
    const after = await fs.lstat(lockPath);
    if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino)
      fail("LOCK_CHANGED_DURING_READ");
    return { bytes, sha256: hashBytes(bytes), stat: opened };
  } finally {
    await handle.close();
  }
}

async function writeImmutable(file, bytes) {
  const handle = await fs.open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Inspect a stale lock, or explicitly move it to a private evidence path.
 * `privateDirectory` is an injectable test seam; production CLI uses ./private.
 */
export async function recoverPublisherIntakeLock({
  outputDirectory,
  runId,
  manifestSha256,
  nonce,
  execute = false,
  privateDirectory: privateRoot = path.resolve("private"),
  kill = process.kill,
  now = () => new Date().toISOString(),
  id = randomUUID,
}) {
  if (
    !UUID.test(runId ?? "") ||
    !SHA256.test(manifestSha256 ?? "") ||
    !UUID.test(nonce ?? "") ||
    typeof execute !== "boolean" ||
    typeof kill !== "function" ||
    typeof id !== "function"
  )
    fail("EXPECTED_LOCK_IDENTITY_REQUIRED");
  const paths = await privateDirectory(outputDirectory, privateRoot);
  const lockPath = path.join(paths.directory, "intake.lock");
  const current = await readRegularLock(lockPath);
  const lock = validateLockBytes(current.bytes, { runId, manifestSha256, nonce });
  const initialState = processState(lock.pid, kill);
  if (initialState !== "dead")
    fail(initialState === "live" ? "LOCK_PROCESS_LIVE" : "LOCK_PROCESS_STATE_UNCERTAIN");

  const preview = {
    project_id: PROJECT,
    run_id: runId,
    manifest_sha256: manifestSha256,
    nonce,
    pid: lock.pid,
    lock_sha256: current.sha256,
    process_state: "dead",
    execute,
  };
  if (!execute) return { state: "stale_lock_candidate", ...preview };

  const recoveryId = id();
  if (!UUID.test(recoveryId)) fail("RECOVERY_ID_INVALID");
  const mutexPath = path.join(paths.directory, "intake-recovery.lock");
  let mutex;
  try {
    mutex = await fs.open(mutexPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") fail("RECOVERY_MUTEX_HELD");
    throw error;
  }
  let mutexNonce = randomUUID();
  const recoveryDirectory = path.join(paths.directory, "lock-recovery");
  try {
    await mutex.writeFile(
      JSON.stringify({
        project_id: PROJECT,
        run_id: runId,
        manifest_sha256: manifestSha256,
        recovery_id: recoveryId,
        nonce: mutexNonce,
        pid: process.pid,
        created_at: now(),
      }),
    );
    await mutex.sync();
    await fs.mkdir(recoveryDirectory, { recursive: false, mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const recoveryStat = await fs.lstat(recoveryDirectory);
    if (!recoveryStat.isDirectory() || recoveryStat.isSymbolicLink())
      fail("RECOVERY_DIRECTORY_INVALID");
    const realRecoveryDirectory = await fs.realpath(recoveryDirectory);
    if (
      !inside(paths.root, realRecoveryDirectory) ||
      !inside(paths.directory, realRecoveryDirectory)
    )
      fail("RECOVERY_PATH_OUTSIDE_PRIVATE");
    const beforeimagePath = path.join(
      realRecoveryDirectory,
      `intake-lock-${recoveryId}.beforeimage`,
    );
    const evidencePath = path.join(
      realRecoveryDirectory,
      `intake-lock-${recoveryId}.prepared.json`,
    );
    const recoveredPath = path.join(realRecoveryDirectory, `intake-lock-${recoveryId}.recovered`);
    const beforeimage = await readRegularLock(lockPath);
    validateLockBytes(beforeimage.bytes, { runId, manifestSha256, nonce });
    if (beforeimage.sha256 !== current.sha256) fail("LOCK_CHANGED_BEFORE_RECOVERY");
    await writeImmutable(beforeimagePath, beforeimage.bytes);
    const prepared = {
      schema: "publisher-intake-lock-recovery/1",
      state: "prepared",
      ...preview,
      recovery_id: recoveryId,
      beforeimage_path: beforeimagePath,
      recovered_path: recoveredPath,
      prepared_at: now(),
    };
    await writeImmutable(evidencePath, Buffer.from(`${JSON.stringify(prepared)}\n`));

    // Immediately before moving, verify the lock bytes and probe the PID again.
    const finalRead = await readRegularLock(lockPath);
    validateLockBytes(finalRead.bytes, { runId, manifestSha256, nonce });
    if (finalRead.sha256 !== current.sha256) fail("LOCK_CHANGED_BEFORE_RECOVERY");
    const finalState = processState(lock.pid, kill);
    if (finalState !== "dead")
      fail(finalState === "live" ? "LOCK_PROCESS_LIVE" : "LOCK_PROCESS_STATE_UNCERTAIN");

    // Hard-link provides atomic no-overwrite reservation on the same volume.
    // Keep the prepared record and beforeimage if any later step is interrupted.
    await fs.link(lockPath, recoveredPath);
    const linked = await readRegularLock(recoveredPath);
    if (linked.sha256 !== current.sha256) fail("RECOVERY_COPY_HASH_MISMATCH");
    const sourceAgain = await readRegularLock(lockPath);
    if (
      sourceAgain.sha256 !== current.sha256 ||
      sourceAgain.stat.dev !== linked.stat.dev ||
      sourceAgain.stat.ino !== linked.stat.ino ||
      processState(lock.pid, kill) !== "dead"
    )
      fail("LOCK_CHANGED_DURING_RECOVERY");
    await fs.unlink(lockPath);
    const completed = {
      schema: "publisher-intake-lock-recovery/1",
      state: "recovered",
      ...preview,
      recovery_id: recoveryId,
      beforeimage_path: beforeimagePath,
      prepared_evidence_path: evidencePath,
      recovered_path: recoveredPath,
      recovered_sha256: linked.sha256,
      recovered_at: now(),
    };
    const completedPath = path.join(
      realRecoveryDirectory,
      `intake-lock-${recoveryId}.recovered.json`,
    );
    await writeImmutable(completedPath, Buffer.from(`${JSON.stringify(completed)}\n`));
    return completed;
  } finally {
    await mutex.close();
    const held = await fs.readFile(mutexPath, "utf8").catch(() => "");
    try {
      const parsed = JSON.parse(held);
      if (parsed.nonce === mutexNonce) await fs.unlink(mutexPath);
    } catch {
      /* Preserve uncertain mutex evidence for manual review. */
    }
  }
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const index = argument.indexOf("=");
      return index < 0
        ? [argument.replace(/^--/, ""), true]
        : [argument.slice(2, index), argument.slice(index + 1)];
    }),
  );
  if (!args.output || !args.run || !args["manifest-sha256"] || !args.nonce)
    fail("EXPECTED_LOCK_IDENTITY_REQUIRED");
  const result = await recoverPublisherIntakeLock({
    outputDirectory: path.resolve(String(args.output)),
    runId: String(args.run),
    manifestSha256: String(args["manifest-sha256"]),
    nonce: String(args.nonce),
    execute: args.execute === true,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "LOCK_RECOVERY_STOPPED_CHECK_PRIVATE_EVIDENCE",
    );
    process.exitCode = 1;
  });
}
