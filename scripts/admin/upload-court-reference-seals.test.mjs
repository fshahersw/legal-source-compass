import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPECTED_OBJECTS,
  EXPECTED_ROWS,
  MANIFEST,
  objectKey,
  parseManifest,
  planObjects,
  putVerified,
  sha256,
} from "./upload-court-reference-seals.mjs";

const manifestText = readFileSync(MANIFEST, "utf8");

test("committed manifest matches the live artifact digest and shape", () => {
  const rows = parseManifest(manifestText);
  assert.equal(rows.length, EXPECTED_ROWS);
  assert.equal(new Set(rows.map((r) => r.sha256)).size, EXPECTED_OBJECTS);
  // The one known wrong binding: ilsd carries the byte-identical S.D. Indiana seal.
  const ilsd = rows.find((r) => r.id === "ilsd");
  const insd = rows.find((r) => r.id === "insd");
  assert.equal(ilsd.sha256, insd.sha256);
  assert.ok(!rows.some((r) => r.id === "me"), "the publisher-held Maine seal is not in the bundle");
});

test("rejects an edited manifest", () => {
  assert.throws(() => parseManifest(manifestText.replace("acca ", "accb ")), /MANIFEST_DIGEST_MISMATCH/);
});

function fakeRows() {
  const a = Buffer.from("seal-a");
  const b = Buffer.from("seal-b");
  return {
    rows: [
      { id: "aaa", sha256: sha256(a), bytes: a.length },
      { id: "bbb", sha256: sha256(b), bytes: b.length },
      { id: "ccc", sha256: sha256(a), bytes: a.length },
    ],
    files: new Map([
      ["aaa", a],
      ["bbb", b],
      ["ccc", a],
    ]),
  };
}

test("plan checks every local file and stops on a changed, missing or stray file", () => {
  const { rows, files } = fakeRows();
  // EXPECTED_OBJECTS guards the real run; the fake set has 2 distinct objects.
  assert.throws(() => planObjects(rows, files), /DISTINCT_OBJECT_COUNT/);
  const changed = new Map(files).set("bbb", Buffer.from("other"));
  assert.throws(() => planObjects(rows, changed), /LOCAL_HASH_MISMATCH:bbb/);
  const missing = new Map(files);
  missing.delete("ccc");
  assert.throws(() => planObjects(rows, missing), /MISSING_LOCAL_FILE:ccc/);
  const stray = new Map(files).set("zzz", Buffer.from("x"));
  assert.throws(() => planObjects(rows, stray), /STRAY_LOCAL_FILE:zzz/);
});

function storageFake(initial = new Map()) {
  const store = new Map(initial);
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const key = url.split("/corpus-originals/")[1];
    calls.push([init.method ?? "GET", key, init.headers?.["x-upsert"]]);
    if ((init.method ?? "GET") === "POST") {
      if (store.has(key)) return new Response("{}", { status: 409 });
      store.set(key, Buffer.from(init.body));
      return new Response("{}", { status: 200 });
    }
    if (!store.has(key)) return new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 });
    return new Response(store.get(key), { status: 200 });
  };
  return { store, calls, fetcher };
}

test("uploads a missing object without overwrite and verifies the readback", async () => {
  const body = Buffer.from("png-bytes");
  const object = { key: objectKey(sha256(body)), sha256: sha256(body), bytes: body.length, ids: ["aaa"], body };
  const fake = storageFake();
  const out = await putVerified("https://x.supabase.co", {}, object, fake.fetcher);
  assert.deepEqual({ created: out.created, verified: out.verified }, { created: true, verified: true });
  assert.deepEqual(fake.calls.map((c) => c[0]), ["GET", "POST", "GET"]);
  assert.equal(fake.calls[1][2], "false");
});

test("an existing object is read back, never re-uploaded", async () => {
  const body = Buffer.from("png-bytes");
  const key = objectKey(sha256(body));
  const fake = storageFake(new Map([[key, body]]));
  const out = await putVerified("https://x.supabase.co", {}, { key, sha256: sha256(body), bytes: body.length, ids: ["aaa"], body }, fake.fetcher);
  assert.equal(out.created, false);
  assert.deepEqual(fake.calls.map((c) => c[0]), ["GET"]);
});

test("a stored object with different bytes stops the run", async () => {
  const body = Buffer.from("png-bytes");
  const key = objectKey(sha256(body));
  const fake = storageFake(new Map([[key, Buffer.from("png-byteZ")]]));
  await assert.rejects(
    putVerified("https://x.supabase.co", {}, { key, sha256: sha256(body), bytes: body.length, ids: ["aaa"], body }, fake.fetcher),
    /STORAGE_HASH_MISMATCH:aaa/,
  );
});
