# Legal Source Atlas: coherent pages and trustworthy analytics

## Outcome
One identity area, compact headlines, useful charts and one section index. Extend existing views; enrich only with supported data/joins.

## Current evidence
Texas eventually loads without errors but has six modes, a capitol card, two headline rows and another index before analysis. Courts/Litigation have large loading tiles and uneven rows. Existing Ask AI, map zoom, median dots, court/agency diagrams and law readers should be extended, not duplicated. Loaded diagram contrast remains unverified.

Ask AI caps context at 40 figures, selects one source and lacks explicit unit. MDL parsing defaults missing counts to zero. Live corpus coverage, numeric accruals, comparable penalties, member counts and district spread remain unverified.

## Scope and invariants
Keep nine sidebar sections and old URLs. Preserve Time Limits, corpus scripts/caches/import checkpoints. No inferred identities/edges, estimated values or implicit current-law claims.

Sources/methods stay in info popovers and exports; essential unit/period/gap/denominator/sample-size markers stay visible. 

## Analytical corrections
Clearance is a flow ratio, not proof of backlog reduction: aligned count/rate panels, no dual axis. Keep the median-of-district-medians baseline; national median separate. Bubble size needs evidenced member counts. Rates need matched denominators. Reuse compact tokens/current radius; remove negative tracking.

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

## Technical contracts
Reuse read-only queries; read scoped rules before edits. Create helpers before views; record structure in AGENTS.md.

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
- Run targeted domain tests, then full Vitest at milestones. The platform performs builds/typechecks; inspect diagnostics instead of manually duplicating them.
- Playwright: your 1039×635 view, 390×844 phone and 1280×1800 desktop; both themes, populated/loading/empty/error. Check overflow, screenshots, loaded images, connectors and readable labels. Target AA text contrast and 3:1 meaningful boundaries.
- Verify real filters, geo/tile modes, zoom/reset, exports, hierarchy/profile links, info popovers and chart-to-chat evidence. Empty/demo checks do not verify populated flows.
- Report actual coverage, changed paths, tests, screenshots, blockers and deployment status. No implied all-state completion/currentness or automatic publishing.

## Approval scope
Start with Sprint 1; later modules require evidence gates. Time Limits and corpus acquisition/import jobs remain untouched.
