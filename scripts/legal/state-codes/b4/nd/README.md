# North Dakota Century Code (batch 4)

Official source: [North Dakota Legislative Branch — Century Code](https://ndlegis.gov/general-information/north-dakota-century-code/index.html), full browse at [ndlegis.gov/cencode/](https://ndlegis.gov/cencode/).

Publisher statements (verbatim on the info page):

- North Dakota Century Code published on this website is the official version of the North Dakota Century Code and may vary from any printed or online versions of the North Dakota Century Code available from private publishers.
- 07/01/25 UPDATE: All statutory changes approved by the 69th Legislative Assembly are now reflected on this website regardless of the statute becoming effective earlier than July 1, due to an emergency clause, or on August 1, due to operation of law.

No site-wide “current through” date is published on the info page.

## Artifacts

- Chapter HTML (`tNNcMM.html`): section table of contents (citation + heading); links to PDF anchors.
- Chapter PDF (`tNNcMM.pdf`): full section text (primary body source).

There is no official bulk XML/ZIP download; acquisition uses per-chapter PDFs plus HTML TOCs.

## Commands

```bash
export FIRECRAWL_API_KEY=...   # only if direct fetch is blocked

python3 scripts/legal/state-codes/b4/nd/acquire.py --work /tmp/sc4/nd
python3 scripts/legal/state-codes/b4/nd/parse.py --work /tmp/sc4/nd
python3 -m unittest scripts/legal/state-codes/b4/nd/test_parse.py
```

Resumable acquisition phases: `--phase meta|discover|chapters|all`.

## Output

- Raw originals + `receipts.jsonl`: `/tmp/sc4/nd/raw/`
- Staged packet: `/tmp/sc4/nd/packet/`
- Verification report: `/tmp/sc4/nd/REPORT.json`
