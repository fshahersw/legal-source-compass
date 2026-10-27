// Isolated PostgreSQL contract tests for database/contracts/corpus-pdf-assets-v2.sql and its rollback.
// No credentials, network or live corpus: a throwaway in-memory PGlite database with synthetic rows.
// Run: node --test scripts/admin/corpus-pdf-assets-v2.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const sha1 = (v) => createHash("sha1").update(v).digest("hex");
const read = (p) => fs.readFile(p, "utf8").then((t) => t.replace(/\r\n/g, "\n"));

const V1_TABLES = (await read("database/contracts/corpus-pdf-assets-v1.sql")).split("create or replace function public.corpus_admin_register_pdf_assets_v1")[0];
const V2 = await read("database/contracts/corpus-pdf-assets-v2.sql");
const ROLLBACK = await read("database/contracts/corpus-pdf-assets-v2.rollback.sql");
const LOCAL = await read("database/contracts/corpus-local-bundle-pdf-assets-v1.sql");

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema corpus_ingest; create schema storage; create schema auth; create schema extensions;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
create function extensions.digest(p bytea, alg text) returns bytea language sql immutable as $$ select sha256(p) $$;
create function corpus_ingest.canonical_integer_jsonb_sha256_v1(p jsonb) returns text language sql immutable as $$ select encode(sha256(convert_to(p::text,'UTF8')),'hex') $$;
create table storage.buckets (id text primary key, public boolean not null);
create table storage.objects (bucket_id text, name text, metadata jsonb);
insert into storage.buckets values ('corpus-originals', false);
select set_config('request.jwt.claim.role', 'service_role', false);
`;

const key = (h) => `seeger-weiss/pdf-sha256/${h.slice(0, 2)}/${h}.pdf`;
function base(seed, provider, extra) {
  const h = sha("pdf-" + seed);
  const rec = sha("rec-" + seed);
  return {
    state: "cloud_verified",
    project_id: "xosqzzsnhxcyehcnirpa",
    bucket: "corpus-originals",
    provider,
    sha256: h,
    sha1: sha1("pdf-" + seed),
    bytes: "1234",
    selected_source_record_sha256: rec,
    queue_sha256: sha("queue"),
    storage_key: key(h),
    verified_at: "2026-10-02T00:00:00Z",
    ...extra(rec),
  };
}
const locator = (seed) =>
  base(seed, "courtlistener-public-locator", (rec) => {
    const url = `https://storage.courtlistener.com/recap/gov.uscourts.nysd.${seed}/1.pdf`;
    return {
      native_document_id: url,
      durable_url: url,
      native_document_identity_kind: "publisher_observed_pdf_locator_url",
      native_case_id: "123",
      provider_flags: { public_pdf_link_observed: true, sealing_related_locator_held: false, backend_api_id_verified: false, api_availability_verified: false },
      source_origins: [{ native_record_sha256: rec, source_response_sha256: sha("resp"), retrieved_at: "2026-10-01T00:00:00Z", native_case_id: "123" }],
      // what the queue builders attach today (scripts/ingest/backfill-pdfs-to-supabase.mjs sourcePrivacyQualification)
      source_privacy_qualification: { source_seal_status: "unknown", private_quarantine_required: true, public_projection_allowed: false },
    };
  });
const docketbird = (seed, flags = { restricted: false, downloaded: 1 }) =>
  base(seed, "docketbird", (rec) => ({
    native_document_id: "c-abc-000" + seed.length,
    durable_url: null,
    native_case_id: "c-abc",
    provider_flags: flags,
    source_origins: [{ native_record_sha256: rec, source_sha256: sha("resp"), retrieved_at: "2026-10-01T00:00:00Z", native_case_id: "c-abc" }],
  }));
const courtlistener = (seed, flags) =>
  base(seed, "courtlistener", (rec) => ({
    native_document_id: "77",
    durable_url: null,
    native_case_id: "55",
    provider_flags: flags,
    source_origins: [{ native_record_sha256: rec, source_sha256: sha("resp"), retrieved_at: "2026-10-01T00:00:00Z" }],
  }));

async function db(contract) {
  const pg = new PGlite();
  await pg.exec(MOCK);
  await pg.exec(V1_TABLES);
  await pg.exec(LOCAL.split("create or replace function public.corpus_admin_register_local_bundle_pdf_assets_v1")[0]);
  await pg.exec(contract);
  return pg;
}
async function register(pg, row) {
  await pg.query("insert into storage.objects values ('corpus-originals', $1, $2)", [row.storage_key, { size: Number(row.bytes) }]);
  return pg.query("select public.corpus_admin_register_pdf_assets_v1($1) as r", [JSON.stringify([row])]);
}
const observations = async (pg) => (await pg.query("select observation from corpus_ingest.pdf_asset_observations order by registered_at, observation_sha256")).rows.map((r) => r.observation);

test("v2 records the source seal status only: no quarantine or projection verdict, queue-carried qualification dropped", async () => {
  const pg = await db(V2);
  const r = await register(pg, locator("a"));
  assert.equal(r.rows[0].r.received, 1);
  const [obs] = await observations(pg);
  assert.equal(obs.source_seal_status, "unknown");
  assert.equal("source_privacy_qualification" in obs, false);
  assert.equal(JSON.stringify(obs).includes("private_quarantine_required"), false);
  assert.equal(JSON.stringify(obs).includes("public_projection_allowed"), false);
  await pg.close();
});

test("v2 keeps the explicit provider statuses", async () => {
  const pg = await db(V2);
  await register(pg, docketbird("b"));
  await register(pg, courtlistener("c", { is_available: true, is_sealed: false }));
  const seals = (await observations(pg)).map((o) => o.source_seal_status).sort();
  assert.deepEqual(seals, ["explicit_false", "provider_restricted_false"]);
  await pg.close();
});

test("v2 leaves every validation branch in place (explicit seal or restriction still refused)", async () => {
  const pg = await db(V2);
  await assert.rejects(register(pg, courtlistener("d", { is_available: true, is_sealed: true })), /Unavailable CourtListener original/);
  await assert.rejects(register(pg, docketbird("e", { restricted: true, downloaded: 1 })), /DocketBird parent or availability mismatch/);
  const bad = locator("f");
  bad.provider_flags = { ...bad.provider_flags, sealing_related_locator_held: true };
  await assert.rejects(register(pg, bad), /Observed public RECAP locator identity required/);
  await pg.query("select set_config('request.jwt.claim.role', 'anon', false)");
  await assert.rejects(register(pg, locator("g")), /Service role required/);
  await pg.close();
});

test("rollback restores the v1 annotation exactly", async () => {
  const pg = await db(V2);
  await pg.exec(ROLLBACK);
  await register(pg, locator("h"));
  const [obs] = await observations(pg);
  assert.deepEqual(obs.source_privacy_qualification, { source_seal_status: "unknown", private_quarantine_required: true, public_projection_allowed: false });
  const c = await pg.query("select obj_description('corpus_ingest.pdf_asset_observations'::regclass,'pg_class') as t");
  assert.equal(c.rows[0].t, null);
  await pg.close();
});

test("v2 comments mark the stored annotations as history, not holds", async () => {
  const pg = await db(V2);
  const c = await pg.query(`select obj_description('corpus_ingest.pdf_asset_observations'::regclass,'pg_class') as t,
    col_description('corpus_ingest.local_pdf_asset_occurrences'::regclass, (select attnum from pg_attribute where attrelid='corpus_ingest.local_pdf_asset_occurrences'::regclass and attname='private_quarantine_required')) as q`);
  assert.match(c.rows[0].t, /not a hold/);
  assert.match(c.rows[0].q, /Not a hold/);
  await pg.close();
});

test("v2 body differs from the live body only in the qualification block and one comment", async () => {
  const body = (t) => t.slice(t.indexOf("AS $function$"), t.indexOf("end $function$;")).split("\n");
  const a = body(ROLLBACK);
  const b = body(V2);
  const removed = a.filter((l) => !b.includes(l));
  const added = b.filter((l) => !a.includes(l));
  assert.equal(removed.length, 6);
  assert.ok(removed.some((l) => l.includes("'public_projection_allowed',false));")));
  assert.ok(added.every((l) => l.trim().startsWith("--") || l.includes("stored_observation:=(row-'source_privacy_qualification')")));
});

test("no served reader gates on the PDF annotation keys", async () => {
  const { execFileSync } = await import("node:child_process");
  const hits = execFileSync("git", ["grep", "-l", "-e", "source_privacy_qualification", "-e", "private_quarantine_required", "--", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
  // the documents contract test only builds the mock table; it never filters on these columns
  assert.deepEqual(hits, ["src/lib/documents/contract.test.mjs"]);
});
