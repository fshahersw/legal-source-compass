import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCurrentObject,
  classifyBatchState,
  deleteBatchOnce,
  groupPrefix,
  groupedBatches,
  validatePlan,
  validateMaxAffected,
  validateResumeScope,
  verifyPlanOutputLists,
} from "./remove-owner-storage-20261005.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const eligible = [
  {
    bucket_id: "corpus-originals",
    key: "00/a",
    id: "object-a",
    version: "version-a",
    bytes: 10,
    mimetype: "text/plain",
    is_delete_marker: false,
    reasons: [],
  },
  {
    bucket_id: "corpus-originals",
    key: "00/b",
    id: "object-b",
    version: "version-b",
    bytes: 20,
    mimetype: "text/plain",
    is_delete_marker: false,
    reasons: [],
  },
];
const protectedObjects = [
  {
    bucket_id: "corpus-originals",
    key: "state-codes/sha256/aa/file",
    id: "object-c",
    version: "version-c",
    bytes: 30,
    mimetype: "application/octet-stream",
    is_delete_marker: false,
    reasons: ["active_state_codes_dependency"],
  },
];

function planFixture(outputLists = {}) {
  return {
    schema: "owner-storage-removal-plan/v1",
    inventory: { project: "xosqzzsnhxcyehcnirpa", bucket: "corpus-originals" },
    eligible,
    protected: protectedObjects,
    totals: {
      storage_objects: 3,
      eligible: { objects: 2, bytes: 30 },
      protected: { objects: 1, bytes: 30 },
      ambiguous_pdf_objects: 0,
      missing_dependencies: 0,
    },
    output_lists: outputLists,
  };
}

test("plan rejects wrong scope, duplicate IDs/keys, protected eligible keys and incorrect totals", () => {
  const p = planFixture();
  assert.equal(validatePlan(p), true);
  assert.throws(
    () => validatePlan({ ...p, inventory: { ...p.inventory, project: "wrong" } }),
    /PLAN_TARGET_INVALID/,
  );
  assert.throws(
    () => validatePlan({ ...p, eligible: [eligible[0], { ...eligible[1], id: eligible[0].id }] }),
    /PLAN_OBJECT_INVALID/,
  );
  assert.throws(
    () =>
      validatePlan({
        ...p,
        eligible: [{ ...eligible[0], key: protectedObjects[0].key }, eligible[1]],
      }),
    /PLAN_OBJECT_INVALID|PROTECTED_OBJECT_ELIGIBLE/,
  );
  assert.throws(
    () =>
      validatePlan({
        ...p,
        eligible: [{ ...eligible[0], key: "seeger-weiss/pdf-sha256/a" }, eligible[1]],
      }),
    /PROTECTED_OBJECT_ELIGIBLE/,
  );
  assert.throws(
    () => validatePlan({ ...p, totals: { ...p.totals, eligible: { objects: 2, bytes: 31 } } }),
    /PLAN_TOTAL_INVALID/,
  );
  assert.throws(
    () => validatePlan({ ...p, totals: { ...p.totals, missing_dependencies: 1 } }),
    /PLAN_DEPENDENCIES_MISSING/,
  );
});

test("execute scope acknowledgment must equal the exact reviewed eligible count", () => {
  const plan = planFixture();
  assert.equal(validateMaxAffected(plan, "2"), true);
  for (const value of [undefined, "1", "3", "2.0", "02x", ""]) {
    assert.throws(() => validateMaxAffected(plan, value), /EXACT_MAX_AFFECTED_REQUIRED/);
  }
});

test("reviewed JSONL files are byte-hash and row-count pinned to the plan", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-plan-lists-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const listed = {
    eligible: ["eligible-objects.jsonl", eligible],
    protected: ["protected-objects.jsonl", protectedObjects],
    ambiguous_pdfs: ["ambiguous-pdf-objects.jsonl", []],
  };
  const refs = {};
  for (const [kind, [file, rows]] of Object.entries(listed)) {
    const bytes = Buffer.from(
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
    await fs.writeFile(path.join(dir, file), bytes);
    refs[kind] = { file, rows: rows.length, bytes: bytes.length, sha256: sha(bytes) };
  }
  assert.equal(await verifyPlanOutputLists(planFixture(refs), dir), true);
  await fs.appendFile(path.join(dir, "eligible-objects.jsonl"), " ");
  await assert.rejects(verifyPlanOutputLists(planFixture(refs), dir), /PLAN_OUTPUT_HASH_MISMATCH/);
});

test("current Storage identity must match name, ID, version, size and non-marker state", () => {
  const want = eligible[0],
    actual = { name: want.key, id: want.id, version: want.version, metadata: { size: "10" } };
  assertCurrentObject(want, actual);
  for (const changed of [
    { ...actual, id: "different" },
    { ...actual, version: "different" },
    { ...actual, name: "different" },
    { ...actual, metadata: { size: 11 } },
    { ...actual, is_delete_marker: true },
    { ...actual, archived_at: "2026-10-05" },
  ])
    assert.throws(() => assertCurrentObject(want, changed), /OBJECT_CHANGED_SINCE_PLAN/);
  assert.equal(groupPrefix("a/b/c/file"), "a/b/c/");
  assert.throws(() => groupPrefix("single"), /OBJECT_KEY_WITHOUT_PREFIX/);
});

test("journal recovery only skips fully absent prior receipts and accepts only exact intents", () => {
  const batch = eligible,
    planHash = "p".repeat(64),
    batchHash = "b".repeat(64),
    all = new Set(batch.map((o) => o.key));
  const prior = { plan_sha256: planHash, batch_sha256: batchHash, objects: 2, bytes: 30 };
  assert.deepEqual(
    classifyBatchState({ prior, planHash, batchHash, batch, currentKeys: new Set() }),
    { state: "already_complete", remaining: [] },
  );
  assert.throws(
    () =>
      classifyBatchState({
        prior,
        intent: { plan_sha256: "wrong", batch_sha256: batchHash, objects: batch },
        planHash,
        batchHash,
        batch,
        currentKeys: new Set(),
      }),
    /STORAGE_INTENT_CONFLICT/,
  );
  assert.throws(
    () => classifyBatchState({ prior, planHash, batchHash, batch, currentKeys: all }),
    /PRIOR_STORAGE_RECEIPT_INVALID/,
  );
  assert.throws(
    () => classifyBatchState({ planHash, batchHash, batch, currentKeys: new Set([batch[0].key]) }),
    /UNEXPECTED_OBJECT_ABSENCE/,
  );
  const intent = { plan_sha256: planHash, batch_sha256: batchHash, objects: batch };
  assert.deepEqual(
    classifyBatchState({
      intent,
      planHash,
      batchHash,
      batch,
      currentKeys: new Set([batch[0].key]),
    }),
    { state: "delete", remaining: [batch[0]] },
  );
  assert.throws(
    () =>
      classifyBatchState({
        intent: { ...intent, plan_sha256: "x" },
        planHash,
        batchHash,
        batch,
        currentKeys: all,
      }),
    /STORAGE_INTENT_CONFLICT/,
  );
});

test("preflight allows only journal-proven eligible absences and rejects unplanned keys", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-resume-proof-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const plan = planFixture(),
    planHash = "p".repeat(64),
    batch = groupedBatches(plan)[0].batch,
    batchHash = sha(JSON.stringify(batch)),
    receiptFile = path.join(dir, `${batchHash}.json`),
    intentFile = `${receiptFile}.intent`;
  const current = new Map([
    [
      eligible[0].key,
      {
        name: eligible[0].key,
        id: eligible[0].id,
        version: eligible[0].version,
        metadata: { size: eligible[0].bytes },
      },
    ],
    [
      protectedObjects[0].key,
      {
        name: protectedObjects[0].key,
        id: protectedObjects[0].id,
        version: protectedObjects[0].version,
        metadata: { size: protectedObjects[0].bytes },
      },
    ],
  ]);
  await assert.rejects(
    validateResumeScope({ plan, planHash, current, receiptsDirectory: dir }),
    /UNEXPECTED_OBJECT_ABSENCE/,
  );
  await fs.writeFile(
    intentFile,
    JSON.stringify({ plan_sha256: planHash, batch_sha256: batchHash, objects: batch }),
  );
  assert.equal(
    await validateResumeScope({ plan, planHash, current, receiptsDirectory: dir }),
    true,
  );
  current.set("unexpected/new", {
    name: "unexpected/new",
    id: "new",
    version: "new",
    metadata: { size: 1 },
  });
  await assert.rejects(
    validateResumeScope({ plan, planHash, current, receiptsDirectory: dir }),
    /UNPLANNED_STORAGE_OBJECT_FOUND/,
  );
  current.delete("unexpected/new");
  await fs.rm(intentFile);
  await fs.writeFile(
    receiptFile,
    JSON.stringify({
      plan_sha256: planHash,
      batch_sha256: batchHash,
      objects: batch.length,
      bytes: 30,
    }),
  );
  await assert.rejects(
    validateResumeScope({ plan, planHash, current, receiptsDirectory: dir }),
    /PRIOR_STORAGE_RECEIPT_INVALID/,
  );
});

test("one failed official Storage delete is never automatically retried; acknowledgments must be unique and exact", async () => {
  let calls = 0;
  await assert.rejects(
    deleteBatchOnce({
      url: "https://example.invalid",
      headers: {},
      objects: eligible,
      fetcher: async () => {
        calls++;
        return new Response("", { status: 503 });
      },
    }),
    /STORAGE_DELETE_HTTP_503/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    deleteBatchOnce({
      url: "https://example.invalid",
      headers: {},
      objects: eligible,
      fetcher: async () =>
        new Response(
          JSON.stringify([
            { name: eligible[0].key, id: eligible[0].id },
            { name: eligible[0].key, id: eligible[0].id },
          ]),
          { status: 200 },
        ),
    }),
    /STORAGE_DELETE_ACK_MISMATCH/,
  );
  const ack = await deleteBatchOnce({
    url: "https://example.invalid",
    headers: {},
    objects: eligible,
    fetcher: async () =>
      new Response(JSON.stringify(eligible.map(({ key, id }) => ({ name: key, id }))), {
        status: 200,
      }),
  });
  assert.equal(ack.length, 2);
});
