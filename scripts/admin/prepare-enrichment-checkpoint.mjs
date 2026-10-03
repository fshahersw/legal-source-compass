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
const rules = await read(root + "/private/data/limitations/rules.json");
const sources = await read(root + "/private/data/limitations/sources.json");
const coverage = await read(root + "/private/data/limitations/coverage.json");
const references = await read(root + "/private/data/limitations/case-references.json");
const fdaSources = await read(root + "/private/data/quality/openfda-source-review-2026-10-02.json");
const scopes = await read(
  args.scopes ?? root + "/../audit/2026-10-02/metadata/live-backfill-manifest.json",
);
const counts = await read(
  args["scope-counts"] ?? root + "/../audit/2026-10-02/metadata/master-scope-counts.json",
);
const crosswalk = await read(root + "/private/data/mdl-documents/master-dockets.json");
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
for (const key of [
  "httpSourceObservations",
  "localFileOccurrences",
  "sourceRecordedRelationships",
  "localPointerRelationships",
]) {
  if (receipt.counts[key] != null) safeCounts[key] = safeCount(receipt.counts[key]);
}
if (
  safeCounts.httpSourceObservations != null &&
  (safeCounts.httpSourceObservations !== safeCounts.observations ||
    safeCounts.httpSourceObservations !== safeCounts.sourceRecords)
)
  throw Error("Historical HTTP observation aliases do not reconcile");
if (
  safeCounts.sourceRecordedRelationships != null &&
  safeCounts.localPointerRelationships != null &&
  safeCounts.sourceRecordedRelationships + safeCounts.localPointerRelationships !==
    safeCounts.nativeRelationships
)
  throw Error("Source-recorded and local-pointer edge grains do not reconcile");
if (
  safeCounts.pdfDownloads !== 0 ||
  type("courtlistener", "fjc-integrated-database") !== 365845 ||
  type("courtlistener", "dockets") < 187900
)
  throw Error("Required metadata scope is not complete");
const baseline = rules.rules.filter((r) => r.computation === "baseline_only");
if (!baseline.length || type("corpus-legal-review", "limitation-rules") !== rules.rules.length)
  throw Error("Legal rule file differs from the imported native rule inventory");
if (
  type("corpus-legal-review", "statutory-sources") !== sources.sources.length ||
  type("corpus-legal-review", "judicial-references") !== references.cases.length ||
  type("corpus-legal-review", "jurisdiction-coverage") !== coverage.coverage.length ||
  coverage.coverage.length !== 51 ||
  new Set(coverage.coverage.map((c) => c.state)).size !== 51
)
  throw Error(
    "Legal sources, opinion references or jurisdiction inventory differ from the imported native inventory",
  );
const publicDatasets = receipt.public_datasets.filter((d) => d.ready);
if (
  publicDatasets.find((d) => d.id === "statutory_limitations_review")?.imported_records !==
  rules.rules.length
)
  throw Error("Reviewed legal projection differs from the rule file");
const primaryJurisdictions = coverage.coverage
  .filter((c) => c.sourceStatus === "primary_text_retrieved")
  .map((c) => c.state);
const missingPrimaryJurisdictions = coverage.coverage
  .filter((c) => c.sourceStatus === "primary_text_pending")
  .map((c) => c.state)
  .sort();
const calculatorJurisdictions = [...new Set(baseline.map((r) => r.jurisdiction))].sort();
const researchRules = rules.rules.length - baseline.length;
const documentAvailability = receipt.document_availability;
if (
  !documentAvailability ||
  documentAvailability.records !== type("courtlistener", "recap-documents") ||
  documentAvailability.records !==
    documentAvailability.available + documentAvailability.unavailable + documentAvailability.unknown
)
  throw Error("Document availability receipt does not reconcile");
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
  if (
    native &&
    scope?.complete &&
    (scope.records !== imported?.records || observed?.entries !== imported?.records)
  )
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
const fdaCoverage = {
  agency_safety_openfda_device_classification_20261002: {
    label: "Dated FDA product-category codes",
    sourceAsOf: "2026-10-02",
    qualification:
      "7,094 native product-category codes. Device regulatory class 1/2/3 is separate from recall hazard class I/II/III. Exact ready regulation locators establish an identifier match, not claim-specific applicability or an incorporated-standard finding.",
  },
  agency_safety_openfda_device_enforcement_20260928: {
    label: "Dated FDA device recall-enforcement reports",
    sourceAsOf: "2026-09-28",
    qualification:
      "40,056 identifiable device recall-enforcement records; one original row without a native identity is held. Status is the dated research export's value, not a current clinical alert, causation or liability finding.",
  },
  agency_safety_openfda_drug_enforcement_20260928: {
    label: "Dated FDA drug recall-enforcement reports",
    sourceAsOf: "2026-09-28",
    qualification:
      "17,986 identifiable drug recall-enforcement records; two original rows without documented native identities are held. Reports are separate from litigation cases, adverse-event analyses and current clinical alerts.",
  },
  agency_safety_openfda_device_recalls_20261002: {
    label: "Dated FDA device recall metadata",
    sourceAsOf: "2026-10-02",
    qualification:
      "59,336 documented native cfRes recall records are eligible; eight source-reference records without cfres_id remain private. Source-reported cause categories and exact product-code links do not establish an independent defect, causation, liability or litigation relationship.",
  },
};
const coverageRows = publicDatasets.map((d) => ({
  id: d.id,
  label:
    {
      cl_courts: "Court registry (testing courts excluded)",
      cl_courthouses: "Courthouse references",
      cl_court_appeals_to: "Native appeal-route records",
      cl_people: "People and explicit aliases",
      cl_positions: "Native service / employment position records",
      cl_educations: "Education associations",
      cl_schools: "School references",
      cl_docket_metadata: "Privacy-reviewed native docket metadata",
      cl_master_entries: "Privacy-reviewed native master docket entries",
      cl_reporter_citations: "Scoped formal reporter citations",
      cl_citation_edges: "Scoped directed citation mentions",
      statutory_limitations_review: "Cited state-specific limitations rules",
      regulatory_backfill: "Federal Register publication metadata",
      ecfr_hierarchy: "Dated national eCFR hierarchy",
      ecfr_authority_notes: "Selected eCFR authority and source notes",
      mass_tort_authority_evidence: "Selected mass-tort authorities and access evidence",
      jpml_html_reference: "Selected JPML and official court HTML references",
    }[d.id] ??
    fdaCoverage[d.id]?.label ??
    d.id,
  status:
    d.id.startsWith("cl_docket") || d.id === "cl_master_entries" || d.id.includes("citation")
      ? "partial"
      : [
            "statutory_limitations_review",
            "mass_tort_authority_evidence",
            "jpml_html_reference",
          ].includes(d.id)
        ? "research-review"
        : "complete-snapshot",
  records: safeCount(d.imported_records),
  ...(fdaCoverage[d.id]
    ? {
        sourceUrls: fdaSources.sources
          .find((source) => source.id === d.id)
          ?.originals.map((original) => original.url),
      }
    : {}),
  sourceAsOf:
    fdaCoverage[d.id]?.sourceAsOf ??
    (d.id === "jpml_html_reference"
      ? "July 2026 session; October 1 report locators; HTML observed 2026-10-02"
      : d.id === "ecfr_authority_notes"
        ? "2026-09-30; one Part 820 historical snapshot: 2026-02-01"
        : d.id === "ecfr_hierarchy"
          ? "2026-09-30"
          : d.id === "regulatory_backfill"
            ? "2026-08-21 through 2026-10-02"
            : ["statutory_limitations_review", "mass_tort_authority_evidence"].includes(d.id)
              ? "2026-10-02"
              : "2026-09-30 / observed 2026-10-02"),
  qualification:
    fdaCoverage[d.id]?.qualification ??
    (d.id === "jpml_html_reference"
      ? "93 eligible observations from seven successful HTML captures. Three conflicting/unavailable observations are held; the caption conflict audit is retained separately. Panel membership is not MDL assignment. Linked report/order PDFs remain unread, so current case totals are null; the 25 statistical links cover only the first visible page."
      : d.id === "ecfr_hierarchy"
        ? "49 complete nonreserved title trees; Title 35 is reserved. Native headings, identifiers, reserved flags and parent/child paths are preserved. Editorial eCFR metadata is authoritative but unofficial; no full provision text, incorporated standards or case-specific applicability is established."
        : d.id === "ecfr_authority_notes"
          ? "36 selected dated XML snapshots retain AUTH, SOURCE and section CITA notes. Current and historical Part 820 evidence stay separate. These are metadata and source notes, not full provisions or a finding that a regulation governs a claim."
          : d.id === "regulatory_backfill"
            ? "3,139 publisher documents: notices, proposed rules, rules and presidential documents. Linked official editions were not downloaded; provision-level operative applicability is not established."
            : d.id === "mass_tort_authority_evidence"
              ? "25 selected court-opinion, dated federal-section, publisher-route, access-gap and legislative-status observations. The 2025 Georgia partial reversal and source-copy/treatment limits remain explicit; no extra calculator formula is activated."
              : d.id === "statutory_limitations_review"
                ? `${baseline.length} conditional baseline branches and ${researchRules} further-review records; source text and each rule’s applicability qualifications remain separate.`
                : d.id.includes("citation")
                  ? "Native source-selected metadata only. Mention counts do not encode judicial treatment, binding authority or outcome likelihood."
                  : d.id === "cl_master_entries"
                    ? "Selected native master-entry metadata with exact parent and document associations. Source-blocked dockets and sealed entry material are excluded. Descriptions, captions, party and contact details are not projected. Entry rows are not member cases, outcomes or independent availability findings."
                    : d.id === "cl_docket_metadata"
                      ? "Exact uploaded native identities or source-explicit FJC MDL foreign keys, with blocked records and unconfirmed candidates excluded. Public fields omit natural-person captions and party/contact data. This is not a current member-case census."
                      : "Complete selected publisher snapshot after structural/provenance reconciliation. It does not certify current appointments, institutional status or legal authority."),
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
      mdlAssociations.filter((m) => m.masterScope === "complete").length +
      " complete API entry scopes: " +
      mdlAssociations
        .filter((m) => m.masterScope === "complete")
        .map((m) => `${m.label} ${m.masterEntriesCaptured.toLocaleString("en-US")}`)
        .join("; ") +
      ". Other " +
      Object.keys(scopes.scopes).filter(
        (k) => k.startsWith("docket-entries:") && !scopes.scopes[k].complete,
      ).length +
      " captured scopes remain partial; publisher next cursors and observed totals are retained for continuation. Complete describes the captured dated API scope, not present case status.",
  },
  {
    id: "private-party-attorney-scope",
    label: "Native party and attorney metadata",
    status: "partial",
    records: type("courtlistener", "parties") + type("courtlistener", "attorneys"),
    sourceAsOf: "2026-10-02",
    qualification:
      type("courtlistener", "parties").toLocaleString("en-US") +
      " party identities and " +
      type("courtlistener", "attorneys").toLocaleString("en-US") +
      " attorney identities are retained privately. Each nested role/representation uses its own native docket ID; unrelated nested associations are not assigned to the outer query scope.",
  },
  {
    id: "document-locator-scope",
    label: "RECAP document metadata and URL inventory",
    status: "partial",
    records: type("courtlistener", "recap-documents"),
    sourceAsOf: "2026-10-02",
    qualification:
      documentAvailability.records.toLocaleString("en-US") +
      " document metadata records: the source marks " +
      documentAvailability.available.toLocaleString("en-US") +
      " available, " +
      documentAvailability.unavailable.toLocaleString("en-US") +
      " unavailable and " +
      documentAvailability.unknown.toLocaleString("en-US") +
      " unknown. URLs were collected without fetching their destinations. Availability and PDF bytes were not independently verified.",
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
const relationshipCoverage = receipt.relationships.map((row) => {
  const records = safeCount(row.records),
    unresolvedEdges = safeCount(row.unresolved),
    inferredEdges = safeCount(row.source_inferred);
  const paths = [row.source_system, row.from_type, row.to_type];
  if (
    paths.some(
      (value) => typeof value !== "string" || value.length > 120 || !/^[a-z0-9_-]+$/.test(value),
    )
  )
    throw Error("Invalid controlled source/type path");
  if (unresolvedEdges > records || inferredEdges > records)
    throw Error("Relationship subsets exceed source-version edges");
  return {
    source: row.source_system,
    from: row.from_type,
    to: row.to_type,
    records,
    unresolvedEdges,
    inferredEdges,
  };
});
const relationshipKeys = relationshipCoverage.map((row) => `${row.source}/${row.from}/${row.to}`);
const relationshipTotal = relationshipCoverage.reduce((sum, row) => sum + row.records, 0);
const localRelationshipSources = new Set([
  "local-sw-catalog",
  "local-vaquill-open-us-law",
  "local-source-registry",
]);
const localPointerTotal = relationshipCoverage.reduce(
  (sum, row) => sum + (localRelationshipSources.has(row.source) ? row.records : 0),
  0,
);
const sourceRecordedTotal = relationshipTotal - localPointerTotal;
if (
  !Number.isSafeInteger(relationshipTotal) ||
  relationshipTotal !== safeCounts.nativeRelationships ||
  new Set(relationshipKeys).size !== relationshipKeys.length ||
  (safeCounts.localPointerRelationships != null &&
    localPointerTotal !== safeCounts.localPointerRelationships) ||
  (safeCounts.sourceRecordedRelationships != null &&
    sourceRecordedTotal !== safeCounts.sourceRecordedRelationships)
)
  throw Error("Relationship coverage does not uniquely reconcile");
const data = {
  schemaVersion: "corpus-enrichment/1",
  updatedAt: receipt.captured_at,
  status: "partial",
  metadataOnly: true,
  counts: safeCounts,
  mdlAssociations,
  coverage: coverageRows,
  relationshipCoverage,
  deduplication: {
    version: "2026-10-02.3",
    recordsCompared: 42971,
    exactDuplicateGroups: 0,
    explicitAliases: 394,
    summary:
      "The exact duplicate audit covers 42,971 stated legacy reference/MDL rows, not the whole corpus. The 394 aliases are explicit person aliases in that audit, not all alias types. Native identities and all source versions are preserved. Two publisher testing courts were reversibly quarantined from active public registries. One exact CJA instructions record has an audited reviewed-type overlay while its original source cell remains intact; no people or cases were fuzzy-merged.",
  },
  legalReview: {
    sources: sources.sources.length,
    rules: rules.rules.length,
    jurisdictionsCovered: primaryJurisdictions,
    calculatorJurisdictions,
    qualification: `${sources.sources.length} statutory/federal text captures and ${references.cases.length} selected court-opinion HTML copies support this review. Primary statutory text was retrieved for ${primaryJurisdictions.length} state/DC jurisdictions; all ${coverage.coverage.length} have an inventory.${missingPrimaryJurisdictions.length ? ` Primary text remains pending for ${missingPrimaryJurisdictions.join(", ")}; publication-interface and PDF-only acquisition barriers are recorded in the cited inventory.` : ""} ${baseline.length} conditional baseline branches cover ${calculatorJurisdictions.length} jurisdictions; ${researchRules} records require further legal review. Governing-law, accrual, transition and exception gates apply to each supported branch. No jurisdiction has a comprehensive operative-law review. Holidays, filing/service cutoffs and unreviewed tolling are not computed.`,
  },
  categoryMap: {
    version: "2026-10-02.4",
    summary:
      receipt.mapped_categories +
      " exact native category mappings. Publisher identity, resource type and original source category stay separate; unknown future categories remain unmatched. Mixed histories and third-party summaries are not represented as operative law.",
  },
  qualifications: [
    "HTTP-source observations are cumulative across preserved ingestion runs. The historical sourceRecords and observations fields retain that HTTP-table grain; localFileOccurrences separately counts file SHA and row-ordinal evidence in the local occurrence table. Canonical entities and source versions include both publisher identities and source-qualified local IDs, including private and quarantined records. Public collection counts are stated separately. These units are not cases, people or verified legal outcomes.",
    "The historical nativeRelationships field retains the total of source-qualified, versioned edges. sourceRecordedRelationships counts nonlocal source-recorded edges; localPointerRelationships counts exact local producer/extraction pointers. Different versions can repeat an association. A local pointer establishes an exact record reference in its source snapshot, not publisher-native identity, legal applicability, judicial treatment or causation.",
    "Nationwide original snapshot acquisition and scoped Supabase imports have different coverage. Large original CSVs are retained outside Git; totals from the nationwide archive are not treated as imported case counts.",
    unresolved.toLocaleString("en-US") +
      " source-version relationship edges have no active imported target at this checkpoint, including absent or quarantined target observations; source field paths and version hashes are preserved. No target identity is filled from a similar name.",
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
