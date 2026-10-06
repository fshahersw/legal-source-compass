# Delaware Code Online (`DE`)

Official HTML chapter pages from [delcode.delaware.gov](https://delcode.delaware.gov/). No third-party mirrors. No official machine-readable bulk export of the full code was found; each title offers an **Authenticated PDF** on its title index (UELMA).

## Edition / currency (verbatim from home page notice)

The Delaware Code appearing on this site is prepared by the Delaware Code Revisors and the editorial staff of LexisNexis in cooperation with the Division of Legislative Services of the General Assembly, and is considered an official version of the State of Delaware statutory code. This version includes all acts enacted as of September 04, 2026, up to and including 85 Del. Laws, c. 480, 482-484, 486-490, 492-494, 514-515.

Home notice receipt: `350807b7b095e3043df524a2d8568a4fb6b3a0cd87f2a9b0c7b1bee4db5f5d8f` (see `/tmp/sc4/de/raw/35/350807b7…`).

## Layout

| Step | Script | Output |
|------|--------|--------|
| Acquire | `acquire.py` | `/tmp/sc4/de/raw/`, `receipts.jsonl` |
| Parse | `parse.py` | `/tmp/sc4/de/packet/`, `inventory.json` |
| Verify | `verify.py` | `/tmp/sc4/de/verify_result.json` |

## Rerun

```bash
export FIRECRAWL_API_KEY=...   # only if direct fetches are blocked
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s sc4-de -- \
  'python3 /workspace/scripts/legal/state-codes/b4/de/acquire.py 2>&1 | tee /tmp/sc4/de/acquire.log'
python3 /workspace/scripts/legal/state-codes/b4/de/parse.py --work /tmp/sc4/de
python3 /workspace/scripts/legal/state-codes/b4/de/verify.py --work /tmp/sc4/de
python3 -m unittest discover -s /workspace/scripts/legal/state-codes/b4/de -p 'test_*.py'
```

`Archive` is resumable; re-running acquire skips URLs already checksummed in `receipts.jsonl`.

## Unit of capture

One **chapter** `index.html` (including suffix slugs such as `c053a`, `c029_1`) is one source unit. Section text is parsed from `div#CodeBody div.Section` blocks; spans are Unicode code-point offsets into the chapter derivative text file.

## Tests

`test_parse.py` — minimal HTML fixture for section heads, history tails, and spans.
