**Pinned Free Law Project reporters-db data**

Package: reporters-db 3.2.67 (Free Law Project, https://github.com/freelawproject/reporters-db), BSD 2-Clause licence.
Retrieved: 2026-10-23 as the PyPI source distribution (sha256 in PINNED.json); GitHub was not reachable from this session.

The JSON files are unchanged upstream bytes from `reporters_db/data/`; LICENSE is preserved verbatim. Only the data is used:
`scripts/citations_v2/build_patterns.py` reads `reporters.json` (reporter editions and variations) to generate the reporter
table of the canonical citation pattern table (`src/lib/citations/patterns.json`); `laws.json` is kept as the Bluebook
reference list of state statute and administrative-code names the hand-written state tables were checked against. No
upstream Python code is vendored or executed.
