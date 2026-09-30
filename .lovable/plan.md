# Consolidate and organize Legal Source Atlas

## Goal
Turn the current collection of parallel pages and raw datasets into one coherent legal research workspace. Keep every real record reachable, but remove repeated entry points, clarify labels, and combine related information around places, courts, judges, matters, law, safety, sources, and saved work.

## Confirmed overlap to resolve
- The sidebar currently exposes 18 destinations in four groups.
- `Places` and `Jurisdictions` both organize V2.2A sources geographically; state pages also repeat a source list that already exists in the Library.
- `Categories`, `Source families`, `Endpoints`, `Corpus sources`, and the Library are separate pages over closely related source-directory data.
- `Case insights` summarizes matter data separately from `Matters`.
- Domain pages expose datasets as long tab lists, while the Data catalog exposes the same datasets again as separate destinations.
- The generic dataset view uses technical table labels and IDs without enough domain hierarchy or related-record context.

## New information structure
Use a compact primary navigation with nine destinations:

```text
Search
Places
Courts
Judges
Matters
Law & Regulation
Safety
Sources
Saved Work
```

- **Places** combines the map, jurisdiction counts, states, counties, and geographic summaries. State and county pages become the geographic hub for linked courts, judges, matters, and sources.
- **Courts, Judges, Matters, Law & Regulation, Safety** become domain workspaces. Each has contextual views such as Overview, Records, Related Data, and Analysis only when the real data supports them.
- **Sources** combines the V2.2A Library, categories, source families, endpoints, corpus dataset inventory, and import/export provenance. The raw 71-dataset inventory remains available here as an advanced view, not a competing primary destination.
- **Saved Work** combines bookmarks, review queue, and exports while preserving their browser-local behavior and labels.
- Keep old public paths working through redirects to the corresponding consolidated view.

## Page and data organization
1. Build a metadata-driven domain registry that assigns each dataset a human label, concise description, domain, preferred columns, useful filters, and related datasets. Keep technical dataset IDs available as secondary provenance.
2. Replace long dataset tab strips with a compact view selector grouped by purpose. A user chooses a domain first, then the relevant record type.
3. Create one shared research workspace layout:
   - compact global search in the shell;
   - clear breadcrumbs and domain title;
   - contextual view selector;
   - one filter row with active-filter summary and reset;
   - stable, compact results table;
   - right-side record drawer with facts, files, source links, text, and genuinely linked related records.
4. Normalize presentation labels without changing stored values: expand cryptic field names, format booleans and empty values clearly, show URL hosts separately from long URLs, and expose raw values on demand.
5. Add domain summaries computed from live records: counts, useful breakdowns, coverage tables, and restrained charts/maps. Never infer missing joins or claim national completeness.
6. Link related entities only through IDs and relationships present in the corpus. Mark records as `Unlinked` or `Relationship unavailable` when the source data does not support a connection.

## Visual cleanup
- Preserve the current style, theme, colors, typography, spacing character, and component appearance. This is an information-architecture and content-organization cleanup, not a visual redesign; generated prototype directions were declined and will not be used.
- Reduce sidebar density and remove the persistent bundle statistics box from primary navigation; place provenance and data status within Sources.
- Reuse the existing page, table, filter, tab, drawer, button, and card styling while arranging them more consistently across domains.
- Keep the current compact typography. Human-readable names lead; technical IDs, qualifications, and provenance remain visible but secondary.
- Keep the right-side drawer and improve its hierarchy instead of adding more standalone detail pages unless a record needs a shareable route.
- Maintain usable mobile navigation and prevent long legal titles, citations, filenames, and URLs from overflowing.

## Implementation sequence
1. Add the domain registry and shared label/relationship helpers, with tests covering all 71 datasets and an explicit fallback group.
2. Rework the shell, navigation, global search entry, breadcrumbs, and consolidated Saved Work/Sources navigation.
3. Refactor the shared dataset browser and record drawer around the registry, clearer fields, contextual views, and stable dense-table behavior.
4. Consolidate Places/Jurisdictions and Matters/Insights, then reorganize Courts, Judges, Law & Regulation, Safety, and Sources.
5. Add supported cross-links and domain visualizations; keep unsupported relationships explicitly unlinked.
6. Add redirects for superseded routes and remove redundant navigation without removing access to any records or browser-local actions.
7. Update route-specific metadata and the verification report.

## Verification
- Unit-test dataset assignment, labels, filters, relationship resolution, and fallback behavior against the real catalog.
- Run the complete test suite and the project typecheck; rely on the preview build signal for the production build state.
- In a fresh browser, verify all nine primary destinations, every dataset through Sources, representative court/judge/matter/law/safety records, the map-to-state-to-county flow, search, files/images, record drawer links, bookmarks, review reason/Undo, exports, old-route redirects, refresh persistence, and narrow-screen navigation.
- Confirm the app remains unpublished, read-only for the external corpus, and contains no invented records or counts.

## Guardrails
- No backend writes, crawling, paid services, or fabricated joins.
- Preserve the bundled V2.2A raw bytes, imported-field immutability, IndexedDB import behavior, and browser-local overlays.
- Do not hide datasets merely because they lack polished metadata; place them in an explicit advanced/fallback group.
- Counts and visualizations are computed from the actual available rows and carry the corpus's existing qualifications.
