# Texas limitations citation mapping audit — 2026-10-05

Read-only audit of `scripts/legal/state-codes/tx-map-limitations-citations.mjs` and the private `limitations-citation-map-v1/citation-map.json`, checked against the repository’s protected snapshot manifest and local before-images. No network, database access, or writes to the map/script were used.

The protected manifest identifies project `xosqzzsnhxcyehcnirpa`; its SHA-256 is `5c0cec141543b548c4a3dc074f262454bb743117e38c98fc21a03273c8a3c419`. The manifest entries for `limitations/rules.json` and `limitations/sources.json` match the audited before-images byte-for-byte: respectively  `246698ef17033e2d1241f19ad6d67152b7713a9ae93db052e51db7e81cf34a3e` and `269256f177f0b158f21341970b3c5d8e21c4a667ca73baaebfd757a78937aff2`. The rules snapshot is release `2026-10-05.1`. The mapped source is the existing `tx-cp16` source; its local text matches its recorded length and SHA-256 `5d93754e54beb634189550e2c45cfde124c863451fcde78f22439621159a72e4`.

The mapping resolves exactly six Texas rules to seven rule-to-section associations, with four unique native citations. The six rule IDs are `tx-personal_injury-baseline-20261002`, `tx-wrongful_death-baseline-20261002`, `tx-repose-1-20261002`, `tx-accrual-1-20261002`, `tx-counting-1-20261002`, and `tx-product_liability-general-review-20261002`. Each points to the single existing source ID `tx-cp16`; every association’s native citation was independently derived from the protected rule pinpoint and matches the map.

| Native citation | Publisher occurrence ID | Section bytes | Section SHA-256 |
| --- | --- | ---: | --- |
| `CP:16.003` | `CP:cp.16.htm:16.003:1` | 900 | `8c3c2b3022fec85c72495a3da8c40b853fab9cfba5e18ab46e5355276a1cae43` |
| `CP:16.0031` | `CP:cp.16.htm:16.0031:1` | 882 | `6636be39fd6c6576fab3a235d694ddb49754d0e209c2b3a1183eb5073c65ae8c` |
| `CP:16.012` | `CP:cp.16.htm:16.012:1` | 2,874 | `7c75a8e67cdc1e84ff867841908a20d2cbcf3a1fd4c43beee5f68385c4d1f4ae` |
| `CP:16.072` | `CP:cp.16.htm:16.072:1` | 326 | `5f54ba0076bbf829409359833ff051c38362972d8dbd4b5b292631daa14143fc` |

For all four sections, the mapped native occurrence, chapter identity `CP:cp.16.htm`, source archive/member hashes, UTF-8 text span, extracted section hash, byte count, heading, and materialized `.txt` file agree. The source packet manifest SHA-256 is `87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da`; the citation-map file SHA-256 is `63e00ad365ee327bc8f3837c05ce50d99a0cae5b19293782d2c87c1149575f7a`. No integrity discrepancy was found.

This is a section-level citation and byte mapping only. It preserves the original subsection pinpoints (including `(a)`, `(b)`, and `(b)-(g)`) without claiming a subsection-to-text interpretation. It does not supply new legal review, establish currentness, change calculator behavior, activate a rule, or publish data; the map itself records `published: false`, `calculator_changed: false`, and `current_law_verified_by_this_mapping: false`.
