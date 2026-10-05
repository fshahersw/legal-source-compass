import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertFullRowEquality,
  assertPriorBatchReceipt,
  assertStrictDeleteAck,
  requireStorageCompletion,
  selectHeldArtifactRows,
  strictDeletePreference,
  validateArtifactPlan,
} from "./remove-owner-artifact-metadata-20261005.mjs";

const held = (overrides = {}) => ({
  route: "/held/1",
  sha256: "a".repeat(64),
  object_key: "aa/object",
  bytes: 12,
  mime: "application/pdf",
  filename: "held.pdf",
  ready: false,
  ...overrides,
});

test("selection preserves exact held before-images only for eligible storage keys", () => {
  const rows = [
    held(),
    held({ route: "/held/2", object_key: "bb/other" }),
    held({ route: "/ready/3", ready: true, object_key: "cc/other" }),
  ];
  const selected = selectHeldArtifactRows(rows, new Set(["aa/object"]));
  assert.deepEqual(selected, [held()]);
});

test("selection fails closed if an eligible storage key has any ready route", () => {
  assert.throws(
    () => selectHeldArtifactRows([held(), held({ route: "/ready", ready: true })], ["aa/object"]),
    /ELIGIBLE_KEY_HAS_READY_ARTIFACT/,
  );
});

test("selection rejects duplicated route identities instead of collapsing before-images", () => {
  assert.throws(
    () =>
      selectHeldArtifactRows([held(), held({ object_key: "bb/other" })], ["aa/object", "bb/other"]),
    /DUPLICATE_ARTIFACT_ROUTE/,
  );
});

test("live verification requires exact full-row equality and row count", () => {
  const before = [held()];
  assert.equal(assertFullRowEquality(before, [held()]), true);
  assert.throws(
    () => assertFullRowEquality(before, [held({ filename: "changed.pdf" })]),
    /LIVE_ARTIFACT_ROW_CHANGED/,
  );
  assert.throws(() => assertFullRowEquality(before, []), /LIVE_ARTIFACT_ROW_COUNT_CHANGED/);
  assert.throws(
    () => assertFullRowEquality(before, [held(), held({ route: "/new" })]),
    /LIVE_ARTIFACT_ROW_COUNT_CHANGED/,
  );
});

test("plan validation pins only held rows, eligible keys, valid hashes and strict row caps", () => {
  const row = held();
  const plan = {
    schema: "owner-artifact-metadata-removal-plan/v1",
    project: "xosqzzsnhxcyehcnirpa",
    bucket: "corpus-originals",
    eligible_storage_keys: ["aa/object"],
    selected_rows: [row],
    selected_row_count: 1,
    storage_plan_sha256: "b".repeat(64),
    artifact_rows_sha256: "c".repeat(64),
  };
  assert.equal(validateArtifactPlan(plan), true);
  assert.throws(() => validateArtifactPlan(plan, { maxAffected: 0 }), /MAX_AFFECTED_INVALID/);
  assert.throws(() => validateArtifactPlan(plan, { maxAffected: 50_001 }), /MAX_AFFECTED_INVALID/);
  assert.throws(
    () => validateArtifactPlan({ ...plan, selected_rows: [held({ ready: true })] }),
    /ARTIFACT_BEFOREIMAGE_SCOPE_INVALID/,
  );
  assert.throws(
    () => validateArtifactPlan({ ...plan, eligible_storage_keys: [], selected_rows: [row] }),
    /ARTIFACT_BEFOREIMAGE_SCOPE_INVALID/,
  );
});

test("storage completion proof is pinned to exact plan bytes and completion counts", () => {
  const bytes = Buffer.from("receipt");
  const planDigest = "d".repeat(64);
  const receiptDigest = createHash("sha256").update(bytes).digest("hex");
  const storagePlan = { totals: { eligible: { objects: 9 }, protected: { objects: 11 } } };
  const proof = {
    complete: true,
    plan_sha256: planDigest,
    deleted_objects: 9,
    protected_objects_verified: 11,
  };
  assert.equal(
    requireStorageCompletion(proof, storagePlan, planDigest, receiptDigest, bytes),
    true,
  );
  assert.throws(
    () =>
      requireStorageCompletion(
        { ...proof, deleted_objects: 8 },
        storagePlan,
        planDigest,
        receiptDigest,
        bytes,
      ),
    /STORAGE_COMPLETION_INCOMPLETE/,
  );
  assert.throws(
    () => requireStorageCompletion(proof, storagePlan, "e".repeat(64), receiptDigest, bytes),
    /STORAGE_COMPLETION_PROOF_INVALID/,
  );
  assert.throws(
    () =>
      requireStorageCompletion(proof, storagePlan, planDigest, receiptDigest, Buffer.from("other")),
    /STORAGE_COMPLETION_PROOF_INVALID/,
  );
});

test("delete acknowledgement must echo strict per-request max-affected and exact rows", () => {
  const rows = [held()];
  assert.equal(strictDeletePreference(1), "handling=strict,return=representation,max-affected=1");
  assert.equal(
    assertStrictDeleteAck("handling=strict, return=representation, max-affected=1", rows, rows),
    true,
  );
  assert.throws(
    () => assertStrictDeleteAck("return=representation, max-affected=1", rows, rows),
    /DELETE_PREFERENCES_NOT_APPLIED/,
  );
  assert.throws(
    () =>
      assertStrictDeleteAck("handling=strict, return=representation, max-affected=2", rows, rows),
    /DELETE_PREFERENCES_NOT_APPLIED/,
  );
  assert.throws(
    () => assertStrictDeleteAck("handling=strict, return=representation, max-affected=1", rows, []),
    /LIVE_ARTIFACT_ROW_COUNT_CHANGED/,
  );
});

test("a prior batch is resumable only with a matching absence receipt", () => {
  const receipt = {
    plan_sha256: "a".repeat(64),
    batch_sha256: "b".repeat(64),
    object_keys: ["aa/object"],
    deleted_rows: 1,
    verified_absent: true,
  };
  assert.equal(
    assertPriorBatchReceipt(receipt, {
      planSha: "a".repeat(64),
      batchSha: "b".repeat(64),
      keys: ["aa/object"],
      rowCount: 1,
    }),
    true,
  );
  assert.throws(
    () =>
      assertPriorBatchReceipt(
        { ...receipt, verified_absent: false },
        { planSha: "a".repeat(64), batchSha: "b".repeat(64), keys: ["aa/object"], rowCount: 1 },
      ),
    /PRIOR_BATCH_RECEIPT_INVALID/,
  );
  assert.throws(
    () =>
      assertPriorBatchReceipt(receipt, {
        planSha: "c".repeat(64),
        batchSha: "b".repeat(64),
        keys: ["aa/object"],
        rowCount: 1,
      }),
    /PRIOR_BATCH_RECEIPT_INVALID/,
  );
});
