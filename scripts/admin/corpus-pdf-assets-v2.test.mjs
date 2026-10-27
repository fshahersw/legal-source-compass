// Isolated PostgreSQL contract tests for database/contracts/corpus-pdf-assets-v2.sql (comments only) and its rollback.
// No credentials, network or live corpus: a throwaway in-memory PGlite database.
// Run: node --test scripts/admin/corpus-pdf-assets-v2.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
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
`;

async function db() {
  const pg = new PGlite();
  await pg.exec(MOCK);
  await pg.exec(V1_TABLES);
  await pg.exec(LOCAL.split("create or replace function public.corpus_admin_register_local_bundle_pdf_assets_v1")[0]);
  return pg;
}
const COMMENTS = `select obj_description('corpus_ingest.pdf_asset_observations'::regclass,'pg_class') as t,
  (select array_agg(col_description('corpus_ingest.local_pdf_asset_occurrences'::regclass, a.attnum) order by a.attname)
     from pg_attribute a where a.attrelid = 'corpus_ingest.local_pdf_asset_occurrences'::regclass
      and a.attname in ('private_quarantine_required', 'public_projection_allowed', 'source_seal_status')) as c`;

test("the contract only sets comments: no function, no data", () => {
  const sql = V2.replace(/^--.*$/gm, "");
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function|insert\s|update\s|delete\s|alter\s|drop\s/i);
  assert.equal((sql.match(/comment on /gi) || []).length, 4);
});

test("comments mark the stored annotations as history, not holds, and describe the live v2 label", async () => {
  const pg = await db();
  await pg.exec(V2);
  const { rows: [r] } = await pg.query(COMMENTS);
  assert.match(r.t, /not a hold/);
  assert.match(r.t, /corpus_pdf_availability_v2/);
  assert.match(r.t, /corpus_pdf_availability_v1/);
  assert.equal(r.c.length, 3);
  assert.ok(r.c.every(Boolean));
  assert.match(r.c[0], /Not a hold/);
  await pg.exec(V2); // idempotent
  await pg.close();
});

test("rollback resets the four comments to NULL", async () => {
  const pg = await db();
  await pg.exec(V2);
  await pg.exec(ROLLBACK);
  const { rows: [r] } = await pg.query(COMMENTS);
  assert.equal(r.t, null);
  assert.deepEqual(r.c, [null, null, null]);
  await pg.close();
});

test("no served reader gates on the PDF annotation keys", (t) => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  } catch {
    t.skip("not a git work tree");
    return;
  }
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-l", "-e", "source_privacy_qualification", "-e", "private_quarantine_required", "--", "src"], { encoding: "utf8" });
  } catch (e) {
    if (e.status !== 1) throw e; // git grep exits 1 when nothing matches: that is a pass
  }
  const hits = out.split("\n").filter(Boolean);
  // the documents contract test only builds the mock table; it never filters on these columns
  assert.ok(hits.every((h) => h === "src/lib/documents/contract.test.mjs"), hits.join(", "));
});
