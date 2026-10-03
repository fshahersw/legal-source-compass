# Citation accuracy review - 2026-10-03 (data-quality, round 2, work item A)

Run `af6ac9c6-b834-497d-bd19-17970d4857d3` (continuation of `664a081e-b5a6-4ab0-af5a-41c260b0d09b`). Branch `claude/data-quality-20261003`.

## Method

* Exported read-only, via the app's own read path (PostgREST), every row of `citation_index` (60,616), `citation_reference` (2,433),
  `cl_reporter_citations` (26) and `cl_citation_edges` (201). No credential value is printed or stored in the repo.
* Validated each stored citation string with **eyecite 2.7.8**, **reporters-db 3.2.66** and **courts-db 0.10.27**:
  parse as exactly one full citation; `matched_text()` / `corrected_citation()` equal the stored string; reporter / volume / page
  structure; edition year range; CourtListener court id; link, facet and detail-fact consistency; duplicates on the stored string.
* Rule from the coordinator: fix only deterministic formatting defects that eyecite's normalized form proves equivalent, with
  before-images; flag everything else, never delete.

## Applied (both reversible; before-images in `corpus_ingest.cleanup_decisions`, rollback SQL in each contract header)

| Fix | Contract | Rows | Proof |
|---|---|---|---|
| Stray trailing comma removed from the citation title (`Pub. L. No. 104-208,` -> `Pub. L. No. 104-208`) | `citation-index-trailing-comma-r2-20261003-v1.sql` | 250 (of 282) | stripped string parses as exactly one FullCitation with `matched_text = corrected_citation =` stripped string; id whitelist + "no other row already has that title" guard; virtual revert 250/250 identical |
| `filters.reporter` facet set to the reporter exactly as written in the (eyecite-normalized) title when it differs only by spacing / punctuation / case / apostrophe | `citation-index-reporter-facet-r2-20261003-v1.sql` | 6,223 rows, 140 spellings | alphanumerics identical after lower-casing and canonical spelling literally present in the title; virtual revert 6,223/6,223 identical; option list rebuilt, 0 count mismatches |

Effect on the "Reporter or code" filter of the Citation index: distinct values 673 -> 549, reporters split over several options 94 -> 5
(`Cal.App.4th` 641 + `Cal. App. 4th` 19 -> `Cal. App. 4th` 660; `L.Ed.2d` 450 + `L. Ed. 2d` 554 -> 1,023; `S.Ct.` 190 + `S. Ct.` 2,313 -> 2,528;
`CFR` 204 + `C.F.R.` 656 -> 862; `US` / `U. S.` / `U.S.` -> 10,922; `F.3d` / `F. 3d` / `F.3d.` / `F3d` -> 11,208). Links and `source_url` were
deliberately not touched: CourtListener's `/c/<reporter>/<vol>/<page>/` lookup slugifies every spelling (18 variants probed, e.g.
`/c/US/505/144/`, `/c/U.%20S./...`, `/c/F3d/...`, `/c/S.W,2d/...` all answer 302 to the canonical slug), so the 6,080 "link spelling differs from title" rows are benign.

## Findings table (NOT changed - flagged for the owner)

| # | Finding | Rows | Why it was not fixed | Suggested action |
|---|---|---|---|---|
| 1 | Trailing comma on titles whose stripped form already exists as another row (`Pub. L. No. 104-208,` 89 mentions vs `Pub. L. No. 104-208` 1 mention) | 32 | merging needs summed mention counts and unioned document sets - not a formatting fix | ingest owner re-aggregates; then remove the comma rows |
| 2 | Duplicate citations with split counts (`52 FR 10011` / `52 FR 10,011`; `18 U.S.C. §2261-2262` / `§ 2261-2262`; `548 U.S. 1` / `548 U.S., 1`; `5 M.S.P.B. 313` / `5 MSPB 313`; `Pub. L. 92-544` / `.` / `,`) | 74 groups, 150 rows | same as 1 | same |
| 3 | Facet says one abbreviation, title another: `Fed. Reg.` vs `FR` (924), `Public Law` vs `Pub. L.` (154), `U.S.C.A.` vs `U.S.C.` (49), `United States Code` / `U.S. Code` vs `U.S.C.` (25), `Fed. Appx.` vs `F. App'x` (103), `T.C.M. (CCH)` vs `T.C.M.` (30), N.Y. code names vs `N.Y.` (~28), other publisher editions (BNA/RIA/CCH) | 1,353 | not a spacing/punctuation difference; editions can differ in meaning (U.S.C.A. is the annotated code) | product decision; a mapping table is in `_work/agents/data-quality/citations/results/reporter_facet_plan.json` |
| 4 | Titles missing the code name: `Cal. Code § 11362.5`, `Tex. Code Ann. § 481.121` (facet holds the real code: `Cal. Health & Safety Code`); `N.Y. Law § 1441` (facet `N.Y. Tax Law`) | 149 + ~28 | rewriting changes the identity of the entry (same stem + section number can merge different codes) | ingest fix: key the entry on code name + section, then title = facet + section |
| 5 | Parsed year is not a year (`163 U.S. 662 · 5204`, `109 S. Ct. 2397 · 3142`, `116 F. 350` year `1180-81`): a page / pin cite taken as the year, shown in the subtitle and in the "Year as parsed" fact | 64 | removal, not a formatting fix | proposal: drop the subtitle suffix and fact when the year is outside 1750-2026 (SQL in `docs/data-quality-round2-2026-10-03.md`) |
| 6 | Parsed year contradicts the reporter volume era (`224 F.3d 1152` year 1991; F.3d starts 1993) | 392 (1,561 raw flags; 1,167 are reporters-db range errors - F. Supp. ends 1998 not 1988, F.R.D. starts 1940 not 2001, U.S. starts 1790 not 1875 - or within 1 year) | cannot determine the true year | UI may hide the year for these; list in `results/year_inconsistency_real.json` |
| 7 | Parsed court is not a CourtListener court: `vaccappomattox` on 334 `Ariz.`, 85 `P.2d` and 36 `P.3d` citations (a Virginia circuit court); `supctdc` on 10 `N.Y.S.2d` / `N.W.` / `Wis.` citations | 470 | courts-db returned its first match for an ambiguous reporter; the true court is not recorded | proposal: remove the "Court as parsed" fact when the id is absent from `court_spine` |
| 8 | Impossible public-law number `Pub. L. 99-4991` (99th Congress enacted fewer than 800 laws; `Pub. L. 99-499` exists as a separate row) | 1 | needs source check | ingest owner |
| 9 | Titles eyecite cannot parse as a citation (`Cal. Code § N`, `Tex. Code Ann. § N`) | 149 | same as 4 | same as 4 |
| 10 | eyecite 2.7.8 `corrected_citation()` is not deterministic for N.Y. subject laws (`N.Y. Penal Law § 10.00` -> `N.Y. Law § 10.00` in one process, unchanged in another) | 8 | tooling quirk, titles are as stored | not used as evidence anywhere |

No action needed (recorded so nobody re-investigates): non-numeric pages (117, e.g. `2026 IL App (1st) 231798-U`) and volumes (10, e.g. `1977-1 Trade Cas. (CCH) ¶ 61,508`) are legitimate formats; 54 statute-like strings without a locator are patents / registrations; 265 distinct parsed court ids are all valid in courts-db.

## Link integrity (citation_index internal links)

| Link kind | Rows | Resolve to a record |
|---|---|---|
| `#record/oul:<hash>` saved law text | 3,064 | 3,064 |
| `#federal-register?q=<doc no>` | 558 | 558 (`federal_register_history.source_url`) |
| `#public-laws?q=<n>-<m>` | 49 | 49 (`public_laws` `PLAW-<n>publ<m>`) |
| CourtListener lookup (`/c/...`) | 49,299 | external; spelling variants all redirect to the canonical slug |

## The other three datasets

* `citation_reference` (2,433 = 1,262 reporters + 373 laws + 798 journals): every row maps to a reporters-db entry (abbreviation, name, type, edition count, year range agree; `~N` id suffixes disambiguate reporters sharing an abbreviation); 2 session-law rows show the abbreviation as the name because reporters-db has no name. **Display issue:** 654 reporter rows show years such as `1750 to present`; 1750-01-01 is reporters-db's placeholder for "start unknown" (the first U.S. reporter is 1754), so the UI should show "dates not recorded".
* `cl_reporter_citations` (26): 0 defects - title = `volume reporter page`, eyecite parses each exactly, CourtListener type codes agree with reporters-db (1 federal, 4 specialty, 6 LEXIS, 7 West), all 26 `cluster_id`s resolve to an imported cluster.
* `cl_citation_edges` (201): 0 structural defects - ids numeric, titles equal the cells, no self-citations, no duplicate pairs. Resolvability: the 12 citing opinions all resolve through `clusters.sub_opinions`; the 179 cited opinions are not in the scoped snapshot (no `opinions` entities exist), so no edge can point at a stored opinion - by design, not a defect.

## Reproduce

`_work/agents/data-quality/citations/` (outside the repo): `export_*.mjs` (read-only export), `validate_citation_index.py [before|after]`, `validate_other_citations.py`,
`analyze_reporter_spelling.py`, `plan_reporter_facet.py`, `analyze_trailing_and_dups.py`, `probe_cl_links.mjs`; results in `results/`. Copies of the pure-Python validators are in `docs/data-quality-tools/`.
