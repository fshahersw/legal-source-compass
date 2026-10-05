# Requested collection sizes and app usage — October 5, 2026

Measured through the connected SQL editor for Supabase project `xosqzzsnhxcyehcnirpa` at approximately 22:35–22:39 UTC. All operations were read-only. Decimal GB/MB are used below.

| Requested group | Stored database record data | Separately registered original/export files | App use |
| --- | ---: | ---: | --- |
| U.S. law collection / Open US Law | 26,307,776,764 bytes; 2,968,623 rows | 4,047,464,420 bytes; 223 bulk files | One collection, `open_us_law`, not two. `ready=false`; its records and categorized outline are held. All 223 bulk-file routes are unavailable. |
| All science and safety | 5,594,589,793 bytes; 736,916 rows in 15 collections | 9,922,130,303 bytes; 6,595 science originals plus 12 agency exports | Records are available through browsing/search. All dedicated science-original and agency-export routes are unavailable. Nineteen science objects also have a ready artifact route elsewhere. |
| Uncategorized source-directory entries | No dedicated database collection | The complete mixed-category catalog occupies 5,988,497 bytes, including its index | All 3,648 uncategorized source URLs are represented by the source library: 2,230 merge by exact URL with existing directory entries; 1,418 are catalog-only. |

Database measurements sum `pg_column_size` for **every column** of `public.corpus_records`, including search vectors. They are exact stored datum totals, not an allocation of shared relation/index/TOAST overhead or a guaranteed amount of reclaimable disk. The earlier four-column probe was superseded by the all-column measurement and must not be reported as the total.

Storage measurements deduplicate object keys within each identified group and join actual `storage.objects` metadata. Every referenced object exists; no declared-vs-storage size mismatch or conflicting reference was found. These are metadata size checks, not a new download/re-hash of all file bodies. Objects shared with other routes cannot be treated as unused or independently deletable.

Science originals account for 9,768,728,070 stored bytes; agency safety exports add 153,402,233 bytes. Within the database subtotal, science documents occupy 504,410,019 bytes and CPSC injury records occupy 3,136,798,110 bytes. The old FDA device-classification version remains retained and is selectable through the consolidated version browser; its 39,492,644 bytes are included in the 15-collection subtotal.

The catalog's recorded **30,473,158,087-byte Open US Law source JSONL** is an input-export size. It is neither the database allocation nor an additional measured storage charge to add to the table above.

## Different meanings of uncategorized

The source catalog's 55 jurisdiction shards hold 9,348 rows: 3,648 literally classified `uncategorized` and 5,700 categorized rows. They share 5,984,203 bytes of shard files plus the 4,294-byte catalog index. No separate physical object size can be assigned to just the uncategorized rows. There are no `corpus_records` rows whose category is NULL, blank, `uncategorized`, `unclassified`, `unknown` or `other` in the measured snapshot.

Separately, the frontend dataset-section mapper omitted seven exact Seeger Weiss dataset IDs. They fell into “Other” despite powering matters, dockets, entries, parties and regulatory-reference links. Their stored database data total **1,059,265,247 bytes**. This is **not** the uncategorized source-directory category. The exact IDs have now been mapped to the Matters section in the pending frontend release; all row identities and holds remain unchanged. Five of the seven datasets are ready, while the superseded two-row dataset and empty staged-link dataset remain held.

The measured project totals are 87,812,426,899 database bytes and 144,770,591,610 declared Storage bytes. These totals include unrelated collections and were observed before any later state-code imports. `public.corpus_records` alone occupied 64,043,352,064 physical bytes including its indexes; that physical total is not apportioned to the individual datasets above.

Private query text, exact hashes and connected JSON readbacks are retained under `private/audit-2026-10-05/requested-dataset-sizes/`. No deletion was requested or performed by this audit. “Used” here means exposed through an app read/browse/download path; it does not claim user-access analytics or complete matter-evidence linkage.

## Five largest database collections

The same all-column measurement at 22:36:57 UTC ranks the individual `corpus_records` datasets as follows. This ranking excludes separately stored files and shared database overhead; it does not aggregate multiple science/safety datasets into a single collection.

| Collection | Stored datum bytes | Rows | Catalog ready |
| --- | ---: | ---: | --- |
| U.S. law collection / Open US Law | 26,307,776,764 | 2,968,623 | false |
| Federal Register history | 3,871,107,605 | 1,006,725 | true |
| CPSC injury data | 3,136,798,110 | 479,534 | true |
| Dated national eCFR hierarchy — September 30, 2026 | 1,095,961,784 | 274,752 | true |
| FDA device enforcement reports (openFDA) | 798,426,398 | 39,949 | true |

## Open US Law content and licensing clarification

The retained catalog reconciles 2,968,623 rows as 1,997,490 statutes, 885,121 regulations, 44,547 court rules, 28,083 guidance-category records and 13,382 constitution records. These are compiled source occurrences, not independently established unique current provisions. The private October 5 state-provenance audit found 265,261 state/DC/territory statute rows with empty source URLs, no Georgia or North Carolina statute rows in this imported snapshot, and no populated saved/as-of/effective date in its 50 metadata samples. The separately inventoried July/August source files contain useful older text and known repeated-text/version anomalies; the sampled defects must not be generalized as a count of all defective rows.

The publisher's [current dataset card](https://huggingface.co/datasets/vaquill/open-us-law), retrieved at 22:44:39 UTC, explicitly says earlier snapshots retain CC BY 4.0 while the newest compilation uses CC BY-NC 4.0. Its licensing section and changelog disagree on the September change boundary, but both leave the July/August releases under CC BY 4.0. Do not retroactively apply the new commercial-use restriction to verified older copies. The earlier local July manifest also claimed CC BY 4.0. This is materially stronger licensing evidence than a blanket uncertainty statement, though matching the imported records to the licensed immutable release and resolving source-specific exceptions remain necessary. A commercial-host URL alone is not proof of infringement or paid acquisition.

The collection remains held while source lineage, exact snapshot mapping, extraction quality and dated publication decisions are unfinished. That does not establish that every row is unusable. Selectively reviewed, attributed, dated source browsing can proceed independently of calculator-grade legal review; neither a whole-collection readiness flip nor automatic calculator activation follows from this clarification.

The exact publisher HTML (199,518 bytes; SHA-256 `791558335da078efa41207005d211cdabcc91a7aeb9e2e96d2e1ebc781cd64b3`) and retrieval receipt are retained with the private size-audit evidence. No publisher account, agreement, download gate or commercial subscription was changed.
