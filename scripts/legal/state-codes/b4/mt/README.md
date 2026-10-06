# Montana Code Annotated (batch 4)

Official source: [MCA Online](https://mca.legmt.gov/bills/mca/) (`https://mca.legmt.gov/bills/mca/`). Legacy `leg.mt.gov/bills/mca/` redirects to the archive host; the current site is `mca.legmt.gov`.

## Edition / currency (as published on `index.html`)

Verbatim strings are captured at acquire time from the home page (e.g. **Montana Code Annotated 2025**, **Updated August 2026**). The Internet disclaimer on section pages states that the printed version prevails in case of inconsistencies.

## Layout

| Level | Path pattern |
|-------|----------------|
| Title | `title_XXXX/chapters_index.html` |
| Chapter / Article | `chapter_XXXX/` or `article_XXXX/` → `parts_index.html` |
| Part | `part_XXXX/sections_index.html` |
| Section | `section_XXXX/….html` (one page per section) |

Staging unit: **part** (all sections in a part concatenated with Unicode spans).

## Commands

```bash
export FIRECRAWL_API_KEY=…   # only if direct fetch is blocked

python3 /workspace/scripts/legal/state-codes/b4/mt/acquire.py --work /tmp/sc4/mt
python3 /workspace/scripts/legal/state-codes/b4/mt/parse.py --work /tmp/sc4/mt
python3 -m unittest /workspace/scripts/legal/state-codes/b4/mt/test_parse.py
```

Phases: `acquire.py --phase inventory` (TOC + `inventory.json`), `--phase fetch` (section pages).

## Outputs

| Path | Contents |
|------|----------|
| `/tmp/sc4/mt/raw/` | Verbatim HTML |
| `/tmp/sc4/mt/receipts.jsonl` | Fetch receipts |
| `/tmp/sc4/mt/inventory.json` | Full TOC + section URL list |
| `/tmp/sc4/mt/packet/` | `chapters.jsonl`, `sections.jsonl`, `chapter-text/` |
| `/tmp/sc4/mt/REPORT.json` | Coverage and verification summary |
