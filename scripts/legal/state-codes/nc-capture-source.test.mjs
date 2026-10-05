import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureSources } from "./nc-capture-source.mjs";

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nc-capture-source-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function source(overrides = {}) {
  return {
    id: "section-test",
    url: "https://example.test/statute",
    rawPath: "raw/section.html",
    receiptPath: "receipts/section.json",
    ...overrides,
  };
}

test("valid existing capture pair is verified and skipped without fetching", async () => {
  await withTempDirectory(async (base) => {
    let calls = 0;
    const config = source();
    const first = await captureSources({
      base,
      sources: [config],
      spacingMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(Buffer.from("<p>official text</p>"), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    });
    assert.equal(first[0].outcome, "captured");
    const second = await captureSources({
      base,
      sources: [config],
      fetchImpl: async () => {
        calls += 1;
        throw new Error("fetch must not run for a verified capture");
      },
    });
    assert.equal(second[0].outcome, "verified_existing_capture");
    assert.equal(calls, 1);
  });
});

test("all outputs are preflighted so a partial later pair prevents every request", async () => {
  await withTempDirectory(async (base) => {
    await mkdir(path.join(base, "raw"), { recursive: true });
    await writeFile(path.join(base, "raw", "section.html"), "orphan bytes");
    let calls = 0;
    await assert.rejects(
      captureSources({
        base,
        sources: [
          source({ id: "first", rawPath: "raw/first.html", receiptPath: "receipts/first.json" }),
          source(),
        ],
        fetchImpl: async () => {
          calls += 1;
          return new Response("unexpected");
        },
      }),
      /partial existing capture output/,
    );
    assert.equal(calls, 0);
  });
});

test("conflicting existing URL/body metadata fails closed before fetch", async () => {
  await withTempDirectory(async (base) => {
    const config = source();
    await mkdir(path.join(base, "raw"), { recursive: true });
    await mkdir(path.join(base, "receipts"), { recursive: true });
    const bytes = Buffer.from("old body");
    await writeFile(path.join(base, config.rawPath), bytes);
    await writeFile(
      path.join(base, config.receiptPath),
      JSON.stringify({
        schemaVersion: "nc-section-identity-source-capture/1",
        id: config.id,
        requestedUrl: "https://example.test/other",
        finalUrl: "https://example.test/other",
        requestMethod: "GET",
        httpStatus: 200,
        outcome: "captured",
        rawPath: config.rawPath,
        bytes: bytes.length,
        sha256: "not-the-body-hash",
      }),
    );
    let calls = 0;
    await assert.rejects(
      captureSources({
        base,
        sources: [config],
        fetchImpl: async () => {
          calls += 1;
          return new Response("unexpected");
        },
      }),
      /conflicts with requested URL/,
    );
    assert.equal(calls, 0);
  });
});

test("oversized response leaves a transport/size failure receipt and no truncated raw file", async () => {
  await withTempDirectory(async (base) => {
    const config = source({ maxBytes: 4 });
    await assert.rejects(
      captureSources({
        base,
        sources: [config],
        fetchImpl: async () => new Response("too many bytes"),
      }),
      /capture limit/,
    );
    const receipt = JSON.parse(await readFile(path.join(base, config.receiptPath), "utf8"));
    assert.equal(receipt.outcome, "transport_or_size_failure");
    assert.equal(receipt.httpStatus, 200);
    assert.match(receipt.error, /capture limit/);
    assert.equal(receipt.bytes, 0);
    assert.equal(receipt.sha256, null);
    assert.equal(receipt.rawPath, null);
    await assert.rejects(readFile(path.join(base, config.rawPath)), { code: "ENOENT" });
    let calls = 0;
    await assert.rejects(
      captureSources({
        base,
        sources: [config],
        fetchImpl: async () => {
          calls += 1;
          return new Response("repeat");
        },
      }),
      /partial existing capture output/,
    );
    assert.equal(calls, 0);
  });
});

test("transport error writes a failure receipt and does not proceed to the next source", async () => {
  await withTempDirectory(async (base) => {
    let calls = 0;
    const sources = [
      source(),
      source({ id: "later", rawPath: "raw/later.html", receiptPath: "receipts/later.json" }),
    ];
    await assert.rejects(
      captureSources({
        base,
        sources,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("socket closed");
        },
      }),
      /failure receipt preserved/,
    );
    assert.equal(calls, 1);
    const receipt = JSON.parse(await readFile(path.join(base, sources[0].receiptPath), "utf8"));
    assert.equal(receipt.outcome, "transport_or_size_failure");
    assert.equal(receipt.httpStatus, null);
    assert.match(receipt.error, /socket closed/);
    await assert.rejects(readFile(path.join(base, sources[0].rawPath)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(base, sources[1].receiptPath)), { code: "ENOENT" });
  });
});

test("non-2xx body and receipt are preserved, and additional sources are not fetched", async () => {
  await withTempDirectory(async (base) => {
    let calls = 0;
    const sources = [
      source(),
      source({ id: "later", rawPath: "raw/later.html", receiptPath: "receipts/later.json" }),
    ];
    await assert.rejects(
      captureSources({
        base,
        sources,
        fetchImpl: async () => {
          calls += 1;
          return new Response("rate limited", {
            status: 429,
            headers: { "content-type": "text/plain" },
          });
        },
      }),
      /HTTP 429/,
    );
    assert.equal(calls, 1);
    assert.equal(await readFile(path.join(base, sources[0].rawPath), "utf8"), "rate limited");
    const receipt = JSON.parse(await readFile(path.join(base, sources[0].receiptPath), "utf8"));
    assert.equal(receipt.outcome, "http_error_body_preserved");
    assert.equal(receipt.httpStatus, 429);
    assert.equal(receipt.rawPath, sources[0].rawPath);
    await assert.rejects(readFile(path.join(base, sources[1].receiptPath)), { code: "ENOENT" });
  });
});

test("new requests are serialized with the configured one-second start interval", async () => {
  await withTempDirectory(async (base) => {
    let clock = 0;
    const startTimes = [];
    const waits = [];
    const sources = [
      source(),
      source({ id: "next", rawPath: "raw/next.html", receiptPath: "receipts/next.json" }),
    ];
    const results = await captureSources({
      base,
      sources,
      monotonicNow: () => clock,
      sleepImpl: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
      fetchImpl: async () => {
        startTimes.push(clock);
        return new Response("ok", { status: 200 });
      },
    });
    assert.equal(results.length, 2);
    assert.deepEqual(startTimes, [0, 1_000]);
    assert.deepEqual(waits, [1_000]);
  });
});
