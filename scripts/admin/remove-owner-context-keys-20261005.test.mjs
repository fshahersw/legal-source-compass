import assert from "node:assert/strict";
import test from "node:test";
import {
  TARGETS,
  deleteRoute,
  receiptStem,
  validateTargetContextRow,
} from "./remove-owner-context-keys-20261005.mjs";

const keys = Object.keys(TARGETS);

function contextRow(key) {
  const target = TARGETS[key];
  const row = {
    key,
    source_sha256: target.source_sha256,
    ready: key === "supplement:cpsc_injury_data_20260919",
    data: {
      name: target.name,
      status: "passed",
      data_files: [{ path: target.file, verified: true }],
      license_ref:
        key === "supplement:cpsc_injury_data_20260919"
          ? "public domain U.S. government data (CPSC)"
          : "open_us_law_cc_by_4_0_compilation",
    },
  };
  if (key === "supplement:cpsc_injury_data_20260919") {
    row.data.counts = { neiss_cases: 410201, saferproducts_incidents: 69333 };
  }
  return row;
}

test("context target validation binds exact identity, source, file, readiness, and known counts", () => {
  for (const key of keys) assert.equal(validateTargetContextRow(contextRow(key), key).key, key);
  const key = keys[0];
  const wrongHash = { ...contextRow(key), source_sha256: "a".repeat(64) };
  assert.throws(() => validateTargetContextRow(wrongHash, key), /CONTEXT_TARGET_ROW_INVALID/);
  const wrongFile = contextRow(key);
  wrongFile.data.data_files[0].path = "other.sqlite3";
  assert.throws(() => validateTargetContextRow(wrongFile, key), /CONTEXT_TARGET_ROW_INVALID/);
  const wrongCount = contextRow(key);
  wrongCount.data.counts.neiss_cases++;
  assert.throws(() => validateTargetContextRow(wrongCount, key), /CONTEXT_TARGET_ROW_INVALID/);
});

test("receipt filenames use unique Windows-safe stems while API routes keep exact context keys", () => {
  const stems = keys.map(receiptStem);
  assert.equal(new Set(stems).size, keys.length);
  for (const stem of stems) {
    assert.match(stem, /^[a-z0-9-]+$/);
    assert.doesNotMatch(stem, /[<>:"/\\|?*]/);
  }
  assert.throws(() => receiptStem("supplement:other"), /CONTEXT_DELETE_SCOPE_INVALID/);
  const key = keys[0];
  assert.match(
    deleteRoute(key, TARGETS[key].source_sha256),
    /key=eq\.supplement%3Acpsc_injury_data_20260919/,
  );
  assert.throws(() => deleteRoute(key, "0".repeat(64)), /CONTEXT_DELETE_SCOPE_INVALID/);
});
