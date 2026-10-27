#!/usr/bin/env node
/**
 * READ-ONLY parity gate for database/contracts/corpus-pdf-case-aliases-v2.sql (set-based body of
 * public.corpus_pdf_case_aliases_v1). It never writes to the database: it reads sw_matters_v1 and mdls through
 * PostgREST and calls two STABLE read RPCs (corpus_pdf_case_aliases_v1, and with --totals
 * corpus_matter_pdf_documents_v1 with p_limit 1).
 *
 * For each Seeger Weiss hub matter it builds the exact case-id plan the app builds (caseIdPlan from
 * src/lib/matters/registry.ts on the same registry record, derived keys from the MDL record), asks the alias RPC,
 * applies the app's acceptance rule (acceptsRegisteredCaseId, 50-id cap) and, with --totals, reads the PDF summary on
 * the expanded ids: the numbers the hub chip and the matter header show.
 *
 *   node scripts/admin/parity-pdf-case-aliases.mjs --write=PATH [--totals]     before applying v2: save a baseline
 *   node scripts/admin/parity-pdf-case-aliases.mjs --compare=PATH [--totals]   after applying v2: must match it
 *   node scripts/admin/parity-pdf-case-aliases.mjs [--totals]                  check against the 2026-10-27 fixture
 *   node scripts/admin/parity-pdf-case-aliases.mjs --self-check                offline check of the comparison logic
 *
 * Exit code 1 on any alias difference (against the fixture, or against the baseline with --compare) and on any total
 * difference against the baseline. Totals against the fixture are reported but only fail with --strict-totals (a PDF
 * intake legitimately moves them). Credentials: EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY from the
 * environment (the RPCs refuse any other role); they are never printed or written.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Alias ids the RPC returned per matter on 2026-10-27 (v1, and the v2 body run as a read-only SELECT). */
export const EXPECTED_ALIASES = {
  2545: ["MDL 2545", "ilnd-1:2014-cv-01748"],
  2592: ["laed-2:2014-md-02592"],
  2606: ["njd-1:2015-md-02606"],
  2782: ["1:17-md-2782"],
  2921: ["2:19-md-2921", "MDL 2921"],
  2789: ["MDL 2789"],
  2804: ["MDL 2804"],
  2846: ["MDL 2846"],
  2873: ["MDL 2873"],
  2885: ["MDL 2885"],
  2973: ["MDL 2973"],
  3014: ["MDL 3014"],
  3043: ["MDL 3043"],
  3080: ["MDL 3080"],
  3081: ["MDL 3081"],
  3108: ["MDL 3108"],
  3113: ["MDL 3113"],
  3140: ["MDL 3140"],
};

/** Hub PDF totals measured by the survey (aliases included). */
export const EXPECTED_TOTALS = {
  2738: { total: 37483, open: 31 },
  2741: { total: 24763, open: 1 },
  2804: { total: 15552, open: 236 },
  3081: { total: 9694, open: 9542 },
  3047: { total: 8302, open: 3900 },
  3180: { total: 46, open: 42 },
};
export const EXPECTED_ALL = { total: 144157, open: 34623 };

const sorted = (a) => [...(a ?? [])].map(String).sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/**
 * Differences between two runs (or a run and the fixture). `expected` and `actual` map an MDL number to
 * `{ aliases?: string[], totals?: {total, open, held?} | null }`. Matters absent from `expected` expect no aliases
 * when `allMatters` lists them.
 */
export function compareRuns(expected, actual, { allMatters = [], checkTotals = true } = {}) {
  const diffs = [];
  const mdls = new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
    ...allMatters.map(String),
  ]);
  for (const mdl of [...mdls].sort((a, b) => Number(a) - Number(b))) {
    const e = expected[mdl];
    const a = actual[mdl];
    if (!a) {
      diffs.push({ mdl, kind: "missing", detail: "not read in this run" });
      continue;
    }
    const want = e?.aliases ?? [];
    if (!same(want, a.aliases))
      diffs.push({ mdl, kind: "aliases", want: sorted(want), got: sorted(a.aliases) });
    if (checkTotals && e?.totals && a.totals) {
      for (const k of ["total", "open", "held"])
        if (e.totals[k] !== undefined && e.totals[k] !== a.totals[k])
          diffs.push({ mdl, kind: `totals.${k}`, want: e.totals[k], got: a.totals[k] });
    }
  }
  return diffs;
}

export function fixtureAsRun() {
  const out = {};
  for (const [mdl, aliases] of Object.entries(EXPECTED_ALIASES)) out[mdl] = { aliases };
  for (const [mdl, totals] of Object.entries(EXPECTED_TOTALS))
    out[mdl] = { ...(out[mdl] ?? { aliases: [] }), totals };
  return out;
}

async function selfCheck() {
  const fixture = fixtureAsRun();
  const all = ["2545", "2738", "3180", "9999"];
  const good = {
    2545: { aliases: ["ilnd-1:2014-cv-01748", "MDL 2545"] },
    2738: { aliases: [], totals: { total: 37483, open: 31, held: 37452 } },
    3180: { aliases: [], totals: { total: 46, open: 42, held: 4 } },
    9999: { aliases: [] },
  };
  const want = Object.fromEntries(all.filter((m) => fixture[m]).map((m) => [m, fixture[m]]));
  // The app's own plan builder and acceptance rule load and agree on a registry-shaped record.
  const app = await loadAppModules();
  const reg = app.registry.parseRegistryRecord(
    {
      title: "IN RE: Testosterone",
      cells: {},
      facts: [],
      registry: {
        schema: "sw-matter-registry/v1",
        mdl: "2545",
        pdf_case_ids: ["ilnd-1:14-cv-01748", "ilnd-1:14-cv-01748"],
      },
    },
    "2545",
  );
  const plan = app.registry.caseIdPlan(reg, []);
  const checks = [
    ["identical run passes", compareRuns(want, good, { allMatters: all }).length === 0],
    [
      "a lost alias fails",
      compareRuns(want, { ...good, 2545: { aliases: ["MDL 2545"] } }, { allMatters: all }).some(
        (d) => d.mdl === "2545" && d.kind === "aliases",
      ),
    ],
    [
      "an extra alias on a matter that expects none fails",
      compareRuns(want, { ...good, 9999: { aliases: ["MDL 9999"] } }, { allMatters: all })
        .length === 1,
    ],
    [
      "a moved total fails",
      compareRuns(
        want,
        { ...good, 2738: { aliases: [], totals: { total: 37482, open: 31 } } },
        {
          allMatters: all,
        },
      ).some((d) => d.kind === "totals.total"),
    ],
    [
      "totals can be ignored",
      compareRuns(
        want,
        { ...good, 2738: { aliases: [], totals: { total: 1, open: 1 } } },
        {
          allMatters: all,
          checkTotals: false,
        },
      ).length === 0,
    ],
    [
      "a matter not read fails",
      compareRuns(want, { 2545: good[2545] }, { allMatters: all }).length >= 1,
    ],
    [
      "the app plan builder loads and de-duplicates ids",
      plan.length === 1 && plan[0].basis === "registry",
    ],
    [
      "the app acceptance rule takes a formatting variant and this MDL's label only",
      app.variants.acceptsRegisteredCaseId(
        "ilnd-1:2014-cv-01748",
        ["ilnd-1:14-cv-01748"],
        "2545",
      ) &&
        app.variants.acceptsRegisteredCaseId("MDL 2545", ["ilnd-1:14-cv-01748"], "2545") &&
        !app.variants.acceptsRegisteredCaseId("MDL 2546", ["ilnd-1:14-cv-01748"], "2545"),
    ],
    ["the hub list has 38 matters", app.tiers.SW_MATTERS.length === 38],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  return checks.every(([, ok]) => ok);
}

/* ------------------------------------------------------------------ live run */

function creds() {
  const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY are required");
  const headers = { apikey: key, Accept: "application/json", "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { url, headers };
}

async function restGet(c, pathAndQuery) {
  const res = await fetch(`${c.url}/rest/v1/${pathAndQuery}`, { headers: c.headers });
  if (!res.ok) throw new Error(`GET ${pathAndQuery.split("?")[0]} failed (${res.status})`);
  return res.json();
}

async function rpc(c, fn, body) {
  const started = performance.now();
  const res = await fetch(`${c.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: c.headers,
    body: JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - started);
  if (!res.ok) throw new Error(`rpc ${fn} failed (${res.status})`);
  return { value: await res.json(), ms };
}

async function loadAppModules() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") } });
  const load = (p) => jiti.import(pathToFileURL(path.join(ROOT, p)).href);
  const [registry, keys, variants, tiers] = await Promise.all([
    load("src/lib/matters/registry.ts"),
    load("src/lib/matters/docketKeys.ts"),
    load("src/lib/matters/docketVariants.ts"),
    load("src/lib/matters/tiers.ts"),
  ]);
  return { registry, keys, variants, tiers };
}

async function liveRun({ totals }) {
  const c = creds();
  const app = await loadAppModules();
  const ids = app.tiers.SW_MATTERS.map((m) => String(m.mdl));
  const [regRows, mdlRows] = await Promise.all([
    restGet(
      c,
      "corpus_records?select=id,title,cells:item->cells,facts:detail->facts,registry:detail->registry&dataset=eq.sw_matters_v1&limit=200",
    ),
    restGet(
      c,
      `corpus_records?select=id,summary:detail->summary&dataset=eq.mdls&id=in.(${ids.join(",")})&limit=100`,
    ),
  ]);
  const registry = new Map();
  for (const row of regRows) {
    const mdl = /^sw-matter:(\d{1,6})$/.exec(row.id)?.[1];
    const parsed = mdl ? app.registry.parseRegistryRecord(row, mdl) : null;
    if (mdl && parsed) registry.set(mdl, parsed);
  }
  const summaries = new Map(mdlRows.map((r) => [r.id, r.summary]));
  const run = {};
  // Two at a time: the v1 body costs seconds per call, and this gate must not load the database.
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (next < ids.length) {
        const mdl = ids[next++];
        const s = summaries.get(mdl);
        const derived = s
          ? app.keys.matterCaseKeys(
              typeof s.cl_court_id === "string" ? s.cl_court_id : null,
              typeof s.master_docket === "string" ? s.master_docket : null,
            ).all
          : [];
        const plan = app.registry.caseIdPlan(registry.get(mdl) ?? null, derived);
        if (!plan.length) {
          run[mdl] = {
            asked: [],
            aliases: [],
            accepted: [],
            ms: null,
            totals: null,
            note: "no case-id plan",
          };
          continue;
        }
        const asked = plan.map((p) => p.id);
        const matter = app.variants.matterMdlNumber(mdl);
        const alias = await rpc(c, "corpus_pdf_case_aliases_v1", {
          p_case_ids: asked,
          p_mdl: matter,
        });
        const raw = Array.isArray(alias.value)
          ? alias.value.filter((x) => typeof x === "string")
          : [];
        // The app's acceptance rule and 50-id cap (source.server.ts expandRegisteredCaseIds).
        const queried = [...asked];
        const seen = new Set(asked);
        for (const id of raw) {
          if (queried.length >= 50) break;
          if (seen.has(id) || !app.variants.acceptsRegisteredCaseId(id, asked, matter)) continue;
          seen.add(id);
          queried.push(id);
        }
        let t = null;
        if (totals) {
          const page = await rpc(c, "corpus_matter_pdf_documents_v1", {
            p_native_case_ids: queried,
            p_limit: 1,
            p_offset: 0,
          });
          const sm = page.value?.summary ?? {};
          t = { total: sm.total ?? null, open: sm.open ?? null, held: sm.held ?? null };
        }
        run[mdl] = {
          asked,
          aliases: raw,
          accepted: queried.slice(asked.length),
          ms: alias.ms,
          totals: t,
        };
        process.stdout.write(".");
      }
    }),
  );
  process.stdout.write("\n");
  return { run, ids };
}

function report(run, ids) {
  let aliasMs = 0;
  let timed = 0;
  const sum = { total: 0, open: 0 };
  for (const mdl of ids) {
    const r = run[mdl];
    if (r?.ms != null) {
      aliasMs += r.ms;
      timed += 1;
    }
    if (r?.totals?.total != null) {
      sum.total += r.totals.total;
      sum.open += r.totals.open ?? 0;
    }
    console.log(
      `${mdl.padStart(5)}  ${String(r?.ms ?? "-").padStart(6)} ms  aliases=${JSON.stringify(sorted(r?.aliases))}${
        r?.totals ? `  pdf total=${r.totals.total} open=${r.totals.open}` : ""
      }`,
    );
  }
  console.log(`alias calls: ${timed}, mean ${timed ? Math.round(aliasMs / timed) : "-"} ms`);
  if (sum.total) console.log(`PDF records across hub matters: ${sum.total} (open ${sum.open})`);
  return sum;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const i = a.indexOf("=");
      return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
    }),
  );
  if (args["self-check"]) {
    process.exit((await selfCheck()) ? 0 : 1);
  }
  const totals = !!args.totals;
  const { run, ids } = await liveRun({ totals });
  const sum = report(run, ids);
  let diffs;
  if (args.compare) {
    const baseline = JSON.parse(await readFile(String(args.compare), "utf8"));
    diffs = compareRuns(baseline.matters, run, { allMatters: ids, checkTotals: totals });
    console.log(`compared with ${args.compare} (${baseline.generatedAt})`);
  } else {
    const aliasDiffs = compareRuns(fixtureAsRun(), run, { allMatters: ids, checkTotals: false });
    const totalDiffs = totals
      ? compareRuns(fixtureAsRun(), run, { allMatters: [], checkTotals: true }).filter((d) =>
          d.kind.startsWith("totals"),
        )
      : [];
    if (totals && (sum.total !== EXPECTED_ALL.total || sum.open !== EXPECTED_ALL.open))
      totalDiffs.push({ mdl: "all", kind: "totals.sum", want: EXPECTED_ALL, got: sum });
    for (const d of totalDiffs) console.log(`note: fixture total differs ${JSON.stringify(d)}`);
    diffs = args["strict-totals"] ? [...aliasDiffs, ...totalDiffs] : aliasDiffs;
  }
  if (args.write) {
    await writeFile(
      String(args.write),
      JSON.stringify({ generatedAt: new Date().toISOString(), totals, matters: run }, null, 2),
    );
    console.log(`baseline written to ${args.write}`);
  }
  for (const d of diffs) console.log(`DIFF ${JSON.stringify(d)}`);
  console.log(diffs.length ? `FAILED: ${diffs.length} difference(s)` : "PARITY OK");
  process.exit(diffs.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  });
}
