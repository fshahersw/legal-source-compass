# CourtListener bulk acquisition gaps — October 2, 2026

The complete observed official bulk inventory contains **33 September 30 CSV exports**, plus the schema and load script. **22 CSV originals are already retained**; the 11 remaining exports are listed below. This is an acquisition inventory, not a claim that every original row is imported or publicly eligible. The [machine-readable manifest](courtlistener-bulk-gap-manifest-2026-10-02.json) preserves export columns, source URLs, compressed sizes, checksums and qualifications.

The [official S3 index](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data%2F&max-keys=1000) required two pages: 1,111 objects, ending with `IsTruncated=false`. The earlier retained 1,000-object index was truncated and remains unchanged. Negative availability findings below use the complete listing, the [September 30 loader](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/load-bulk-data-2026-09-30.sh) and the [current official exporter](https://github.com/freelawproject/courtlistener/blob/main/scripts/make_bulk_data.sh), which enumerates 33 tables.

The publisher describes these as quarterly full table snapshots in UTF-8 PostgreSQL CSV format. API and CSV schemas can differ, and null/blank distinctions must survive ingestion. The publisher applies the Public Domain Mark and reports no known copyright restrictions; that statement does not establish privacy eligibility, current accuracy or claim-specific legal applicability. [Official bulk documentation](https://wiki.free.law/c/courtlistener/help/api/bulk-data/bulk-legal-data).

## Remaining listed originals

| Export | Compressed bytes | Scope decision |
|---|---:|---|
| [Opinions](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2) | 55,252,643,429 | Contains opinion text with native opinion/cluster IDs; no separate metadata-only opinion CSV is listed. Not acquired. |
| [Oral arguments](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/oral-arguments-2026-09-30.csv.bz2) | 691,880,446 | Metadata and transcript fields, with media locators. Not acquired by this discovery; no audio requested. |
| [Financial disclosures](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-2026-09-30.csv.bz2) | 5,635,744 | Disclosure-document metadata and native person FK. |
| [Investments](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosure-investments-2026-09-30.csv.bz2) | 36,608,328 | Disclosure investment/transaction rows. |
| [Agreements](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-agreements-2026-09-30.csv.bz2) | 318,103 | Disclosure agreement rows. |
| [Debts](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-debts-2026-09-30.csv.bz2) | 393,432 | Disclosure debt rows. |
| [Gifts](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-gifts-2026-09-30.csv.bz2) | 68,178 | Disclosure gift rows. |
| [Non-investment income](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-non-investment-income-2026-09-30.csv.bz2) | 441,242 | Disclosure income rows. |
| [Positions](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-positions-2026-09-30.csv.bz2) | 915,384 | Disclosed organizational positions, separate from the acquired judicial-service position table. |
| [Reimbursements](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-reimbursements-2026-09-30.csv.bz2) | 1,138,508 | Disclosure reimbursement rows. |
| [Spousal income](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/financial-disclosures-spousal-income-2026-09-30.csv.bz2) | 515,573 | Disclosure spousal-income rows. |

The nine financial-disclosure exports total **46,034,492 compressed bytes**. They contain source-specific redaction/inference flags and potentially sensitive descriptions/partners. They require separate identity and privacy review before any projection. A disclosure association does not establish judicial bias, a conflict, causation or a case outcome. None of these bodies was downloaded here. Export fields and sizes come from the [official loader](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/load-bulk-data-2026-09-30.sh) and complete S3 inventory.

## Requested metadata without a listed bulk export

The [schema dump](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/schema-2026-09-30.sql) defines parties, case-role/party types, attorneys, attorney organizations and their associations, docket entries, RECAP documents, RECAP-document opinion citations, and parenthetical groups. None has a corresponding CSV in the observed complete bucket inventory or either export list. A table definition alone is not a downloadable data source. Existing scoped API observations and unfinished cursors remain the verified backfill route; no CSV URL was guessed.

The acquired `citation-map` describes directed citing/cited **opinion** IDs and mention depth. The [current official model](https://github.com/freelawproject/courtlistener/blob/main/cl/search/models.py) has no operative positive/negative treatment field in `OpinionsCited`; treatment appears only as a comment. Parenthetical scores measure source descriptiveness. Neither metric establishes binding authority, legal treatment or a probability. RECAP-document citation relations are a separate model and are not exported in the listed CSV set.

No separate verdict, settlement or generic current MDL master/member join export was identified. FJC disposition/judgment/amount fields and cluster disposition/history are dated source fields; they do not establish a comprehensive verdict or settlement corpus. Historical FJC MDL fields and exact docket foreign keys retain their source meaning. Termination dates and docket entries are not proven outcomes, and `parent_docket_id` is not generalized into MDL membership. These limits follow the actual fields in the [official loader](https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/load-bulk-data-2026-09-30.sh).

Exactly five bounded official source fetches were used: documentation, two index pages, exporter and search model. No CourtListener REST API request, database call, export-body download, PDF or audio retrieval occurred. Private original discovery evidence is retained under `C:/Users/firas/.codex/corpus-cache/courtlistener/bulk-gap-discovery-20261002`. Small retained exports were rehashed; multi-gigabyte originals retain their prior acquisition hashes with current byte-count checks. The discovery manifest SHA256 is `e9c677b1ef3d0d8ab368aeacc548a71631dfeffc1b16ab10df11bbf188583c1a`.
