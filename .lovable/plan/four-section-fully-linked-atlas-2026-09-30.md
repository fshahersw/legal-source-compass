# Four-section, fully linked Atlas

Style, theme, colors and typography stay exactly as they are. This is a structure, linking and visualization pass.

## New uploaded file: MDL docket documents
`documents.json` holds 35,862 docket entries across 16 MDLs / 17 master dockets and 30+ courts (e.g. N.D. Cal 5,004, N.D. Ill 4,505). 16,035 have a real PDF link (RECAP); 19,827 are PACER-only (listed, no free file). Categories: orders/opinions 7,674, motions 3,289, case management orders 2,881, complaints 1,658, remand/transfer 1,319, motions to dismiss 1,196, transcripts 909, other 14,602. 14,319 flagged high value.

Use: bundled as a read-only data file, shown on every MDL page as a docket timeline and on court pages as "MDL documents filed here". PACER-only entries are labeled "Not freely available", never linked as downloads. Original fields preserved.

## Sidebar: 4 sections only
```text
1. Explore        map landing + global search (states -> counties -> courts)
2. Litigation     Courts -> Judges -> Matters (MDLs) -> Documents -> People A-Z
3. Law & Safety   Federal or State -> type -> collection -> provision; FDA/CPSC
4. Sources & Work Source library, registry, coverage gaps, dataset inventory,
                  saved items, review queue, imports/exports
```
Everything else becomes a tab or step inside one of these. Old URLs (Categories, Jurisdictions, Source families, Endpoints, Case insights, Corpus sources, /data, /people, etc.) redirect to their new home, keeping search terms.

## Top-down pages, everything linked
- **Explore**: the map is the home page. Clicking a state shows its courts, judges, MDLs, laws and sources in one page; county shows its tagged records.
- **Court page**: header with seal + small state map, stats, then sections: judges, MDLs, docket documents, rules/forms, related records. Uses the court map table to link records to the court.
- **Judge page**: bio, portrait, courts, MDLs presided, financial disclosures/holdings when linked; unlinked data clearly marked.
- **MDL page**: summary, timeline chart of filings by month, documents by category (bar list), parties/counsel, related cases via docket links, settlements/verdicts.
- **Names**: judges, attorneys, firms, parties shown as clickable chips linking to their profile or A-Z entry; duplicates flagged, never merged.
- Row clicks go to full pages everywhere a page exists; the side drawer remains only for rows with no page.
- Supporting tables (court map, docket links, duplicate groups, context) feed these pages instead of standing alone.

## Less clutter
- One header, breadcrumbs and one filter bar per page; remove repeated notices, record-count boxes and duplicate tab strips.
- Provenance/technical fields stay in one collapsed "Technical details" block; a single footer note replaces page disclaimers.
- Reuse existing bar lists, map and cards for visuals (counts, timelines, category breakdowns).

## Technical details
- Bundle `public/data/mdl-documents.json` (raw bytes), parser + tests in `src/lib/atlas/mdlDocuments.ts`, indexed by mdl_number and court.
- Rewrite `AppShell` NAV to 4 groups with CONTEXT_NAV sub-steps; redirect routes for retired pages.
- Extend `entityView`/EntityPage sections with docket-document timeline and linked name chips; join court map + docket links in `entity.functions.ts`.
- Tests for parser counts (35,862 / 16 MDLs / 16,035 downloadable), redirects, link resolution; typecheck, build, browser check of every section.

## Limits
Links only where IDs actually match; mismatches shown as "unlinked". Judge holdings depend on what the database links. App stays unpublished and read-only.
