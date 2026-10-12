import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readBytesWithRetry, requestWithRetry } from "./private-release-network.mjs";

function brokenBody(status = 200) {
  let first = true;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(new Uint8Array([99, 111, 114, 114, 117, 112, 116]));
        } else controller.error(new TypeError("connection terminated during body"));
      },
    }),
    { status },
  );
}

test("a partial HTTP 200 body retries from byte zero and returns only complete hashable bytes", async () => {
  let calls = 0;
  const delays = [];
  const expected = new Uint8Array([0, 1, 2, 255, 10]);
  const result = await readBytesWithRetry(
    async () => (++calls === 1 ? brokenBody() : new Response(expected)),
    { sleep: async (ms) => delays.push(ms) },
  );
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.bytes, expected);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha(result.bytes), sha(expected));
});

test("broken successful bodies exhaust the same bounded attempt budget", async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(
    readBytesWithRetry(
      async () => {
        calls++;
        return brokenBody();
      },
      { attempts: 3, sleep: async (ms) => delays.push(ms) },
    ),
    /connection terminated during body/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("readback HTTP 400, 404 and 403 retain their status without consuming or retrying error bodies", async () => {
  for (const status of [400, 404, 403]) {
    let calls = 0;
    const result = await readBytesWithRetry(async () => {
      calls++;
      return brokenBody(status);
    });
    assert.equal(calls, 1);
    assert.equal(result.response.status, status);
    assert.equal(result.bytes, null);
  }
});

test("ambiguous connection failure retries the same idempotent request", async () => {
  let calls = 0;
  const delays = [];
  const request = () => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return new Response("stored", { status: 409 });
  };
  const result = await requestWithRetry(request, { sleep: async (ms) => delays.push(ms) });
  assert.equal(result.status, 409);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test("transient responses close their body before bounded retry", async () => {
  const events = [];
  let calls = 0;
  const result = await requestWithRetry(
    async () =>
      ++calls === 1
        ? { status: 503, body: { cancel: async () => events.push("closed") } }
        : new Response("verified"),
    { sleep: async () => events.push("waited") },
  );
  assert.equal(await result.text(), "verified");
  assert.deepEqual(events, ["closed", "waited"]);
});

test("denied access is returned without retry and transport failures stay bounded", async () => {
  let calls = 0;
  const denied = await requestWithRetry(async () => {
    calls++;
    return new Response("", { status: 403 });
  });
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    requestWithRetry(
      async () => {
        calls++;
        throw new TypeError("offline");
      },
      { attempts: 3, sleep: async () => {} },
    ),
    /offline/,
  );
  assert.equal(calls, 3);
});
