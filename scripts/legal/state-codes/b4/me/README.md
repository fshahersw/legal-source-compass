# Maine Revised Statutes (batch 4)

Official source: [Maine Legislature — Statutes](https://legislature.maine.gov/statutes/homepage.html) (`legislature.maine.gov`).

## Edition / currency (as published on homepage)

Verbatim from the left-panel status block on `homepage.html` at acquisition time (see `/tmp/sc4/me/inventory.json` → `currency_blocks` and packet `manifest.json` → `currency`).

Example text observed during development:

> The text reflects changes made through the First Special Session of the 132nd Maine Legislature, and is current through October 1, 2025. The text is subject to change without notice.

Per-page footer: `Data for this page extracted on …` (stored on section rows as `page_extracted` when present).

## Layout

- Title list: `homepage.html`
- Title TOC: `{slug}/title{slug}ch0sec0.html` (e.g. `1/title1ch0sec0.html`, `17-A/title17-Ach0sec0.html`)
- Chapter TOC: `{slug}/title{slug}ch{N}sec0.html`
- Section HTML: `{slug}/title{slug}sec{N}.html` (suffixes like `sec4-A.html`)

Bulk per-title PDF/DOCX links exist on title pages; this pipeline uses section HTML for full coverage.

## Commands

```bash
export FIRECRAWL_API_KEY=…   # optional; direct fetch first, Firecrawl on 403/406 only

python3 acquire.py --work /tmp/sc4/me --phase inventory
python3 acquire.py --work /tmp/sc4/me --phase fetch
python3 parse.py --work /tmp/sc4/me
python3 verify.py --work /tmp/sc4/me
python3 -m unittest
```

Long acquisition: tmux session `sc4-me`, log `/tmp/sc4/me/acquire-inventory.log` and `/tmp/sc4/me/acquire-fetch.log`.

## Outputs

| Path | Role |
|------|------|
| `/tmp/sc4/me/raw/` | Verbatim originals (content-addressed) |
| `/tmp/sc4/me/receipts.jsonl` | Archive receipts |
| `/tmp/sc4/me/inventory.json` | Title/chapter/section URL inventory |
| `/tmp/sc4/me/packet/` | Staged `chapters.jsonl`, `sections.jsonl`, `chapter-text/`, `manifest.json` |
| `/tmp/sc4/me/REPORT.json` | Parse coverage and mismatches |
| `/tmp/sc4/me/verify.json` | Receipt re-hash and span checks |
