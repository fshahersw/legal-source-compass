#!/usr/bin/env node
/**
 * Bounded validation of the built api-law samples against their official APIs (wave 1025). For each dataset a fixed
 * sample (rows spread evenly over the build file, at most --per rows) is re-read from the publisher and the fields a
 * record states are compared exactly with the stored row. Fields that legitimately move (latest actions, comment
 * counts, last-modified stamps) are not compared. GAO rows are checked against the stored feed file (gao.gov asks for
 * 420 s between requests, so nothing is fetched); 10-K rows are verified by legal_proceedings.py verify (re-fetch, raw
 * and rendering hashes, span slices).
 *
 *   set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
 *     node scripts/api_law/validate_samples.mjs [--per 4] [--datasets a,b]
 *
 * Output: private/build/w1025_api-law/validation.json (one entry per checked record: url without key, compared fields,
 * mismatches) and a one-line summary per dataset. Exit 1 when any mismatch is found.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { ACQ, BUILD, flag, nowIso, politeClient } from "./lib/node.mjs";

const args = process.argv.slice(2);
const per = Number(flag(args, "--per", "4"));
const only = flag(args, "--datasets", null)?.split(",") ?? null;
const key = process.env.DATA_GOV_API_KEY;
if (!key) {
  console.error("DATA_GOV_API_KEY must be set (load it from private/scratch/secrets.env in the same command)");
  process.exit(2);
}
const client = politeClient({
  minIntervalMs: 1500,
  lowWater: 50,
  maxRequests: 120,
  headers: { "X-Api-Key": key },
  ledger: path.join(BUILD, "validation.requests.jsonl"),
});

const FILES = {
  regulations_gov_documents: "regulations_gov/regulations_gov_documents",
  regulations_gov_dockets: "regulations_gov/regulations_gov_dockets",
  congress_amendments: "congress/congress_amendments",
  congress_nominations: "congress/congress_nominations",
  congress_treaties: "congress/congress_treaties",
  congress_committee_reports: "congress/congress_committee_reports",
  govinfo_hearings: "govinfo/govinfo_hearings",
  govinfo_committee_prints: "govinfo/govinfo_committee_prints",
  govinfo_gao_reports: "govinfo/govinfo_gao_reports",
  govinfo_bill_versions: "govinfo/govinfo_bill_versions",
  gao_legal_decisions: "gao/gao_legal_decisions",
};

/** Lines of a gzip JSONL file, streamed (a bill-versions build decompresses past the largest string Node allows). */
async function* gzLines(file) {
  yield* readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

async function sample(dataset) {
  const file = path.join(BUILD, `${FILES[dataset]}.rows.jsonl.gz`);
  if (!fs.existsSync(file)) return [];
  let count = 0;
  for await (const line of gzLines(file)) if (line) count += 1;
  const step = Math.max(1, Math.floor(count / per));
  const out = [];
  let i = 0;
  for await (const line of gzLines(file)) {
    if (!line) continue;
    if (i % step === 0 && out.length < per) out.push(JSON.parse(line));
    i += 1;
  }
  return out;
}
const day = (v) => (typeof v === "string" ? v.slice(0, 10) : v ?? null);
const norm = (v) => (v === undefined ? null : v);

/** compare [label, stored, published] triples; returns the mismatches */
const compare = (pairs) =>
  pairs
    .filter(([, a, b]) => JSON.stringify(norm(a)) !== JSON.stringify(norm(b)))
    .map(([field, stored, published]) => ({ field, stored, published }));

const CHECKS = {
  async regulations_gov_documents(r) {
    const d = r.item.regs_document;
    const url = `https://api.regulations.gov/v4/documents/${encodeURIComponent(r.id)}`;
    const a = (await client.getJson(url)).body.data.attributes;
    return [url, compare([
      ["title", d.title, a.title],
      ["documentType", d.documentType, a.documentType],
      ["postedDate", d.postedDate, a.postedDate],
      ["docketId", d.docketId, a.docketId],
      ["frDocNum", d.frDocNum, a.frDocNum ?? null],
      ["commentEndDate", d.commentEndDate, a.commentEndDate ?? null],
      ["agencyId", d.agencyId, a.agencyId],
    ])];
  },
  async regulations_gov_dockets(r) {
    const d = r.item.regs_docket;
    const url = `https://api.regulations.gov/v4/dockets/${encodeURIComponent(r.id)}`;
    const a = (await client.getJson(url)).body.data.attributes;
    return [url, compare([
      ["title", d.title, a.title],
      ["docketType", d.docketType, a.docketType],
      ["agencyId", d.agencyId, a.agencyId],
    ])];
  },
  async congress_amendments(r) {
    const m = r.item.amendment;
    const url = `https://api.congress.gov/v3/amendment/${m.congress}/${m.type.toLowerCase()}/${m.number}?format=json`;
    const a = (await client.getJson(url)).body.amendment;
    const pairs = [
      ["congress", m.congress, a.congress],
      ["type", m.type, String(a.type).toUpperCase()],
      ["number", m.number, String(a.number)],
    ];
    if (m.detail)
      pairs.push(
        ["submittedDate", m.submittedDate, day(a.submittedDate)],
        ["chamber", m.chamber, a.chamber ?? null],
        ["sponsors", m.sponsors.map((s) => s.bioguideId), (a.sponsors ?? []).map((s) => s.bioguideId)],
        ["amendedBill", m.amendedBill ? `${m.amendedBill.congress}-${String(m.amendedBill.type).toLowerCase()}-${m.amendedBill.number}` : null,
          a.amendedBill ? `${a.amendedBill.congress}-${String(a.amendedBill.type).toLowerCase()}-${a.amendedBill.number}` : null],
      );
    return [url, compare(pairs)];
  },
  async congress_nominations(r) {
    const n = r.item.nomination;
    const num = n.number ?? n.citation.slice(2).split("-")[0];
    const url = `https://api.congress.gov/v3/nomination/${n.congress}/${num}?format=json`;
    const a = (await client.getJson(url)).body.nomination;
    return [url, compare([
      ["citation (base)", n.citation.split("-")[0], String(a.citation).split("-")[0]],
      ["receivedDate", n.receivedDate, day(a.receivedDate)],
      ["kind", n.kind, (a.nominationType ?? a).isCivilian === true ? "civilian" : (a.nominationType ?? a).isMilitary === true ? "military" : "not recorded"],
    ])];
  },
  async congress_treaties(r) {
    const t = r.item.treaty;
    const url = `https://api.congress.gov/v3/treaty/${t.congressReceived}/${t.number}${t.suffix ? `/${t.suffix}` : ""}?format=json`;
    const body = (await client.getJson(url)).body;
    const a = Array.isArray(body.treaty) ? body.treaty[0] : body.treaty;
    return [url, compare([
      ["transmittedDate", t.transmittedDate, day(a.transmittedDate)],
      ["topic", t.topic, a.topic ?? null],
      ["inForceDate", t.inForceDate, day(a.inForceDate) ?? null],
    ])];
  },
  async congress_committee_reports(r) {
    const p = r.item.report;
    const url = `https://api.congress.gov/v3/committee-report/${p.congress}/${p.type.toLowerCase()}/${p.number}?format=json`;
    const list = (await client.getJson(url)).body.committeeReports ?? [];
    const a = list.find((x) => Number(x.part ?? 1) === Number(p.part)) ?? list[0] ?? {};
    return [url, compare([
      ["citation", p.citation, a.citation ?? null],
      ["issueDate", p.issueDate, day(a.issueDate)],
      ["isConferenceReport", p.isConferenceReport, a.isConferenceReport ?? null],
    ])];
  },
  async govinfo_hearings(r) {
    return govinfoPackage(r);
  },
  async govinfo_committee_prints(r) {
    return govinfoPackage(r);
  },
  async govinfo_gao_reports(r) {
    return govinfoPackage(r);
  },
  async govinfo_bill_versions(r) {
    const v = r.item.versions[r.item.versions.length - 1];
    const url = `https://api.govinfo.gov/packages/${v.packageId}/summary`;
    const a = (await client.getJson(url)).body;
    return [url, compare([
      ["packageId", v.packageId, a.packageId],
      ["date", v.date, day(a.dateIssued)],
      ["bill", `${r.item.bill.congress}-${r.item.bill.type}-${r.item.bill.number}`,
        `${Number(a.congress)}-${String(a.billType).toLowerCase()}-${Number(a.billNumber)}`],
      ["version code", v.code, String(a.billVersion).toLowerCase()],
    ])];
  },
  async gao_legal_decisions(r) {
    const feed = fs.readFileSync(path.join(ACQ, "gao/reportslegal.xml"), "utf8");
    const d = r.item.decision;
    const esc = (s) => s.replaceAll("&", "&amp;");
    return ["file:private/acq/w1025_api-law/gao/reportslegal.xml", compare([
      ["link in feed", true, feed.includes(`<link>${d.link}</link>`)],
      ["title in feed", true, feed.includes(`<title>${esc(d.title)}</title>`) || feed.includes(d.title)],
      ["pubDate in feed", true, d.pubDate ? feed.includes(`<pubDate>${d.pubDate}</pubDate>`) : false],
    ])];
  },
};

async function govinfoPackage(r) {
  const p = r.item.package;
  const url = `https://api.govinfo.gov/packages/${p.packageId}/summary`;
  const a = (await client.getJson(url)).body;
  // the stored package title is the collection listing's (GovInfo's listing and summary can differ in case); the
  // summary's own title is compared with the stored summary
  return [url, compare([
    ...(r.item.summary ? [["summary title", r.item.summary.title, a.title]] : []),
    ["dateIssued", p.dateIssued, day(a.dateIssued)],
    ["docClass", p.docClass, a.docClass ?? null],
  ])];
}

const results = [];
for (const dataset of Object.keys(FILES)) {
  if (only && !only.includes(dataset)) continue;
  const rows = await sample(dataset);
  let bad = 0;
  for (const r of rows) {
    try {
      const [url, mismatches] = await CHECKS[dataset](r);
      results.push({ dataset, id: r.id, url: url.replace(/[?&]format=json/, ""), mismatches });
      if (mismatches.length) bad++;
    } catch (e) {
      results.push({ dataset, id: r.id, error: String(e).slice(0, 200) });
      bad++;
    }
  }
  console.log(`${dataset}: ${rows.length} checked, ${rows.length - bad} exact, ${bad} with differences or errors`);
}
fs.writeFileSync(
  path.join(BUILD, "validation.json"),
  JSON.stringify({ checked_at: nowIso(), per, requests: client.used, results }, null, 1),
);
console.log(`requests: ${client.used}; report: private/build/w1025_api-law/validation.json`);
process.exit(results.some((r) => r.error || r.mismatches?.length) ? 1 : 0);
