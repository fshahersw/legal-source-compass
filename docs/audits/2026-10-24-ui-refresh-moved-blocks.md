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
