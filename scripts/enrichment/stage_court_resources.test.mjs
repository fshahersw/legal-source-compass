import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  putVerified,
  validateDescriptor,
  validateIdentity,
  validateCaptureReceipt,
  parseArguments,
  uploadWithJournal,
} from "./stage_court_resources.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const source = "b".repeat(64),
    date = "2026-10-12T12:00:00Z";
  const rawReceipt = Buffer.from(
    JSON.stringify({
      court_id: "test",
      court_name: "Test Court",
      status: "captured",
      identity_reviewed: true,
      publication: "not_published",
      source_record: "court_spine:test",
      retrieved_at: date,
      final_url: "https://example.gov/",
      response_sha256: source,
      text_sha256: "c".repeat(64),
      anchors: [{ label: "Forms", url: "https://example.gov/forms", href_as_published: "/forms" }],
    }),
  );
  const receipt = hash(rawReceipt);
  const identity = Buffer.from(
    JSON.stringify({
      contract: "corpus_detail",
      retrieved_at: date,
      records: [
        {
          id: "test",
          status: 200,
          data: {
            id: "test",
            title: "Test Court",
            facts: [
              ["CourtListener court id", "test"],
              ["System", "Federal"],
            ],
            links: [{ url: "https://example.gov/" }],
          },
        },
      ],
    }),
  );
  const review = Buffer.from(
    JSON.stringify({
      schema: "court-resource-review/1",
      release: "test",
      reviewer: "test-review",
      reviewed_at: date,
      identity_evidence: {
        sha256: hash(identity),
        contract: "corpus_detail",
        retrieved_at: date,
        records: [
          {
            court_id: "test",
            recorded_title: "Test Court",
            court_system: "Federal",
            recorded_native_id: "test",
            source_homepage: "https://example.gov/",
            match: "Exact fixture identity",
          },
        ],
      },
      decisions: [
        {
          decision: "approve",
          court_id: "test",
          court_system: "Federal",
          label: "Forms",
          url: "https://example.gov/forms",
          kind: "forms",
          receipt_sha256: receipt,
          note: "Exact fixture anchor",
        },
      ],
    }),
  );
  const body = Buffer.from(
    JSON.stringify({
      schema: "court-resources/1",
      release: "test",
      generatedAt: date,
      resources: [
        {
          id: `resource:${"d".repeat(64)}`,
          courtId: "test",
          courtName: "Test Court",
          courtSystem: "Federal",
          label: "Forms",
          url: "https://example.gov/forms",
          kind: "forms",
          status: "source_link_observed",
          review: {
            decision: "approved",
            reviewer: "test-review",
            reviewedAt: date,
            note: "Exact fixture anchor",
          },
          provenance: {
            sourcePage: "https://example.gov/",
            sourceRecord: "court_spine:test",
            capturedAt: date,
            receiptSha256: receipt,
            responseSha256: source,
          },
        },
      ],
    }),
  );
  const digest = hash(body);
  return {
    review,
    body,
    identity,
    rawReceipt,
    descriptor: {
      schema: "court-resource-staging/1",
      publication: "not_published",
      release: "test",
      file: "court-resources/official-links.json",
      resources: 1,
      reviewSha256: hash(review),
      entry: {
        bytes: body.length,
        sha256: digest,
        storage_key: `atlas-private-data/sha256/${digest.slice(0, 2)}/${digest}.bin`,
      },
    },
  };
}
test("only exact approved review and content-addressed court snapshot can be staged", () => {
  const { descriptor, body, review } = fixture();
  assert.equal(validateDescriptor(descriptor, body, review).resources.length, 1);
  assert.throws(
    () => validateDescriptor({ ...descriptor, file: "limitations/rules.json" }, body, review),
    /INVALID/,
  );
  assert.throws(() => validateDescriptor(descriptor, body, Buffer.from("changed")), /INVALID/);
  const changed = JSON.parse(review);
  changed.decisions[0].decision = "hold";
  const held = Buffer.from(JSON.stringify(changed));
  assert.throws(
    () => validateDescriptor({ ...descriptor, reviewSha256: hash(held) }, body, held),
    /REVIEW/,
  );
});

test("staging reuses runtime schema and exact reviewer rationale", () => {
  const { descriptor, body, review } = fixture();
  for (const mutate of [
    (row) => {
      row.url += " ";
    },
    (row) => {
      row.review.reviewer = "somebody else";
    },
    (row) => {
      row.review.note = "different review";
    },
    (row) => {
      row.review.reviewedAt = "2026-10-11T12:00:00Z";
    },
  ]) {
    const value = JSON.parse(body);
    mutate(value.resources[0]);
    const changed = Buffer.from(JSON.stringify(value)),
      digest = hash(changed);
    const repacked = {
      ...descriptor,
      entry: {
        bytes: changed.length,
        sha256: digest,
        storage_key: `atlas-private-data/sha256/${digest.slice(0, 2)}/${digest}.bin`,
      },
    };
    assert.throws(
      () => validateDescriptor(repacked, changed, review),
      /INVALID_BUNDLE_SCHEMA|REVIEW_MISMATCH/,
    );
  }
});

test("identity evidence binds the exact native ID, recorded system and homepage", () => {
  const { body, review, identity } = fixture();
  assert.equal(validateIdentity(JSON.parse(body), review, identity).records.length, 1);
  assert.throws(() => validateIdentity(JSON.parse(body), review, Buffer.from("different")), /HASH/);
  for (const mutate of [
    (record) => {
      record.status = 404;
    },
    (record) => {
      record.data.facts[0][1] = "other";
    },
    (record) => {
      record.data.facts[1][1] = "State";
    },
    (record) => {
      record.data.links[0].url = "https://another.example/";
    },
  ]) {
    const changed = JSON.parse(identity);
    mutate(changed.records[0]);
    const bytes = Buffer.from(JSON.stringify(changed));
    const modifiedReview = JSON.parse(review);
    modifiedReview.identity_evidence.sha256 = hash(bytes);
    assert.throws(
      () => validateIdentity(JSON.parse(body), Buffer.from(JSON.stringify(modifiedReview)), bytes),
      /COURT_IDENTITY_MISMATCH/,
    );
  }
});

test("receipt retains exact source page, source record, capture date and anchor", () => {
  const { body, rawReceipt } = fixture();
  assert.equal(
    validateCaptureReceipt(JSON.parse(body), hash(rawReceipt), rawReceipt).court_id,
    "test",
  );
  for (const mutate of [
    (row) => {
      row.source_record = "other";
    },
    (row) => {
      row.final_url = "https://another.example/";
    },
    (row) => {
      row.retrieved_at = "2026-10-11T12:00:00Z";
    },
    (row) => {
      row.identity_reviewed = false;
    },
    (row) => {
      row.anchors[0].href_as_published += " ";
    },
  ]) {
    const receipt = JSON.parse(rawReceipt);
    mutate(receipt);
    const bytes = Buffer.from(JSON.stringify(receipt));
    const bundle = JSON.parse(body);
    bundle.resources[0].provenance.receiptSha256 = hash(bytes);
    assert.throws(
      () => validateCaptureReceipt(bundle, hash(bytes), bytes),
      /INVALID_CAPTURE_RECEIPT|SOURCE_ANCHOR_MISMATCH/,
    );
  }
});

test("only bare execution flags are accepted; explicit false exits before file or network work", () => {
  assert.equal(parseArguments(["--execute", "--activate"]).activate, true);
  for (const flag of ["--execute=false", "--execute=true", "--activate=false"]) {
    assert.throws(() => parseArguments([flag]), /INVALID_BOOLEAN_FLAG/);
    const result = spawnSync(
      process.execPath,
      ["scripts/enrichment/stage_court_resources.mjs", flag],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INVALID_BOOLEAN_FLAG/);
  }
  assert.throws(() => parseArguments(["--execute", "--execute"]), /DUPLICATE_ARGUMENT/);
  assert.throws(() => parseArguments(["--activate"]), /ACTIVATION_REQUIRES_EXECUTE/);
});
test("existing identical storage objects are read back without overwriting", async () => {
  const { body } = fixture();
  const calls = [];
  const result = await putVerified(
    "https://example.test",
    {},
    "test",
    body,
    async (_url, options) => {
      calls.push(options.method ?? "GET");
      return new Response(body);
    },
  );
  assert.equal(result.verified, true);
  assert.equal(result.created, false);
  assert.deepEqual(calls, ["GET"]);
});
test("missing object upload disables upsert then verifies bytes", async () => {
  const { body } = fixture();
  const methods = [];
  const result = await putVerified(
    "https://example.test",
    {},
    "test",
    body,
    async (_url, options) => {
      methods.push(options.method ?? "GET");
      if (methods.length === 1)
        return new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), {
          status: 400,
        });
      if (options.method === "POST") {
        assert.equal(options.headers["x-upsert"], "false");
        return new Response("{}");
      }
      return new Response(body);
    },
  );
  assert.equal(result.created, true);
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
});
test("corruption and unrelated storage errors cannot be overwritten", async () => {
  const { body } = fixture();
  await assert.rejects(
    putVerified(
      "https://example.test",
      {},
      "test",
      body,
      async () => new Response(Buffer.alloc(body.length)),
    ),
    /HASH/,
  );
  await assert.rejects(
    putVerified(
      "https://example.test",
      {},
      "test",
      body,
      async () =>
        new Response(JSON.stringify({ statusCode: "400", error: "bad_request" }), { status: 400 }),
    ),
    /UNEXPECTED/,
  );
});

test("incremental journal retains prior verified objects and attempted keys after a later failure", async () => {
  const folder = await mkdtemp(join(tmpdir(), "court-resource-journal-"));
  try {
    const first = Buffer.from("first source"),
      second = Buffer.from("second source");
    const files = new Map([
      ["first-key", first],
      ["second-key", second],
    ]);
    await assert.rejects(
      uploadWithJournal(files, "https://example.test", {}, folder, async (url) =>
        url.endsWith("first-key")
          ? new Response(first)
          : new Response("Unavailable", { status: 503 }),
      ),
      /STORAGE_READBACK_503/,
    );
    const journals = await readdir(folder);
    assert.equal(journals.length, 1);
    const rows = (await readFile(join(folder, journals[0]), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows[2].storage_key, "first-key");
    assert.equal(rows[2].verified, true);
    assert.equal(rows[2].created, false);
    assert.equal(rows[3].storage_key, "second-key");
    assert.equal(rows[3].status, "verification_pending");
    assert.equal(rows[4].status, "failed_or_unverified");
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(folder.includes("court-resource-journal-"));
    await rm(folder, { recursive: true, force: true });
  }
});
