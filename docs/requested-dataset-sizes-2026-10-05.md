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
