# Montana Code Annotated

Official source: [MCA Online](https://mca.legmt.gov/bills/mca/index.html), Montana Legislature, Legislative Services Division. The home page heading and the line under it are the edition and currency statement, copied verbatim (for example **Montana Code Annotated 2025** / **Updated August 2026**). The footer disclaimer says the printed version prevails in case of inconsistencies. There is no bulk download: "Each MCA section is a separate web page" (`help.html`).

Title 0 in the official table of contents is the Montana Constitution; it is captured with the code so the parsed count can be compared with the whole table of contents.

## Layout

| Level | Page |
|-------|------|
| Home | `index.html` (title list, reserved titles) |
| Title | `title_XXXX/chapters_index.html` |
| Chapter (Constitution: article) | `chapter_XXXX/parts_index.html`, `article_XXXX/parts_index.html` |
| Part | `part_XXXX/sections_index.html` (section TOC; reserved lines are unlinked) |
| Section | `section_XXXX/<title>-<chapter>-<part>-<section>.html`, one page per section |

## Pipeline

```bash
python3 scripts/legal/state-codes/b4/mt/acquire.py --work /tmp/sc4/mt --workers 12   # inventory + every section page
python3 scripts/legal/state-codes/b4/mt/parse.py --work /tmp/sc4/mt                  # landing packet in /tmp/sc4/mt/landing
python3 -m unittest scripts/legal/state-codes/b4/mt/test_parse.py
python3 scripts/legal/state-codes/common/land_publisher_code_v2.py /tmp/sc4/mt/landing   # dry run; --execute --workers 4 lands
```

`acquire.py` keeps one keep-alive connection per worker thread (the site's front end stalls when many new connections open per second) and retains every page through `sc_common.Archive` receipts. A 200 response without the publisher's page markers is re-fetched, not accepted. Re-running skips captured pages.

## Landing packet

- One source unit per section page: the page HTML is the `publisher_original`; the unit text derivative is the section text, then its printed history line. The section span is `[0, len(text))` of that derivative.
- Section text is every version block the page prints (for example "(Temporary)" and "(Effective October 1, 2026)"), whitespace-collapsed only. History is the printed "History:" line.
- `citation_path` is the printed MCA number (`27-2-204`). Constitution sections are `const-<article>-<number>` from the printed article heading and TOC number; a printed repeat keeps a `~N` suffix (the Transition Schedule's unnumbered intro is printed as "1." in its own part).
- Status-only entries (repealed, renumbered, terminated, superseded, reserved ranges) are marked by the publisher with a `skip-running-header` span; the Constitution's repealed sections have no marker and are matched by a heading that is only a status word. Their printed line is the text and `status_note` is the same wording.
- `toc-proof.json` compares each part TOC's linked section lines with the parsed sections from that part, and each section page's single `section-doc` block with its one parsed section; `unfetched_child_pages` lists any linked page not captured.
- Heading is the part TOC line (minus the leading number), checked against the section page; otherwise the page catchline.

Outputs (not in git): `/tmp/sc4/mt/raw/`, `receipts.jsonl`, `inventory.json`, `acquire_failed.json`, `landing/`.
