"""Build dataset `state_code_sd`: the South Dakota Codified Laws, section by section, from the official
South Dakota Legislature publication (acquire_sd.py, acquire_sd_records.py, acquire_sd_chapters.py).

Usage: python3 -I -B build_state_code_sd.py <acq_dir> <out_file>

Sources, all from sdlegislature.gov:
  * whole-title documents api/Statutes/{title}.html?all=true: every section document with text (catchline,
    paragraphs, "Source:" history, Code Commission notes, "Effective <date>" banners);
  * the statutes sitemap (Statutes.1.xml, Statutes.2.xml): the publisher's list of section numbers, used for order
    and completeness;
  * single-statute records api/Statutes/Statute/{number} for sitemap numbers that have no section document
    (mostly repealed or transferred entries printed only as a catchline) and for title/chapter captions.
One row per printed entry: a printed range ("1-13A-1 to 1-13A-3. Repealed ...") is one row whose id is its first
number; the other numbers it covers are listed in a fact. Excluded: chapter appendices (court rules, forms, board
regulations appended to some chapters), which are not codified sections.
Statutory text is public domain (Georgia v. Public.Resource.Org, 590 U.S. 255 (2020)); SDCL 2-16-8 says the
Code Commission's publication is copyrighted by the State, so only text, catchlines and history are kept.
"""
import collections
import datetime
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import codebuild  # noqa: E402
import fetchlib  # noqa: E402
import parse_sd  # noqa: E402

DATASET = "state_code_sd"
STATE = "SD"
CODE_NAME = "South Dakota Codified Laws"
SOURCE_HOME = "https://sdlegislature.gov/Statutes"
SECTION = re.compile(r"^" + parse_sd.NUMBER + r"$")
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}


def banner_date(banner):
    m = re.match(r"^Effective ([A-Z][a-z]+) (\d{1,2}), (\d{4})$", banner or "")
    return datetime.date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))).isoformat() if m else None


def title_order(label):
    m = re.match(r"(\d+)([A-Z]?)", label)
    return int(m.group(1)), m.group(2)


def heading_label(lines, fallback):
    """'TITLE 2. LEGISLATURE AND STATUTES' from the document's printed heading lines."""
    printed = [line for line in lines[:2] if line and line.lower() != "chapter"]
    return ". ".join(printed) if printed else fallback


def title_contents_chapters(title, rows):
    """Chapter labels from the title's printed contents ('01A Unconstitutional Official Actions' in title 1 ->
    {'1-1A': 'Chapter 1-1A. Unconstitutional Official Actions'})."""
    out = {}
    for _, text in rows:
        m = re.match(r"^0*(\d+[A-Z]*)\s+(.+)$", text)
        if m:
            out[f"{title}-{m.group(1)}"] = f"Chapter {title}-{m.group(1)}. {m.group(2)}"
    return out


def api_records(manifest):
    """Single-statute records by number: {number: {"Type", "CatchLine", "Html"}}."""
    out = {}
    for url, entry in manifest.items():
        m = re.search(r"/api/Statutes/Statute/(.+)$", url)
        if m and entry["status"] == 200:
            data = json.loads(fetchlib.read_raw(entry))
            if data.get("Statute") == m.group(1):
                out[m.group(1)] = data
    return out


def sitemap_numbers(manifest):
    numbers = []
    for url, entry in sorted(manifest.items()):
        if re.search(r"/Statutes\.\d+\.xml$", url):
            for loc in re.findall(r"<loc>([^<]+)</loc>", fetchlib.read_raw(entry).decode("utf-8")):
                number = loc.rsplit("/Statutes/", 1)[-1]
                if SECTION.match(number):
                    numbers.append(number)
    return list(dict.fromkeys(numbers))


def chapter_of(number):
    return "-".join(number.split("-")[:2])


def collect(acq):
    """Every printed entry (dict) with its title and chapter labels, plus stats and exclusions."""
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    records = api_records(manifest)
    captions = {n: parse_sd.clean(r["CatchLine"]) for n, r in records.items() if r.get("Type") in ("Title", "Chapter") and (r.get("CatchLine") or "").strip()}
    order = {n: i for i, n in enumerate(sitemap_numbers(manifest))}
    title_entries = {}
    for url, entry in manifest.items():
        m = re.search(r"/api/Statutes/([0-9]+[A-Z]?)\.html\?all=true$", url)
        if m and entry["status"] == 200:
            title_entries[m.group(1)] = entry
    stats, appendices, excluded_records = collections.Counter(), [], []
    unbracketed = {re.sub(r"[()]", "", n): n for n in order if "(" in n}
    title_labels, chapter_labels, entries = {}, {}, []
    by_number = {}
    for label in sorted(title_entries, key=title_order):
        parsed = parse_sd.parse_title(fetchlib.read_raw(title_entries[label]))
        if parsed["errors"]:
            raise SystemExit(f"title {label}: parse errors {parsed['errors'][:3]}")
        printed = parsed["title"]["lines"] if parsed["title"] else []
        if len([line for line in printed[:2] if line.lower() != "chapter"]) < 2 and label in captions:
            title_labels[label] = f"TITLE {label}. {captions[label]}"
            stats["title_caption_from_record"] += 1
        else:
            title_labels[label] = heading_label(printed, f"TITLE {label}")
        chapter_labels.update(title_contents_chapters(label, parsed["title"]["rows"] if parsed["title"] else []))
        for c in parsed["chapters"]:
            if c["number"] not in chapter_labels and len(c["lines"]) > 1:
                chapter_labels[c["number"]] = f"Chapter {c['number']}. {c['lines'][1]}"
        appendices += [{"title": label, **a} for a in parsed["appendices"]]
        last_key = (order.get(f"{label}-0", -1), 0)
        for seq, s in enumerate(parsed["sections"]):
            key = (order[s["number"]], 0) if s["number"] in order else (last_key[0], last_key[1] + 1)
            last_key = key
            effective = banner_date(s.get("effective"))
            rid = s["number"] if s["number"] not in by_number else f"{s['number']}@{effective}"
            if rid in by_number or (s["number"] in by_number and not effective):
                raise SystemExit(f"duplicate section {s['number']} without a distinguishing effective date")
            entry = {**s, "id": rid, "title_value": label, "key": key, "members": [], "origin": "title document"}
            if s["number"] not in order:
                # e.g. printed "57A-11-101A" whose publisher page is /Statutes/57A-11-101(A)
                page = unbracketed.get(s["number"])
                if page:
                    entry["page_number"] = page
                    entry["key"] = (order[page], 0)
                    stats["printed_number_differs_from_page_address"] += 1
                else:
                    stats["documented_not_in_sitemap"] += 1
            by_number[rid] = entry
            entries.append(entry)
    documented_pages = {e.get("page_number", e["number"]) for e in entries}
    for number, data in records.items():
        if data.get("Type") != "Section" or number in by_number or number in documented_pages:
            continue
        html = data.get("Html") or ""
        parsed = parse_sd.parse_section(number, html) if parse_sd.clean(re.sub(r"<[^>]+>", " ", html)) else None
        if parsed is None or "error" in parsed:
            line = parse_sd.clean(data.get("CatchLine"))
            source_paras = [p for p in re.findall(r"<p[^>]*>(.*?)</p>", html, re.S)]
            source = " ".join(t for t in (parse_sd.clean(re.sub(r"<[^>]+>", "", p)) for p in source_paras) if t.startswith("Source:"))
            if line.upper().startswith("CHAPTER"):
                stats["record_is_chapter_heading"] += 1
                excluded_records.append({"number": number, "reason": f"the publisher's record is a chapter heading: {line[:80]}"})
                continue
            if line.startswith(number):
                lab, heading = parse_sd.split_heading(number, line)
                origin = "single-statute record (catchline only)"
            elif line:
                # The record carries the catchline without its number and prints no section text.
                lab, heading = number, line
                origin = "single-statute record (catchline and Source only; no section text printed)"
            else:
                stats["record_catchline_unusable"] += 1
                excluded_records.append({"number": number, "reason": "the publisher's record has no catchline or text"})
                continue
            status = parse_sd.STATUS.match(heading)
            parsed = {"number": number, "label": lab, "heading": heading, "paragraphs": [], "source": source, "notes": [],
                      "status": status.group(1).capitalize() if status else None, "effective": None}
        else:
            parsed["effective"] = None
            origin = "single-statute record"
        first = re.findall(parse_sd.NUMBER, parsed["label"])[0]
        if first != number and first in by_number and by_number[first]["label"] == parsed["label"]:
            by_number[first]["members"].append(number)
            stats["covered_by_printed_range"] += 1
            continue
        if first != number and first in records and parse_sd.clean(records[first].get("CatchLine")) == parse_sd.clean(data.get("CatchLine")):
            continue  # the first number's own record creates the row; this number is listed as its member below
        title_value = number.split("-")[0]
        entry = {**parsed, "id": number, "title_value": title_value, "key": (order.get(number, 10 ** 9), 0), "members": [], "origin": origin}
        by_number[number] = entry
        entries.append(entry)
        stats[f"from_record:{origin}"] += 1
    # Members of ranges whose first number came from a record.
    for number, data in records.items():
        if data.get("Type") != "Section" or number in by_number:
            continue
        line = parse_sd.clean(data.get("CatchLine"))
        if line.startswith(number):
            lab, _ = parse_sd.split_heading(number, line)
            first = re.findall(parse_sd.NUMBER, lab)[0]
            if first in by_number and first != number:
                by_number[first]["members"].append(number)
                stats["covered_by_printed_range"] += 1
    for entry in entries:
        chapter_no = chapter_of(entry["number"])
        if chapter_no not in chapter_labels and chapter_no in captions:
            chapter_labels[chapter_no] = f"Chapter {chapter_no}. {captions[chapter_no]}"
        if entry["title_value"] not in title_labels:
            raise SystemExit(f"{entry['id']}: title {entry['title_value']} has no whole-title document")
    entries.sort(key=lambda e: e["key"])
    return {"entries": entries, "stats": stats, "appendices": appendices, "excluded_records": excluded_records, "title_labels": title_labels,
            "chapter_labels": chapter_labels, "manifest": manifest, "title_entries": title_entries, "order": order}


def build(acq_dir, out_file):
    acq = Path(acq_dir)
    got = collect(acq)
    stats, manifest, order = got["stats"], got["manifest"], got["order"]
    retrieved = max(e["retrieved_at"] for e in got["title_entries"].values())[:10]
    edition = "SDCL as published online (statutes page: Effective September 3, 2026)"
    currency = f"Retrieved {retrieved}"
    rows = []
    for e in got["entries"]:
        chapter_no = chapter_of(e["number"])
        chapter_label = got["chapter_labels"].get(chapter_no)
        if chapter_label is None:
            stats["chapter_caption_not_recorded"] += 1
            chapter_label = f"Chapter {chapter_no}"
        status = e["status"]
        if e.get("effective"):
            status = e["effective"]
            stats["future_effective"] += 1
        history = re.sub(r"^Source:\s*", "", e["source"]).strip() or None
        extra = [["Code Commission note (printed after the history)", n] for n in e["notes"]]
        members = sorted(set(e["members"]), key=lambda n: order.get(n, 10 ** 9))
        if members:
            extra.append(["Numbers in this entry", ", ".join([e["number"], *members])])
        body = "\n".join(e["paragraphs"]) or None
        rows.append(codebuild.section_row(
            DATASET, STATE, e["id"],
            citation=f"SDCL {e['label']}", heading=e["heading"], title_value=e["title_value"], chapter_label=chapter_label,
            body=body, source_url=f"https://sdlegislature.gov/Statutes/{e.get('page_number', e['number'])}", edition=edition,
            currency=currency, history=history, status=status, extra_facts=extra,
        ))
        stats["rows"] += 1
        stats["with_text"] += 1 if body else 0
        stats["without_text"] += 0 if body else 1
        stats["with_commission_note"] += 1 if e["notes"] else 0
    qualification = (
        "South Dakota Codified Laws as published by the South Dakota Legislature at sdlegislature.gov "
        f"(retrieved {retrieved}; the publisher's statutes page reads \"Effective September 3, 2026\"). "
        "Section text, catchlines and Source notes are as printed; repealed, transferred and similar entries are kept as the "
        "publisher prints them, and text marked \"Effective <date>\" takes effect on that date. Chapter appendices "
        "(court rules, forms, board regulations) are not included. Not an official or certified copy."
    )
    listing = codebuild.listing_block(rows, got["title_labels"], qualification)
    inputs = [{"url": e["url"], "path": e["path"], "sha256": e["sha256"]} for _, e in sorted(manifest.items())]
    summary = {
        "records": len(rows),
        "source": "South Dakota Legislature, Legislative Research Council (sdlegislature.gov): api/Statutes/{title}.html?all=true, Statutes.xml sitemap, api/Statutes/Statute/{number}",
        "terms": "Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). SDCL 2-16-8 states the Code Commission's publication is copyrighted by the State; only statute text, catchlines and history notes are kept. robots.txt allows these paths.",
        "retrieved": retrieved,
        "titles": len(got["title_labels"]),
        "stats": dict(stats),
        "excluded_appendices": got["appendices"],
        "excluded_records": got["excluded_records"],
        "method": "open-us-law sd_bulk approach (Apache-2.0, Vaquill AI), reimplemented in scripts/enrichment/state_statutes/",
        "full_code": {
            "state": STATE,
            "code_name": CODE_NAME,
            "edition": edition,
            "currency": currency,
            "source_url": SOURCE_HOME,
            "grain": "section",
            "title_filter": "title",
            "chapter_field": "chapter",
            "replaces_projection": True,
        },
    }
    label_text = f"{CODE_NAME} (South Dakota Legislature)"
    codebuild.write_build(out_file, dataset=DATASET, label=label_text, rows=rows, listing=listing, summary=summary, inputs=inputs)
    sizes = sorted(codebuild.row_bytes(r) for r in rows)
    print(json.dumps({"rows": len(rows), "titles": len(got["title_labels"]), "stats": dict(stats), "appendices": len(got["appendices"]),
                      "row_bytes_median": sizes[len(sizes) // 2], "row_bytes_mean": sum(sizes) // len(sizes), "row_bytes_max": sizes[-1]}))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
