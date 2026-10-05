import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capturePlan, validateCapturePlan } from "./wa-capture-core.mjs";

async function withPrivateRoot(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wa-capture-test-"));
  const privateRoot = path.join(temp, "private", "audit", "wa");
  await mkdir(privateRoot, { recursive: true });
  try {
    await run({ temp, privateRoot });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function plan(requests, overrides = {}) {
  return {
    maxObjectBytes: 16,
    maxTotalBytes: 64,
    delayMs: 0,
    timeoutMs: 1000,
    requests,
    ...overrides,
  };
}

function request(id, overrides = {}) {
  return {
    id,
    url: `https://leg.wa.gov/${id}`,
    label: id,
    discovery: "synthetic test URL",
    ...overrides,
  };
}

async function execute({
  privateRoot,
  outputName = "run",
  requests,
  planOverrides = {},
  fetchImpl,
  sleepImpl = async () => {},
}) {
  const outputDir = path.join(privateRoot, outputName);
  const spec = plan(requests, planOverrides);
  const planBytes = Buffer.from(JSON.stringify(spec));
  return {
    outputDir,
    ...(await capturePlan({
      plan: spec,
      planBytes,
      planPath: "fixture-plan.json",
      outDir: outputDir,
      privateRoot,
      fetchImpl,
      sleepImpl,
    })),
  };
}

test("validates every request and output path before starting a capture", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    const invalidPlans = [
      plan([request("duplicate"), request("duplicate")]),
      plan(Array.from({ length: 101 }, (_, i) => request(`r${i}`))),
      plan([request("bad-protocol", { url: "ftp://leg.wa.gov/file" })]),
      plan([request("bad-host", { url: "https://example.test/file" })]),
      plan([request("../escape")]),
    ];
    for (const spec of invalidPlans)
      assert.throws(
        () => validateCapturePlan(spec, { outDir: path.join(privateRoot, "run"), privateRoot }),
        /Capture plan|Duplicate|Unapproved|Unsafe/,
      );
    assert.throws(
      () =>
        validateCapturePlan(plan([request("one")]), {
          outDir: path.join(privateRoot, "..", "escape"),
          privateRoot,
        }),
      /inside the Washington private audit root/,
    );
    let calls = 0;
    await assert.rejects(
      execute({
        privateRoot,
        requests: [request("one"), request("one")],
        fetchImpl: async () => {
          calls += 1;
          return new Response("unexpected");
        },
      }),
      /Duplicate request id/,
    );
    assert.equal(calls, 0);
  });
});

test("allows only the four observed current Title 25 full-chapter PDF routes on app.leg.wa.gov", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    const observed = ["25.05", "25.10", "25.12", "25.15"].map((cite) =>
      request(`chapter-${cite}`, {
        url: `https://app.leg.wa.gov/RCW/default.aspx?cite=${cite}&full=true&pdf=true`,
      }),
    );
    assert.doesNotThrow(() =>
      validateCapturePlan(plan(observed), { outDir: path.join(privateRoot, "valid"), privateRoot }),
    );
    for (const url of [
      "https://app.leg.wa.gov/RCW/default.aspx?cite=25.05",
      "https://app.leg.wa.gov/RCW/default.aspx?cite=25.05&full=true",
      "https://app.leg.wa.gov/RCW/other.aspx?cite=25.05&full=true&pdf=true",
      "https://app.leg.wa.gov/RCW/default.aspx?cite=25.06&full=true&pdf=true",
      "https://other.app.leg.wa.gov/RCW/default.aspx?cite=25.05&full=true&pdf=true",
    ]) {
      assert.throws(
        () =>
          validateCapturePlan(plan([request("unobserved", { url })]), {
            outDir: path.join(privateRoot, "invalid"),
            privateRoot,
          }),
        /Unobserved app\.leg\.wa\.gov route|Unapproved protocol or publisher host/,
      );
    }
  });
});

test("refuses an existing output directory before any request", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    await mkdir(path.join(privateRoot, "already-there"));
    let calls = 0;
    await assert.rejects(
      execute({
        privateRoot,
        outputName: "already-there",
        requests: [request("one")],
        fetchImpl: async () => {
          calls += 1;
          return new Response("unexpected");
        },
      }),
      /Refusing to overwrite existing evidence directory/,
    );
    assert.equal(calls, 0);
  });
});

test("stops after access-denied, rate-limit, or server-error HTTP statuses and journals unattempted requests", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await withPrivateRoot(async ({ privateRoot }) => {
      let calls = 0;
      const result = await execute({
        privateRoot,
        requests: [request("blocked"), request("later")],
        fetchImpl: async () => {
          calls += 1;
          return new Response("status body not retained", { status });
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.receipt.stopped, true);
      assert.equal(result.receipt.stopReason, `http-${status}`);
      assert.deepEqual(
        result.receipt.unattempted.map((x) => x.id),
        ["later"],
      );
      const lines = (await readFile(path.join(result.outputDir, "request-journal.jsonl"), "utf8"))
        .trim()
        .split(/\r?\n/);
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).status, status);
      assert.deepEqual(
        JSON.parse(await readFile(result.receiptPath, "utf8")).unattempted.map((x) => x.id),
        ["later"],
      );
    });
  }
});

test("transport errors stop and preserve an attempt receipt before listing the rest as unattempted", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    let calls = 0;
    const result = await execute({
      privateRoot,
      requests: [request("failure"), request("later")],
      fetchImpl: async () => {
        calls += 1;
        throw new Error("synthetic socket close");
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.receipt.stopReason, "transport-error");
    assert.match(result.receipt.results[0].error, /synthetic socket close/);
    assert.deepEqual(
      result.receipt.unattempted.map((x) => x.id),
      ["later"],
    );
    assert.equal(
      (await readFile(path.join(result.outputDir, "request-journal.jsonl"), "utf8"))
        .trim()
        .split(/\r?\n/).length,
      1,
    );
  });
});

test("size caps stop without storing a partial body and preserve exact unattempted work", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    let calls = 0;
    const result = await execute({
      privateRoot,
      requests: [request("large"), request("later")],
      planOverrides: { maxObjectBytes: 3 },
      fetchImpl: async () => {
        calls += 1;
        return new Response("0123456789", { status: 200 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.receipt.stopReason, "streamed-body-over-cap");
    assert.equal(result.receipt.storedBodies, 0);
    assert.deepEqual(
      result.receipt.unattempted.map((x) => x.id),
      ["later"],
    );
    await assert.rejects(readFile(path.join(result.outputDir, "raw", "large.body")), {
      code: "ENOENT",
    });
  });
});

test("normalizes invalid short spacing to at least one second and continues after a recorded 404", async () => {
  await withPrivateRoot(async ({ privateRoot }) => {
    const sleeps = [];
    let calls = 0;
    const result = await execute({
      privateRoot,
      requests: [request("missing"), request("available")],
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? new Response("not found", { status: 404 })
          : new Response("ok", { status: 200 });
      },
      sleepImpl: async (ms) => sleeps.push(ms),
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(result.receipt.limits.effectiveDelayMs, 1000);
    assert.equal(result.receipt.results[0].status, 404);
    assert.equal(result.receipt.results[0].outcome, "http-non-200");
    assert.equal(result.receipt.results[1].outcome, "captured");
    assert.deepEqual(result.receipt.unattempted, []);
  });
});
