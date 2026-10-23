#!/usr/bin/env node
/**
 * Build govinfo_hearings, govinfo_committee_prints, govinfo_gao_reports and govinfo_bill_versions from the acquired
 * GovInfo listings and summaries (acquire.mjs), with the row functions the scheduled refresh uses
 * (src/lib/ingest/sources/govinfo.ts). Exact-link checks read the held ids of congress_bills and congress_committees
 * (read-only, cached under <out>/known/).
 *
 *   . private/scratch/env.sh && node scripts/api_law/govinfo/build.mjs [CHRG,CPRT,GAOREPORTS,BILLS] [--out DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, ensureStripTypes, fileDigest, flag, knownIds, nowIso, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";
import { countFilters, listing, presentOptions } from "../lib/listing.mjs";

ensureStripTypes(import.meta.url);
const G = await import("../../../src/lib/ingest/sources/govinfo.ts");
const args = process.argv.slice(2);
const which = (args[0] && !args[0].startsWith("--") ? args[0] : "CHRG,CPRT,GAOREPORTS,BILLS").split(",");
const out = path.resolve(flag(args, "--out", path.join(BUILD, "govinfo")));
const knownDir = path.join(out, "known");
fs.mkdirSync(knownDir, { recursive: true });

async function* lines(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".jsonl.gz")) yield* readJsonl(path.join(dir, f));
}
const inputs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz")).sort().map((f) => fileDigest(path.join(dir, f))) : []);
const ord = (c) => `${G.ordinal(Number(c))} Congress`;
const COMMON = {
  source: "GovInfo API (U.S. Government Publishing Office), https://api.govinfo.gov",
  documentation: G.GI_DOCS,
  licence: "GovInfo content is U.S. Government work, not subject to copyright (17 U.S.C. 105)",
};

async function emit(dataset, label, rows, columns, filterDefs, names, summary, inputFiles) {
  const counts = countFilters(rows, names);
  const file = await writeJsonlGz(path.join(out, `${dataset}.rows.jsonl.gz`), rows);
  writeJson(path.join(out, `${dataset}.header.json`), {
    dataset,
    label,
    listing_block: listing(columns, filterDefs(counts), counts),
    summary: { ...COMMON, ...summary, records: rows.length, built_at: nowIso() },
    built_at: nowIso(),
    inputs: inputFiles,
    output: file,
  });
  console.log(JSON.stringify({ dataset, rows: rows.length, sha256: file.sha256 }));
}

const committees = which.some((c) => c !== "BILLS") ? await knownIds("congress_committees", knownDir) : new Set();
const LABELS = {
  CHRG: ["govinfo_hearings", "Congressional hearings (GovInfo)", "Every hearing GovInfo lists in the Congressional Hearings collection (acquired range), with held dates and committees from the package summary where read"],
  CPRT: ["govinfo_committee_prints", "Congressional committee prints (GovInfo)", "Every committee print GovInfo lists in the Congressional Committee Prints collection (acquired range)"],
  GAOREPORTS: ["govinfo_gao_reports", "GAO reports and Comptroller General decisions, 1994-2008 (GovInfo)", "Every package of GovInfo's GAO Reports and Comptroller General Decisions collection (GAO's own site holds later reports)"],
};

for (const c of which.filter((x) => x !== "BILLS")) {
  const [dataset, label, scope] = LABELS[c];
  const sums = new Map();
  for await (const s of lines(path.join(out, c, "summaries"))) if (s.summary) sums.set(s.packageId, s);
  const rows = new Map();
  for await (const l of lines(path.join(out, c, "listing"))) {
    const p = G.normalizeListed(l.package);
    if (!p) continue;
    const s = sums.get(p.packageId);
    const row = G.packageRow(c, p, s ? G.normalizeSummary(s.summary) : null, committees, {
      listing_url: l.listing_url,
      retrieved_at: l.retrieved_at,
      summary_url: s?.summary_url ?? null,
      summary_retrieved_at: s?.retrieved_at ?? null,
    });
    const prev = rows.get(row.id);
    if (!prev || String(prev.item.package.lastModified ?? "") <= String(p.lastModified ?? "")) rows.set(row.id, row);
  }
  const date = (r) => String(r.item.summary?.heldDates?.[0] ?? r.item.package.dateIssued ?? "");
  const ordered = [...rows.values()].sort((a, b) => (date(a) !== date(b) ? (date(a) < date(b) ? 1 : -1) : a.id < b.id ? 1 : -1));
  await emit(
    dataset,
    label,
    ordered,
    c === "CHRG"
      ? [["package", "Package"], ["class", "Class"], ["held", "Held"], ["congress", "Congress"]]
      : c === "CPRT"
        ? [["package", "Package"], ["class", "Class"], ["issued", "Issued"], ["congress", "Congress"]]
        : [["package", "Package"], ["class", "Class"], ["issued", "Issued"], ["unit", "Issuing unit"]],
    (counts) => [
      ...(c === "GAOREPORTS" ? [] : [["congress", "Congress", presentOptions(counts.congress ?? {}, { order: "desc", label: ord })]]),
      ["class", "Document class", Object.fromEntries(Object.keys(counts.class ?? {}).sort().map((k) => [k, k.toUpperCase()]))],
      ["year", c === "CHRG" ? "Year held or issued" : "Year issued", presentOptions(counts.year ?? {})],
      ["summary", "Summary read", { yes: "Yes", no: "Not yet" }],
    ],
    ["congress", "class", "year", "summary"],
    { scope, collection: c, stats: { packages: ordered.length, with_summary: ordered.filter((r) => r.item.summary).length } },
    [...inputs(path.join(out, c, "listing")), ...inputs(path.join(out, c, "summaries"))],
  );
}

if (which.includes("BILLS")) {
  const bills = await knownIds("congress_bills", knownDir);
  const groups = new Map();
  let notBill = 0;
  const urls = new Set();
  let at = "";
  for await (const l of lines(path.join(out, "BILLS", "listing"))) {
    const p = G.normalizeListed(l.package);
    const b = p && G.parseBillPackage(p.packageId);
    if (!b) {
      notBill++;
      continue;
    }
    const k = G.billKey(b);
    const g = groups.get(k) ?? { b, vs: new Map() };
    const prev = g.vs.get(p.packageId);
    if (!prev || String(prev.lastModified ?? "") <= String(p.lastModified ?? ""))
      g.vs.set(p.packageId, { code: b.code, date: p.dateIssued, packageId: p.packageId, title: p.title, lastModified: p.lastModified });
    groups.set(k, g);
    urls.add(l.listing_url);
    if (l.retrieved_at > at) at = l.retrieved_at;
  }
  const rows = [...groups.entries()].map(([k, g]) =>
    G.billVersionsRow(g.b, [...g.vs.values()], bills.has(k), { listing_urls: [...urls].slice(0, 3), retrieved_at: at }),
  );
  const latest = (r) => String(r.item.versions.at(-1)?.date ?? "");
  rows.sort((a, b) => (latest(a) !== latest(b) ? (latest(a) < latest(b) ? 1 : -1) : a.id < b.id ? 1 : -1));
  await emit(
    "govinfo_bill_versions",
    "Bill text versions on GovInfo, grouped by bill",
    rows,
    [["bill", "Bill"], ["congress", "Congress"], ["versions", "Versions"], ["latest", "Latest version"], ["latest_date", "Latest date"]],
    (counts) => [
      ["congress", "Congress", presentOptions(counts.congress ?? {}, { order: "desc", label: ord })],
      ["type", "Bill type", { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res.", hres: "H.Res.", sres: "S.Res." }],
      ["enrolled", "Enrolled version published", { yes: "Yes", no: "No" }],
      ["held_bill", "Bill record in this atlas", { yes: "Yes", no: "No" }],
    ],
    ["congress", "type", "enrolled", "held_bill"],
    {
      scope: "Every bill text version GovInfo lists in the Congressional Bills collection (acquired range), one record per bill with its versions in issue order",
      version_rule: "Version codes are GPO's (ih, rh, eh, enr, ...); a code without a label in the table shows as 'Version <CODE>'",
      stats: { bills: rows.length, versions: rows.reduce((n, r) => n + r.item.versions.length, 0), held_bill_links: rows.filter((r) => r.filters.held_bill[0] === "yes").length, not_bill_packages: notBill },
    },
    inputs(path.join(out, "BILLS", "listing")),
  );
}
