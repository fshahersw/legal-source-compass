"""Build dataset `state_code_nd`: the North Dakota Century Code, section by section, from the North Dakota
Legislative Branch's contents page and chapter PDFs (acquire_nd.py).

Usage: python3 -I -B build_state_code_nd.py <acq_dir> <out_file>

Kept per section: number, catchline and text as printed in the chapter PDF (printed line breaks kept), the
section link from the publisher's contents, and the chapter PDF's own creation date. The Century Code PDFs
print no history notes, so none are recorded. Chapters the contents list as repealed, with no sections, are
counted in the summary but are not rows.
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
import parse_nd  # noqa: E402

DATASET = "state_code_nd"
STATE = "ND"
CODE_NAME = "North Dakota Century Code"
SITE = "https://ndlegis.gov"
INDEX = f"{SITE}/general-information/north-dakota-century-code/index.html"


def anchor(number):
    """The publisher's named destination for a section: 12.1-16-01 -> 12p1-16-01 (dots written as 'p')."""
    return number.replace(".", "p")


def build(acq_dir, out_file):
    acq = Path(acq_dir)
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    index_html = fetchlib.read_raw(manifest[INDEX]).decode("utf-8")
    index = parse_nd.parse_index(index_html)
    repealed_chapters = re.findall(r'<a class="no-items" href="(/cencode/[^"]+)">([^<]*)</a>', index_html)
    scratch = str(HERE.parents[2] / "private" / "scratch" / "enrich" / "state_statutes" / "tmp")
    retrieved = max(e["retrieved_at"] for e in manifest.values())[:10]
    rows, stats, errors, title_labels = [], collections.Counter(), [], {}
    created_dates = collections.Counter()
    for title in index:
        title_labels[title["number"]] = f"Title {title['number']} - {title['caption']}"
        for ch in title["chapters"]:
            entry = manifest.get(SITE + (ch["pdf"] or ""))
            if not entry or entry["status"] != 200:
                errors.append({"chapter": ch["number"], "error": "chapter PDF not acquired"})
                continue
            lines, created = parse_nd.pdf_lines(fetchlib.read_raw(entry), scratch, with_created=True)
            created_dates[created] += 1
            sections, errs = parse_nd.split_sections(lines, ch["sections"])
            errors += [{"chapter": ch["number"], **e} for e in errs]
            chapter_label = f"Chapter {ch['number']} - {ch['caption']}"
            for key, s in sections.items():
                body = "\n".join(s["lines"]) or None
                rows.append(codebuild.section_row(
                    DATASET, STATE, key,
                    citation=f"N.D.C.C. § {s['number']}", heading=s["heading"], title_value=title["number"],
                    chapter_label=chapter_label, body=body,
                    source_url=f"{SITE}{ch['pdf']}#nameddest={anchor(s['number'])}",
                    edition="North Dakota Century Code, chapter PDF" + (f" created {created}" if created else ""),
                    currency=f"Retrieved {retrieved}", status=s["status"],
                ))
                stats["rows"] += 1
                stats["with_text"] += 1 if body else 0
                stats["status_stub"] += 1 if s["status"] else 0
                if "@" in key:
                    stats["second_version"] += 1
            stats["chapters"] += 1
    stats["contents_sections"] = sum(len(c["sections"]) for t in index for c in t["chapters"])
    stats["repealed_chapters_without_sections"] = len(repealed_chapters)
    stats["errors"] = len(errors)
    qualification = (
        "North Dakota Century Code as published by the North Dakota Legislative Branch at ndlegis.gov: section names from "
        f"the publisher's contents page and section text from its chapter PDFs (retrieved {retrieved}; each section shows "
        "its chapter PDF's creation date). Text keeps the PDF's printed line breaks; the Century Code PDFs print no history "
        "notes. Chapters listed as repealed with no sections are not included. Not an official or certified copy."
    )
    listing = codebuild.listing_block(rows, title_labels, qualification)
    inputs = [{"url": e["url"], "path": e["path"], "sha256": e["sha256"]} for _, e in sorted(manifest.items())]
    summary = {
        "records": len(rows),
        "source": "North Dakota Legislative Branch (ndlegis.gov): Century Code contents page and /cencode/ chapter PDFs",
        "terms": "Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt allows /cencode/ and the contents page.",
        "retrieved": retrieved,
        "titles": len(title_labels),
        "stats": dict(stats),
        "pdf_creation_dates": dict(sorted(((k or "Not recorded"), v) for k, v in created_dates.items())),
        "parse_errors": errors[:200],
        "method": "open-us-law ND scraper sources (Apache-2.0, Vaquill AI), reimplemented with poppler pdftotext -layout in scripts/enrichment/state_statutes/",
        "full_code": {
            "state": STATE,
            "code_name": CODE_NAME,
            "edition": "North Dakota Century Code (chapter PDFs, ndlegis.gov)",
            "currency": f"Retrieved {retrieved}",
            "source_url": INDEX,
            "grain": "section",
            "title_filter": "title",
            "chapter_field": "chapter",
            "replaces_projection": True,
        },
    }
    codebuild.write_build(out_file, dataset=DATASET, label=f"{CODE_NAME} (North Dakota Legislative Branch)", rows=rows,
                          listing=listing, summary=summary, inputs=inputs)
    sizes = sorted(codebuild.row_bytes(r) for r in rows)
    print(json.dumps({"rows": len(rows), "titles": len(title_labels), "stats": dict(stats), "errors_sample": errors[:5],
                      "row_bytes_median": sizes[len(sizes) // 2], "row_bytes_mean": sum(sizes) // len(sizes), "row_bytes_max": sizes[-1]}))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
