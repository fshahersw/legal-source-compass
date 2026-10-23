#!/usr/bin/env node
/**
 * Compare the TypeScript enforcement-text port (src/lib/ingest/sources/enforcementText.ts) with the Python extractors'
 * golden outputs (goldens.py). Prints mismatches per function; exit 1 when any.
 *
 *   node scripts/api_law/enforcement/parity.mjs <goldens.json> [--show 5]
 */
import fs from "node:fs";
import { ensureStripTypes, flag } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const E = await import("../../../src/lib/ingest/sources/enforcementText.ts");
const args = process.argv.slice(2);
const file = args[0];
const show = Number(flag(args, "--show", "5"));
const g = JSON.parse(fs.readFileSync(file, "utf8"));
const canon = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const bad = {};
let checked = 0;
function cmp(name, c, got, want) {
  checked++;
  if (canon(plain(got)) !== canon(want)) {
    (bad[name] ??= []).push({ id: c.uuid ?? c.url, got: plain(got), want });
  }
}
for (const c of g.cases) {
  if (c.kind === "doj") {
    cmp("html_to_text", c, E.htmlToText(c.body), c.text);
    cmp("clean_title", c, E.cleanTitle(c.raw_title), c.title);
  }
  const text = c.text;
  const o = c.out;
  const spans = E.sentenceSpans(text);
  // spans are code-unit offsets in TS, code points in Python
  cmp("sentence_spans", c, spans.map(([a, b]) => [E.cpIndex(text, a), E.cpIndex(text, b)]), o.spans);
  const amounts = E.extractAmounts(text, spans);
  cmp("extract_amounts", c, amounts, o.amounts);
  cmp("extract_statutes", c, E.extractStatutes(text), o.statutes);
  cmp("extract_dockets", c, E.extractDockets(text), o.dockets);
  cmp("extract_courts", c, E.extractCourts(text), o.courts);
  cmp("extract_court_cites", c, E.extractCourtCites(text), o.court_cites);
  cmp("title_parties", c, E.titleParties(c.title, text), o.parties);
  cmp("title_figures", c, E.titleFigures(c.title), o.title_figures);
  cmp("headline_figure", c, E.headlineFigure(c.title, amounts, c.date, c.kind === "sec" ? 6 : 2), o.headline);
  cmp("clip_1500", c, E.clip(text, 1500), o.clip_1500);
  cmp("clip_900", c, E.clip(text, 900), o.clip_900);
  cmp("money_label", c, amounts.filter((a) => a.value_usd !== undefined).map((a) => E.moneyLabel(a.value_usd)), o.money_labels);
  cmp("amount_bucket", c, amounts.map((a) => E.amountBucket(a.value_usd ?? null)), o.buckets);
  cmp("normalize_company", c, E.titleParties(c.title, text).map((p) => E.normalizeCompany(p.as_written)), o.normalized);
  cmp("verify_spans", c, E.verifySpans(text, [...amounts, ...E.extractStatutes(text), ...E.extractDockets(text), ...E.extractCourts(text)]), o.verify);
}
const summary = Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length]));
console.log(JSON.stringify({ cases: g.cases.length, checks: checked, mismatches: summary }));
for (const [k, v] of Object.entries(bad))
  for (const m of v.slice(0, show)) console.log(k, m.id, "\n got ", JSON.stringify(m.got).slice(0, 1500), "\n want", JSON.stringify(m.want).slice(0, 1500));
process.exit(Object.keys(bad).length ? 1 : 0);
