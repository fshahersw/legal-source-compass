# Load the real V2.2A bundle

The uploaded file (6.5 MB) has 4,633 directory sources, 258 endpoint candidates, 8 family manifests, 73 promotion records and 4 original files. Its layout (`meta`, `directorySources`, `endpointCandidates`, `familyManifest`, `promotionLedger`, `originalFiles`) is different from the app's placeholder format, so importing it today would fail.

## What changes
1. **Native V2.2A adapter**: a converter that maps the real layout into the app's model without rewriting any field:
   - sources: `categories[]` become heading categories, `jurisdictions[]` stay multi-valued, `occurrences[]` (line, label, heading path) are kept and counted, `format`/`formatBasis` are shown as imported.
   - endpoints: `endpoint_id`, `source_family_id/name`, seed/referring/canonical URL, mime/extension and status fields.
   - families: manifest numbers (candidate endpoints, promoted, levels, pilot status) shown as **imported manifest figures**, not live counts.
   - promotions: linked to their endpoint by `endpoint_id`.
   - original files: name, SHA-256, size, with a viewer for the original text.
   - Every unknown field is still kept and shown in the detail drawer's raw section.
2. **Cross-check**: Data & Exports compares the bundle's own `meta` claims (4,633 / 6,372 / 258 / 8 / 73) against the rows actually counted and flags any mismatch.
3. **Filters and search** handle multiple categories/jurisdictions per source; the family filter is derived from endpoint/manifest links.
4. **Storage**: the 6.5 MB file probably exceeds browser storage. Store sources/endpoints/families/promotions and keep original file text for the session only, with a clear note; fall back to session-only with the existing warning.
5. **Endpoint Explorer and Source Families** show the richer imported fields.
6. The old placeholder format still imports.

## Verification
- Tests using the real file: counts equal the recomputed totals, URLs with query strings and `#` routes are unchanged, no field is modified.
- Import it in the preview via Playwright, check Library, filters, drawer, exports, then run the tests and production build and report the real numbers.

## Technical details
- New `src/lib/atlas/v22a.ts` (zod schema + `adaptV22A`), with `parseBundle` detecting the format by `meta.sourceVersion`.
- `Source` gains `categories: string[]`, `jurisdictions: string[]`, `occurrence_records`; the existing scalar fields become joined display values for sorting/CSV.
- Stats reported from rows; `meta` figures shown separately as "bundle claims".
