# Full state codes

`publisher-code-intake/2` is applied. The public read `database/contracts/corpus-publisher-code-projection-v2.sql` is applied as well (migration `corpus_publisher_code_projection_v2`). The website shows section text only for a state whose review flag `public_projection_allowed` is on. States that have landed but are still private appear on Sources → Quality & coverage as landed-private, with no section text. Working rules: the project store `internal/state-codes/README.md`. Contract: `database/contracts/corpus-publisher-code-intake-v2.sql` (PR #45, merged).

Isolated tests (`node --test scripts/legal/state-codes/publisher-code-intake-v2.test.mjs`, PGlite 0.5.8): 5/5 pass. They cover a manifest, one run, a unit and a section landing with exact readback, coverage counts, a terms gate, a bad section id, a foreign host, a section before its unit, projection before review, a second open run, anonymous denial, a reused payload hash, and the public projection staying empty until the review flag is allowed.

Nothing below is a count of landed sections.

| Batch | States                                         | Status                                     |
| ----- | ---------------------------------------------- | ------------------------------------------ |
| A     | NY, PA, FL, IL, OH, MI, GA, NC, MA, AZ, MO, LA | MI, NC, MO, FL (2026-10-06) and IL (2026-10-07) landed and reviewed (public). PA and NY landed, held (proxied captures). MA landed, not yet reviewed. AZ, LA capturing. OH blocked, GA gated. |
| B     | MN, WI, IN, TN, CO, MD, VA, SC, AL, KY, OK, OR | staging against the mapping                |
| C     | CT, NV, IA, MS, AR, KS, UT, NE, NM, WV, ID, HI | staging against the mapping                |
| 4     | NH, ME, MT, RI, DE, SD, ND, AK, VT, WY         | later                                      |

## New York

Official source: New York State Senate OpenLegislation, [Consolidated Laws](https://www.nysenate.gov/legislation/laws/CONSOLIDATED). On 2026-10-06 a Chrome 131 User-Agent, with client hints, still received HTTP 403 and `cf-mitigated: challenge` for the consolidated index and for the Alcoholic Beverage Control law. The identifying capture agent gets the same challenge. That is not a terms gate, and it is not the empty-shell CDN behavior Indiana saw. Direct fetch is still unavailable, so the capture stays `proxied:firecrawl`. The Assembly's own laws link, `public.leginfo.state.ny.us`, does not connect from here.

The publisher does not print one code-wide edition. Each page says "Viewing most recent revision (from YYYY-MM-DD)". Environmental Conservation is 2025-10-31. Abandoned Property Law § 101 is 2014-09-22, which is that section's own latest revision, not a statement that the code stopped in 2014. The 94 law tables of contents are captured. Article capture is still running. Nothing for New York has been landed.

## Before a state is landed or reviewed

Every source on a landed object carries `http_status` 200 from its receipt. A unit or section with no text is a gap, not a row. TOC completeness is the publisher's own section markers on each page, including child pages the page links to. Delaware's chapter indexes linked subchapter pages that were not fetched, and 350 of 1,326 chapters were missing. The shared lander (`scripts/legal/state-codes/common/land_publisher_code_v2.py`) refuses a packet, before it opens a run, when a source lacks `http_status` 200, a unit or section text is empty, or `toc-proof.json` is missing, disagrees, or lists unfetched child pages.

Review is `scripts/legal/state-codes/common/review_publisher_code_v2.py` (20 seeded random sections re-fetched live and diffed, then `corpus_publisher_code_review_v2`). `scripts/legal/state-codes/batch-a-review/make_packets.py` rebuilds the review packet for states that landed through their own landers. A mismatch, missing TOC evidence or proxied content stays `held` with projection off.

Coverage read on 2026-10-06, without a recount: Michigan 43,891 sections and 205 units, Pennsylvania 14,741 sections and 75 units, North Carolina 39,612 sections and 396 units, Missouri 30,435 sections and 458 units, Florida 24,993 sections and 638 units. All five are `landed` with `public_projection_allowed` false.

Michigan's official directory lists 241 `Chapter N.xml` files. All 241 were fetched with HTTP 200. `MCLSectionInfo` counts 43,891 and the parser emits 43,891. Thirty-six of those files contain no section marker and were not landed as units. 3,077 sections have an empty `BodyText`; the landed text is the publisher's printed catchline. The Chapter Index HTML links 227 of the 241 files. The other 14 are on the directory listing and were fetched with the rest. Currency printed on the index: "Michigan Compiled Laws Complete Through PA 103 of 2026" (not an ISO date, so `through_date` is null and edition is null). This is not a review.

North Carolina's landing record says 396 chapter pages were captured at HTTP 200, matching the table of contents, with 85 explicit status stubs and no unresolved markers. The publisher statement is "The General Statutes include changes through S.L. 2026-30." Edition is null. The landed text for § 113-403, § 104E-28, and § 105-113.110A keeps the body sentences that begin "Article" or "Part". The review RPC was not called.

## Georgia

Nothing was landed. No manifest was registered and no run was opened. The General Assembly's Georgia Code link goes to `http://www.lexisnexis.com/hottopics/gacode`, which redirects into an `advance.lexis.com` container. A direct fetch returns HTTP 200 and a JavaScript cookie bootstrap with no statute text. A rendered fetch, with no clicks, ends on `signin.lexisnexis.com` with "Unable to Complete Your Request." The gate was not accepted or bypassed. The 2026 General Statutes Summary is a session summary, not the code. Session-law pages are not the code. A Secretary of State PDF is one chapter of Title 43, current through the 2020 regular session, and the direct fetch returns HTTP 403. Landing the current code needs a Code Revision Commission or Lexis arrangement, or a later owner decision on the gated site.

Missouri's chapter tables of contents matched the parsed sections on the 458 chapters that list sections. Ten chapter pages list no section links (chapter 203 is printed "Transferred to Chapter 643"). Their "view entire chapter" URL did not return a section list. Edition is null. The site says the posted statutes are uncertified and unofficial. This is not a review.

Pennsylvania is landed and private. Each title document carries a `revised` meta timestamp; the index page prints no "current through" line and no edition. `through_date` is null. This is not a review.

## Florida

Landed and private. Run `c01932d4-eb99-4e27-8957-405d668e0884` completed with 24,993 sections and 638 chapter units. Every chapter page prints "The 2026 Florida Statutes". Edition is 2026. No through-date is printed, so `through_date` is null. The October 6, 2026 page date is the display date. The TOC proof covers 2,833 pages: the 638 full chapters and 2,195 contents indexes, including the part and subpart indexes those chapters link to. Marker counts match on every page, and `unfetched_child_pages` is empty. All 2,883 direct fetches returned HTTP 200. The review RPC was not called.

## Review of batch A, 2026-10-06

Michigan, North Carolina, Missouri and Florida passed the shared review (20 of 20 live diffs each, direct HTTP 200, TOC evidence recorded, no proxied units) and are `reviewed` with projection allowed. Reports: `internal/state-codes/batch-a/<st>/review.md`. Printed repeal and status lines are kept as text with `status_note` set (Michigan 3,077, North Carolina 11,514, none missing). Michigan's 281 Constitution sections have no per-section page and were not diffed. Missouri's publisher calls its posted statutes uncertified and unofficial.

Pennsylvania stays held: its captures are `proxied:firecrawl`, and direct requests to palegis.us time out from here.

## Ohio

`codes.ohio.gov/robots.txt` is `User-agent: * / Disallow: /`, so the Revised Code is not captured, directly or through a proxy. An official bulk download was searched for on 2026-10-06: Tavily searches limited to ohio.gov hosts, and Firecrawl maps of `lsc.ohio.gov` and `legislature.ohio.gov`, found bill analyses, digests and bill text but no Revised Code bulk, XML, ZIP or API. `lsc.ohio.gov` has no robots.txt (404) and `legislature.ohio.gov/robots.txt` allows all; neither hosts the code. The Legislative Service Commission technical contact (codes@lsc.ohio.gov, on codes.ohio.gov/contact) is the route to written permission or an export. Nothing is landed.

## Illinois and New York

Illinois: 72,813 sections in 2,817 act units, run `1020fbf4-bbe0-49be-b4c5-148bf2e14787`, 20 of 20 live diffs, `reviewed` with projection allowed. 669 acts with no section text are gaps. ilga.gov serves an incomplete certificate chain; the review used the intermediates with verification on, at the publisher's 10-second delay.

New York: 21,429 sections, one per nysenate.gov section page, run `f5fb6fd1-6930-56ba-8409-bd2033fa1f05`, landed and `held`. Every capture is `proxied:firecrawl` because the publisher challenges direct requests, so the review could not diff live pages. `ENV/13-0901` prints no text and is a gap.

## Arizona and Louisiana

Arizona: `azleg.gov/robots.txt` sets a 120-second crawl delay for all agents, and the capture honors it, about 30 section pages an hour. 376 pages were retained by 2026-10-07 (titles 1 and 3 in progress). No official bulk file was found (Tavily searches limited to azleg.gov, a Firecrawl map of the site). Fetching through Firecrawl would route around the delay and produce proxied content that could not be published, so it was not done. Nothing is landed.

Louisiana: the document capture was at 45,000 of 46,432 on 2026-10-07 with no failures; it lands once it finishes and its TOC proof is written.
