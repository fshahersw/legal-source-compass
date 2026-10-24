# Cleaner, more visual Atlas

The app has ~45 component areas and 20+ chart types, but each page opens with long lists, tab rows and counts. The goal: every page answers its question at a glance, then lets you drill in.

## 1. One page pattern everywhere
Every section page (Places, Courts & judges, Litigation, Law, Enforcement, Products & safety, Companies, Insights) uses the same top-down order:

```text
[ Header strip: title, search, one action ]
[ 4-6 KPI tiles with sparkline + period ]
[ 2-4 headline charts, each titled as a question ]
[ AI summary card (labelled) + Ask AI about this section ]
[ Sticky in-page index -> sections below ]
[ "View data" / "See all N" drawers with source + download ]
```
- Tab rows replaced by the sticky section index (max 4 tabs only for real mode changes).
- Long method text moves into an "About this data" popover and a one-line source footer.

## 2. Visual quality pass
- Tighter type scale (page title, section title, label, number), consistent spacing grid, one card style, softer borders, muted backgrounds so charts carry the color.
- One chart palette from design tokens, light and dark mode checked.
- Every chart: question title, unit, period, source footer, "Not recorded" gaps shown, table view toggle.

## 3. Higher-quality charts (from the corpus)
Build the planned d3 set (folder does not exist yet) and adopt where data supports it:
- **Zoomable US map** (Places home): click a state to fit; colour by cases, enforcement, or code coverage.
- **Index chart** (Insights, Companies): series rebased to a scrubbed date.
- **Stacked bars over time** (Litigation filings by nature of suit, Enforcement actions by agency).
- **Diverging dot plot** (Courts: median time to disposition vs national baseline).
- **Sunburst** (Law: title > chapter > section coverage for state codes and CFR).
- Plus existing styled forms: verdict stack, dumbbell range (judge/court ranges), bench matrix (judges by court), annotated area/line.

## 4. Visual identity
- Courthouse, judge, agency seal and capitol images from the registry used as page header art and in profile identity blocks, with credit line.
- Entity profiles (judge, court, company, agency, state) get one identity block: image, name, 4 KPIs, key chart.

## 5. Rollout order
1. Shared kit: header strip, KPI tile, chart card, section index, data drawer, About popover.
2. d3 charts + tests.
3. Pages: Overview/Places, Courts & judges, Litigation, then the rest.
4. Profiles.
5. Browser screenshots desktop + mobile per page; list every demoted block so it can be restored.

## Technical notes
- New charts in `src/components/charts/d3/` using d3 modules for maths, React for rendering, tokens only.
- No data readers or routes removed; old URLs keep working.
- Time Limits calculator internals untouched.
- AI summaries grounded in the figures on screen, no vendor names.
