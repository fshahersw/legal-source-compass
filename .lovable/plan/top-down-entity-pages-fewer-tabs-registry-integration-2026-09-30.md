# Top-down entity pages, fewer tabs, registry integration

## Goal
Replace "click a row, open a side panel" with real, shareable pages organized top-down. Each court, judge, matter, and body of law gets one consolidated page that gathers everything the database actually links to it. Keep the current style, colors, and typography exactly as they are.

## New page hierarchy
```text
Places (map)  ->  State  ->  County
   |                |
   |                +-> Courts in state  -> Court page
   +-> Law: Federal | State -> Type (statutes, rules, regs, forms) -> Collection -> Title/Section
Courts   -> Court page      (/courts/$courtId)
Judges   -> Judge page      (/judges/$judgeId)
Matters  -> MDL page        (/matters/$mdlId)
People   -> Attorney page   (/people/attorneys/$id)
Sources  -> Registry browser (jurisdiction -> layer -> category)
```

### Judge page (one page per judge)
Header with portrait, name, court, role, service dates. Sections on the same page: Biography/enrichment, Courts served, Financial disclosures & holdings (by year, table + totals), Relationships (entities), MDL appearances (linked to MDL pages), Source files. Empty sections collapse to one line instead of showing notes.

### Court page (one page per court)
Header with seal, name, level, state, location. Sub-navigation anchors: Overview stats, Judges (linked), MDLs in this court, Rules, Forms, Documents, Statistics charts, Official links. Small map inset of the state highlighting the court's county when the corpus provides it.

### MDL / matter page
Status, JPML counts, transferee judge and court (linked), docket activity timeline, related cases, counsel (linked to attorney pages), settlements, verdicts, expert rulings.

### Law page (single entry, narrows step by step)
Choose Federal or State (state picked from the reused map or a list) -> type of law -> collection -> outline -> provision text. Breadcrumb reflects each step; CFR, public laws, Federal Register, limitation periods and citations appear as types under the right jurisdiction instead of separate tabs.

## Name indexes ("enumerate" people)
Build browsable A-Z indexes with counts for judges, attorneys/counsel, and parties where the data supports them. Names are normalized only for display and grouping (case, spacing, suffixes); original spelling is kept and shown. Possible duplicates are listed as "possible duplicates", never merged automatically.

## Using the uploaded registry (9,348 sources)
The file is a source registry: 55 jurisdictions, 31 layers, 27 record categories, parent/child links (4,554 children), source type, file type, and last check status.
- Bundle it with the app as a read-only data file alongside V2.2A (raw lines preserved).
- Sources becomes one browser: jurisdiction -> layer -> category -> source, with parent/child nesting.
- Each state page and court/law page shows the registry sources for that jurisdiction and category (e.g. Minnesota court forms).
- Link check status is shown as "last checked by the registry on <date>: <status>", never as fresh verification.

## Gap research
Produce a coverage report page (under Sources) comparing, per state and category, what the registry lists versus what the corpus holds (courts, rules, forms, statutes, regulations, opinions). Highlights states or categories with registry sources but no corpus records, and vice versa. Computed from real rows only; no crawling or live fetching.

## Cleanup
- Remove the per-dataset record-view dropdown as the main way in; domain landing pages show a directory plus a short "More data" list for secondary datasets.
- Remove repeated disclaimer banners; keep one small data-source note in the footer and on Sources.
- File metadata shows only name, type, size, and open/download; raw storage details go behind a "Technical details" toggle.
- Retire overlapping pages (Categories, Jurisdictions, Case insights, Source families, Endpoints, Dataset inventory as primary views) into the new hierarchy, with redirects from old addresses.
- Side panel remains only for quick previews in long lists; every entity also has its full page.

## Technical details
- New routes: `courts.$courtId`, `judges.$judgeId`, `matters.$mdlId`, `people.attorneys.$id`, `law.$jurisdiction`, `law.$jurisdiction.$type`, `sources.registry`, `sources.coverage`; each with its own head() metadata, loader via ensureQueryData, error/notFound components.
- New read-only server functions in `src/lib/external/entities.functions.ts` using `corpus_detail`, `corpus_group_detail`, and filtered `corpus_records` queries; parallel section fetches with per-section failure handling.
- Name index server functions use bounded, paginated queries by initial letter to avoid timeouts.
- Registry: `public/data/registry_v06_1.jsonl`, parser + tests in `src/lib/atlas/registry.ts`; state code to state name mapping reused from geo helpers.
- Reuse UsMap, BarList, existing tables, cards, and breadcrumb components unchanged in style.
- Tests for registry parsing, hierarchy grouping, name normalization, and coverage math; typecheck; browser check of the map -> state -> court -> judge -> MDL -> attorney flow and the law narrowing flow.

## Guardrails
Read-only corpus, no invented links (unlinked stays labeled), no crawling, app stays unpublished, V2.2A and review/bookmark behavior unchanged, visual style unchanged.
