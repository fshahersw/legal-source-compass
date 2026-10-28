# Cleaner, richer data visuals and pages

Goal: every page answers its question at a glance, says each thing once, and uses far more of the corpus — with better maps, court and law hierarchy diagrams, and visual backfill for courts, judges, places and companies. Chart rules follow your uploaded spec (sections 3, 7, 8, 15).

## 1. Replace "Explore" with a minimal Ask AI icon
- Remove the Explore button and side panel from every chart card.
- Add a small sparkle icon (top-right of each chart/section card, tooltip "Ask AI about this").
- Clicking opens the existing research assistant pre-filled with: page topic, entity (court/judge/state/company), chart title, the figures shown, period, unit, source and gaps. Answers stay grounded in those figures and labelled AI-generated.

## 2. Declutter: say it once
- Site-wide pass for repeated content: KPIs that repeat a chart, captions restating the title, duplicate "about" text, the same count in header + tile + chart. Keep the clearest one.
- Each chart: finding-style title, one-line definition subtitle with n, "View data" toggle, source in the info icon only.
- Spec chart rules applied: sorted bars with n labels, low-n faded, max 4 lines / 6 stack segments / 20 bars, no pies for comparison, no dual axes, gray-by-default with one accent colour, rate axes 0–100%.
- Durations shown as medians with spread (not averages); dense text blocks become KPI tiles, small charts or short bulleted facts.

## 3. Upgrade the weakest visuals
Audit every page's charts and rebuild the confusing ones first (ranked list delivered with the first batch), e.g.:
- Enforcement calendar views: stop showing unrecorded days as zero.
- Litigation: filings vs terminations trend with clearance-rate line and 100% reference.
- Courts: time-to-disposition as median + range dot plots per district vs national baseline.
- MDL: pending-actions line with annotated events, momentum scatter (spec 15.10).
- Fix the chart-data bugs from the scan (missing years connected, ranking of stacked bars).

## 4. Maps and jurisdictions
- One shared map with two modes: real US map (zoom to state, click to drill) and a square tile-grid state selector (spec 15.9) with keyboard support.
- Shade by rates or per-capita values, never raw counts presented as rates; 5-step legend; distinct styles for "no coverage" vs "zero".
- Used on Overview, Places, Courts, Litigation, Enforcement and Law, with a metric picker drawn from data we already hold.

## 5. Court hierarchy diagrams (spec 15.6)
- Federal column: Supreme Court → 13 Courts of Appeals → 94 District Courts, plus Court of International Trade, Court of Federal Claims, bankruptcy courts, and the JPML side node with a dashed link to MDL transferee courts.
- State column with a state selector: court of last resort → intermediate appellate → general jurisdiction → limited jurisdiction, built only from each state's recorded court structure (states without one show "Not recorded").
- Appeal arrows point up; dashed arrow for federal-question review. Equal-size nodes showing record counts, each linking to the court page; current court highlighted.
- Shown on Courts & judges, every court profile, and state pages.

## 6. Law hierarchy diagrams
- U.S. Code: title → chapter → section; CFR: title → part → section; state codes and constitutions: recorded structure only.
- Clean collapsible tree plus a compact coverage map of what we hold, linking to each level.

## 7. Visual backfill: courts, judges, places, companies
- Courts: courthouse photos and seals from the visual registry (exact court IDs only); labelled court-type emblems where none exists.
- Judges: portraits from the registry (exact unique match); identity block with court, appointment, tenure timeline.
- Places: capitol imagery, state seal, key indicators tiles, mini hierarchy and map.
- Companies: logo, clean financial trend charts, legal-proceedings and enforcement summaries as charts and short facts instead of text walls.

## 8. Use more of the data
- Inventory the corpus datasets not yet surfaced on any page and wire the accurate, useful ones into the right section (state pages, court/judge profiles, company profiles, Insights), each with source, period and unit.
- Cross-links between entities only on exact identifiers.

## Rollout order
1. Shared kit: Ask AI icon, chart card cleanup, map, hierarchy diagram components.
2. Courts & judges, Places (map + hierarchy + backfill).
3. Litigation, Enforcement, Companies.
4. Law & government (law trees), Insights, Overview.
5. Unused-dataset wiring, then a full browser check desktop/mobile.

## Technical notes
- Remove `src/components/charts/explore/*` and the server suggestion function; Ask AI icon passes a structured context object into the existing assistant.
- New shared components: `kit/AskAiIcon`, `charts/maps/AtlasMap` (d3 geo + tile-grid mode), `charts/hierarchy/CourtHierarchy`, `charts/hierarchy/LawTree`.
- Court structure from recorded court types/IDs in the corpus; no hard-coded generic state shape.
- Existing rules kept: no fabricated data, "Not recorded" gaps, exact-ID image binding, sources only in the info icon, no vendor/model names, all URLs keep working, Time Limits internals untouched.
- Spec says "no 3D"; the Enforcement 3D view you asked for earlier stays unless you want it removed.
