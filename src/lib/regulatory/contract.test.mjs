// Isolated PostgreSQL contract tests. No credentials, network or live corpus access.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const raw = sha("offline synthetic source receipt"),
  storageKey = `regulatory/${raw.slice(0, 2)}/${raw}.raw`;
const source = "federal_register",
  captureUrl = "https://www.federalregister.gov/api/v1/documents.json?page=1";
const stamp = "2026-01-01T12:00:00Z";
const record = (id = "2026-00001", patch = {}) => ({
  native_id: id,
  title: "Synthetic regulation record",
  document_type: "Proposed Rule",
  published_on: "2025-12-31",
  source_updated_on: null,
  source_url: `https://www.federalregister.gov/documents/2026/01/01/${id}`,
  agency_ids: ["54"],
  agency_names: ["Fixture agency"],
  entity_refs: [{ namespace: "federal_register:agency", native_id: "54", label: "Fixture agency" }],
  identifiers: ["RIN-001"],
  status: null,
  fields: { action: "Proposal" },
  correction_of: [],
  evidence_excerpt: "A synthetic source excerpt for offline verification.",
  ...patch,
});

test("regulatory evidence and confidential workspace contracts", { timeout: 120000 }, async (t) => {
  const db = new PGlite();
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,public boolean); create table storage.objects(bucket_id text,name text,metadata jsonb); insert into storage.buckets values('corpus-originals',false);",
    );
    for (const name of [
      "corpus-ingest-v1.sql",
      "canonical-integer-jsonb-v1.sql",
      "corpus-regulatory-monitor-v1.sql",
      "corpus-regulatory-evidence-read-v1.sql",
      "corpus-regulatory-run-read-v1.sql",
    ])
      await db.exec(await fs.readFile(`database/contracts/${name}`, "utf8"));
    await db.query("insert into storage.objects values('corpus-originals',$1,'{\"size\":100}')", [
      storageKey,
    ]);
    const open = (id, mode = "incremental", count = 1, s = source) =>
      rpc("corpus_regulatory_open_run_v1", [id, s, "2025-12-01", "2026-01-31", count, { mode }]);
    const capture = (id, at = stamp) =>
      rpc("corpus_regulatory_capture_v1", [
        id,
        [
          {
            sha256: raw,
            byte_count: 100,
            content_type: "application/json",
            source_url: captureUrl,
            retrieved_at: at,
            storage_key: storageKey,
            readback_sha256: raw,
          },
        ],
      ]);
    const envelope = (data, at = stamp) => ({
      data,
      payload_sha256: sha(canonical(data)),
      raw_sha256: raw,
      raw_storage_key: storageKey,
      capture_source_url: captureUrl,
      retrieved_at: at,
      record_pointer: "results[0]",
      schema_version: "regulatory-record/1",
    });
    const intake = (id, data, at = stamp) =>
      rpc("corpus_regulatory_intake_v1", [id, [envelope(data, at)]]);
    const finish = (id, status = "completed", count = 1) =>
      rpc("corpus_regulatory_finish_run_v1", [id, status, count, null]);
    const ingest = async (data, mode = "incremental", at = stamp) => {
      const id = randomUUID();
      await open(id, mode);
      await capture(id, at);
      await intake(id, data, at);
      await finish(id);
      return id;
    };
    let initialId, eventId, changedEventId;
    await t.test(
      "allowlisted source identities, private storage and exact raw/hash provenance",
      async () => {
        await assert.rejects(
          open(randomUUID(), "initial", 1, "cpsc_injury_data"),
          /approved source/,
        );
        const id = randomUUID();
        await open(id, "initial");
        await assert.rejects(
          rpc("corpus_regulatory_capture_v1", [
            id,
            [
              {
                sha256: raw,
                byte_count: 99,
                content_type: "application/json",
                source_url: captureUrl,
                retrieved_at: stamp,
                storage_key: storageKey,
                readback_sha256: raw,
              },
            ],
          ]),
          /object size/,
        );
        await capture(id);
        await assert.rejects(
          rpc("corpus_regulatory_intake_v1", [
            id,
            [{ ...envelope(record()), payload_sha256: "a".repeat(64) }],
          ]),
          /canonical payload hash/,
        );
        await assert.rejects(
          intake(
            id,
            record("2026-00001", { source_url: "https://www.federalregister.gov.evil.test/foo" }),
          ),
          /source record/,
        );
        await assert.rejects(
          rpc("corpus_regulatory_intake_v1", [
            id,
            [
              {
                ...envelope(record()),
                capture_source_url: "https://www.federalregister.gov/unretained",
              },
            ],
          ]),
          /exact retained capture/,
        );
        await intake(id, record());
        const before = await rpc("corpus_regulatory_query_v1", [{}]);
        assert.equal(before.total, 0, "open run stays private");
        await finish(id);
        initialId = id;
        const page = await rpc("corpus_regulatory_query_v1", [{}]);
        eventId = page.items[0].id;
        assert.equal(page.items[0].eventType, "initial_record");
        assert.equal(page.items[0].record.fields.action, "Proposal");
      },
    );
    await t.test(
      "replay preserves versions without duplicated events or late finalized writes",
      async () => {
        await finish(initialId);
        await assert.rejects(intake(initialId, record()), /not open/);
        await ingest(record(), "incremental", "2026-01-02T12:00:00Z");
        assert.equal((await rpc("corpus_regulatory_query_v1", [{}])).total, 1);
        const detail = await rpc("corpus_regulatory_detail_v1", [source, "2026-00001"]);
        assert.equal(detail.versions.length, 1);
        assert.match(detail.versions[0].lastObservedAt, /2026-01-02/);
      },
    );
    await t.test(
      "changed fields and explicit corrections retain previous source versions",
      async () => {
        await ingest(
          record("2026-00001", { status: "Corrected", correction_of: ["2025-99999"] }),
          "incremental",
          "2026-01-03T12:00:00Z",
        );
        const page = await rpc("corpus_regulatory_query_v1", [{ eventType: "correction" }]);
        changedEventId = page.items[0].id;
        assert.equal(page.total, 1);
        assert.deepEqual(page.items[0].changedFields, ["correction_of", "status"]);
        assert.equal(page.items[0].previousPayloadSha256, sha(canonical(record())));
        assert.equal(
          (await rpc("corpus_regulatory_detail_v1", [source, "2026-00001"])).versions.length,
          2,
        );
      },
    );
    await t.test(
      "failed coverage never publishes records and cannot claim completed expected totals",
      async () => {
        const id = randomUUID();
        await open(id, "incremental", 2);
        await capture(id);
        await intake(id, record("2026-00002"));
        await assert.rejects(finish(id), /Exact source count/);
        await finish(id, "partial");
        assert.equal(await rpc("corpus_regulatory_detail_v1", [source, "2026-00002"]), null);
        const overview = await rpc("corpus_regulatory_overview_v1");
        assert.equal(overview.runs.find((x) => x.id === id).status, "partial");
        assert.equal(overview.sources.find((x) => x.id === "cpsc_recalls").latestCompletedAt, null);
      },
    );
    await t.test(
      "historical backfill and publication date filtering are distinct from detection",
      async () => {
        await ingest(
          record("2024-00003", { published_on: "2024-02-01" }),
          "backfill",
          "2026-01-04T12:00:00Z",
        );
        const page = await rpc("corpus_regulatory_query_v1", [
          { eventType: "backfill", dateBasis: "published", from: "2024-02-01", to: "2024-02-01" },
        ]);
        assert.equal(page.total, 1);
        assert.equal(page.dateBasis, "published");
        assert.equal(
          (
            await rpc("corpus_regulatory_query_v1", [
              { dateBasis: "detected", from: "2024-02-01", to: "2024-02-01" },
            ])
          ).total,
          0,
        );
        const trend = await rpc("corpus_regulatory_trends_v1", [
          { from: "2024-02-01", to: "2024-02-02", dateBasis: "published" },
        ]);
        assert.equal(trend.points[0].initialRecords, 1);
        assert.match(trend.qualification, /not incidents/);
        await assert.rejects(
          rpc("corpus_regulatory_trends_v1", [{ from: "2020-01-01", to: "2026-01-01" }]),
          /Bounded trend/,
        );
      },
    );
    await t.test(
      "entity namespace is exact; text search is literal and source family is explicit",
      async () => {
        assert.equal(
          (
            await rpc("corpus_regulatory_query_v1", [
              { entityNamespace: "unrelated:agency", entityId: "54" },
            ])
          ).total,
          0,
        );
        assert.equal(
          (
            await rpc("corpus_regulatory_query_v1", [
              { entityNamespace: "federal_register:agency", entityId: "54" },
            ])
          ).total,
          3,
        );
        assert.equal((await rpc("corpus_regulatory_query_v1", [{ q: "%" }])).total, 0);
        assert.equal((await rpc("corpus_regulatory_query_v1", [{ sourceFamily: "fda" }])).total, 0);
        assert.equal((await rpc("corpus_regulatory_entities_v1", [{}])).items[0].records, 2);
        await assert.rejects(
          rpc("corpus_regulatory_query_v1", [{ entityId: "54" }]),
          /Invalid bounded/,
        );
      },
    );
    await t.test(
      "public evidence is source-pinned, read-only and refuses missing or duplicate events",
      async () => {
        const before = await db.query(
          "select (select count(*) from corpus_regulatory_workspace.investigations) investigations, (select count(*) from corpus_regulatory_workspace.briefs) briefs",
        );
        const snapshot = await rpc("corpus_regulatory_evidence_v1", [
          [eventId, changedEventId],
          {},
        ]);
        assert.equal(snapshot.manifestSha256, sha(canonical(snapshot.manifest)));
        assert.equal(snapshot.manifest.title, "Regulatory source evidence");
        assert.equal(snapshot.manifest.events.length, 2);
        assert.equal(snapshot.manifest.coverageRuns.length, 2);
        assert.ok(
          snapshot.manifest.coverageRuns.every(
            (r) => r.status === "completed" && r.observedCount === r.expectedCount,
          ),
        );
        const prior = snapshot.manifest.evidence.find((e) => e.eventId === eventId);
        assert.equal(prior.rawSha256, raw);
        assert.equal(prior.captureSourceUrl, captureUrl);
        assert.equal(prior.payloadSha256, sha(canonical(record())));
        assert.equal(
          prior.currentPayloadSha256,
          snapshot.manifest.events.find((e) => e.id === changedEventId).payloadSha256,
        );
        assert.deepEqual(
          (
            await db.query(
              "select (select count(*) from corpus_regulatory_workspace.investigations) investigations, (select count(*) from corpus_regulatory_workspace.briefs) briefs",
            )
          ).rows,
          before.rows,
        );
        await assert.rejects(
          rpc("corpus_regulatory_evidence_v1", [[eventId, eventId], {}]),
          /exactly once/,
        );
        await assert.rejects(
          rpc("corpus_regulatory_evidence_v1", [["f".repeat(64)], {}]),
          /exactly once/,
        );
        await assert.rejects(rpc("corpus_regulatory_evidence_v1", [[], {}]), /Bounded exact/);
        await assert.rejects(
          rpc("corpus_regulatory_evidence_v1", [
            [eventId],
            { privateNote: "must not be accepted" },
          ]),
          /Invalid bounded/,
        );
        const overview = await rpc("corpus_regulatory_overview_v1");
        assert.equal(overview.sources.find((s) => s.id === "nhtsa_communications").enabled, false);
        assert.match(
          overview.sources.find((s) => s.id === "cpsc_recalls").qualification,
          /RSS.*not a complete/,
        );
        assert.match(
          overview.sources.find((s) => s.id === "openfda_enforcement_drug").qualification,
          /without a published recall number/,
        );
        assert.equal(
          (
            await db.query(
              "select has_function_privilege('anon','public.corpus_regulatory_evidence_v1(jsonb,jsonb)','EXECUTE') a",
            )
          ).rows[0].a,
          false,
        );
      },
    );
    await t.test("public and authenticated roles have no table or RPC privileges", async () => {
      const r = await db.query(
        "select has_function_privilege('anon','public.corpus_regulatory_query_v1(jsonb)','EXECUTE') a,has_function_privilege('authenticated','public.corpus_regulatory_workspace_write_v1(text,uuid,uuid,text,jsonb)','EXECUTE') w,has_table_privilege('authenticated','corpus_regulatory_workspace.memberships','SELECT') m",
      );
      assert.deepEqual(r.rows[0], { a: false, w: false, m: false });
      const bad = await db.query(
        "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'corpus_regulatory_%' and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=\"\"'],false))",
      );
      assert.equal(bad.rows.length, 0);
    });
    await t.test(
      "administrative recovery reads an exact run without the overview history limit",
      async () => {
        const overview = await rpc("corpus_regulatory_overview_v1");
        const expected = overview.runs.find((r) => r.id === initialId);
        assert.ok(expected);
        assert.deepEqual(await rpc("corpus_regulatory_run_v1", [initialId]), expected);
        assert.equal(await rpc("corpus_regulatory_run_v1", [randomUUID()]), null);
        // Move the requested run outside the overview's last-100 window without altering its scope.
        for (let i = 0; i < 101; i++) {
          const run = randomUUID();
          await open(run, "incremental", 0);
          await finish(run, "failed", 0);
        }
        assert.ok(
          !(await rpc("corpus_regulatory_overview_v1")).runs.some((r) => r.id === initialId),
        );
        assert.deepEqual(await rpc("corpus_regulatory_run_v1", [initialId]), expected);
        assert.deepEqual(
          (
            await db.query(
              "select has_function_privilege('anon','public.corpus_regulatory_run_v1(uuid)','EXECUTE') a,has_function_privilege('authenticated','public.corpus_regulatory_run_v1(uuid)','EXECUTE') u,has_function_privilege('service_role','public.corpus_regulatory_run_v1(uuid)','EXECUTE') s",
            )
          ).rows[0],
          { a: false, u: false, s: true },
        );
      },
    );
    await t.test(
      "issuer-bound membership, cross-organization denial, immutable reviews and reproducible briefs",
      async () => {
        const org = randomUUID(),
          other = randomUUID(),
          user = randomUUID(),
          viewer = randomUUID(),
          issuer = "https://auth.example.test";
        assert.deepEqual(await rpc("corpus_regulatory_workspace_access_v1", [issuer, user]), []);
        await rpc("corpus_regulatory_admin_membership_v1", [
          org,
          "Offline firm",
          issuer,
          user,
          "analyst",
          true,
          "Operator verified exact provider UUID offline",
        ]);
        await rpc("corpus_regulatory_admin_membership_v1", [
          org,
          "Offline firm",
          issuer,
          viewer,
          "viewer",
          true,
          "Read-only fixture",
        ]);
        await assert.rejects(
          rpc("corpus_regulatory_workspace_read_v1", ["https://wrong.example.test", user, org]),
          /access denied/,
        );
        await assert.rejects(
          rpc("corpus_regulatory_workspace_read_v1", [issuer, user, other]),
          /access denied/,
        );
        await assert.rejects(
          rpc("corpus_regulatory_workspace_write_v1", [
            issuer,
            viewer,
            org,
            "investigation",
            { title: "x", description: "x" },
          ]),
          /access denied/,
        );
        const investigation = await rpc("corpus_regulatory_workspace_write_v1", [
          issuer,
          user,
          org,
          "investigation",
          { title: "Private matter", description: "Offline confidential notes" },
        ]);
        const watch = await rpc("corpus_regulatory_workspace_write_v1", [
          issuer,
          user,
          org,
          "watchlist",
          {
            name: "Exact agency",
            investigationId: investigation.id,
            query: { entityNamespace: "federal_register:agency", entityId: "54" },
          },
        ]);
        assert.equal(watch.investigationId, investigation.id);
        await assert.rejects(
          rpc("corpus_regulatory_workspace_write_v1", [
            issuer,
            user,
            org,
            "watchlist",
            { name: "bad", investigationId: randomUUID(), query: {} },
          ]),
          /not accessible/,
        );
        const review = await rpc("corpus_regulatory_workspace_write_v1", [
          issuer,
          user,
          org,
          "review",
          {
            eventId,
            status: "relevant",
            note: "Review exact prior version",
            investigationId: investigation.id,
          },
        ]);
        assert.equal(review.needsReconsideration, true);
        await assert.rejects(
          rpc("corpus_regulatory_workspace_write_v1", [
            issuer,
            user,
            org,
            "review",
            { id: review.id, eventId, status: "dismissed", note: "overwrite" },
          ]),
          /Append-only/,
        );
        const brief = await rpc("corpus_regulatory_workspace_write_v1", [
          issuer,
          user,
          org,
          "brief",
          {
            title: "Pinned source brief",
            eventIds: [eventId, changedEventId],
            query: {},
            investigationId: investigation.id,
          },
        ]);
        assert.equal(sha(canonical(brief.manifest)), brief.manifestSha256);
        assert.equal(brief.manifest.events.length, 2);
        assert.equal(brief.manifest.evidence.length, 2);
        assert.equal(brief.manifest.evidence[0].rawSha256, raw);
        assert.equal(brief.manifest.evidence[0].recordPointer, "results[0]");
        assert.equal(brief.manifest.sources[0].id, source);
        assert.match(brief.manifest.sources[0].qualification, /continuous/);
        assert.equal(brief.manifest.coverageRuns.length, 2);
        assert.ok(brief.manifest.coverageRuns.every((r) => r.status === "completed"));
        const workspace = await rpc("corpus_regulatory_workspace_read_v1", [issuer, user, org]);
        assert.equal(workspace.briefs[0].manifest, undefined);
        assert.equal(workspace.reviews[0].needsReconsideration, true);
        assert.deepEqual(
          await rpc("corpus_regulatory_brief_read_v1", [issuer, user, org, brief.id]),
          brief,
        );
        await rpc("corpus_regulatory_admin_membership_v1", [
          org,
          "Offline firm",
          issuer,
          user,
          "analyst",
          false,
          "Membership revoked",
        ]);
        await assert.rejects(
          rpc("corpus_regulatory_brief_read_v1", [issuer, user, org, brief.id]),
          /access denied/,
        );
        const publicData = await rpc("corpus_regulatory_overview_v1");
        assert.ok(!JSON.stringify(publicData).includes("Private matter"));
      },
    );
    await t.test(
      "a repeated A to B transition in a later collection is a new occurrence, not a duplicate",
      async () => {
        const a = record("2026-cycle", { title: "Version A" }),
          b = record("2026-cycle", { title: "Version B" });
        await ingest(a, "incremental", "2026-01-10T12:00:00Z");
        await ingest(b, "incremental", "2026-01-11T12:00:00Z");
        await ingest(a, "incremental", "2026-01-12T12:00:00Z");
        const finalRun = await ingest(b, "incremental", "2026-01-13T12:00:00Z");
        await finish(finalRun);
        const detail = await rpc("corpus_regulatory_detail_v1", [source, "2026-cycle"]);
        assert.equal(detail.events.length, 4);
        assert.equal(new Set(detail.events.map((e) => e.id)).size, 4);
        assert.equal(detail.versions.length, 2);
        assert.equal(detail.record.title, "Version B");
      },
    );
    await t.test(
      "staged failed revisions never leak through public detail or replace the current record",
      async () => {
        const id = randomUUID();
        await open(id, "incremental", 2);
        await capture(id, "2026-01-14T12:00:00Z");
        await intake(
          id,
          record("2026-cycle", { title: "UNRELEASED FAILED REVISION" }),
          "2026-01-14T12:00:00Z",
        );
        await finish(id, "failed");
        const detail = await rpc("corpus_regulatory_detail_v1", [source, "2026-cycle"]);
        assert.equal(detail.record.title, "Version B");
        assert.equal(detail.versions.length, 2);
        assert.ok(!JSON.stringify(detail).includes("UNRELEASED FAILED REVISION"));
      },
    );
    await t.test(
      "an older dated backfill is retained without replacing a newer source revision",
      async () => {
        await ingest(
          record("2026-dated", {
            source_updated_on: "2026-01-20",
            title: "Current source revision",
          }),
          "incremental",
          "2026-01-21T12:00:00Z",
        );
        await ingest(
          record("2026-dated", {
            source_updated_on: "2025-01-20",
            title: "Older archived source revision",
          }),
          "backfill",
          "2026-01-22T12:00:00Z",
        );
        const detail = await rpc("corpus_regulatory_detail_v1", [source, "2026-dated"]);
        assert.equal(detail.record.title, "Current source revision");
        assert.equal(detail.versions.length, 2);
        assert.equal(detail.events.length, 1);
      },
    );
    await t.test(
      "run lease and replay bind source selection and expected count exactly",
      async () => {
        const id = randomUUID();
        await open(id, "incremental", 0);
        await assert.rejects(open(randomUUID(), "incremental", 0), /already running/);
        await assert.rejects(open(id, "backfill", 0), /conflicting scope/);
        await capture(id);
        await finish(id, "completed", 0);
        const query = await rpc("corpus_regulatory_query_v1", [
          { sourceFamily: "federal_register", limit: 2, offset: 0 },
        ]);
        assert.equal(query.items.length, 2);
        assert.equal(query.nextOffset, 2);
        assert.equal(
          (await rpc("corpus_regulatory_entities_v1", [{ sourceFamily: "fda" }])).total,
          0,
        );
        await assert.rejects(rpc("corpus_regulatory_query_v1", [{ q: 123 }]), /Invalid bounded/);
        await assert.rejects(
          rpc("corpus_regulatory_query_v1", [{ limit: "10" }]),
          /Invalid bounded/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
