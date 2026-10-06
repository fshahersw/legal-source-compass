# Vermont (V.S.A.) — batch 4 staging

Official source: [Vermont Statutes Online](https://legislature.vermont.gov/statutes/) (Vermont General Assembly).

## Publisher statements (verbatim)

Captured from the `alert-warning` block on statute pages (SHA256 recorded in `/tmp/sc4/vt/evidence/` after parse):

- *The Statutes below include the actions of the 2025 session of the General Assembly.*
- *NOTE: The Vermont Statutes Online is an unofficial copy of the Vermont Statutes Annotated that is provided as a convenience.*

No separate “current through” calendar date is published on these pages.

## Acquisition

```bash
export FIRECRAWL_API_KEY=…   # optional; only used on 403/406 from legislature.vermont.gov
python3 scripts/legal/state-codes/b4/vt/acquire.py --work /tmp/sc4/vt
python3 scripts/legal/state-codes/b4/vt/parse.py --work /tmp/sc4/vt
python3 -m unittest scripts/legal/state-codes/b4/vt/test_parse.py
```

Artifacts:

- Raw HTML + `receipts.jsonl` under `/tmp/sc4/vt/raw/`
- Chapter inventory + per-chapter section TOC in `/tmp/sc4/vt/inventory.jsonl`
- Staged packet under `/tmp/sc4/vt/packet/`
- `REPORT.json` verification summary

Strategy: title index → chapter index (TOC) + `fullchapter/{title}/{chapter}` full text; constitution page separately. No official bulk XML/ZIP found.

## Routes

Direct `urllib` with ≥1 s spacing (`sc_common.Archive`). Firecrawl fallback only when the official host returns 403/406.
