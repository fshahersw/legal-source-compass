# Seeger Weiss PDF backfill — October 2, 2026

Status: **running**, not an exhaustive-completion claim. Snapshot verified directly in Supabase at 2026-10-02T21:44:17.801145+00:00.

Supabase currently holds **50,335 distinct PDF objects**, totaling **41.4 GB**. These are cumulative library totals, including the earlier backfill. Every counted object has a complete hash-checked cloud readback. Storage remains in the private `corpus-originals` bucket; public and authenticated client roles cannot read the new capture registry.

The current scope is actual Seeger Weiss LLP PDFs and their docket metadata. The broader Atlas, website, and bulk-source work is paused. This pass makes **zero CourtListener REST API requests**. Firecrawl scraping was explicitly authorized.

- CourtListener: 1,810 cached firm-indexed docket URLs, following observed pagination and preserving HTML, docket rows, filing dates, document links, and source spans in Supabase. More than 2,000 pages have been registered and 87,816 additional PDF locators frozen in pending batches. These counts keep growing while collection runs.
- DocketBird: the exact-phrase search reached a null pagination cursor for every year from 1999 through 2026, plus an empty pre-1999 search. The captures contain 15,577 unique document hits across 2,752 source case IDs. A full-text mention is not labeled as certified firm representation.
- Fresh DocketBird downloads: 104 recent PDFs and six state-court PDFs were verified and registered. The first historical batch covered all 4,496 PDFs after one successful retry. Another 8,937 historical PDFs and 1,817 additional PDFs from the MDL refresh are queued or downloading.
- MDL refresh: recent sheets were captured for 23 graph-linked master dockets, in addition to the fresh Dupixent sheet. The publisher caps large sheet responses at 500 entries; these refreshes are not represented as complete dockets.

Known gaps remain explicit. CourtListener native document `203325132` returned 404. Documents `242373063` and `411496475` have repeatable SHA-1 conflicts with the cached publisher metadata and are held rather than registered as matching that metadata. Sealed/restricted flags and unavailable PDFs remain held. Search-returned PDFs without an explicit restriction flag retain an unknown status in private quarantine.

Follow-up: fresh docket pages independently published the exact PDF links for the two checksum-conflict documents. Their current bytes have now been saved and verified as private public-locator observations, with the prior checksum conflicts explicitly recorded. The conflicting native metadata was not replaced or marked as matching. Evidence is in `courtlistener-integrity-follow-up.json` in the run directory.

The active workers freeze new page-derived queues, transfer PDFs, verify stored bytes, register the assets, and retry failed docket pages twice after the main scan. The CourtListener download worker uses steady pacing and honors rate-limit cooldowns. No paid PACER fetches are triggered.

A final worker retries unresolved batch PDF failures twice after the primary transfers finish. Its completion marker is `pdf-retries-finished.json`; source restrictions, persistent failures, and native metadata conflicts remain explicit.

Private run directory:
`C:\Users\firas\.codex\corpus-cache\seeger-weiss\2026-10-02\pdf-focus-20261002`

For current state, read `courtlistener-page-progress.json`, `docketbird-batch-progress.json`, `courtlistener-batch-progress.json`, per-batch transfer/registration receipts, and `acquisition-supervisor.jsonl`. `acquisition-finished.json` marks the end of page collection only; both PDF batch runners and their registrations must also finish before the full run can be assessed.

Validation: 12 PDF validation tests passed, including state-case parent matching and explicit unknown restriction status. Two canonical-docket redirect tests passed. A spread sample of 20 scraped pages retained filing dates on all 1,975 sampled docket rows. Direct SQL checks confirmed RLS, a private bucket, no anonymous/client capture access, and service-role-only registration.
