**Pinned Open Law ID reference implementation**

Repository: https://github.com/Vaquill-AI/open-law-id
Commit: 75f69acf4386fa7e198a33e3f93a58a0fe836774
Retrieved: 2026-10-12 through GitHub's contents API.

The files in impl/, registry/, conformance/ and spec/ are unchanged upstream bytes. LICENSE is preserved verbatim. The implementation is MIT; the specification, registry and conformance corpus are CC0, as described in that license.

Only the reference identifier implementation is used. No Vaquill law-text dataset, hosted resolver, or concordance was imported. The local wrapper in scripts/enrichment/law_id_crosswalk.py preserves native IDs, requires reviewed complete publisher paths, holds collisions, and refuses point-in-time minting. An identifier is not a legal rule or a publication approval.
