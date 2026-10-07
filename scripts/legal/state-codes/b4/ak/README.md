# Alaska Statutes (batch 4 staging)

Official source: [Alaska BASIS Statutes](https://www.akleg.gov/basis/statutes.asp) (`akleg.gov`).

## Edition / currency (verbatim from source home page)

- **Edition heading:** Alaska Statutes 2025
- **Legislature line:** 34th Legislature(2025-2026)
- **“Current through” date:** Not published on the statutes home page (only the 2025 edition heading and legislature session line above).

No separate unofficial-status disclaimer was found on the home page beyond those headings.

## Acquisition strategy

1. **Inventory** — `media=js&type=TOC` for each title (`title=1` … `47`), then each chapter id (`title=TT.CC`). Section ids come from chapter TOC links.
2. **Full text** — one verbatim HTML artifact per chapter: `media=print&secStart=<first>&secEnd=<last>`, or `secStart=<chapter>&secEnd=<chapter>` when the official TOC lists “No Sections” (repealed/empty chapter stubs).
3. All bodies retained under `/tmp/sc4/ak/raw/` with `sc_common.Archive` receipts (`receipts.jsonl`).

Titles with only a title-level “No Sections” entry (e.g. Title 7 Boroughs) have no chapter rows in the inventory.

## Commands

```bash
export FIRECRAWL_API_KEY=...   # optional fallback; direct fetch succeeded for this run

cd scripts/legal/state-codes/b4/ak
python3 acquire.py --work /tmp/sc4/ak              # inventory + download
python3 acquire.py --work /tmp/sc4/ak --download-only  # resume downloads
python3 parse.py --work /tmp/sc4/ak
python3 verify.py --work /tmp/sc4/ak
python3 -m unittest
```

## Staged output

- Packet: `/tmp/sc4/ak/packet/` (`chapters.jsonl`, `sections.jsonl`, `chapter-text/`, `manifest.json`)
- Evidence: `/tmp/sc4/ak/REPORT.json`, `/tmp/sc4/ak/verify.json`, `/tmp/sc4/ak/inventory.json`

## Known gaps / verification notes

See `/tmp/sc4/ak/REPORT.json` for counts, request routes, and the full mismatch list.

- **TOC duplicate section lines:** Some chapters list the same section number twice in the official TOC; the print HTML contains a single anchor — staged section count is below duplicate-inclusive TOC count (documented per chapter in `parse_mismatch_detail`).
- **TOC vs body drift:** A small number of chapters have extra sections in print HTML not repeated in the TOC (also listed in `parse_mismatch_detail`).
- **Title 7:** No chapter inventory from the official TOC.
