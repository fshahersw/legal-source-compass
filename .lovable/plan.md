# Legal Source Atlas: coherent pages and trustworthy analytics

## Outcome
Make each page easier to scan: one identity area, a compact headline band, a few useful charts, and one section index. Extend existing components rather than building parallel versions. Use more corpus data only when its meaning, coverage, identifiers and periods support the proposed analysis.

## Current evidence
- Texas at 1039×635 eventually loads without page errors, but six modes, a separate capitol card, two headline rows and another section index delay the analysis. Initial blank loading needs measurement, not an assumed permanent failure.
- Courts/Litigation open with five large loading/headline tiles and uneven last rows. Repeated takeaways and long descriptions compete with plots.
- Ask AI, map zoom/pan, district median dots, court tiers, agency diagrams and law readers already exist. Extend them rather than duplicate them.
- Loaded court-diagram contrast remains unverified: the latest hierarchy screenshot was a skeleton.
- Ask AI defaults to 40 figures and only the first source label, without explicit unit. MDL parsing defaults missing counts to zero and casts monthly rows without validation.
- Live corpus coverage was not inventoried here. Company numeric accrual history, compatible cross-agency penalties, member-docket bubble counts and district spread remain unverified.

## Scope and invariants
Keep all nine sidebar sections and existing URLs. Keep Time Limits engines, bundles, manifests and release tools untouched. Preserve corpus scripts, acquisition caches and active import checkpoints. No inferred people/entity links, invented hierarchy edges, estimated amounts or implicit current-law claims.

Source names, attribution and methodology remain in info popovers and exports. Essential interpretive markers—unit, period, partial period, missing coverage, denominator and sample size—stay visible where hiding them would mislead. Official image credit remains accessible with its recorded source and licence.

## Corrections to the brief
- Clearance is a flow ratio, not proof of backlog change or efficiency. Use aligned count/percentage panels, not dual axes; label >100% “More terminations than filings.”
- Keep the district-median baseline; national case-level median is separate. Across-district range is not within-district spread.
- MDL bubble area needs evidenced member-docket counts; otherwise fixed-size points. Never substitute cumulative actions.
- Maps need matched denominators/periods. Preserve raw-count tables, DC and territory destinations; no invented rates.
- Reuse current card radius/tokens; retain compact type sizes and remove negative tracking, not another global radius migration.

## Sprint 1 — Cohesion and truthful existing views
**First implementation batch; no new analytical data required.**
1. Capture loaded/slow/error/empty baselines for Texas, California, Courts, Litigation, Enforcement, Law and Companies; sample court/judge/agency/company profiles in both themes.
2. Balance headline grids and tighten shared chrome so analysis appears sooner at your window size. Assign each metric one narrative owner; remove redundant badges/echo paragraphs, not underlying data. Log moved blocks.
3. Consolidate state modes to at most four while keeping old `?tab=` destinations working. Keep one scroll index. Integrate recorded capitol imagery into the identity area.
4. Give independently loaded blocks bounded loading and explicit error/retry/empty states; slow directories cannot hide the whole page.
5. Check loaded court/agency diagrams for contrasting boundaries, equal tier proportions, legible connectors, stable imagery and wrapping labels. Distinguish directory grouping from evidenced appeal/reporting edges.
6. Make Ask AI carry page/entity, selected filters, chart topic, all shown table values, units, sources, period and gaps. Limits must be disclosed and backed by an evidence reference, never silently truncate or include unrelated page data.
**Exit:** coherent loaded pages, honest loading/errors, no duplicate metric narrative, and verified chart-to-chat context.

## Sprint 2 — Three useful analytical questions
**Filings versus terminations:** add `ClearanceRateChart` to Litigation after verifying civil fiscal-year rows. Aligned count and ratio panels share years; ratio has 100% reference. Divide only positive filings with matched scope/period. Preserve gaps; exclude incomplete years from findings. Table contains counts and ratio.

**MDL momentum:** validate `getMdlAnalytics` monthly observations. Match exact MDL and report month twelve months earlier, never nearest-date observations. X=current pending (log); Y=signed absolute 12-month change. Put zero-pending proceedings in a separate list; show zero-change divider, not invented rapid/steady/dormant quadrants. Tooltips use recorded caption/court/judge/dates and exact profile links. Fixed-size dots unless member counts are evidenced.

**District comparison:** extend existing `DistrictSpeedChart`. Keep ≥500 terminations eligibility and median-of-district-medians baseline; national median separately. Link only resolved court profiles, otherwise plain labels. Add spread only with published percentiles/ranges.
**Exit:** concrete fixture tests, chart/table parity, real populated flow verified; missing evidence reported.

## Sprint 3 — Maps and hierarchy navigation
- Add `AtlasMap` adapter and equal-area tile mode over existing `MetricMap`; reuse geometry, zoom/pan and county layer. Wire fit-to-state without breaking navigation.
- Share values, selection and five-class legend across modes. Name quantile versus equal-interval breaks; handle ties. Zero and missing remain distinct. Rates require valid denominators/periods. Keyboard controls and parallel data list remain.
- Roll out Overview/Places first, then other sections only with supported regional measures; no duplicate unsupported maps.
- Build shared `LawTree` over existing reader contracts, not dataset-classification `external/lawTree.ts`. Preserve recorded IDs, skipped levels, order, citations, versions and destinations. Text/outline/link coverage chips require evidence; retained text never implies current law.
- Refine existing court/agency components. Dated official internal org charts stay references until reporting edges are actually acquired; Government Manual headings are not edges.
**Exit:** geo/tile parity, real reader destinations, no invented structures/coverage.

## Sprint 4 — Registry imagery and eligible corpus enrichment
- Inventory exact-ID court/judge/agency/place/company registry coverage; reuse existing artwork/identity components. No generated official imagery or invented seals. Keep recorded credits/licences accessible.
- Judge timelines use individually recorded events and date precision, never inferred continuous tenure; no wall of empty tiles.
- Read-only dataset eligibility matrix: source, period, unit, grain, exact key, useful question, query, missingness and join feasibility. Prioritize useful supported datasets, not raw size.
- Penalties: separate eligible agency distributions first. Preserve assessment/settlement definitions, currencies and periods; no pooled incomparable values or totals extrapolated from capped samples. Bins [0,10k), [10k,100k), [100k,1M), [1M,10M), [10M,+∞). Null/negative adjustments are not zero fines. Medians come from records, not bucket centres.
- Company accrual joins require exact CIK, fiscal period, unit and amendment identity. Narrative is not a numeric accrual. If absent, provide concise sourced disclosure links. Use aligned panels or a verified positive-denominator ratio rather than tiny accrual bars beside huge revenue bars.

## Technical delivery contracts
Read scoped `AGENTS.md` before edits and runtime/server rules before server work. Reuse current read-only queries. Create helpers before importing views; record structural decisions in `AGENTS.md`.

| Target | Interface, data/helper | Fallback and tests |
|---|---|---|
| `src/styles.css`; both kit/chart-layer `ChartCard.tsx` | Existing slots, tokens and ready/loading/error/empty states | Stable dimensions; browser geometry, contrast and retry checks |
| `kit/ai/chartContext.ts` and callers | Typed page/entity/filter/unit/all-source/row context; existing assistant | Explicit limits; tests for nulls, multiple sources, >40 figures; real chart-to-chat check |
| Primary routes, `places.$state.tsx`, state overview/headline panels | Existing queries, metric ownership ledger, legacy search parser | Independent errors; preserve old tab URLs; loaded/error screenshots |
| New `litviz/clearanceRate.ts`, `ClearanceRateChart.tsx` | Matched year/count/completeness rows; pure ratio helper | Tests: 80/100=80%, 120/100=120%, zero filing=null, partial excluded, gap not connected |
| New `litviz/mdlMomentum.ts`, `MdlMomentumScatter.tsx`; MDL parser | Validated `getMdlAnalytics`; exact-month join, optional evidenced member count | Tests: missing month/null count/duplicate report; zero excluded from log; no inferred membership |
| `courts/caseload/DistrictSpeedChart.tsx`, `districtSpeed.ts` | Current median helper + exact court-page resolution | Tests: 500 threshold, median-of-medians, unavailable profile remains unlinked |
| New `charts/maps/AtlasMap.tsx`; `places/MetricMap.tsx`, `mapView.ts` | Existing GeoData/MapArea callbacks + mode; shared rate/class helpers | Tests: missing denominator, period mismatch, zero/null, ties, DC and mode parity |
| New `charts/hierarchy/LawTree.tsx` + existing reader adapters | Recorded ID/label/children/destination/coverage/version nodes | Lazy loading/retry; tests: skipped levels, historic text, missing text; real reader links |
| Existing court/agency diagrams, `SectionIdentity.tsx`, profiles | Recorded edges, exact registry bindings, individually recorded dates | Honest fallbacks; exact-ID/date tests; keyboard and profile navigation checks |
| New `enforcement/penaltyDistribution.ts`, `PenaltyDistributionCard.tsx` | Eligible amount/currency/definition/period/source rows; bins/median | Tests: exact boundaries, nulls, negatives, duplicates, incompatible definitions |
| Company profile/statements/disclosure modules | Exact numeric same-period facts and amendment resolver | Narrative links if accrual absent; tests reject CIK-only joins and mixed units/quarters |

## Verification and reporting
- Vitest: targeted domain/contract tests per change, then full suite at milestones. No tests of copy/styling/snapshots as proof of business correctness.
- Preview diagnostics: inspect latest build result; the platform runs compilation/typechecks. Do not manually run production builds or duplicate typechecks.
- Playwright: 1039×635 for your view, 390×844 for phone, and 1280×1800 desktop; light/dark, populated/loading/empty/error. Measure overflow and clipped labels; inspect actual screenshots, image load success, connectors and chart legibility. Aim for WCAG AA text contrast and 3:1 meaningful chart/control boundaries.
- Verify end-to-end filters, modes, zoom/reset, data table/export, hierarchy/profile links, info popovers and chart-to-chat context using real loaded data. A demo-only or empty flow is not verified.
- Report each sprint: changed paths, actual analytical coverage, tests run, screenshots reviewed, unresolved blockers and deployment status. Do not claim all states complete/current or publish automatically as part of this UI work.

## Approval scope
Approve the sequence, starting with Sprint 1. Later data-dependent modules proceed only when their evidence gates pass; any missing extraction or relationship contract is reported specifically, not filled by inference. This plan does not authorize altering calculator releases or resuming/importing corpus acquisition jobs.