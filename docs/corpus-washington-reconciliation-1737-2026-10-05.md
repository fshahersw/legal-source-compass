# Washington source reconciliation — October 5, 2026

This is an additive audit of the 16 chapter IDs that the frozen Complete Title PDF audit did not find as `Chapter <id> RCW` headings. It does not revise the all-state acquisition checkpoint and makes no claim that the Washington code is complete or current.

## Exact chapter-page capture

The 16 requests were derived one-for-one from `capture-extraction-audit-v3.json` and matched to the identical chapter hrefs and descriptions in the raw-verified native title inventory. The inventory SHA-256 is `268052732386672b46978baa0e23333dda1394fc443e2f727bcaf05078b31e94`; the pinned PDF audit SHA-256 is `b934e27c9c0a7e6166c6fbc00d1723d0fbbb4910dd9533eb744a1d5d1a10a733`. All title-page source bodies used for this mapping rehashed to the inventory values.

The exact chapter pages were captured from 17:40:07.546Z to 17:40:26.732Z on October 5, 2026, with one-second minimum spacing, a 2 MiB per-object cap and a 16 MiB aggregate cap. All 16 returned HTTP 200 as `text/html`; the capture stored 75,240 bytes, stopped normally and left no unattempted requests. The receipt SHA-256 is `4b5bb120ee8e202f3e8d0d8232e45be2723217d7c6c3cc472cf317d86a56c464`. All 16 raw response bodies independently passed the recorded byte-count and SHA-256 checks. The HTML headings identify all 16 requested native chapters.

These chapter HTML pages are indexes: they show a chapter heading, section-number/title lists and links labeled “PDF of Chapter” / “PDF of Complete Chapter.” They do **not** contain the statutory section bodies. Thus the capture confirms an index-to-PDF structural mismatch; it does not establish that the missing PDF heading is a formatting issue, that newer law is incorporated, or that the HTML index text is a substitute for full chapter text.

## Complete Chapter PDF body capture

Each of the 16 indexes had exactly one link labeled “Complete Chapter.” The PDF plan preserves those literal hrefs from the hash-verified raw index pages; it does not construct or normalize them. The single batch ran from 17:46:39Z to 17:47:02Z on October 5, 2026. All 16 returned HTTP 200, and all had raw PDF bodies verified against per-request and batch receipts. The pass stored **2,642,819 bytes** and left no request unattempted. It used a 10 MiB object cap, 100 MiB total cap and at least one second between requests. Each individual request has its own raw file, request journal and receipt.

Pypdf 6.10.0 extracted **119 pages / 346,290 UTF-8 text bytes**. All 119 page records show the printed footer `Certified on 7/15/2026`. A focused cross-check parsed the exact section PDF link IDs from each chapter index and counted only body-heading lines beginning `RCW <section citation> <heading title>` in the linked Complete Chapter PDF. All **154 of 154** distinct index section IDs appear as exactly one body heading; there are zero missing or unexpected IDs and zero repeated body-heading IDs. The old Complete Title PDF text contains zero matching chapter/section headings for this set. This closes the specific index-to-body gap while preserving the older Complete Title PDFs as separate source versions.

All 16 chapter PDFs contain at least one literal 2026 session-law citation in their section histories. Examples useful for version/effective-date review include 4.74 (2026 c 107; the PDF says the act takes effect January 1, 2027 and includes a transitional-provision section), 18.139 (2026 c 18; the PDF says July 1, 2028), 19.435 (2026 c 167; February 1, 2027), 19.440 (2026 c 168; January 1, 2027), and 41.26A (2026 c 261; several provisions state June 30, 2029). Chapter 2.78 contains 2026 c 199 and section 2.78.900 says the chapter expires December 31, 2029. The exact snippets and chapter-by-chapter citations are in the comparison artifact. These are literal texts from a dated publisher file, not conclusions about legal force, applicability to a claim, whether an effective date has passed, or current law.

For context, retained Complete Title PDFs include printed certification dates from 2024 and 2025 (Title 19 includes `10/6/2025`; Title 4 includes `8/15/2025`, with older dates on combined-chapter pages). The linked chapter PDFs’ later printed certification dates and 2026 session-law notes explain why their headings and sections were absent from those older Title PDF captures. Do not replace or merge the source versions, and do not infer that the 2026 archive labeling certifies current law. Pypdf output is a review derivative; a zero/low-text-page screen is not proof of OCR completeness, and the captured PDF remains the source document.

## Title 25 / Partnerships mapping

The previously captured official 2026 archive HTML and its parsed archive inventory show row 25 labeled “Partnerships” pointing to `http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/RCW%20%2026%20%20%20TITLE.htm`. Row 26, “Domestic Relations,” points to that exact same href. The parsed inventory records the row-25 path/native-title disagreement and duplicate href. An exact-href capture of that page returned a native Title 26 heading and produced 26 chapter links; its raw body SHA-256 is `998a9805ca28842d02aaea4502c2dbe72c4956e70c70bd5c2bbef99b5079c954`.

The merged **2026 archive** inventory has zero native Title 25 chapter links and zero Title 25 PDF links. A bounded hyperlink scan of the retained archive and captured official title-page bodies (including the separate exact Title 26 follow-up) found no distinct native Title 25 href in that source set; its two numeric matches were unrelated Title 53 sections 53.25.100 and 53.25.190.

A Firecrawl official-source search then surfaced the separate official RCW Title 25 listing and the literal archive URL `https://lawfilesext.leg.wa.gov/law/RCWArchive/2024/RCW%20%2025%20%20%20TITLE.htm`. Firecrawl’s processed page showed “2024 Archive,” “Title 25 RCW,” “PARTNERSHIPS,” and chapters 25.05, 25.10, 25.12 and 25.15. After confirming that native identity, one exact raw request to that URL returned HTTP 200. Its 2,812-byte body rehashes to `4778e756654e3f2e5e0d80786dd2f23173408acb17d1ebb809af301938a2cfa5`; the raw verification lists the four chapter hrefs observed on that page. This proves a distinct **2024 archived** Title 25 page exists. It does not fix the erroneous 2026 Title 25 row, identify a 2026 Title 25 link, or establish current text.

## Evidence files

Private, ignored artifacts are under `private/audit-2026-10-05/full-state-codes/wa/chapter-page-reconciliation-1737-2026-10-05/`:

- `capture/receipt.json` and `capture/request-journal.jsonl`: exact request, response status/headers, pacing/run record and raw-body paths/hashes.
- `capture/raw/`: 16 raw chapter-index HTML bodies.
- `private/audit-2026-10-05/full-state-codes/wa/chapter-page-reconciliation-1737-2026-10-05-plan.json`: pinned 16-URL plan and source hashes; SHA-256 `a4893fdced4c9d243a94c1db6086af5ee0bf78cbbf4d4b8bd5d245602db424d0`.
- `chapter-source-review.json`: hash/size verification, native heading checks, index-only text observations; SHA-256 `ed58368d41d9da29146a19c7e55146335b8a58d1b465d27656b0b27765110abf`.
- `title25-existing-source-scan-v2.json`: bounded scan of retained official source links; SHA-256 `2aebc0e37cb143be14f5fc5a36c18221fdc5cf963e9ed43b347832f270f500c3`.
- `complete-chapter-pdf-capture-1745/`: 16 per-request raw PDFs, journals and receipts plus `batch-receipt.json` (SHA-256 `96c3e518a5d88978bbaf207083167107c411774a7c7d9fc1f60b02aed16bff9e`).
- `complete-chapter-pdf-text-pypdf-1745/`: per-page text derivatives and `extraction-comparison-manifest.json` (SHA-256 `6e0bcfbbfe8079b4accd2cfb66d2cb8f92ebe3d026ced33d6cf3aae6c820c48f`).
- `index-to-pdf-body-section-reconciliation.json`: exact 154-ID/multiplicity match and page-by-page certification evidence; SHA-256 `2692557f3a4e77788e0624843048e76d7a00a8509c394bf357adbe276f699562`.
- `chapter-body-version-comparison-v2.json`: 2026 chapter-law references, printed dates and literal effective-date/transitional text; SHA-256 `719d1b9f876f15df0e039606449f753af77218c5dcba8edce264b20bf73dbd32`.
- `title25-distinct-observed-2024-page/`: Firecrawl identity record and one exact raw 2024 Title 25 page capture; `raw-page-verification.json` SHA-256 `d09af310d9325cecad3f4839c53b8102a944d233fb24c667f59501b3e046180c`.

No database, application, published data, or existing source capture was changed.
