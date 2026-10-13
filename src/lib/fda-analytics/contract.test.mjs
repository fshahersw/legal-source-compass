// Isolated PostgreSQL checks only; no credentials or network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
const { PGlite } = await import(
  pathToFileURL(
    process.env.PUBLISHER_CODE_PGLITE ??
      path.resolve(
        "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
      ),
  ).href
);
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const ids = [
  "food_enforcement",
  "food_event",
  "animalandveterinary_event",
  "transparency_crl",
  "tobacco_problem",
  "other_historicaldocument",
  "other_unii",
  "other_nsde",
  "other_substance",
  "device_classification",
  "device_510k",
  "device_covid19serology",
  "device_registrationlisting",
  "device_enforcement",
  "device_udi",
  "device_event",
  "device_recall",
  "device_pma",
  "cosmetic_event",
  "drug_drugsfda",
  "drug_orangebook",
  "drug_label",
  "drug_enforcement",
  "drug_event",
  "drug_shortages",
  "drug_ndc",
];
const url = "https://api.fda.gov/food/enforcement.json?count=report_date&limit=1000";
const raw = sha("synthetic offline API response");
const receipt = {
  id: sha(`${url}\n${raw}`),
  url,
  sha256: raw,
  retrievedAt: "2026-01-10T11:00:00Z",
  lastUpdated: "2026-01-08",
  byteCount: 100,
  contentType: "application/json",
  httpStatus: 200,
};
const proof = {
  id: receipt.id,
  storageKey: `fda-analytics/${raw.slice(0, 2)}/${raw}.raw`,
  readbackSha256: raw,
};
function fixture() {
  const snapshot = {
    schemaVersion: "fda-analytics/1",
    runId: randomUUID(),
    generatedAt: "2026-01-10T12:00:00Z",
    window: { from: "2026-01-01", to: "2026-01-09" },
    receipts: [receipt],
    qualifications: ["Synthetic offline contract fixture only."],
    datasets: ids.map((id) => ({
      id,
      label: `Synthetic ${id}`,
      endpoint: `https://api.fda.gov/${id.replace("_", "/")}.json`,
      documentationUrl: "https://open.fda.gov/apis/",
      productFamily:
        id.split("_")[0] === "animalandveterinary" ? "animal_veterinary" : id.split("_")[0],
      countUnit: "source aggregate records",
      status: "unavailable",
      statusReason: "Offline fixture",
      retrievedAt: "2026-01-10T11:00:00Z",
      sourceUpdatedAt: null,
      qualification: "Synthetic offline contract fixture.",
      total: { value: null, scope: "inventory", receiptIds: [] },
      series: null,
      facets: [],
    })),
  };
  Object.assign(snapshot.datasets[0], {
    status: "ready",
    statusReason: null,
    total: { value: 12, scope: "all_time", receiptIds: [receipt.id] },
    series: {
      dateField: "report_date",
      dateMeaning: "Publisher report date",
      range: snapshot.window,
      complete: true,
      completeThrough: "2026-01-08",
      points: [
        { date: "2026-01-01", count: 2 },
        { date: "2026-01-08", count: 2 },
      ],
      matchedRecords: 4,
      receiptIds: [receipt.id],
      qualification: "Enumerated API count only.",
    },
    facets: [
      {
        id: "classification",
        label: "Classification",
        field: "classification",
        countUnit: "source aggregate records",
        scope: { kind: "window", ...snapshot.window },
        buckets: [
          { key: "I", label: "Class I", count: 2 },
          { key: "II", label: "Class II", count: 2 },
        ],
        denominator: 4,
        denominatorLabel: "matching records in scope",
        multiValued: false,
        exhaustive: true,
        truncated: false,
        receiptIds: [receipt.id],
        qualification: "Source category counts.",
      },
    ],
  });
  return snapshot;
}

test("versioned FDA aggregate publication contract", { timeout: 120_000 }, async (t) => {
  const db = new PGlite();
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  const prepare = async (value) => {
    const bytes = canonical(value),
      hash = sha(bytes);
    await db.query("insert into storage.objects values('corpus-originals',$1,$2)", [
      `fda-analytics/snapshots/${hash}.json`,
      { size: Buffer.byteLength(bytes) },
    ]);
    return hash;
  };
  const publish = async (value, proofs = [proof]) =>
    rpc("corpus_fda_analytics_publish_v1", [value.runId, value, await prepare(value), proofs]);
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,public boolean); create table storage.objects(bucket_id text,name text,metadata jsonb); insert into storage.buckets values('corpus-originals',false);",
    );
    for (const name of [
      "corpus-ingest-v1.sql",
      "canonical-integer-jsonb-v1.sql",
      "corpus-fda-analytics-v1.sql",
    ])
      await db.exec(await fs.readFile(`database/contracts/${name}`, "utf8"));
    await db.query("insert into storage.objects values('corpus-originals',$1,'{\"size\":100}')", [
      proof.storageKey,
    ]);
    const original = fixture();
    await t.test(
      "empty is null; exact snapshot publication and replay preserve versioned evidence",
      async () => {
        assert.equal(await rpc("corpus_fda_analytics_snapshot_v1"), null);
        const result = await publish(original);
        assert.equal(result.status, "completed");
        assert.equal(result.datasetCount, 26);
        assert.deepEqual(
          (await rpc("corpus_fda_analytics_snapshot_v1", [original.runId])).snapshot,
          original,
        );
        assert.deepEqual(await publish(original), result);
        assert.equal(
          (await db.query("select count(*)::int n from corpus_ingest.observations")).rows[0].n,
          1,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from corpus_ingest.entity_versions where entity_type='aggregate-snapshot'",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "same run cannot replace data and replay cannot substitute readback proof",
      async () => {
        const changed = structuredClone(original);
        changed.datasets[0].label = "Changed label";
        await assert.rejects(publish(changed), /immutable/);
        await assert.rejects(
          publish(original, [{ ...proof, readbackSha256: "f".repeat(64) }]),
          /readback/,
        );
        assert.deepEqual(
          (await rpc("corpus_fda_analytics_snapshot_v1", [original.runId])).snapshot,
          original,
        );
      },
    );
    await t.test("missing private raw/snapshot storage and canonical tampering fail", async () => {
      const value = fixture();
      await assert.rejects(
        rpc("corpus_fda_analytics_publish_v1", [
          value.runId,
          value,
          sha(canonical(value)),
          [proof],
        ]),
        /snapshot object/,
      );
      await assert.rejects(
        rpc("corpus_fda_analytics_publish_v1", [value.runId, value, "a".repeat(64), [proof]]),
        /canonical snapshot hash/,
      );
      await db.exec("update storage.buckets set public=true");
      await assert.rejects(publish(value), /Private/);
      await db.exec("update storage.buckets set public=false");
      await assert.rejects(
        publish(value, [{ ...proof, storageKey: "other/object.raw" }]),
        /readback/,
      );
    });
    await t.test(
      "source identity, failed counts and unknown catalog entries cannot masquerade as metrics",
      async () => {
        for (const mutate of [
          (v) => {
            v.datasets[0].endpoint = "https://api.fda.gov/device/event.json";
          },
          (v) => {
            v.datasets[0].status = "failed";
            v.datasets[0].statusReason = "Network failed";
          },
          (v) => {
            v.datasets[0].id = "cpsc_injury_data";
          },
          (v) => {
            v.datasets[0].total.value = -1;
          },
          (v) => {
            v.datasets[0].total.receiptIds = ["a".repeat(64)];
          },
          (v) => {
            v.datasets[0].status = null;
          },
          (v) => {
            v.schemaVersion = null;
          },
          (v) => {
            v.runId = null;
          },
        ]) {
          const value = fixture();
          mutate(value);
          await assert.rejects(publish(value));
        }
      },
    );
    await t.test(
      "missing days never certify complete enumeration and release metadata never extends coverage",
      async () => {
        for (const mutate of [
          (v) => {
            v.datasets[0].series.matchedRecords = 5;
          },
          (v) => {
            v.datasets[0].series.points.push({ date: "2026-01-01", count: 1 });
          },
          (v) => {
            v.datasets[0].series.completeThrough = "2026-01-09";
          },
          (v) => {
            v.datasets[0].series.completeThrough = "2026-01-10";
          },
          (v) => {
            v.datasets[0].series.range = { from: "2020-01-01", to: "2026-01-09" };
          },
        ]) {
          const value = fixture();
          mutate(value);
          await assert.rejects(publish(value));
        }
      },
    );
    await t.test("facet denominator, exclusivity, truncation and dates are checked", async () => {
      for (const mutate of [
        (f) => {
          f.denominator = 5;
        },
        (f) => {
          f.multiValued = true;
          f.buckets[0].count = f.denominator + 1;
        },
        (f) => {
          f.truncated = true;
        },
        (f) => {
          f.buckets.push({ key: "I", label: "duplicate", count: 0 });
        },
        (f) => {
          f.scope.from = "2025-12-01";
        },
        (f) => {
          f.scope.kind = null;
        },
      ]) {
        const value = fixture();
        mutate(value.datasets[0].facets[0]);
        await assert.rejects(publish(value));
      }
      const partial = fixture();
      partial.datasets[0].facets[0].exhaustive = false;
      partial.datasets[0].facets[0].truncated = true;
      partial.datasets[0].facets[0].denominator = 8;
      assert.equal((await publish(partial)).status, "completed");
      const empty = fixture();
      empty.datasets[0].facets[0].buckets[0].key = "";
      await assert.rejects(publish(empty), /facet bucket/);
      empty.datasets[0].facets[0].buckets[0].label = "(empty term in source)";
      assert.equal((await publish(empty)).status, "completed");
    });
    await t.test(
      "repeated request URLs retain distinct changed raw versions without rewriting source URLs",
      async () => {
        const value = fixture(),
          changedRaw = sha("a changed stability-check source body");
        const second = {
          ...receipt,
          id: sha(`${url}\n${changedRaw}`),
          sha256: changedRaw,
          retrievedAt: "2026-01-10T11:30:00Z",
        };
        const secondProof = {
          id: second.id,
          storageKey: `fda-analytics/${changedRaw.slice(0, 2)}/${changedRaw}.raw`,
          readbackSha256: changedRaw,
        };
        value.receipts.push(second);
        value.datasets[0].status = "failed";
        value.datasets[0].statusReason = "Source changed during capture";
        value.datasets[0].total = { value: null, scope: "all_time", receiptIds: [] };
        value.datasets[0].series = null;
        value.datasets[0].facets = [];
        await db.query(
          "insert into storage.objects values('corpus-originals',$1,'{\"size\":100}')",
          [secondProof.storageKey],
        );
        await publish(value, [proof, secondProof]);
        const rows = (
          await db.query(
            "select source_url,source_sha256 from corpus_ingest.observations where run_id=$1",
            [value.runId],
          )
        ).rows;
        assert.equal(rows.length, 2);
        assert.deepEqual(new Set(rows.map((row) => row.source_sha256)), new Set([raw, changedRaw]));
        assert.ok(rows.every((row) => row.source_url === url));
      },
    );
    await t.test("only service role can call reads or administrative publication", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await assert.rejects(rpc("corpus_fda_analytics_snapshot_v1"), /permission denied/);
        await assert.rejects(
          rpc("corpus_fda_analytics_publish_v1", [
            original.runId,
            original,
            sha(canonical(original)),
            [proof],
          ]),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select * from corpus_fda_analytics.snapshots"),
          /permission denied/,
        );
        await db.exec("reset role");
      }
      await db.exec("set role service_role");
      assert.ok(await rpc("corpus_fda_analytics_snapshot_v1"));
      await db.exec("reset role");
      const flags = (
        await db.query(
          "select prosecdef,proconfig from pg_proc where proname in ('corpus_fda_analytics_publish_v1','corpus_fda_analytics_snapshot_v1')",
        )
      ).rows;
      assert.ok(flags.every((row) => row.prosecdef && row.proconfig.includes('search_path=""')));
    });
  } finally {
    await db.close();
  }
});
