# Add the matter-registry bundle (parties, attorneys, outcomes, documents)

## What the upload contains

A "matter registry baseline" (built 2026-08-23) with a manifest and gzipped JSONL files:

- 73 matters (case name, court, docket number, filed/terminated dates, status)
- 325 parties, 130 attorneys, 10 firms, 25 judges, 13 courts
- 25 outcomes (e.g. FJC case dispositions, with evidence level)
- 24,598 docket entries and 13,971 verified documents (description, size, sha256, verification status)
- Empty: opinions, citations

The manifest also lists files not uploaded (provenance, review_records, source_records, counsel_appearances, judicial_assignments, matter_aliases, matter_relationships, coverage) — the plan uses only what was uploaded.

## What it adds

The external corpus has no per-case parties, attorneys or outcomes. This bundle fills that gap for its 73 matters. Documents carry S3 keys, not URLs, so document rows show metadata only (no file download) — stated honestly on the page.

## Build

1. **Bundle the data**: decompress the 8 uploaded .jsonl.gz files into `public/data/matter-registry/` (matters, parties, attorneys, outcomes, courts, documents, plus manifest.json). Total ≈ 2.7 MB compressed; keep as .jsonl or convert to compact JSON, whichever is smaller. No invented rows; empty datasets (opinions) are simply omitted.
2. **Pure parsing layer** `src/lib/registry/` (mirroring existing atlas patterns): load + index by matter_id; derive per-matter party/attorney/outcome/document lists; unit tests with the real files.
3. **Matters section** under Litigation:
   - Registry list page: all 73 matters, searchable, with court, status, filed/terminated dates.
   - Matter detail page: header facts, parties grouped by type, attorneys, outcome (with evidence level shown), docket-document table (description, size, verified badge), judges.
   - Cross-links where exact keys match the existing corpus: court_id (e.g. `ilnd`) → court page, docket number → MDL/docket-links where present. No fuzzy matching.
4. **Court/judge pages**: where a registry court_id matches, show a "Registry matters" count/link on the existing court page.
5. **Verify**: run the test suite, check the new pages in a browser (list, one matter detail, one linked court), confirm no fabricated counts — uncountable values show "Not recorded".

## Technical notes

- Data is static and read-only: plain JSON fetches from `public/data/`, no database writes, no new server functions.
- Follows existing patterns: `src/lib/atlas/*` pure modules + tests, `EntityPage` header/jump-nav layout, semantic color tokens only.
- Uploads are read-only at `/mnt/user-uploads/`; files are copied (not moved) into `public/data/matter-registry/`.
