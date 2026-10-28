# Legal Source Atlas: coherent pages and trustworthy analytics

## Outcome
Make each page easier to scan: one identity area, a compact headline band, a few useful charts, and one section index. Extend existing components rather than building parallel versions. Use more corpus data only when its meaning, coverage, identifiers and periods support the proposed analysis.

## Current evidence
- At your 1039 × 635 window, Texas loads successfully but has six page modes followed by another section index, a separate capitol card, and a two-row headline band before the first analytical section. The initial capture was blank; a later capture loaded without page errors. Measure this delay rather than declaring it a permanent failure.
- Courts and Litigation first screens are dominated by five large headline/loading tiles with uneven final rows. Long descriptions and finding titles compete for attention before the plots become visible.
- The Texas page repeats “Key takeaways,” “What this shows,” and “Research resources.” Build a metric/content ledger to identify actual duplication; identical heading labels alone do not justify deleting distinct data.
- Chart Ask AI, geographic map zoom/pan, district median dots, court-system tiers, agency parent/component diagrams, and law readers already exist. They need refinement, not replacement.
- The court-hierarchy screenshot captured a loading placeholder, not the completed diagram. Loaded hierarchy contrast and proportions still need checking in both themes.
- `chartContext.ts` defaults to 40 figures; the chart card forwards only the first source label, without an explicit unit. That is not a lossless context contract.
- `mdlAnalytics.functions.ts` defaults absent pending/total amounts to zero and casts series without validating observations. Resolve this before adding the momentum chart.
- Numeric company legal-accrual history, comparable cross-agency penalties, and per-district spread are not yet established. No live corpus inventory was performed during this planning pass; do not mistake exported types for verified coverage.

## Scope and invariants
Keep all nine sidebar sections and existing URLs. Keep Time Limits engines, bundles, manifests and release tools untouched. Preserve corpus scripts, acquisition caches and active import checkpoints. No inferred people/entity links, invented hierarchy edges, estimated amounts or implicit current-law claims.

Source names, attribution and methodology remain in info popovers and exports. Essential interpretive markers—unit, period, partial period, missing coverage, denominator and sample size—stay visible where hiding them would mislead. Official image credit remains accessible with its recorded source and licence.

## Corrections to the uploaded brief
1. **Clearance is a flow ratio:** terminations ÷ filings × 100, not proof of backlog change. Label above 100% “More terminations than filings”; do not imply efficiency, cause or good/bad performance.
2. **No dual-axis chart:** aligned count and percentage panels share a fiscal-year axis; the ratio panel has a 100% reference. Complete-period analysis uses the established alignment rules. If partial observations appear separately, label and dash them; exclude them from comparative findings.
3. **District baseline:** keep the median of qualifying districts’ medians as the line. Show the national case-level median separately. Add spread only if published percentiles/ranges exist; a range across districts is not a within-district spread.
4. **MDL bubble area:** associated member-docket counts are not supplied by the inspected analytics contract. Use fixed-size points unless explicit membership counts are available. Do not substitute cumulative actions for member dockets.
5. **Map semantics:** rate shading requires matched denominators and periods. Preserve raw counts in tables; do not manufacture rates. Geography and tile modes use exactly the same values and legend. Preserve DC and existing territory destinations, explicitly identifying ranking coverage.
6. **Existing card system:** use its current radius/token rather than another site-wide radius migration. Retain the supplied compact type sizes; remove negative tracking and unnecessary one-off overrides.

## Sprint 1 — Make the existing experience coherent
**First implementation batch; no new analytics data required.**

1. Establish baseline loaded screenshots for Texas, California, Courts, Litigation, Enforcement, Law and Companies; sample court, judge, agency and company profiles. Include slow, empty and failed reads, not only populated states.
2. Tighten shared headline bands and chart chrome. At your window size, use balanced headline grids without isolated last tiles; keep the first analytical section visible sooner. Remove feature-description prose, redundant count badges and echo takeaways using a page-level ownership ledger.
3. On state pages, distinguish genuine modes from scroll destinations. Keep old `?tab=` values working; consolidate visible choices to at most four, without nested tab bars. Fold capitol identity into the existing identity treatment, preserving the actual recorded photo.
4. Fix persistent loading states: each independently loaded block has an honest loading, error/retry or empty result. A slow directory must not hide the rest of a page.
5. Strengthen the current court/agency diagrams only after loaded screenshots: clear boundaries, equal tier proportions, legible connectors, stable image sizes, wrapping labels, and no image behind tiny text. Distinguish recorded directory grouping from evidenced appeal/reporting relationships.
6. Complete chart Ask AI context: current page/entity, chart topic, selected filters, complete plotted table values, units, all source links, period and gaps. Any payload limit must be disclosed and supported by a server-side reference to the shown rows—not silent truncation or unrelated page data.

**Exit:** sample pages are aligned in both themes, no duplicate metric narrative, no indefinite skeletons, and Ask AI accurately identifies the selected chart and its evidence.

## Sprint 2 — Improve three analytical questions
### A. Are filings and terminations keeping pace?
Add `ClearanceRateChart` to Litigation using verified civil fiscal-year caseload rows. One count panel for filings/terminations; one ratio panel with 100% reference. Divide only when filings are positive and both measures refer to the same complete scope/period. Missing or zero-denominator ratios remain unrecorded; do not connect gaps. Chart table includes both counts and the calculated ratio.

### B. Which MDLs are growing or shrinking?
Validate monthly observations before rendering `MdlMomentumScatter`. Require exact MDL identity, current report date and an observation twelve calendar months earlier; no nearest-date substitution. X = current pending actions on log scale; Y = signed absolute 12-month change. Zero-pending proceedings get a separate labelled list because log(0) is undefined. Show a zero-change line; omit invented “rapid/steady/dormant” classifications. Tooltips expose recorded caption, court, judge and dates. Links require exact profile resolution.

### C. How does a district compare with other districts?
Extend `DistrictSpeedChart`, not replace it. Keep ≥500 terminations eligibility and distinct national/typical-district statistics. Resolve clickable labels through the court-page availability mechanism. When no exact profile exists, retain a readable unlinked label. Do not add estimated spread or causal rankings.

**Exit:** all calculations tested against concrete fixtures; every plotted point reads back in View data; live populated flows verified, with unavailable evidence explicitly reported.

## Sprint 3 — Maps and evidence-based hierarchy navigation
- Extend `MetricMap` with a shared `AtlasMap` adapter and an equal-area state tile mode. Reuse existing geographic geometry and zoom/pan; connect fit-to-state interaction without suppressing navigation. Retain county capability in geographic mode.
- Use one classification helper and five classes for both modes. Label whether breaks are quantiles or equal intervals; repeated values cannot create misleading empty ranges. Zero remains distinct from no observation. Rate choices are enabled only with valid unit/denominator metadata.
- Roll out to Overview and Places first, then Courts/Litigation/Enforcement/Law only where a supported regional measure exists. Preserve selection and filters when switching modes; keyboard activation and a parallel data list remain available.
- Build a shared `LawTree` renderer over existing federal/state reader contracts. `src/lib/external/lawTree.ts` is dataset classification, not statutory hierarchy. Adapters must preserve actual node IDs, skipped levels, ordering, citations, versions and destinations. Coverage states need explicit evidence: text retained, outline retained, or official link only. Do not imply “current” from “text retained.”
- Reuse court tiers and agency organization components. Internal organization charts stay dated external references until actual reporting edges are acquired and verified; no Government Manual heading-based reconstruction.

**Exit:** geo/tile values match exactly; hierarchy nodes open real destinations; no invented structure or coverage chips.

## Sprint 4 — Better imagery and useful corpus enrichment
- Query exact-ID visual registry coverage for courts, judges, agencies, places and companies. Reuse `SectionIdentity`, existing court-building/portrait components and marks; no generated replacements for official entities. Profile image fallback remains labelled court-type artwork, not an invented seal or identity.
- Build judicial timelines from individually recorded appointment events; do not invent date precision, uninterrupted tenure or omitted terms. Missing portraits/dates do not create a wall of empty tiles.
- Inventory candidate datasets through existing read-only corpus access. Deliver a compact eligibility matrix: source, period, unit, grain, exact entity key, useful question, supported query, missingness and join feasibility.
- Penalties: start with separate eligible agency distributions. Preserve source-specific assessment/settlement definitions, currencies and report periods. Brackets are [0,10k), [10k,100k), [100k,1M), [1M,10M), [10M,+∞); null and negative adjustments are not zero fines. Compute medians only from eligible records, not histogram buckets. Do not extrapolate a capped sample to agency totals.
- Companies: join legal accrual to financial facts only with exact CIK, fiscal period, unit and filing/amendment selection. Narrative disclosure is not a numeric accrual. If numeric facts are unavailable, offer concise linked disclosure evidence rather than fabricate a burden chart. Avoid a dual-bar display that makes small accruals disappear against revenue; use aligned same-period panels or a verified ratio with a positive denominator.

## Technical delivery contracts
Read relevant scoped `AGENTS.md` before edits; follow server/runtime rules before server work. Reuse query options and existing read-only functions; add a query only when the current response cannot support the view.

| Target | Interface / data and helpers | Fallback and automated evidence |
|---|---|---|
| `src/styles.css`; kit `ChartCard.tsx`; `charts/ChartCard.tsx` | Existing title/actions/data/source/state slots; compact shared tokens | Stable loading/error/empty dimensions; browser geometry/contrast checks, no styling snapshots |
| `src/components/kit/ai/chartContext.ts` and chart callers | Typed page/entity/filter/unit/source/row context; existing assistant contract | Omit unavailable context explicitly; unit tests for multiple sources, nulls and >40 figures; click-through chat verification |
| Primary section routes; `places.$state.tsx`; state overview and headline panels | Existing page queries; metric ownership ledger and legacy search parsing | Independent retries; navigation tests for preserved old tabs; screenshot loaded/error states |
| New `litviz/clearanceRate.ts`, `ClearanceRateChart.tsx` | Matched year/filings/terminations/completeness rows; pure ratio helper | Null denominator/gaps; tests: 80/100=80%, 120/100=120%, zero filing=null, partial excluded |
| New `litviz/mdlMomentum.ts`, `MdlMomentumScatter.tsx`; MDL analytics parsing | Validated `getMdlAnalytics` rows; exact-month helper; optional evidenced member count | Unmatched history/zero log value labelled separately; tests for missing month, null count, duplicate report and no invented membership |
| `courts/caseload/DistrictSpeedChart.tsx`, `districtSpeed.ts` | Current helper + resolved court availability; published spread optional | Plain label when unavailable; tests retain 500 threshold and median-of-medians, reject orphan links |
| New `charts/maps/AtlasMap.tsx`; `places/MetricMap.tsx`, `mapView.ts` | Existing `GeoData`, `MapArea`, selection callbacks + geo/tile mode; shared rate eligibility/classification | No denominator=no rate; tests for matched periods, zero/null, ties, state/DC coverage and mode parity |
| New `charts/hierarchy/LawTree.tsx` + reader adapters | Recorded nodes: ID, label, children/child query, destination, evidence-backed coverage/version | Lazy loading/retry, no fabricated parent; fixtures for skipped levels, historic text and missing text |
| Existing court/agency diagrams, `SectionIdentity.tsx`, court/judge profiles | Current recorded relationships and registry lookup; explicit dated references | Honest artwork/reference fallback; exact-ID/date tests and keyboard/drill-through checks |
| New `enforcement/penaltyDistribution.ts`, `PenaltyDistributionCard.tsx` | Eligible amount/currency/definition/date/source rows; tested bins and median | Incompatible agency kept separate; exact boundary/null/negative/duplicate record fixtures |
| Company profile/statements/disclosure modules | Exact numeric facts only; tested same-period and amendment resolver | Disclosure links when numeric accrual absent; tests prevent CIK-only joins and mixed units/quarters |

Dependency helpers are created before their importing views. Structural decisions go in `AGENTS.md`. Each sprint updates the roadmap and moved-block ledger with what was removed, moved or retained.

## Verification and reporting
- Vitest: targeted domain/contract tests per change, then full suite at milestones. No tests of copy/styling/snapshots as proof of business correctness.
- Preview diagnostics: inspect latest build result; the platform runs compilation/typechecks. Do not manually run production builds or duplicate typechecks.
- Playwright: 1039×635 for your view, 390×844 for phone, and 1280×1800 desktop; light/dark, populated/loading/empty/error. Measure overflow and clipped labels; inspect actual screenshots, image load success, connectors and chart legibility. Aim for WCAG AA text contrast and 3:1 meaningful chart/control boundaries.
- Verify end-to-end filters, modes, zoom/reset, data table/export, hierarchy/profile links, info popovers and chart-to-chat context using real loaded data. A demo-only or empty flow is not verified.
- Report each sprint: changed paths, actual analytical coverage, tests run, screenshots reviewed, unresolved blockers and deployment status. Do not claim all states complete/current or publish automatically as part of this UI work.

## Approval scope
Approve the sequence, starting with Sprint 1. Later data-dependent modules proceed only when their evidence gates pass; any missing extraction or relationship contract is reported specifically, not filled by inference. This plan does not authorize altering calculator releases or resuming/importing corpus acquisition jobs.