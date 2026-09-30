# What's crucially missing — assessment and fix plan

## Honest assessment

The platform now has strong coverage of *structure* (courts, judges, MDLs, matters, agencies, laws, sources, registry). What's missing falls into four crucial gaps:

### 1. You can't read the actual documents (biggest gap)
- Registry lists 13,971 verified documents but they are storage keys, not links — users see metadata only.
- MDL docket documents link out to RECAP/CourtListener, but nothing opens inside the platform.
- **Fix:** add a document viewer path. Where a public URL exists (RECAP, eCFR, Federal Register), open it in an in-app reader pane; where only a storage key exists, show "Available in your private storage" with the key and a copy button — never a fake link.

### 2. Coverage page lacks the database's own per-state counts
- The coverage page shows bundle/catalog counts but not how many records your database actually has per state, so gaps are invisible.
- **Fix:** add a "Database records" column per state using the per-state overlap queries already proven to work (exact county counts time out, so reuse the overlap approach).

### 3. Rule/law pages are missing the reference frame
- The Title · Part · Subpart breadcrumb line and a "Dates & sources" block (effective date, FR citations, source links) are still absent.
- **Fix:** add both to provision pages from fields already in the database; show "Not recorded" where absent.

### 4. Catalog-only sources aren't fully first-class
- Reviewing, bookmarking, and exporting a catalog-only source is not yet verified end-to-end.
- **Fix:** verify and, if broken, make review/bookmark/export work for merged catalog rows exactly as for original rows.

## Not fixable inside this app (flagging, not planning)
- Documents-per-year charts per agency — the database can't count these.
- The ~130 GB archive — not in the repo; would need a storage pipeline decision from you.
- Accounts / cross-device sync of bookmarks and reviews — currently browser-local by design. Say the word if you want this; it's a larger piece of work.

## Technical notes
- Document viewer: client-side pane using existing absolute URLs; no new server functions.
- Coverage counts: extend `sources.coverage.tsx` with the existing per-state overlap query pattern in `src/lib/external/`.
- Provision pages: extend `law_.provision.$id.tsx` + `formatLawText.ts`; unit tests updated.
- Catalog row actions: verify in browser, fix in `catalog.ts` merge layer if needed.
- All rules hold: no invented data, exact-match linking only, "Not recorded" for unknowns.
