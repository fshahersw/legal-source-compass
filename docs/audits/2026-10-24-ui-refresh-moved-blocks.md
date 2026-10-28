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
