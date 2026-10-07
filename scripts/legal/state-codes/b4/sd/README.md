# South Dakota Codified Laws (batch 4)

Official source: [South Dakota Legislature — Statutes](https://sdlegislature.gov/Statutes) (SPA) backed by JSON at `https://sdlegislature.gov/api/Statutes/`.

## Publisher statements (API)

- **Effective date field:** `GET /api/Statutes/LastStatuesEffectiveDate` returns a JSON string (publisher spelling `LastStatuesEffectiveDate`). Recorded verbatim in `meta.json` — not interpreted as a guaranteed “current through” banner unless the site publishes one on the Statutes page.
- **Edition:** South Dakota Codified Laws (SDCL); title list from `GET /api/Statutes/Title`.

## Acquisition

```bash
export FIRECRAWL_API_KEY=...   # optional; official host only
python3 scripts/legal/state-codes/b4/sd/acquire.py --work /tmp/sc4/sd --phase meta
python3 scripts/legal/state-codes/b4/sd/acquire.py --work /tmp/sc4/sd --phase inventory
```

Inventory walks the published `Next` chain from Title 1 through the code (~44k+ JSON responses, ≥1 s spacing). Resumable via `Archive` receipts and partial `inventory.json`.

## Parse and verify

```bash
python3 scripts/legal/state-codes/b4/sd/parse.py --work /tmp/sc4/sd
python3 scripts/legal/state-codes/b4/sd/verify.py --work /tmp/sc4/sd
python3 -m unittest scripts/legal/state-codes/b4/sd/test_parse.py
```

## Section gaps (`not archived`)

When chapter bundles are archived but a section fragment is missing, `parse.py` records `missing_body` with reason `not archived`. Fetch official per-section JSON (resumable):

```bash
python3 scripts/legal/state-codes/b4/sd/acquire_missing_sections.py --work /tmp/sc4/sd
python3 scripts/legal/state-codes/b4/sd/parse.py --work /tmp/sc4/sd
```

## Corpus reconciliation (read-only)

```bash
python3 scripts/legal/state-codes/b4/sd/reconcile_corpus.py \
  --corpus /tmp/sc4/sd/existing_sd_statutes.json \
  --inventory /tmp/sc4/sd/inventory.json
```

Outputs `/tmp/sc4/sd/reconcile_corpus.json` comparing the 71-row `sd_statutes` title-level TOC snapshot (2026-08-20) with staged acquisition counts per title.
