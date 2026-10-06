# Full state codes

`publisher-code-intake/2` is the private intake. The website reads only states whose review flag is on, through `database/contracts/corpus-publisher-code-projection-v2.sql` (apply that file after the intake contract). Working rules: the project store `internal/state-codes/README.md`. Intake contract: `database/contracts/corpus-publisher-code-intake-v2.sql`. Texas continues on `publisher-code-intake/1` until its own review flag is allowed.

Isolated tests (`node --test scripts/legal/state-codes/publisher-code-intake-v2.test.mjs`, PGlite 0.5.8): 4/4 pass. They cover a manifest, one run, a unit and a section landing with exact readback, coverage counts, a terms gate, a bad section id, a foreign host, a section before its unit, projection before review, a second open run, anonymous denial, and a reused payload hash.

Nothing below is a count of landed sections.

| Batch | States                                         | Status                                |
| ----- | ---------------------------------------------- | ------------------------------------- |
| A     | NY, PA, FL, IL, OH, MI, GA, NC, MA, AZ, MO, LA | not started; waiting on the migration |
| B     | MN, WI, IN, TN, CO, MD, VA, SC, AL, KY, OK, OR | staging against the mapping           |
| C     | CT, NV, IA, MS, AR, KS, UT, NE, NM, WV, ID, HI | staging against the mapping           |
| 4     | NH, ME, MT, RI, DE, SD, ND, AK, VT, WY         | later                                 |
