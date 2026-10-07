# New Hampshire Revised Statutes Annotated (RSA) — batch 4 staging

## Official source

- Primary host: [New Hampshire General Court RSA HTML](https://www.gencourt.state.nh.us/rsa/html/NHTOC.htm) (requests may redirect to `https://gc.nh.gov/rsa/html/…`).
- Table of contents: `NHTOC.htm` → per-title `NHTOC/NHTOC-<roman>.htm` → per-chapter `NHTOC/NHTOC-<title>-<chapter>.htm` → section pages under `<title-roman>/<chapter>/…` and merged chapter bodies `*-mrg.htm`.

## Edition / currency (as published)

The RSA HTML table-of-contents pages reviewed for this run do **not** publish a “current through” date, edition label, or official/unofficial disclaimer on `NHTOC.htm`. Staged rows leave `edition` and `currency.statement` null unless a future page in the crawl publishes them verbatim.

## Layout

| Path | Role |
|------|------|
| `acquire.py` | Resumable crawl: robots, TOC, title TOCs, chapter TOCs, merged chapter HTML |
| `inventory.py` | Section inventory from archived chapter TOC pages |
| `parse.py` | Parse `*-mrg.htm` bodies → `write_packet` under `/tmp/sc4/nh/packet/` |
| `verify.py` | Receipt re-hash, span re-hash, TOC vs parsed counts |
| `nh_lib.py` | URL helpers and Firecrawl fallback |

## Commands

```bash
export FIRECRAWL_API_KEY=…   # only if direct fetch is blocked
cd scripts/legal/state-codes/b4/nh
python3 acquire.py --work /tmp/sc4/nh          # full crawl (hours; use tmux)
python3 inventory.py /tmp/sc4/nh
python3 parse.py /tmp/sc4/nh
python3 verify.py /tmp/sc4/nh
python3 -m unittest
```

Long runs: `tmux -f /exec-daemon/tmux.portal.conf new-session -d -s sc4-nh` then run `acquire.py` with log at `/tmp/sc4/nh/acquire.log`.

## Data (not in git)

- Raw originals: `/tmp/sc4/nh/raw/` + `receipts.jsonl`
- Packet: `/tmp/sc4/nh/packet/`
- Report: `/tmp/sc4/nh/REPORT.json`
