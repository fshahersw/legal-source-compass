# Research workbench · October 2, 2026

The `/insights` route now provides state comparisons, judge research, case cohorts and relationships, citation paths, and the publisher's court/resource hierarchy. Context links connect it to state directories, judge profiles and case listings. The four main navigation sections remain unchanged.

## Source collection

- Federal Judicial Center nightly CSV exports: 4,077 unique Article III judges and 4,777 service appointments. Original CSV bytes are retained. The derived view contains names, native IDs and court/service history.
- Census Vintage 2025: July 1 population estimates for 50 states and DC. Their total reconciles to 341,784,857 nationally.
- U.S. Courts FY 2025 Table C-5: 94 district rows reconcile to 355,243 reported terminations, across all disposition-stage categories. The existing Table C workload benchmark remains a separate population.
- DOJ Library Staff: 56 jurisdiction pages retrieved live with Firecrawl, all HTTP 200. The 51-state/DC derived view retains 2,951 links and the publisher's section/subsection labels. Linked destination pages have not all been independently checked.
- Four MDL research readings: AFFF/PFAS (2873), GLP-1 GI injuries (3094), Bard implanted ports (3081), and proton-pump inhibitors (2789). Seven court-published pages/PDFs were retrieved. Each reading links an identified dated order and its pinpoints; later operative orders require separate review.
- Native court crosswalk: 1,391 short court IDs read from the existing Supabase `court_spine`, without database writes. All 79 court IDs used by the case catalog are present. The crosswalk maps 2,023 cases to states; 99 appellate/JPML cases have no single-state assignment.

Official downloads and retrieved-page captures have SHA-256 checksums in `public/data/research/source-manifest.json`. All public files remain below 10 MB each. No original corpus file is rewritten.

## Interpretation and matching

Federal district workload grouped by state is distinct from state trial-court workload. Population normalization uses July 2025 population and fiscal-year court counts. Terminated/filed is a flow ratio and may exceed 100%. FJC district-judge headcount includes senior judges and is not a measure of seats or full-time capacity. Service is evaluated at September 30, 2025 for workload comparisons.

Pearson and Spearman correlations use complete finite pairs; tied ranks are averaged and constant series return unknown. Coefficients and all observations can be downloaded. Associations do not establish causation or case-outcome probabilities.

Case durations require recorded terminated status and valid, non-reversed full ISO dates. Unknown durations remain unknown, and every statistic shows its cohort or usable sample size. Median and quartiles use interpolated empirical quantiles; active cases are excluded. District medians are never averaged into a state median.

FJC biographies join only to a unique exact full-name match, normalizing punctuation, spacing and case while preserving initials and suffixes. MDL relationships require the uploaded native master-docket crosswalk. Related-case views identify their exact recorded relationship; shared counsel or a judge is not a citation edge. Master-docket documents are identified as such.

Citation paths use existing publication-gated, read-only server functions and retain native facts, excerpts and document links. Native search can match citing-document text. Preview item counts are distinguished from the publisher's full reported counts; an unknown listing total is not synthesized. The deployed server connection works; the local public key lacks access to the protected corpus tables, so citation UI must also be checked on the deployed release. No database permission is widened.

## Reproduction

1. `node --use-system-ca scripts/fetch-research-sources.mjs` downloads the four official CSV/XLSX sources.
2. Retrieve the observed DOJ jurisdiction URLs and identified court pages/PDFs with Firecrawl; save their source metadata and markdown in the two raw capture JSON files.
3. `node scripts/register-research-captures.mjs` hashes the captures.
4. Run `scripts/import-research-sources.py` with Python and openpyxl to derive the view files and reconcile source counts.
5. Run `npm test`, the repository TypeScript compiler, `npm run build`, and `npm run audit:check`.

Pure analysis tests reconcile real source files, enforce identity boundaries, test missing/invalid dates and correlation cases, and confirm that each MDL reading has a retrieved court source. Browser checks cover state selection, correlations, judge-to-case cohorts, MDL filters, source hierarchy filtering, downloads and narrow layouts. Live citation behavior and the published research snapshots are verified after deployment.
