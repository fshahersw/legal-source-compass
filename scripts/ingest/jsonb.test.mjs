// jsonbText equals PostgreSQL's jsonb::text (pglite), on synthetic edge cases and on the recorded golden rows.
//   node --test scripts/ingest/jsonb.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jsonbText } from "./jsonb.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);

const cases = [
  null,
  true,
  false,
  0,
  -1,
  12345678901,
  0.5,
  2.25,
  "",
  "plain",
  'quote " back \\ slash',
  "tab\tnew\nline\rcr\bbs\fff",
  "ctrl \u0001\u001f del \u007f",
  "non-ASCII é ü ☃ 𝄞  ",
  [],
  {},
  [1, "a", null, [true, {}]],
  { b: 1, a: 2, aa: 3, ab: 4, B: 5, é: 6, z: { y: [], x: {} } },
  { id: "x", title: "t", text: "", filters: { _listing: ["yes"] } },
];

test("jsonbText equals PostgreSQL jsonb::text", { timeout: 120000 }, async (t) => {
  const db = new PGlite();
  const pg = async (v) =>
    (await db.query("select ($1::text)::jsonb::text as t", [JSON.stringify(v)])).rows[0].t;
  try {
    await t.test("edge cases", async () => {
      for (const v of cases) assert.equal(jsonbText(v), await pg(v), JSON.stringify(v));
    });
    for (const file of ["cpsc-rows.json", "hsr-rows.json"]) {
      await t.test(`golden rows ${file}`, async () => {
        const g = JSON.parse(await fs.readFile(`src/lib/ingest/fixtures/golden/${file}`, "utf8"));
        for (const row of g.rows) assert.equal(jsonbText(row), await pg(row), row.id);
      });
    }
    await t.test("recorded source records", async () => {
      for (const file of [
        "cpsc-recalls.json",
        "federal-register-2026-10-23.json",
        "ftc-hsr-pages.json",
      ]) {
        const v = JSON.parse(await fs.readFile(`src/lib/ingest/fixtures/${file}`, "utf8"));
        assert.equal(jsonbText(v), await pg(v), file);
      }
    });
    await t.test("refuses an exponent number", () => {
      assert.throws(() => jsonbText(1e-7), /no exact jsonb text form/);
    });
  } finally {
    await db.close();
  }
});
