# Full state codes

## Live status (read 2026-10-08, `corpus_publisher_code_coverage_v2`, no recount)

43 jurisdictions are `reviewed` with `public_projection_allowed` on and show section text on the site: AK, AL, AZ, CO, CT, DC, DE, FL, IA, ID, IL, IN, KY, LA, MA, MD, ME, MI, MN, MO, MT, NC, ND, NE, NH, NM, NV, NY, OH, OK, OR, PA, RI, SC, SD, TX, UT, VA, VT, WA, WI, WV, WY. Four are `acquiring` with projection off (CA 0 sections, HI 0 sections / 1,500 units, KS 5,821 sections, NJ 0 sections; a second TX acquisition run also reports 32,007 sections landed beside the reviewed TX code). Four have no coverage row at all: AR, GA, MS, TN. The batch table and the "landed and private" lines further down are the October 6–7 history and are no longer the live state.

Section counts per public state are the ones `corpus_publisher_code_projected_states_v2` prints (for example PA 14,741; NY 37,530; TX 121,902; IN 83,148; IL 72,813). Edition and currency come from each publisher's own statement; where a publisher prints none (AZ, DE, IL, LA, MA, MI, MO, NC, OH, OK, PA, TX, UT, VT, WV, WY and others) the site shows "Not recorded". Pennsylvania's only currency signal is each title document's `revised` meta stamp; the site now prints it as "Publisher page revised stamp: <value>" rather than the raw tag.

## Outline defect and the projection/3 contract (2026-10-08)

`corpus_publisher_code_projected_outline_v2` matches a recorded path against a section's `hierarchy` by array position and only groups on the next *declared* level. Publishers that declare optional levels land sections that skip them (PA declares title, part, subpart, article, subarticle, chapter, subchapter, division, subdivision, schedule, section; 42 Pa.C.S. § 5524 is recorded as title 42 › part VI › chapter 55 › subchapter B). Under v2 the outline at title 42 › part VI looks for a subpart in position 2, finds none, and lists nothing; a path that names the chapter directly is rejected ("does not follow this code's declared levels").

Measured with v2 on the first click only (root group → its outline), reading every top-level group: Louisiana 48 of 54 titles dead-end (38,577 sections behind them); Pennsylvania 12 of 51 titles (2,058 sections); New York 7 of 94 laws (5,370 sections); Connecticut 2 of 110 titles (753 sections); Iowa, Kentucky, Nevada, Florida and Colorado 0. Deeper dead-ends (such as the Pennsylvania example) are not in those numbers.

Fix: `database/contracts/corpus-publisher-code-projection-v3-outline.sql` adds `corpus_publisher_code_projected_outline_v3`. It keeps v2's anchored, positional path matcher (`publisher_code_path_matches_v2`), accepts any path whose steps are declared levels in strictly increasing declared order (so declared levels may be skipped), and groups on whatever entry each matched section records right after the path, so one outline level can list, say, chapters beside subparts; every group carries its own `level`. A path that is not anchored at the first recorded level (for example `part VI` alone) lists nothing rather than merging across titles. Same gate, same grants (service role only), nothing writes, v2 stays installed. The function was exercised on a local PostgreSQL 16.13 with a fixture (skipped levels, a null subpart, direct sections, a quarantined row, an unknown state, an unanchored path, and four invalid paths each isolated in its own savepoint) and returned the expected shapes; it has not been run against the live corpus. **Status (2026-10-08):** applied by the owner in the corpus project; all four trailer checks pass live (PA 42 › VI lists 16 chapters incl. 55 "LIMITATION OF TIME"; subchapter B reaches PA:42:5524; wrong-order path → 22023; LA root lists 54 titles), and LA Title 10 / PA Title 42 open in the site. Original owner action: apply the contract in the SQL editor of the corpus project, then run the readback queries in the file's trailer; the step-by-step version is [the runbook](./outline-projection-v3-runbook-2026-10-08.md). The site already prefers v3 and falls back to v2 when v3 is absent; under v2 it now reports a path it cannot express as "The outline cannot open this position yet" instead of a 400 error.

## Site behaviour (2026-10-08)

- `/law/codes/$state` for a projected state shows a clickable outline (divisions with counts, breadcrumbs, filter, up-one-level), a section list with the open section highlighted and previous/next links, the section's recorded position in the code ("Show in outline" jumps the outline there), and a toolbar: Official source, Copy citation, Copy text, Copy link.
- "Time limits citing this section" lists Time Limits rules whose pinpoint resolves exactly to the section's native id, or whose quoted passages a code-capture recheck found in that section; it links to the calculator for that state and claim. Nothing is matched by heading, chapter or neighbouring number (`src/lib/limitations/sectionRules.ts`).
- Everything older below is history of the intake, kept for provenance.

`publisher-code-intake/2` is applied. The public read `database/contracts/corpus-publisher-code-projection-v2.sql` is applied as well (migration `corpus_publisher_code_projection_v2`). The website shows section text only for a state whose review flag `public_projection_allowed` is on. States that have landed but are still private appear on Sources → Quality & coverage as landed-private, with no section text. Working rules: the project store `internal/state-codes/README.md`. Contract: `database/contracts/corpus-publisher-code-intake-v2.sql` (PR #45, merged).

Isolated tests (`node --test scripts/legal/state-codes/publisher-code-intake-v2.test.mjs`, PGlite 0.5.8): 5/5 pass. They cover a manifest, one run, a unit and a section landing with exact readback, coverage counts, a terms gate, a bad section id, a foreign host, a section before its unit, projection before review, a second open run, anonymous denial, a reused payload hash, and the public projection staying empty until the review flag is allowed.

Historical batch plan (October 6; superseded by the live status above). Nothing below is a count of landed sections.

| Batch | States                                         | Status (as of October 6)                   |
| ----- | ---------------------------------------------- | ------------------------------------------ |
| A     | NY, PA, FL, IL, OH, MI, GA, NC, MA, AZ, MO, LA | MI, PA, NC, and MO are landed and still private. No batch A state has been reviewed. |
| B     | MN, WI, IN, TN, CO, MD, VA, SC, AL, KY, OK, OR | staging against the mapping                |
| C     | CT, NV, IA, MS, AR, KS, UT, NE, NM, WV, ID, HI | staging against the mapping                |
| 4     | NH, ME, MT, RI, DE, SD, ND, AK, VT, WY         | later                                      |

## New York

Official source: New York State Senate OpenLegislation, [Consolidated Laws](https://www.nysenate.gov/legislation/laws/CONSOLIDATED). On 2026-10-06 a Chrome 131 User-Agent, with client hints, still received HTTP 403 and `cf-mitigated: challenge` for the consolidated index and for the Alcoholic Beverage Control law. The identifying capture agent gets the same challenge. That is not a terms gate, and it is not the empty-shell CDN behavior Indiana saw. Direct fetch is still unavailable, so the capture stays `proxied:firecrawl`. The Assembly's own laws link, `public.leginfo.state.ny.us`, does not connect from here.

The publisher does not print one code-wide edition. Each page says "Viewing most recent revision (from YYYY-MM-DD)". Environmental Conservation is 2025-10-31. Abandoned Property Law § 101 is 2014-09-22, which is that section's own latest revision, not a statement that the code stopped in 2014. The 94 law tables of contents are captured. Article capture is still running. Nothing for New York has been landed.

## Before a state is landed or reviewed

Every source on a landed object carries `http_status` 200 from its receipt. A unit or section with no text is a gap, not a row. TOC completeness is the publisher's own section markers on each page, including child pages the page links to. Delaware's chapter indexes linked subchapter pages that were not fetched, and 350 of 1,326 chapters were missing. The shared lander (`scripts/legal/state-codes/common/land_publisher_code_v2.py`) refuses a packet, before it opens a run, when a source lacks `http_status` 200, a unit or section text is empty, or `toc-proof.json` is missing, disagrees, or lists unfetched child pages.

Review is `scripts/legal/state-codes/common/review_state.py` (20 live sections, then `corpus_publisher_code_review_v2`). That file is not in the tree yet. No batch A state was flipped. A mismatch stays `held` with projection off.

Coverage read on 2026-10-06, without a recount: Michigan 43,891 sections and 205 units, Pennsylvania 14,741 sections and 75 units, North Carolina 39,612 sections and 396 units, Missouri 30,435 sections and 458 units, Florida 24,993 sections and 638 units. All five are `landed` with `public_projection_allowed` false.

Michigan's official directory lists 241 `Chapter N.xml` files. All 241 were fetched with HTTP 200. `MCLSectionInfo` counts 43,891 and the parser emits 43,891. Thirty-six of those files contain no section marker and were not landed as units. 3,077 sections have an empty `BodyText`; the landed text is the publisher's printed catchline. The Chapter Index HTML links 227 of the 241 files. The other 14 are on the directory listing and were fetched with the rest. Currency printed on the index: "Michigan Compiled Laws Complete Through PA 103 of 2026" (not an ISO date, so `through_date` is null and edition is null). This is not a review.

North Carolina's landing record says 396 chapter pages were captured at HTTP 200, matching the table of contents, with 85 explicit status stubs and no unresolved markers. The publisher statement is "The General Statutes include changes through S.L. 2026-30." Edition is null. The landed text for § 113-403, § 104E-28, and § 105-113.110A keeps the body sentences that begin "Article" or "Part". The review RPC was not called.

## Delaware

Recaptured and reviewed on 2026-10-07. The home-page notice had moved from "all acts enacted as of September 04, 2026" to "all acts enacted as of September 10, 2026, up to and including 85 Del. Laws, c. 518". Run `fc86f47c-79c9-580b-83c1-5f3852851bae` (parser `de-delcode-html/3`, manifest `674758989217…`) landed 23,444 sections and 2,453 units with projection off. 25,897 rows were verified. `toc-proof.json` matches the publisher's `SectionHead` markers on all 2,453 pages, and no child page is unfetched. The shared review passed 20 of 20 live sections and turned projection back on.

Parser v2 ended a section at the first `</div>` after its heading. A table inside `<div class="code-table">` therefore ended the section, and the text after the table was lost: 87 of the first 18,263 sections, 31,531 words. Version 3 ends a section at its balanced `</div>` and keeps tables as section text. `b4/de/reverse_check.py` found no section whose live text is missing from the stored text.

Sixteen sections and five units the publisher no longer prints are still rows from the previous run: 4 Del. C. ch. 4, the old 31 Del. C. ch. 28 subchapters, and 21 Del. C. § 2121. A land adds and updates rows; it does not remove them. They need a ledgered quarantine before they leave the projection.

## Georgia

Nothing was landed. No manifest was registered and no run was opened. The General Assembly's Georgia Code link goes to `http://www.lexisnexis.com/hottopics/gacode`, which redirects into an `advance.lexis.com` container. A direct fetch returns HTTP 200 and a JavaScript cookie bootstrap with no statute text. A rendered fetch, with no clicks, ends on `signin.lexisnexis.com` with "Unable to Complete Your Request." The gate was not accepted or bypassed. The 2026 General Statutes Summary is a session summary, not the code. Session-law pages are not the code. A Secretary of State PDF is one chapter of Title 43, current through the 2020 regular session, and the direct fetch returns HTTP 403. Landing the current code needs a Code Revision Commission or Lexis arrangement, or a later owner decision on the gated site.

Missouri's chapter tables of contents matched the parsed sections on the 458 chapters that list sections. Ten chapter pages list no section links (chapter 203 is printed "Transferred to Chapter 643"). Their "view entire chapter" URL did not return a section list. Edition is null. The site says the posted statutes are uncertified and unofficial. This is not a review.

Pennsylvania is landed and private. Each title document carries a `revised` meta timestamp; the index page prints no "current through" line and no edition. `through_date` is null. This is not a review.

## Florida

Landed and private. Run `c01932d4-eb99-4e27-8957-405d668e0884` completed with 24,993 sections and 638 chapter units. Every chapter page prints "The 2026 Florida Statutes". Edition is 2026. No through-date is printed, so `through_date` is null. The October 6, 2026 page date is the display date. The TOC proof covers 2,833 pages: the 638 full chapters and 2,195 contents indexes, including the part and subpart indexes those chapters link to. Marker counts match on every page, and `unfetched_child_pages` is empty. All 2,883 direct fetches returned HTTP 200. The review RPC was not called.
