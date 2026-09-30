# Unify sources, agency profiles, rule-page additions, map home, linking

The look and colors stay the same. This is only about structure, data and links.

## 1. Remove the "V2.2A" labels, but keep all its data

- About 27 places in the app say "V2.2A". These become plain names: "Source library", "Sources", "Imported sources". This covers the sidebar footer, the page headers, the state pages, the coverage page, the source drawer, the exports page and the empty-state text.
- The data stays exactly the same underneath: all 4,633 URLs, 6,372 occurrences, 258 endpoints, 8 families and 73 promotions. Original URLs keep their query strings, and exports keep the original fields.
- The imported "verified" and "current" labels are still shown as past checks, not new ones. Only the version name is removed.
- The sources on each state page merge into a single "Sources for this state" block, next to the Registry V2.2 sources. Where the same URL appears in both lists, it is shown once and marked as found in both.

## 2. State page sources table: the whole row opens

- The "Sources (first 50 by title)" list becomes a table (title, domain, category).
- Clicking anywhere on a row opens that source's detail panel, the same one the Library uses. That panel has an "Open source" button that keeps the exact original link.
- A small outgoing-link icon on each row opens the source website directly in a new tab.
- Rows respond to the keyboard (Enter) and show a hover state, using the existing table style.
- A "Show all N" link opens the Library filtered to that state.

## 3. Agency profile pages

These are based on your screenshots.

Your database lists the agencies on each Federal Register document. For example: "Agencies (as listed by the API): Labor Department; Employment and Training Administration".

- **New folder:** Law & Safety → Agencies, listing the departments and their component agencies.
- **Agency pages** (at `/agencies/<code>`) show:
  - Stat cards: Federal Register documents, rules, proposed rules, notices, CFR parts cited, safety records and saved files.
  - Documents per year by type, with a Chart/Table switch.
  - Tabs: Overview · Rules & notices (the latest ones, filterable by type) · Regulations (the CFR titles the agency administers, linked into Law) · Safety & enforcement (FDA and CPSC agency records) · Documents.
- **Department totals:** a note says that department totals include documents filed by their component agencies, because the publisher names both on each document.
- **How counts are made:** counts come from bounded, cached queries that match the agency name exactly as the database lists it.
  - If a count times out, the card says "Not available — too large to count" rather than showing a number.
  - Any card with no data behind it says "Not recorded".

## 4. Rule and law page additions

These are like your 40 C.F.R. § 155.23 screenshot.

- A "Copy citation" button.
- A breadcrumb line: Title · Part · Subpart, taken from the outline path.
- "All sections of this part →" opens that part's list in Law.
- "Current eCFR ↗" appears only when the database stores an eCFR link or a CFR citation it can be built from.
- Tabs: Text · Dates & sources (published date, source date, collected date, source links) · Federal Register N.
  - The Federal Register tab lists documents that name this CFR part. It appears only when such documents exist.

## 5. Map as the home page

- `/` becomes the map: national map, state totals, then a small row of folders (Courts, Judges, Matters, Law, Agencies, Sources).
- The source library moves to `/sources/library`. Old links, saved filters, bookmarks and review decisions keep working.
- Old pages fold into the library as filters, and their old links redirect with their filters kept:
  - Categories and Jurisdictions become filters.
  - Source families and Endpoints become library views.

## 6. Linking

- **Court pages:** add a small state map with the court's state highlighted, plus rows from the court-map table for that court.
- **Case and MDL pages:** show related dockets from the docket-links table.
- **Duplicate-document groups** show as "Other copies" on document rows.
- **County pages** show the county profile from the context table.
- **Judge names on MDL pages** link to the judge's profile only when exactly one judge has that exact name. Otherwise they link to the A–Z list.
- **Coverage gaps** gain a column with the database's own record count per state.

## Technical details

- Relabel by editing display strings only. Types, parsers, stored data and test fixtures keep their internal names (`v22a.ts` etc.).
- `places.$state.tsx`: the row becomes `role="button"`/`tabIndex=0` and opens the existing `SourceDrawer`. The external `<a>` calls `stopPropagation`.
- New `src/lib/external/agency.functions.ts`: a read-only PostgREST query on `corpus_records` (federal_register_history) with `detail->>subtitle ilike` on the exact agency name, plus bounded counts. It returns per-year × type counts, cached with `staleTime: Infinity`.
- The agency list is built from the exact agency names listed on the documents (not made up), with a pure mapper and tests.
- Provision additions use the existing `getLawProvision` plus `corpus_law_path`. The CFR-part match is done on the Federal Register "CFR parts" fact.
- Routes: new `agencies.index.tsx` and `agencies.$id.tsx` (under Law & Safety), and `sources.library.tsx`. The old routes redirect and keep their search state.
- Supporting-table joins go through the existing `queryTable` with exact-key filters.
- Verify: tests, typecheck, build, then a browser walk: home map → Texas → click a source row; Agencies → HHS; a CFR provision; a court page with its mini-map; an MDL page with judge links.

## Limits

- Agency counts use the agency names exactly as the Federal Register lists them. Name variants are not merged.
- Very large counts may show "too large to count" instead of a number.
- Links that aren't recorded in the database are left out, never guessed.
