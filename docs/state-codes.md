# Full state codes

`publisher-code-intake/2` is applied. Coverage currently reports Texas only, still on `publisher-code-intake/1`. The website reads a state only after its review flag is on, through `database/contracts/corpus-publisher-code-projection-v2.sql` (apply that file next). Working rules: the project store `internal/state-codes/README.md`. Contract: `database/contracts/corpus-publisher-code-intake-v2.sql` (PR #45, merged).

Isolated tests (`node --test scripts/legal/state-codes/publisher-code-intake-v2.test.mjs`, PGlite 0.5.8): 5/5 pass. They cover a manifest, one run, a unit and a section landing with exact readback, coverage counts, a terms gate, a bad section id, a foreign host, a section before its unit, projection before review, a second open run, anonymous denial, a reused payload hash, and the public projection staying empty until the review flag is allowed.

Nothing below is a count of landed sections.

| Batch | States | Status |
|---|---|---|
| A | NY, PA, FL, IL, OH, MI, GA, NC, MA, AZ, MO, LA | in progress 2026-10-06; nothing landed yet |

## New York

Official source: New York State Senate OpenLegislation, [Consolidated Laws](https://www.nysenate.gov/legislation/laws/CONSOLIDATED). Direct requests from this environment get a Cloudflare challenge (HTTP 403). That is not a terms gate. The Assembly's own laws link, `public.leginfo.state.ny.us`, does not connect from here. Pages are being captured through Firecrawl and recorded as `proxied:firecrawl`.

The publisher does not print one code-wide edition. Each page says "Viewing most recent revision (from YYYY-MM-DD)". Environmental Conservation is 2025-10-31. Abandoned Property Law § 101 is 2014-09-22, which is that section's own latest revision, not a statement that the code stopped in 2014. The 94 law tables of contents are being captured first (about 20 of 94 were in when this was written), then articles, then sections. Nothing has been landed.
| B | MN, WI, IN, TN, CO, MD, VA, SC, AL, KY, OK, OR | staging against the mapping |
| C | CT, NV, IA, MS, AR, KS, UT, NE, NM, WV, ID, HI | staging against the mapping |
| 4 | NH, ME, MT, RI, DE, SD, ND, AK, VT, WY | later |
