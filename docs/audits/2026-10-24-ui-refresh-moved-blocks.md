# UI refresh 2026-10-24: blocks moved or demoted

Owner rule (2026-10-24 evening/night): demoted blocks are listed so they can be restored. Nothing below deleted data
or a data reader; each entry says where the content went.

| Page | Block | Now | Restore |
| --- | --- | --- | --- |
| Products & safety (`/safety`) | "Recalls by year" grid of four agency cards (`SafetyRecallTrends`) | One click away under the lead charts ("Each agency's recalls by year (4 charts)") | Put `<SafetyRecallTrends />` back in place of `<EachAgencyRecalls />` in `src/routes/safety.tsx` |
| Companies (`/companies`) | Method paragraph above the dashboard (`SourceLine`) | "How companies are linked" popover beside a one-line summary | Restore the `SourceLine` block in `CompaniesDashboard.tsx` |
| Companies (`/companies`) | KPI tiles "SEC registrants linked" (with XBRL count) and "Company–MDL links" (with tier split) | Figures in the one-line summary and the popover; the section header already shows profile and link counts | Re-add the two `Kpi` tiles in `CompaniesDashboard.tsx` |

New lead charts (added, nothing removed): Litigation (JPML MDL change-since + 12-month change dots), Enforcement
(agency change-since + latest-period dots), Products & safety (recalls change-since + latest-period dots), Courts &
judges (federal caseload change-since + latest-year dots), Law & government (Federal Register rules by year; bills per
Congress split by became law).
