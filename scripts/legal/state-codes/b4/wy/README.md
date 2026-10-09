# Wyoming Statutes (batch 4)

Official publisher: Wyoming Legislative Service Office ([wyoleg.gov](https://wyoleg.gov/)).

## Source

- Statutes hub: https://wyoleg.gov/stateStatutes/StateStatutes
- Download index (per-title PDFs): https://wyoleg.gov/stateStatutes/StatutesDownload

Publisher currency (verbatim on the download page):

> This version of the Wyoming Statutes contains changes from the 2026 Budget Session and reflects the contents of the statutes as they exist as of July 1, 2026.

Full text is acquired as official compressed PDFs at `https://wyoleg.gov/statutes/compress/title{NN}.pdf` (43 statute titles, Title 34.1, Title 99, and Title 97 Constitution). LexisNexis annotated online and USB Word editions are not used.

## Commands

Requires `pdftotext` (poppler-utils).

```bash
export FIRECRAWL_API_KEY=...   # optional fallback on 403/406
python3 scripts/legal/state-codes/b4/wy/acquire.py --work /tmp/sc4/wy
python3 scripts/legal/state-codes/b4/wy/parse.py --work /tmp/sc4/wy
python3 scripts/legal/state-codes/b4/wy/verify.py --work /tmp/sc4/wy
python3 scripts/legal/state-codes/b4/wy/spot_check.py --work /tmp/sc4/wy
python3 scripts/legal/state-codes/b4/wy/report.py --work /tmp/sc4/wy
python3 -m unittest scripts/legal/state-codes/b4/wy/test_wy_parse.py
```

## Output

- Raw originals + `receipts.jsonl`: `/tmp/sc4/wy/raw/`
- Staged packet: `/tmp/sc4/wy/packet/`
- `REPORT.json`, `inventory.json`, `verify.json`: `/tmp/sc4/wy/`

## Parser

Section boundaries use the publisher PDF line layout:

- **New section:** `{title}-{chapter}-{section}.` with heading text on the **same line**, where `{section}` is an integer (`(?!\d)` rejects sub-decimal blocks like `1-1-123.1.`).
- **Constitution (title 97):** `Article N, Section M` with heading on the same line.
- **Occurrence suffix** (`1-6-107:2`): only when the same main header appears more than once in the title PDF (genuine reprints).

Sub-decimal enrolled-act blocks (e.g. Ski Safety Act inside `1-1-123`) remain inside the parent section text.

TOC reconciliation: `toc_citation_paths()` and the parser share one detector; `parse.py` requires an **exact ordered match** per title.

## Parser v4 safety correction — 2026-10-08

The previous numeric-only article detector omitted lettered UCC sections (including `34.1-2.A-101` and `34.1-4A-101`) and appended their text to an earlier numeric section. Version 4 preserves the printed article token and represents the UCC hierarchy as title/article/part/section, without inventing a chapter. Article boundaries terminate the prior section. Embedded decimal act blocks retain the pre-existing policy.

The new regression uses independently listed expected citations and tests that lease text is not merged into the sales limitation. A parser-derived ordered list matching that same parser is a consistency check, **not independent proof of statutory completeness**.

This is a new parser version, not an approved replacement of the live data. The old manifest review does not apply; it has been removed from this v4 candidate. Rebuild into a new staging packet, compare retained originals and source boundaries, review the changed identities and pass the normal private intake/projection gates before publishing. Never relabel a v3 packet as v4.
