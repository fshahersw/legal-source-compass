# Legal Source Atlas — roadmap

- [x] First version: seven views, search/filters, drawer, local reviews/bookmarks, CSV/JSON exports
- [x] Real V2.2A adapter + meta-claim cross-check
- [x] Bundle the real V2.2A file; auto-load on first visit
- [x] IndexedDB raw-byte storage for user imports; legacy localStorage migration; explicit save failures; Retry
- [x] Raw bundle / original-file downloads; raw record in JSON export
- [x] Source Families: all 8 manifest families, computed counts by ID, unassigned/ambiguous labelled
- [x] Data & Exports overflow + title fixes
- [x] Verification report in docs/
- [x] Consolidate navigation, duplicate pages, labels, and dataset presentation while preserving the current visual design
- [ ] Later (out of scope now): Tavily server-side harvesting
- [x] Case analytics (year×status, defendants, firm roles, median close, state map) + defendant/role filters; /insights redirects
- [x] Agency profiles (Federal Register agency list, exact type counts, recent docs, all docs, safety links)
- [x] Provision page: copy citation, eCFR, Federal Register link
- [x] Provision page: Title·Part·Subpart line, Dates & sources tab
- [x] Map as home page; library at /sources/library; V2.2A labels removed; state source rows clickable
- [x] Retire Categories/Jurisdictions/Families/Endpoints into library filters; merge state sources with Registry V2.2 duplicates
- [x] Supporting tables into court/case/county pages; court mini-map; MDL judge links
- [x] DB-based coverage gaps column
- [x] Case registry (matters/parties/outcomes/docket documents) + Registry matter pages
- [x] Source catalog integrated into library; court website links on state pages
- [x] Email/password sign-up, sign-in, reset; sidebar AccountBox
- [x] Collapsible sidebar (icon rail, persisted choice, header toggle)
- [x] Court artwork on every court profile (verified exact-ID marks, honest court-type fallbacks, shared matter-page treatment)
- [x] Time Limits calculator: single-page flow, grouped confirmations, live missing-requirements list

## Time Limits accuracy program (started 2026-10-08)
- [x] Currency recheck of every official limitations source: direct fetch where the host allows it, otherwise passage matching against the publisher's current code text in the corpus (route recorded on each source); 198 sources still unreachable by either route, 40 rules without literal evidence
- [x] Recheck status shown in the app: "Last re-checked" on every rule, per-source status chips, matched code sections, fresh-text links
- [ ] Gap backfill: not-recorded and flagged claim cells from official captures with literal evidence; AR/GA/MS official-compilation blockers documented
- [ ] Claim taxonomy expansion from official text already captured (defamation, intentional torts, breach of warranty UCC 2-725, legal malpractice) — only literal-evidence entries
- [ ] Cross-references: tolling/repose/counting provisions and official-opinion precedents attached to rules; nothing from secondary reproductions
- [x] State code reader: clickable outline with counts, breadcrumbs, filter, previous/next, section position + "Show in outline", toolbar (official source, copy citation/text/link), "Time limits citing this section"
- [ ] Time Limits → statute panel: per-state list of cited sections with excerpt, last checked and change status, claim matrix with variants
- [ ] Release 2026-10-08.1: build, stage to private storage with hash readback, activate manifest, verify in app; audit report in docs/
- [ ] Owner action: apply `database/contracts/corpus-publisher-code-projection-v3-outline.sql` (outline dead-ends on skipped optional levels: PA 12/51 titles, NY 7/94 laws); site switches to v3 automatically
- [ ] Full state code intake: CA/HI/KS/NJ acquiring; AR/GA/MS/TN absent (GA gated behind Lexis) — see docs/state-codes.md
- [ ] Manual review of the 3 code-capture mismatches (NH opinion PDF, PA MCARE session law, SD duplicate rows)
