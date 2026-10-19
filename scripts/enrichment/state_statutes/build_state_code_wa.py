"""Build dataset `state_code_wa`: the Revised Code of Washington, section by section, from the Washington State
Legislature's online RCW (Office of the Code Reviser), acquired by acquire_wa.py.

Usage: python3 -I -B build_state_code_wa.py <acq_dir> <out_file>

Kept per section: RCW number, catchline, text paragraphs and the bracketed session-law history, all as printed.
Not kept: the Code Reviser's "NOTES:" annotations after the history (editorial annotations), and the
dispositions of sections no longer codified. A section printed twice with different effective-date notes
(e.g. "(Effective until July 1, 2027.)" and "(Effective July 1, 2027.)") gives two rows: the first keeps the RCW
number as its id, the second is "<number>@2", each showing its printed note as its status.
"""
import collections
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import codebuild  # noqa: E402
import fetchlib  # noqa: E402
import parse_wa  # noqa: E402

DATASET = "state_code_wa"
STATE = "WA"
CODE_NAME = "Revised Code of Washington"
BASE = "https://app.leg.wa.gov/RCW/default.aspx"


def title_order(label):
    m = re.match(r"(\d+)([A-Z]?)", label)
    return int(m.group(1)), m.group(2)


def chapter_order(cite):
    t, c = cite.split(".", 1)
    m = re.match(r"(\d+)([A-Z]?)", c)
    return title_order(t), int(m.group(1)), m.group(2)


def load(acq):
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    toc_html = fetchlib.read_raw(manifest[BASE]).decode("utf-8", "replace")
    titles = list(dict.fromkeys(re.findall(r"[?&][Cc]ite=(\d+[A-Z]?)(?=['\"&#])", toc_html)))
    last_update = re.search(r"Last update:\s*([A-Z][a-z]+ \d{1,2}, \d{4})", re.sub(r"<[^>]+>", " ", toc_html))
    pages = {}
    for title in titles:
        entry = manifest.get(f"{BASE}?Cite={title}")
        if not entry:
            raise SystemExit(f"title {title} page not acquired")
        tpage = parse_wa.parse_title_page(fetchlib.read_raw(entry).decode("utf-8", "replace"))
        chapters = []
        for cite, caption in tpage["chapters"]:
            centry = manifest.get(f"{BASE}?cite={cite}&full=true")
            if not centry:
                raise SystemExit(f"chapter {cite} page not acquired")
            chapters.append((cite, caption, parse_wa.parse_chapter_page(fetchlib.read_raw(centry).decode("utf-8", "replace")), centry))
        pages[title] = (tpage, chapters, entry)
    return manifest, titles, pages, last_update.group(1) if last_update else None


def build(acq_dir, out_file):
    acq = Path(acq_dir)
    manifest, titles, pages, last_update = load(acq)
    retrieved = max(e["retrieved_at"] for e in manifest.values())[:10]
    edition = f"RCW online (Code Reviser; page states last update {last_update})" if last_update else "RCW online (Code Reviser)"
    currency = f"Retrieved {retrieved}"
    rows, stats, title_labels, table_rows = [], collections.Counter(), {}, []
    for title in sorted(titles, key=title_order):
        tpage, chapters, _ = pages[title]
        title_labels[title] = f"{tpage['h1']}. {tpage['caption']}" if tpage["caption"] else tpage["h1"]
        for cite, caption, page, _ in sorted(chapters, key=lambda c: chapter_order(c[0])):
            if page["errors"]:
                raise SystemExit(f"chapter {cite}: {page['errors'][:2]}")
            chapter_label = f"{page['h1']}. {page['caption'] or caption}".strip(". ")
            seen = collections.Counter()
            for s in page["sections"]:
                seen[s["number"]] += 1
                rid = s["number"] if seen[s["number"]] == 1 else f"{s['number']}@{seen[s['number']]}"
                if seen[s["number"]] > 1:
                    stats["second_version"] += 1
                history = (s["history"] or "").strip()
                history = re.sub(r"^\[\s*|\s*\]$", "", history).strip() or None
                body = "\n".join(s["paragraphs"]) or None
                rows.append(codebuild.section_row(
                    DATASET, STATE, rid,
                    citation=f"RCW {s['number']}", heading=s["heading"], title_value=title, chapter_label=chapter_label,
                    body=body, source_url=f"{BASE}?cite={s['number']}", edition=edition, currency=currency,
                    history=history, status=s["version_note"], history_label="History",
                ))
                stats["rows"] += 1
                stats["with_text"] += 1 if body else 0
                stats["without_history"] += 0 if history else 1
                if s.get("has_table"):
                    table_rows.append(rid)  # printed tables: one line per row, cells separated by a space
            stats["chapters"] += 1
    ids = [r["id"] for r in rows]
    dup = [i for i, c in collections.Counter(ids).items() if c > 1]
    if dup:
        raise SystemExit(f"duplicate ids across chapters: {dup[:5]}")
    qualification = (
        f"Revised Code of Washington as published online by the Washington State Legislature, Office of the Code Reviser "
        f"(app.leg.wa.gov/RCW; the RCW page states \"Last update: {last_update}\"; retrieved {retrieved}). The certified PDF "
        "documents in the Code Reviser's RCW Archive are the official publication. Section text, catchlines and session-law "
        "history are as printed (a printed table gives one line per row, its cells separated by spaces); the Code "
        "Reviser's notes are not included. A section printed in two versions with effective-date or amendment notes "
        "appears twice. Not an official or certified copy."
    )
    listing = codebuild.listing_block(rows, title_labels, qualification)
    inputs = [{"url": e["url"], "path": e["path"], "sha256": e["sha256"]} for _, e in sorted(manifest.items())]
    summary = {
        "records": len(rows),
        "source": "Washington State Legislature, Office of the Code Reviser: app.leg.wa.gov/RCW/default.aspx (title list, title pages, full chapter pages)",
        "terms": "Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). app.leg.wa.gov has no robots.txt. The Statute Law Committee declares the certified PDFs in the RCW Archive the official publication; Code Reviser notes are not kept.",
        "retrieved": retrieved,
        "titles": len(title_labels),
        "stats": dict(stats),
        "sections_with_tables": table_rows,
        "method": "open-us-law WA scraper surface (Apache-2.0, Vaquill AI), reimplemented over full chapter pages in scripts/enrichment/state_statutes/",
        "full_code": {
            "state": STATE,
            "code_name": CODE_NAME,
            "edition": edition,
            "currency": currency,
            "source_url": f"{BASE}",
            "grain": "section",
            "title_filter": "title",
            "chapter_field": "chapter",
            "replaces_projection": True,
        },
    }
    codebuild.write_build(out_file, dataset=DATASET, label=f"{CODE_NAME} (Washington State Legislature)", rows=rows,
                          listing=listing, summary=summary, inputs=inputs)
    sizes = sorted(codebuild.row_bytes(r) for r in rows)
    print(json.dumps({"rows": len(rows), "titles": len(title_labels), "stats": dict(stats),
                      "row_bytes_median": sizes[len(sizes) // 2], "row_bytes_mean": sum(sizes) // len(sizes), "row_bytes_max": sizes[-1]}))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
