# Use the whole corpus, and reorganize the app

## What is in your database right now (checked)
- About 5.28 million records across 71 datasets, plus 108,122 stored files (PDFs and images), 196,458 law outline entries and 818,617 law text segments.
- The app currently uses only 4 of them: judges, MDLs, law outlines, and county tags.
- Unused groups include:
  - **Judges:** enrichment (11,926), disclosures (21,832), entities (10,669), MDL appearances (878). The portraits dataset has 0 rows.
  - **MDLs and matters:** docket activity (26,549), docket documents (5,016), case inventory (4,159), counsel (6,940), crosswalk, settlements (869), verdicts (3,312), expert rulings (2,035), state proceedings (1,432).
  - **Courts:** court spine (5,413), court reference with seal images (253), court statistics (374), court documents (20,861), court forms (4,475), uscourts pages, county litigation (3,311).
  - **Laws and regulations:** state and federal codes (open_us_law 2.97M), CFR sections and parts, public laws, Federal Register (1M), limitation periods, citations.
  - **Agency safety:** FDA, openFDA, CPSC recalls and injury data (more than 700k rows).
  - **Other:** people biographies, counsel directory, the URL directory, saved pages, coverage topics and labels.

## New navigation (replaces today's 14 loosely grouped pages)
```text
Search (one box across everything)
Places      map -> state -> county -> courts, judges, records
Courts      court directory -> court page (seal, stats, judges, rules, forms, documents)
Judges      directory -> judge page (bio, disclosures, MDLs, courts)
Matters     MDLs -> MDL page (docket, cases, counsel, settlements, verdicts, experts)
Law         statutes, regulations, Federal Register, limitation periods, citations
Safety      FDA / CPSC recalls, enforcement, injury data
Sources     the current Atlas library, families, endpoints, review queue
My work     saved items, exports
Data        a catalog of all 71 datasets with live row counts
```
- The separate Overview, Insights, Categories and Jurisdictions pages get merged into Places and the Data catalog, so the same information isn't shown twice.
- The sidebar gets grouped sections with counts. Every page gets the same header, breadcrumbs, filter bar and right-hand detail drawer.
- Every entity links to related ones (court to judges, judge to MDLs, county to courts).

## Build order
1. **Data catalog plus universal record drawer.** A generic view for any dataset, so none of the 71 stays hidden. The drawer shows each record's own fields, links and attached files.
2. **Files and images.** Seal images and PDFs are served through a secure pass-through to your stored files. The exact storage location still needs checking; if the files can't be reached, they'll be labeled "file not available" instead of being hidden.
3. Courts, Judges and Matters detail pages, joined by the IDs the records already carry. Nothing is guessed.
4. Law, and Safety.
5. Global search using your database's existing search functions.
6. Navigation cleanup and removal of the redundant pages. Then tests, a browser check of every section, and an updated verification report.

## Guardrails
- Read-only access, all counts computed live, no invented data, and no crawling.
- Anything that doesn't join cleanly is labeled "unlinked".
- The app stays unpublished. Anyone with the preview link can view the data.

## Technical notes
- Add server functions in `src/lib/external/` for: dataset list, a paged generic dataset query (`corpus_records` filtered by dataset, category and state), `rpc/corpus_detail`, `corpus_group_detail`, `corpus_query_bounded`, and law path/segments.
- Add a file-proxy server route that resolves `corpus_artifacts.route` to its object and streams it. The storage host still needs to be confirmed.
- Use a shared `EntityPage` / `RecordDrawer` / `DatasetTable` component set. The route tree gets reorganized under `/courts`, `/judges`, `/matters`, `/law`, `/safety`, `/sources`, `/data`, and old paths redirect.
