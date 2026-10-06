# Full state codes

`publisher-code-intake/2` is applied. The public read `database/contracts/corpus-publisher-code-projection-v2.sql` is applied as well (migration `corpus_publisher_code_projection_v2`). The website shows section text only for a state whose review flag `public_projection_allowed` is on. States that have landed but are still private appear on Sources → Quality & coverage as landed-private, with no section text. Working rules: the project store `internal/state-codes/README.md`. Contract: `database/contracts/corpus-publisher-code-intake-v2.sql` (PR #45, merged).

Isolated tests (`node --test scripts/legal/state-codes/publisher-code-intake-v2.test.mjs`, PGlite 0.5.8): 5/5 pass. They cover a manifest, one run, a unit and a section landing with exact readback, coverage counts, a terms gate, a bad section id, a foreign host, a section before its unit, projection before review, a second open run, anonymous denial, a reused payload hash, and the public projection staying empty until the review flag is allowed.

Nothing below is a count of landed sections.

| Batch | States                                         | Status                                     |
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

## Georgia

Nothing was landed. No manifest was registered and no run was opened. The General Assembly's Georgia Code link goes to `http://www.lexisnexis.com/hottopics/gacode`, which redirects into an `advance.lexis.com` container. A direct fetch returns HTTP 200 and a JavaScript cookie bootstrap with no statute text. A rendered fetch, with no clicks, ends on `signin.lexisnexis.com` with "Unable to Complete Your Request." The gate was not accepted or bypassed. The 2026 General Statutes Summary is a session summary, not the code. Session-law pages are not the code. A Secretary of State PDF is one chapter of Title 43, current through the 2020 regular session, and the direct fetch returns HTTP 403. Landing the current code needs a Code Revision Commission or Lexis arrangement, or a later owner decision on the gated site.

Missouri's chapter tables of contents matched the parsed sections on the 458 chapters that list sections. Ten chapter pages list no section links (chapter 203 is printed "Transferred to Chapter 643"). Their "view entire chapter" URL did not return a section list. Edition is null. The site says the posted statutes are uncertified and unofficial. This is not a review.

Pennsylvania is landed and private. Each title document carries a `revised` meta timestamp; the index page prints no "current through" line and no edition. `through_date` is null. This is not a review.

## Florida

Landed and private. Run `c01932d4-eb99-4e27-8957-405d668e0884` completed with 24,993 sections and 638 chapter units. Every chapter page prints "The 2026 Florida Statutes". Edition is 2026. No through-date is printed, so `through_date` is null. The October 6, 2026 page date is the display date. The TOC proof covers 2,833 pages: the 638 full chapters and 2,195 contents indexes, including the part and subpart indexes those chapters link to. Marker counts match on every page, and `unfetched_child_pages` is empty. All 2,883 direct fetches returned HTTP 200. The review RPC was not called.
