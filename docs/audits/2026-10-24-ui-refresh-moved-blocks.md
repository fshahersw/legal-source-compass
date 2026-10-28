# UI refresh 2026-10-24: blocks moved or demoted

Owner rule (2026-10-24 evening/night): demoted blocks are listed so they can be restored. Nothing below deleted data
or a data reader; each entry says where the content went.

| Page | Block | Now | Restore |
| --- | --- | --- | --- |
| Products & safety (`/safety`) | "Recalls by year" grid of four agency cards (`SafetyRecallTrends`) | One click away under the lead charts ("Each agency's recalls by year (4 charts)") | Put `<SafetyRecallTrends />` back in place of `<EachAgencyRecalls />` in `src/routes/safety.tsx` |
| Companies (`/companies`) | Method paragraph above the dashboard (`SourceLine`) | "How companies are linked" popover beside a one-line summary | Restore the `SourceLine` block in `CompaniesDashboard.tsx` |
| Companies (`/companies`) | KPI tiles "SEC registrants linked" (with XBRL count) and "Company–MDL links" (with tier split) | Figures in the one-line summary and the popover; the section header already shows profile and link counts | Re-add the two `Kpi` tiles in `CompaniesDashboard.tsx` |

| Every record page (`EntityPage`) | "Source scope" box above the record | "About this record" popover in the same place | Restore the `section aria-label="Source scope"` block in `EntityPage.tsx` |
| Court profile (`/courts/$id`) | Flat stack of 24 panels | Same panels, in five sections behind a sticky index; a section with no panel content for the court is hidden | Remove the `Section` wrappers in `src/routes/courts.$id.tsx` |

New lead charts (added, nothing removed): Litigation (JPML MDL change-since + 12-month change dots), Enforcement
(agency change-since + latest-period dots), Products & safety (recalls change-since + latest-period dots), Courts &
judges (federal caseload change-since + latest-year dots), Law & government (Federal Register rules by year; bills per
Congress split by became law).

## Judge and company profiles (2026-10-24)

- Judge pages: panels grouped into Career, Practices, Cases & MDLs and Disclosures behind the sticky index. The record's own section links ("On this page" strip, formerly sticky) now sit under a "Record details" heading as a plain link row; the index gains a "Record" entry. Nothing removed.
- Every record page that adds its own grouped sections (courts, judges): same change — one sticky index, record links under "Record details". Pages without grouped sections keep the old sticky strip.
- Company pages: the six tabs (Overview, Financial statements, Segments, Investor documents, Filings, Litigation) became four views. "Financials" shows Financial statements then Segments; "Documents & filings" shows Investor documents then SEC filings. `?tab=segments` and `?tab=filings` still work and put their part first. Restore: `COMPANY_VIEWS` in `src/components/companies/companySearch.ts`.
- Company segment charts: when two fiscal years end in the same calendar year (52/53-week years), those bars are labelled with their end date instead of a repeated year.

## Agency and MDL profiles (2026-10-24)

- Agency pages: tabs went from four (Overview, Rules & notices, Unified Agenda, All documents) to three. "Documents" shows the 12 most recent documents with the type filter, then a "Browse every Federal Register document" button that opens the full browser (formerly the "All documents" tab). The overview panels are unchanged, now grouped into Rulemaking, Pipeline, Money, Law and structure, and Data; the oversight panel sits in Data. Added: AI summary and Ask AI under the headline figures.
- MDL pages: the seven tabs became four views. Overview shows Overview then Lifecycle & signals; Cases & parties shows Member cases then Parties & counsel; Docket & documents shows Docket entries then Documents; Evidence & sources is unchanged. Every former `?tab=` address opens its view with its own part first. Restore: `MATTER_VIEWS` in `src/lib/matters/search.ts`.
- MDL "Membership & coverage": removed the "Member-like dockets" and "Parties & counsel" tiles, which repeat the header figures exactly (same registry counts). The membership-evidence breakdown and the per-provider docket-entry tiles stay. Restore from git (`src/components/matters/OverviewPanel.tsx`, RegistryCard).

## Decluttering pass (2026-10-27)

- Companies landing: removed the hub's four record-count tiles (companies profiled, company–MDL links, Open Payments manufacturers, MAUDE-matched manufacturers) and its one-card "In this section" block (Industry payments, already a header tab). The page opens with the dashboard's own figures; the profile and link counts stay in the line above them. Restore: `HUBS.companies` in `src/components/atlas/hub/hubs.ts`.
- Companies cluster flags: each flag's rule moved from the button into the "How each flag is set" popover (and the button's tooltip). Restore: `ClusterFlags` in `src/components/companies/CompaniesDashboard.tsx`.
- EPA enforcement: the first two key takeaways (window penalties and cases opened) repeated the KPI tiles and were dropped; the flag rules moved into info popovers; the "Largest case" block in Flags repeated the takeaway and the largest-cases table and was removed. Restore: `EpaBody` in `src/components/enforcement/EpaEnforcement.tsx`.
- Insights board: a data-layer tile that repeats another tile's exact figure, period and change in the same area is left out of the area lists and "What moved most" (2026-10-27: Federal civil cases filed, Department of Justice press releases, Resident population (July 1), Final rules published in the Federal Register). Each stays in Trends. Restore: `repeatedTileIds` use in `src/components/insights/OverviewBoard.tsx`.
- Section landings ("In this section"): a link card that leads to a destination already in the section's header menu is left out (`linksNotInHeader`, `src/components/atlas/hub/hubLinkFilter.ts`). 2026-10-27 effect: Courts drops all five (Judges, Caseload, Vacancies, Compare courts, Compare judges); Litigation keeps Emerging torts, Court filings, Matters workspace and Case registry; Law drops all six; Enforcement keeps Settlements and Federal rulemaking; Products & safety keeps Signals; Places keeps County map. Links into other sections always stay. Restore: pass `hub.links` straight to `HubLinks` in `SectionHub`.
- Record pages (`EntityPage`): source identifiers and provider flags in the identity box ("CourtListener court id", "FJC court id", "Local registry key", "In use (CourtListener flag)") move to "Technical details and provenance"; the header line drops its "<provider> id <id>" segment; provider names in field names, provenance explanations in values ("NY — state name printed in the … court name") and provenance notes in link labels ("Court website (url as recorded by …, not re-checked)") move into tooltips. The recorded values are unchanged. Rules: `src/components/corpus/recordDisplay.ts`; restore by removing their use in `EntityPage.tsx`.

## Regulatory monitor (2026-10-28)

- FDA analytics (`/law/monitoring`, FDA analytics): the grid of recharts cards became chart-kit cards that open with a "What stands out" list (computed from the snapshot) and an AI summary, a KPI strip with change against the prior window, recalls by period beside a recall class mix, a change-vs-prior chart, adverse-report trends with their top products, and device decisions with decoded 510(k) and PMA codes. Nothing in the snapshot is dropped. Moved: on the Overview tab the cosmetic, veterinary, tobacco, Complete Response Letter and device recall database charts became tiles that open their own tab (the full charts are there), and the catalog inventories show only on the Catalog tab (and at the bottom of each product tab). Restore: the former `DashboardCharts`, `MetricCard`, `DatasetTimeline`, `FacetCard`, `RecallClassification` and `InventoryPanel` in `src/components/fda-analytics/FdaDashboard.tsx` (git history, commit before 2026-10-28 "Regulatory monitor").
- Source changes: the five-column table became a compact list (event type, title, source, document type, native id, dates, entity labels, changed fields). A reason shared by most rows of a page is printed once above the list instead of on every row; a different reason stays on its row. Entity namespaces and native ids remain in the evidence drawer. Added above it: family filter chips, KPIs, daily detections by kind and records by source. Restore: the `<table>` block in `src/components/regulatory/RegulatoryMonitoring.tsx` (git history).
- Recall patterns: "Recalls by year" no longer draws a second y-axis; FDA years are stacked Class I and other classes, and the CPSC China share is its own small line chart. Restore: `YearChart` in `src/components/regulatory/RecallPatterns.tsx` (git history).

## Product watch (2026-10-28)

- Products & devices (`/safety/products`): the page now opens on the product watch (which drugs and device product codes have FDA reports rising faster than their source, their MDL status, rising death reports), read through `public.safety_watch_v1` (`database/contracts/safety-watch-v1.sql`). The three lists stay one tab away; the "Named in MDL titles" list, formerly the default, is `?view=mdl`, and `?view=drugs` / `?view=devices` are unchanged. Restore: default `view` back to "mdl" in `src/routes/safety_.products.index.tsx`.
- Product pages (`/safety/products/$id`): a "Product watch" line (signal, expected count, MDL status, 36-month strip, Ask AI) sits under the headline figures. Added; nothing moved.

## Visual stories (2026-10-28)

- New page `/insights/stories` (owned by the Insights Overview tab, no new tab): the MDL docket race over every captured JPML pending report, a streamgraph of the whole docket and the live defendant network from SEC filings, read through `public.corpus_mdl_docket_v1` and `public.corpus_defendant_network_v1` (`database/contracts/visual-stories-v1.sql`). The Insights Overview tools list gains a "Visual stories" entry. Added; nothing moved or removed.
- Visual stories, second pass (same day): four more sections from `public.corpus_mdl_atlas_v1` (`database/contracts/mdl-atlas-v1.sql`): the court map (actions pending per transferee district, on the race's playhead), every case as dots (unit chart, regrouped by MDL, type, court, judge or year), every MDL's life (heatmap of all 704 MDLs across the reports) and the co-defendant chord (from the SEC defendant links). Added; nothing moved or removed.
