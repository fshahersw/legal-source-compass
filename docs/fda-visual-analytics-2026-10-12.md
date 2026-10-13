# FDA visual analytics release

## Owner correction and acceptance

The owner rejected the text-led monitoring page and requested a dense visual dashboard: statistics, percentages, multi-line and bar charts, daily/weekly/monthly histories, time controls, automatic refresh, and broad official FDA API coverage. This release makes visual analytics the default at `/law/monitoring`; existing evidence and investigations remain secondary workflows without an account gate.

Acceptance requires real populated charts, not chart-shaped placeholders or tables. The desktop page should put compact metrics and substantial graphs ahead of explanatory text. Domain views cover devices, drugs, food, cosmetics, veterinary, tobacco, transparency and available supporting datasets. Current inventory snapshots are distinct from event histories. Historical records are grouped by their documented source date, not acquisition date.

## Data and statistical contract

- Discover and probe the current official openFDA catalog. Retain every contributing API response privately with exact URL, timestamp, release metadata and SHA-256. Website reads use a versioned service-only public RPC and never carry corpus credentials.
- Capture approximately two years of daily count buckets where a documented scalar date supports them, with independent scoped total reconciliation. Valid complete query gaps can be zero; failed, truncated, unsupported or missing series stay unavailable.
- Category facets record their exact time scope and total denominator. Multi-valued facets represent records mentioning a term and can overlap; top categories are not silently normalized to 100%. Comparisons use like-for-like periods and never combine heterogeneous record units into a headline total.
- Current registrations, listings, labels and reference catalogs retain inventory semantics. PMA application/supplement records, clearance records and adverse-event reports are not unique products, patients, confirmed injuries or causal findings.
- A daily infrastructure job refreshes protected API snapshots with a 600-request ceiling. The owner-provided openFDA key is used only in the acquisition authorization header and GitHub Actions secret. The browser rereads the protected snapshot every five minutes; it does not issue repeated bulk FDA requests. Acquisition time and publisher release time remain separate.
- Preserve the earlier owner deletion decisions and all unrelated working-tree changes. No general corpus continuation automation is resumed.

## Implementation ownership and verification

The active clean worktree is `C:/Users/firas/.codex/worktrees/corpus-production-quality/firastest1corpus`, branch `codex/fda-visual-analytics`, based on published main `d2581fe24d3d0769e39a51380d38c72b8f299900`. The original checkout remains untouched.

The source agent owns official catalog research, aggregate collectors and the schedule; the architecture agent owns versioned storage/read contracts, statistical transformations and tests; the interface agent owns charts, controls and default navigation. The coordinator owns integration, real acquisition/readback, independent review, browser acceptance, CI and publication.

The release judge is focused statistical/collector/SQL tests, TypeScript and repository verification, private source and public readback reconciliation, actual browser interaction with date/granularity/domain controls, desktop/mobile visual inspection, history-preserving PR/merge, scheduler smoke and final live chart verification. Stop repeating an identical failed approach after two attempts; classify its cause and retain failure evidence. Never weaken metric definitions or hide unavailable data to populate a chart.

## Evidence checkpoint

- Final initial capture: all 26 catalog datasets ready; 13 source-aligned 730-day series, current inventories for the other 13 datasets, and scoped category distributions. Latest source dates differ: for example, drug adverse reports through June 30, 2026, device reports through September 30, and cosmetic reports through August 29, 2025. Presets align separately to each source cutoff; custom dates remain fixed calendar windows. No lagging source is assigned zero for unpublished recent periods.
- Independent evidence checks reproduced 184 metrics from 241 hash-checked API responses (2,160,738 raw bytes). The 1,851,466-byte canonical snapshot passed TypeScript validation, isolated PostgreSQL publication and exact whole-payload readback. Run `5eccecb0-43f6-44d6-9692-86bbb28f576d`; payload SHA-256 `eae6841f5130374cf1ec03f10fc4e0e4d80b02df40eb2fb52f027179981d6a5f`.
- FDA required a key for drug/device adverse-event count queries; the owner supplied one and both histories now capture successfully. The device-class count endpoint returned a fielddata error: six documented native-code search totals independently reconcile to all 7,095 classification records. FDA clearance decision categories use the documented exact field. Empty native source categories remain explicitly labeled, not silently discarded.
- Additive private SQL contract installed with source/category validation, immutable run identities, private storage requirements, exact payload hashes and service-only read/publish functions. Final contract SHA-256 `663c6940c9864ac3b76657d2b76305b2df3ea185146452876ebabe7e4206e7da`.
- Local full verification passed 131 suites / 1,406 tests plus one intentional skip, offline JavaScript/Python/artwork contracts, TypeScript and production build. Final collector/private-intake contracts passed 23 tests after category corrections and a release guard; all 62 isolated SQL tests passed. Browser, CI and publication results are recorded below when complete.
- Initial production intake retained and hash-verified 242 private objects. A stale SQL editor result initially concealed the previous revision; the rejected publication was atomic. Executing the final SQL with a unique result marker resolved the revision mismatch. Publication then completed, and CLI recovery independently verified the complete canonical payload through the exact-run read RPC without duplicate publication.
- Independent release review caught a scheduled-collection degradation risk. Both the CLI and publisher now reject any non-ready dataset before cloud activity, leaving the previous verified dashboard snapshot intact. Capture diagnostics remain retained and the workflow fails visibly. Dedicated tests prove no network writes and a failing CLI exit code.
