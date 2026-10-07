# Washington (RCW) — 2026 official archive

**Source:** [2026 RCW archive](https://leg.wa.gov/state-laws-and-rules/state-laws-rcw/past-versions-of-state-laws/2026-rcw-archive/) → `lawfilesext.leg.wa.gov` title/chapter HTML indexes → **Complete Chapter** PDF bodies (direct HTTP; no proxy on live diff).

**Work dir:** `/tmp/sc4/wa`

```bash
python3 acquire.py --work /tmp/sc4/wa
python3 parse.py --work /tmp/sc4/wa
python3 build_toc_proof.py /tmp/sc4/wa
python3 live_diff_preland.py --work /tmp/sc4/wa --seed 20261007
```

**Gates (no landing / no public until pass):**

1. `staging-proof/toc-proof.json` — chapter HTML section rows vs parsed PDF sections per chapter.
2. `live_diff_preland.json` — 20/20 direct re-fetch of Complete Chapter PDFs.

**Known publisher gate:** 2026 archive row **Title 25** points at the Title 26 page (`title25_row_collision` in `inventory.json`). No 2026 native Title 25 chapter inventory without a separate owner decision.
