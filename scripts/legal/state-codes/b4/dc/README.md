# District of Columbia Code (code.dccouncil.gov)

**Source:** Official D.C. Law Library HTML at [code.dccouncil.gov](https://code.dccouncil.gov/us/dc/council/code) — `index.json` TOC walk, then one GET per section page (direct HTTP).

**Work dir:** `/tmp/sc4/dc`

```bash
python3 acquire.py --work /tmp/sc4/dc          # inventory + all section pages
python3 parse.py --work /tmp/sc4/dc
python3 build_toc_proof.py /tmp/sc4/dc
python3 live_diff_preland.py --work /tmp/sc4/dc --seed 20261007
```

**Gates (no landing / no public until both pass):** inventory TOC section count equals `packet/sections.jsonl` rows; **20/20** direct live diff (no proxy).
