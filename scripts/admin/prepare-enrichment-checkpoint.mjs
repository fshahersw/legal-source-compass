/** Build a public aggregate checkpoint from a verified database receipt, never raw private records. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((s, i, a) => (s.startsWith("--") ? [s.slice(2), a[i + 1]] : []))
    .filter((x) => x.length),
);
if (!args.receipt || !args.output || !args.sql)
  throw Error("Require --receipt verified.json --output public.json --sql checkpoint.sql");
const root = resolve(".");
const read = async (f) => JSON.parse(await readFile(f, "utf8"));
const receipt = await read(args.receipt);
const rules = await read(root + "/public/data/limitations/rules.json");
const sources = await read(root + "/public/data/limitations/sources.json");
const coverage = await read(root + "/public/data/limitations/coverage.json");
const scopes = await read(root + "/../audit/2026-10-02/metadata/live-backfill-manifest.json");
const counts = await read(root + "/../audit/2026-10-02/metadata/master-scope-counts.json");
const crosswalk = await read(root + "/public/data/mdl-documents/master-dockets.json");
const safeCount = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid aggregate count");
  return n;
};
const type = (system, kind) =>
  safeCount(
    receipt.entities.find((x) => x.source_system === system && x.entity_type === kind)?.records ??
      0,
  );
const safeCounts = Object.fromEntries(
  [
    "sourceRecords",
    "canonicalEntities",
    "sourceVersions",
    "observations",
    "nativeRelationships",
    "pdfDownloads",
  ].map((k) => [k, safeCount(receipt.counts[k])]),
);
if (
  safeCounts.pdfDownloads !== 0 ||
  type("courtlistener", "fjc-integrated-database") !== 365845 ||
  type("courtlistener", "dockets") < 187900
)
  throw Error("Required metadata scope is not complete");
const baseline = rules.rules.filter((r) => r.computation === "baseline_only");
if (
  rules.rules.length !== 104 ||
  baseline.length !== 68 ||
  type("corpus-legal-review", "limitation-rules") !== 104
)
  throw Error("Legal checkpoint changed; review required");
const publicDatasets = receipt.public_datasets.filter((d) => d.ready);
const labels = {
  2100: "Yasmin / Yaz (drospirenone)",
  2545: "Testosterone replacement therapy",
  2570: "Cook IVC filters",
  2592: "Xarelto (rivaroxaban)",
  2606: "Benicar (olmesartan)",
  2641: "Bard IVC filters",
  2782: "Ethicon Physiomesh",
  2789: "Proton-pump inhibitors",
  2804: "National prescription opiates",
  2846: "Davol / C.R. Bard polypropylene hernia mesh",
  2873: "Aqueous film-forming foams",
  2885: "3M combat arms earplugs",
  2913: "JUUL",
  2973: "Elmiron",
  3047: "Social media adolescent addiction / personal injury",
  3081: "Bard implanted ports",
  3094: "GLP-1 receptor agonists / gastrointestinal injury",
};
const mdlAssociations = Object.entries(labels).map(([mdlNumber, label]) => {
  const native = Object.entries(crosswalk).find(([, mdl]) => mdl === mdlNumber)?.[0];
  const mdl = receipt.mdls.find((x) => x.mdl === mdlNumber);
  const observed = counts.sources.find((x) => String(x.docket_id) === native);
  const scope = scopes.scopes["docket-entries:" + native];
  const imported = receipt.master_entries.find((x) => x.native_docket_id === native);
  if (native && scope?.complete && scope.records !== imported?.records)
    throw Error("Master-entry receipt differs from captured scope");
  return {
    mdlNumber,
    label,
    profileId: receipt.profiles.find((p) => p.id === mdlNumber)?.id ?? null,
    administrativeRecords: mdl ? safeCount(mdl.administrative_records) : 0,
    nativeDocketLinks: mdl ? safeCount(mdl.native_docket_links) : 0,
    publicMetadataRecords: publicDatasets.some((d) => d.id === "cl_docket_metadata")
      ? safeCount(receipt.public_docket_counts.find((x) => x.mdl === mdlNumber)?.records ?? 0)
      : null,
    masterEntriesCaptured: imported ? safeCount(imported.records) : null,
    masterEntriesObserved: observed ? safeCount(observed.entries) : null,
    masterScope: scope?.complete ? "complete" : "partial",
    sourceAsOf: "FJC: 2026-09-30; API: 2026-10-02",
    sourceUrl:
      "https://www.courtlistener.com/api/rest/v4/dockets/" +
      (native ?? (mdlNumber === "2545" ? "4261857" : "6078886")) +
      "/",
  };
});
const bulkBase = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/";
const coverageRows = publicDatasets.map((d) => ({
  id: d.id,
  label:
    {
      cl_courts: "Court registry (testing courts excluded)",
      cl_courthouses: "Courthouse references",
      cl_court_appeals_to: "Native appeal-route records",
      cl_people: "People and explicit aliases",
      cl_positions: "Judicial service positions",
      cl_educations: "Education associations",
      cl_schools: "School references",
      cl_docket_metadata: "Privacy-reviewed native docket metadata",
      cl_reporter_citations: "Scoped formal reporter citations",
      cl_citation_edges: "Scoped directed citation mentions",
      statutory_limitations_review: "Cited state-specific limitations rules",
      regulatory_backfill: "Federal Register publication metadata",
    }[d.id] ?? d.id,
  status:
    d.id.startsWith("cl_docket") || d.id.includes("citation")
      ? "partial"
      : d.id === "statutory_limitations_review"
        ? "research-review"
        : "complete-snapshot",
  records: safeCount(d.imported_records),
  sourceAsOf:
    d.id === "regulatory_backfill"
      ? "2026-08-21 through 2026-10-02"
      : d.id === "statutory_limitations_review"
        ? "2026-10-02"
        : "2026-09-30 / observed 2026-10-02",
  qualification:
    d.id === "regulatory_backfill"
      ? "3,139 publisher documents: notices, proposed rules, rules and presidential documents. Linked official editions were not downloaded; provision-level operative applicability is not established."
      : d.id === "statutory_limitations_review"
        ? "68 conditional baseline branches and 36 further-review records; source text and each rule’s applicability qualifications remain separate."
        : d.id.includes("citation")
          ? "Native source-selected metadata only. Mention counts do not encode judicial treatment, binding authority or outcome likelihood."
          : d.id === "cl_docket_metadata"
            ? "Exact uploaded native identities or source-explicit FJC MDL foreign keys, with blocked records and unconfirmed candidates excluded. Public fields omit natural-person captions and party/contact data. This is not a current member-case census."
            : "Complete selected publisher snapshot after structural/provenance reconciliation. It does not certify current appointments, institutional status or legal authority.",
}));
coverageRows.push(
  {
    id: "fjc-administrative-scope",
    label: "FJC administrative scan scoped to 17 MDL numbers",
    status: "partial",
    records: type("courtlistener", "fjc-integrated-database"),
    sourceAsOf: "2026-09-30",
    sourceUrls: [bulkBase + "fjc-integrated-database-2026-09-30.csv.bz2"],
    qualification:
      "The complete original scan found source-explicit records for 14 of the 17 requested MDL numbers. Zero matches for a requested number describe this dated administrative snapshot, not a zero current case count. Native tape labels span 2013–2021, plus the publisher’s 2099 pending-record marker; that marker is not a future year or a current-2026 pending finding. The dump date does not make case facts current. A row is not a unique current member case or a verified verdict / settlement.",
  },
  {
    id: "master-entry-scope",
    label: "Master docket-entry backfill",
    status: "partial",
    records: type("courtlistener", "docket-entries"),
    sourceAsOf: "2026-10-02",
    sourceUrls: ["https://www.courtlistener.com/help/api/rest/"],
    qualification:
      "Five complete API entry scopes: Elmiron 419, Davol/Bard mesh 994, GLP-1 GI 1,034, PPI 1,263, Benicar 1,337. Other ten scopes remain partial. The 15 count observations total 150,029 entries; publisher next cursors are retained for continuation.",
  },
  {
    id: "private-party-attorney-scope",
    label: "Native party and attorney metadata",
    status: "partial",
    records: type("courtlistener", "parties") + type("courtlistener", "attorneys"),
    sourceAsOf: "2026-10-02",
    qualification:
      "1,359 party identities and 887 attorney identities are retained privately. Each nested role/representation uses its own native docket ID; unrelated nested associations are not assigned to the outer query scope.",
  },
  {
    id: "document-locator-scope",
    label: "RECAP document metadata and URL inventory",
    status: "partial",
    records: type("courtlistener", "recap-documents"),
    sourceAsOf: "2026-10-02",
    qualification:
      "6,705 document metadata records: the source marks 1,076 available and 5,629 unavailable. URLs were collected without fetching their destinations. Availability and PDF bytes were not independently verified.",
  },
  {
    id: "ecfr-version-index",
    label: "eCFR title version index",
    status: "complete-snapshot",
    records: type("ecfr", "title-versions"),
    sourceAsOf: "2026-10-02",
    sourceUrls: ["https://www.ecfr.gov/api/versioner/v1/titles.json"],
    qualification:
      "All 50 title-version metadata rows, including native amendment/issue/up-to-date dates and reserved-title flags. This is a version index, not an updated full-section corpus.",
  },
  {
    id: "official-court-html",
    label: "Official court HTML inventories",
    status: "partial",
    records: type("official-court", "mdl-source-pages"),
    sourceAsOf: "2026-10-02",
    qualification:
      "Open official HTML captures preserve page metadata, anchor labels and candidate document locators. The linked PDF destinations were not downloaded or independently availability-certified.",
  },
);
const unresolved = receipt.relationships.reduce((n, x) => n + safeCount(x.unresolved), 0);
const data = {
  schemaVersion: "corpus-enrichment/1",
  updatedAt: receipt.captured_at,
  status: "partial",
  metadataOnly: true,
  counts: safeCounts,
  mdlAssociations,
  coverage: coverageRows,
  deduplication: {
    version: "2026-10-02.1",
    recordsCompared: 42971,
    exactDuplicateGroups: 0,
    explicitAliases: 394,
    summary:
      "The exact duplicate audit covers 42,971 stated legacy reference/MDL rows, not the whole corpus. The 394 aliases are explicit person aliases in that audit, not all alias types. Native identities and all source versions are preserved. Two publisher testing courts were reversibly quarantined from active public registries; no people or cases were fuzzy-merged.",
  },
  legalReview: {
    sources: sources.sources.length,
    rules: rules.rules.length,
    jurisdictionsCovered: coverage.coverage
      .filter((c) => c.sourceStatus === "primary_text_retrieved")
      .map((c) => c.state),
    calculatorJurisdictions: [...new Set(baseline.map((r) => r.jurisdiction))].sort(),
    qualification:
      "Primary statutory text was retrieved for 43 state/DC jurisdictions; all 51 have an inventory. Conditional baselines cover 34 jurisdictions, with explicit governing-law, accrual, transition and exception gates. Holidays, filing/service cutoffs and unreviewed tolling are not computed.",
  },
  categoryMap: {
    version: "2026-10-02.1",
    summary:
      receipt.mapped_categories +
      " exact native category mappings. Publisher identity, resource type and original source category stay separate; unknown future categories remain unmatched. Mixed histories and third-party summaries are not represented as operative law.",
  },
  qualifications: [
    "Imported-source and observation counts use versioned native record observations in this run; distinct-native counts use provider + entity type + native ID, including retained private and quarantined review records. Public collection counts are stated separately. Relationship counts are source-version field observations, so multiple versions can repeat an association. These units are not cases, people or verified legal outcomes.",
    "Nationwide original snapshot acquisition and scoped Supabase imports have different coverage. Large original CSVs are retained outside Git; totals from the nationwide archive are not treated as imported case counts.",
    unresolved.toLocaleString("en-US") +
      " native relationship targets lack an imported target observation at this checkpoint; source field paths and version hashes are preserved. No target identity is filled from a similar name.",
    "Native criminal/magistrate parent-docket fields do not become MDL membership. FJC historical administrative associations, master entries, source-listed cases and present member cases remain separate grains.",
    "The Testosterone native docket IDs 4261857 and 18704765 remain separate because their publisher PACER IDs differ. Physiomesh MDL 2782 remains separate from Davol/Bard MDL 2846; Testosterone MDL 2545 remains separate from Benicar MDL 2606.",
    "CourtListener rolling limits verified at collection: 50/minute, 600/hour, 2,800/day. Public-page denial was respected; authenticated API cursors remain resumable. No PDF downloads occurred in this metadata scope.",
  ],
};
const serialized = JSON.stringify(data, null, 2) + "\n";
await writeFile(args.output, serialized);
const sha = createHash("sha256").update(serialized).digest("hex");
const delimiter = "$enrichment_" + sha.slice(0, 16) + "$";
if (serialized.includes(delimiter)) throw Error("SQL delimiter collision");
await writeFile(
  args.sql,
  `insert into public.corpus_context(key,data,source_sha256,captured_at,ready) values ('enrichment_20261002',${delimiter}${serialized}${delimiter}::jsonb,'${sha}','${receipt.captured_at}'::timestamptz,true) on conflict(key) do update set data=excluded.data,source_sha256=excluded.source_sha256,captured_at=excluded.captured_at,ready=excluded.ready;\nselect key,ready,source_sha256 from public.corpus_context where key='enrichment_20261002';\n`,
);
console.log(
  JSON.stringify({
    output: resolve(args.output),
    sql: resolve(args.sql),
    sha256: sha,
    counts: safeCounts,
    mdls: mdlAssociations.length,
  }),
);
