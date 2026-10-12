import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  retrieveSnapshot,
  fixtureDestination,
  ensureFixturePath,
} from "./fetch-private-fixtures.mjs";

const bytes = Buffer.from('{"synthetic":true}');
const entry = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const response = (headers = {}, body = bytes) =>
  new Response(body, {
    headers: {
      "x-atlas-snapshot-sha256": entry.sha256,
      "x-atlas-snapshot-bytes": String(entry.bytes),
      "x-atlas-page": "0",
      "x-atlas-page-count": "1",
      ...headers,
    },
  });
test("reassembles only the pinned active version", async () => {
  const result = await retrieveSnapshot(
    "https://example.test",
    "limitations/rules.json",
    entry,
    async (url) => {
      assert.equal(url.searchParams.get("version"), entry.sha256);
      return response();
    },
  );
  assert.deepEqual(result, bytes);
});
test("rejects changed manifests and corrupted payloads", async () => {
  await assert.rejects(
    retrieveSnapshot("https://example.test", "limitations/rules.json", entry, async () =>
      response({ "x-atlas-snapshot-sha256": "0".repeat(64) }),
    ),
    /VERSION/,
  );
  await assert.rejects(
    retrieveSnapshot("https://example.test", "limitations/rules.json", entry, async () =>
      response({}, Buffer.alloc(bytes.length)),
    ),
    /HASH/,
  );
});
test("refuses traversal outside private fixtures", () => {
  for (const name of ["../rules.json", "/etc/test.json", "a/../../b.json"])
    assert.throws(() => fixtureDestination("private/data", name));
});

test("stops reading an oversized response at the page bound", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(bytes.length + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    retrieveSnapshot("https://example.test", "limitations/rules.json", entry, async () =>
      response({}, stream),
    ),
    /PAGE_SIZE/,
  );
  assert.equal(cancelled, true);
});

test("refuses junctions and symlinks inside or at the private root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "atlas-fixture-test-"));
  try {
    const root = join(temp, "private");
    const outside = join(temp, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(
      outside,
      join(root, "limitations"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(ensureFixturePath(root, "limitations/rules.json"), /SYMLINK/);
    await assert.rejects(ensureFixturePath(join(root, "limitations"), "rules.json"), /SYMLINK/);
    assert.equal(await ensureFixturePath(root, "ordinary.json"), join(root, "ordinary.json"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
