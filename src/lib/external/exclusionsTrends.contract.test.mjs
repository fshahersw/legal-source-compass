// Isolated PostgreSQL contract test for database/contracts/exclusions-trends-v1.sql. No credentials, network or live
// corpus: a throwaway in-memory PGlite database with public.corpus_records, filled with synthetic rows (undated,
// malformed, impossible, future-dated and empty-classification dates), then the RPC output is run through the
// TypeScript parser (src/lib/external/enforcementExclusions.ts, transpiled here with the repository's TypeScript).
// Run: node --test src/lib/external/exclusionsTrends.contract.test.mjs   (from the repository root; needs the PGlite
// runtime at private/tools/publisher-code-contract-tests or PUBLISHER_CODE_PGLITE, like the other test:sql suites)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const ts = (await import("typescript")).default;

async function importTs(file) {
  const source = await fs.readFile(file, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
}
const { parseExclusionTrends } = await importTs("src/lib/external/enforcementExclusions.ts");

const AS_OF = "2026-10-27";

const MOCK = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_records (dataset text, id text, title text, source_url text, item jsonb, detail jsonb,
  filters jsonb, ordinal bigint, primary key (dataset, id));
`;

const leie = (id, cells) => ({ dataset: "oig_leie_exclusions", id, item: { cells } });
const sam = (id, cells) => ({ dataset: "sam_exclusions", id, item: { cells } });
const RECORDS = [
  leie("l1", { excluded: "2025-03-01", code: "1128a1", name: "NOT RETURNED" }),
  leie("l2", { excluded: "2025-05-01", code: "1128a1" }),
  leie("l3", { excluded: "2025-06-01", code: "1128b7" }), // an authority without its own band
  leie("l4", { excluded: "2025-07-01", code: "" }), // empty code: counted as not recorded
  leie("l5", { excluded: "2024-02-30", code: "1128a3" }), // impossible date: compared as text, counted in 2024
  leie("l6", { excluded: "2024/01/01", code: "1128a3" }), // malformed: undated
  leie("l7", { code: "1128a4" }), // no date: undated
  leie("l8", { excluded: "2027-01-01", code: "1128a4" }), // after as-of: future, never charted
  leie("l9", { excluded: "2026-10-27", code: "1128a4" }), // on as-of: counted, partial year
  sam("s1", { active: "2025-01-02", classification: "Firm" }),
  sam("s2", { active: "2025-02-03", classification: "Individual" }),
  sam("s3", { active: "2025-04-05", classification: "" }),
  sam("s4", { active: "2099-12-30", classification: "Firm" }),
  sam("s5", { active: "2084-01-01", classification: "Vessel" }),
  sam("s6", { classification: "Firm" }),
  // other datasets are never read
  {
    dataset: "npdb_mmpr",
    id: "x1",
    item: { cells: { excluded: "2025-01-01", active: "2025-01-01" } },
  },
];

async function db() {
  const pg = new PGlite();
  await pg.exec(MOCK);
  for (const r of RECORDS)
    await pg.query(
      "insert into public.corpus_records (dataset, id, title, item) values ($1, $2, $2, $3)",
      [r.dataset, r.id, r.item],
    );
  await pg.exec(await fs.readFile("database/contracts/exclusions-trends-v1.sql", "utf8"));
  return pg;
}

const run = async (pg) =>
  (await pg.query("select public.exclusions_trends_v1($1::date) as r", [AS_OF])).rows[0].r;

test("counts by year and group, with undated, future and impossible dates handled", async () => {
  const pg = await db();
  const r = await run(pg);
  assert.equal(r.as_of, AS_OF);
  assert.deepEqual(r.leie, [
    { year: "2024", group: "1128a3", n: 1 },
    { year: "2025", group: "1128a1", n: 2 },
    { year: "2025", group: "1128b7", n: 1 },
    { year: "2025", group: "not_recorded", n: 1 },
    { year: "2026", group: "1128a4", n: 1 },
  ]);
  assert.equal(r.leie_total, 9);
  assert.equal(r.leie_undated, 2);
  assert.equal(r.leie_future, 1);
  assert.deepEqual(r.sam, [
    { year: "2025", group: "Firm", n: 1 },
    { year: "2025", group: "Individual", n: 1 },
    { year: "2025", group: "not_recorded", n: 1 },
  ]);
  assert.equal(r.sam_total, 6);
  assert.equal(r.sam_undated, 1);
  assert.equal(r.sam_future, 2);
  // counts only: no name or identifier leaves the function
  assert.equal(JSON.stringify(r).includes("NOT RETURNED"), false);
  assert.equal(JSON.stringify(r).includes('"l1"'), false);
});

test("the parser charts every dated year up to as-of, flags the as-of year partial and bands other codes", async () => {
  const pg = await db();
  const t = parseExclusionTrends(await run(pg));
  assert.ok(t);
  assert.deepEqual(
    t.leie.map((y) => [y.year, y.partial, y.total]),
    [
      ["2024", false, 1],
      ["2025", false, 4],
      ["2026", true, 1],
    ],
  );
  const y2025 = t.leie.find((y) => y.year === "2025");
  assert.equal(y2025["1128a1"], 2);
  assert.equal(y2025.other, 2); // 1128b7 and the empty code
  assert.equal(t.samFuture, 2);
  assert.deepEqual(
    t.sam.map((y) => y.year),
    ["2025"],
  );
});

test("a null as-of means today", async () => {
  const pg = await db();
  const r = (await pg.query("select public.exclusions_trends_v1(null) as r")).rows[0].r;
  assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}$/);
});

test("security: definer, empty search_path, service_role only", async () => {
  const pg = await db();
  const fn = (
    await pg.query(
      "select prosecdef, proconfig, provolatile from pg_proc where proname = 'exclusions_trends_v1'",
    )
  ).rows[0];
  assert.equal(fn.prosecdef, true);
  assert.deepEqual(fn.proconfig, ['search_path=""']);
  assert.equal(fn.provolatile, "s");
  const can = async (role) =>
    (
      await pg.query(
        "select has_function_privilege($1, 'public.exclusions_trends_v1(date)', 'execute') as ok",
        [role],
      )
    ).rows[0].ok;
  assert.equal(await can("anon"), false);
  assert.equal(await can("authenticated"), false);
  assert.equal(await can("service_role"), true);
});

test("idempotent: applying the contract twice keeps one function", async () => {
  const pg = await db();
  await pg.exec(await fs.readFile("database/contracts/exclusions-trends-v1.sql", "utf8"));
  const n = (
    await pg.query("select count(*)::int as n from pg_proc where proname = 'exclusions_trends_v1'")
  ).rows[0].n;
  assert.equal(n, 1);
});
