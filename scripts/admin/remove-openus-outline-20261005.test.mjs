import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  PROJECT,
  TABLE_ORDER,
  batchBeforeImageHash,
  buildIdentityFilter,
  identityTuple,
  validateBatchIntent,
  validateBatchReceipt,
  validateContextBytes,
  validateManifestEnvelope,
  validatePageBytes,
  runRemoval,
} from "./remove-openus-outline-20261005.mjs";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const at = "2026-10-05T23:00:00.000Z";

test("removal order respects the segment-to-node foreign key and retires context last", () => {
  assert.deepEqual(TABLE_ORDER, [
    "corpus_law_segments",
    "corpus_law_nodes",
    "corpus_law_collections",
    "corpus_context",
  ]);
});

test("outline manifest must describe exactly the three complete backed-up tables", () => {
  const targets = {
    corpus_law_segments: 2,
    corpus_law_nodes: 2,
    corpus_law_collections: 1,
    corpus_context: 1,
  };
  const entries = [
    [
      "corpus_law_segments",
      ["node", "lo"],
      [
        [1, 1],
        [1, 2],
      ],
    ],
    ["corpus_law_nodes", ["id"], [[1], [2]]],
    ["corpus_law_collections", ["state", "kind"], [["AK", "statutes"]]],
  ].map(([table, keys, tuples]) => ({
    table,
    rows: targets[table],
    keys,
    pages: [
      {
        file: `${table}-0000.json`,
        sha256: "a".repeat(64),
        bytes: 2,
        rows: tuples.length,
        first: tuples[0],
        last: tuples.at(-1),
      },
    ],
  }));
  const manifest = {
    schema: "owner-openus-outline-backup/1",
    project: PROJECT,
    completed_at: at,
    tables: entries,
    context: { file: "law_outline.json", sha256: "b".repeat(64), bytes: 2 },
  };
  assert.equal(validateManifestEnvelope(manifest, targets), manifest);
  assert.throws(
    () => validateManifestEnvelope({ ...manifest, tables: entries.slice(0, 2) }, targets),
    /OUTLINE_MANIFEST_INVALID|OUTLINE_TABLE_SET_INVALID/,
  );
  assert.throws(
    () =>
      validateManifestEnvelope(
        {
          ...manifest,
          tables: entries.map((entry) =>
            entry.table === "corpus_law_nodes" ? { ...entry, rows: 3 } : entry,
          ),
        },
        targets,
      ),
    /OUTLINE_TABLE_INCOMPLETE/,
  );
});

test("page hash, full rows, sort order, and manifest boundaries are verified", () => {
  const rows = [
    { node: 10, lo: 1, hi: 4 },
    { node: 10, lo: 5, hi: 8 },
  ];
  const bytes = Buffer.from(JSON.stringify(rows));
  const page = { bytes: bytes.length, sha256: hash(bytes), rows: 2, first: [10, 1], last: [10, 5] };
  assert.deepEqual(validatePageBytes("corpus_law_segments", page, bytes), rows);
  assert.throws(
    () => validatePageBytes("corpus_law_segments", { ...page, sha256: "f".repeat(64) }, bytes),
    /OUTLINE_BACKUP_HASH_MISMATCH/,
  );
  const outOfOrder = Buffer.from(JSON.stringify([...rows].reverse()));
  assert.throws(
    () =>
      validatePageBytes(
        "corpus_law_segments",
        { ...page, bytes: outOfOrder.length, sha256: hash(outOfOrder) },
        outOfOrder,
      ),
    /OUTLINE_BACKUP_PAGE_ORDER_INVALID/,
  );
  assert.deepEqual(identityTuple("corpus_law_segments", rows[0]), [10, 1]);
});

test("context backup is restricted to the one exact law_outline row", () => {
  const bytes = Buffer.from(JSON.stringify([{ key: "law_outline", data: { ready: false } }]));
  const receipt = { file: "law_outline.json", bytes: bytes.length, sha256: hash(bytes) };
  assert.equal(validateContextBytes(receipt, bytes).key, "law_outline");
  const mixed = Buffer.from(
    JSON.stringify([{ key: "supplement:law_tier_20260919", data: { ready: true } }]),
  );
  assert.throws(
    () => validateContextBytes({ ...receipt, bytes: mixed.length, sha256: hash(mixed) }, mixed),
    /OUTLINE_CONTEXT_SCOPE_INVALID/,
  );
});

test("delete filters target exact composite identities and bound batch size", () => {
  assert.equal(
    buildIdentityFilter("corpus_law_segments", [
      { node: 12, lo: 41 },
      { node: 12, lo: 42 },
    ]),
    "and=(or(node.gt.12,and(node.eq.12,lo.gte.41)),or(node.lt.12,and(node.eq.12,lo.lte.42)))",
  );
  assert.equal(
    buildIdentityFilter("corpus_law_nodes", [{ id: 4 }, { id: 5 }]),
    "id=gte.4&id=lte.5",
  );
  assert.equal(
    buildIdentityFilter("corpus_law_collections", [{ state: "AK", kind: "statutes" }]),
    "or=(and(state.eq.AK,kind.eq.statutes))",
  );
  assert.equal(
    buildIdentityFilter("corpus_context", [{ key: "law_outline" }]),
    "key=eq.law_outline",
  );
  assert.throws(
    () =>
      buildIdentityFilter(
        "corpus_law_collections",
        Array.from({ length: 41 }, (_, index) => ({ state: `S${index}`, kind: "statutes" })),
      ),
    /OUTLINE_DELETE_BATCH_INVALID/,
  );
  assert.throws(
    () => buildIdentityFilter("corpus_context", [{ key: "supplement:law_tier_20260919" }]),
    /OUTLINE_CONTEXT_SCOPE_INVALID/,
  );
});

test("journal and receipt hashes bind manifest, identities, and complete before-image rows", () => {
  const rows = [
    { id: 10, state: "AK" },
    { id: 11, state: "AL" },
  ];
  const identitySha = batchBeforeImageHash(rows.map((row) => [row.id]));
  const beforeImageSha = batchBeforeImageHash(rows);
  const expected = {
    table: "corpus_law_nodes",
    page: 1,
    batch: 1,
    rows,
    identitySha256: identitySha,
    beforeImageSha256: beforeImageSha,
    manifestSha256: "a".repeat(64),
  };
  const intent = {
    table: expected.table,
    page: expected.page,
    batch: expected.batch,
    rows: rows.length,
    identity_sha256: identitySha,
    beforeimage_sha256: beforeImageSha,
    manifest_sha256: expected.manifestSha256,
    prepared_at: at,
  };
  const receipt = {
    table: expected.table,
    page: expected.page,
    batch: expected.batch,
    rows: rows.length,
    identity_sha256: identitySha,
    beforeimage_sha256: beforeImageSha,
    manifest_sha256: expected.manifestSha256,
    deleted_identity_sha256: identitySha,
    outcome: "exact_identities_deleted",
    completed_at: at,
  };
  assert.equal(validateBatchIntent(intent, expected), intent);
  assert.equal(validateBatchReceipt(receipt, expected), receipt);
  const independentlyAbsent = {
    ...receipt,
    outcome: "independently_absent_after_unknown_write",
    completed_at: undefined,
    confirmed_at: at,
  };
  assert.equal(validateBatchReceipt(independentlyAbsent, expected), independentlyAbsent);
  assert.throws(
    () => validateBatchReceipt({ ...receipt, beforeimage_sha256: "f".repeat(64) }, expected),
    /OUTLINE_BATCH_RECEIPT_INVALID/,
  );
  assert.throws(
    () => validateBatchIntent({ ...intent, manifest_sha256: "b".repeat(64) }, expected),
    /OUTLINE_BATCH_INTENT_INVALID/,
  );
});

test("default mode does not make API calls, and execute requires a pinned manifest hash", async () => {
  let calls = 0;
  await assert.rejects(
    runRemoval({ restClient: async () => calls++, fetcher: async () => calls++ }),
    /EXACT_MANIFEST_HASH_REQUIRED/,
  );
  assert.equal(calls, 0);
});
