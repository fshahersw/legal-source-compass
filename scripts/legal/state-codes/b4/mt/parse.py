"""Parse the retained MCA pages into the shared landing packet (publisher-code-intake/2).

One source unit per official section page: the retained page HTML is the `publisher_original`; the unit text
derivative is the parsed section text followed by its printed history line. Each section row's text is the text of
every version block the page prints (for example a "(Temporary)" and an "(Effective October 1, 2026)" version),
exactly as published apart from whitespace collapsing. A page whose only content is a status line ("Repealed.",
"Renumbered ...", "Terminated.") keeps that printed line as its text with `status_note` set to the same wording.
Nothing is invented: a page with no printed section text is a gap.

    python3 parse.py --work /tmp/sc4/mt [--reviewer "..."]

Writes <work>/landing/{manifest.json,objects.jsonl,units.jsonl,sections.jsonl,toc-proof.json,gaps.json,parse-report.json}.
"""
import argparse
import collections
import datetime
import html as html_mod
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import sc_common as sc  # noqa: E402

BASE = "https://mca.legmt.gov/bills/mca/"
HOME = BASE + "index.html"
PARSER = {"name": "mt-mca-section-html", "version": "2"}
SOURCE_SYSTEM = "mt-mca"
SECTION_URL_RE = re.compile(
    r"^https://mca\.legmt\.gov/bills/mca/(title_\w+)/((?:chapter|article)_\w+)/(part_\w+)/(section_\w+)/([\w-]+)\.html$")
HEAD_RE = {k: re.compile(r'<h\d class="section-%s-title">(.*?)</h\d>' % k, re.S | re.I)
           for k in ("title", "chapter", "part", "section")}
CITATION_RE = re.compile(r'<span class="citation">(.*?)</span>', re.S | re.I)
# A heading that is nothing but a status. "Void act" or "Reserved water rights compact" are real sections, so the
# word alone is not enough; the publisher's own marker (skip-running-header) is the primary signal.
STATUS_HEADING_RE = re.compile(
    r"^(?:Repealed|Terminated|Superseded|Expired|Omitted|Void|Reserved|Unconstitutional|"
    r"(?:Renumbered|Transferred|Recodified|Redesignated)\b.*)$", re.I)
NUM_RE = {
    "title": re.compile(r"^TITLES?\s+([0-9A-Z]+)\b", re.I),
    "chapter": re.compile(r"^CHAPTERS?\s+([0-9A-Z]+)\b", re.I),
    "article": re.compile(r"^ARTICLE\s+([0-9A-Z]+)\b", re.I),
    "part": re.compile(r"^PARTS?\s+([0-9A-Z]+)\b", re.I),
}
SECTION_ID_REGEX = r"^([0-9]+[A-Z]?-[0-9]+[A-Z]?-[0-9]+[A-Z]?|const-[0-9A-Za-z]+-[0-9A-Za-z]+)(~[0-9]+)?$"


def norm(s):
    return sc.collapse(html_mod.unescape(re.sub(r"<[^>]+>", " ", s or "")))


def block_text(fragment):
    """sc_common.html_text with table cells kept apart (a cell boundary is whitespace, not concatenation)."""
    fragment = re.sub(r"(?i)</t[dh]\s*>", " \\g<0>", fragment)
    return sc.html_text(fragment)


def balanced(html, start, name="div"):
    """Inner HTML of the <name ...> element that opens at `start` (nested elements of the same name balanced)."""
    open_end = html.index(">", start) + 1
    depth, pos = 1, open_end
    tag = re.compile(r"<(/?)%s\b[^>]*>" % name, re.I)
    while depth:
        m = tag.search(html, pos)
        if not m:
            raise ValueError("unbalanced " + name)
        depth += -1 if m.group(1) else 1
        pos = m.end()
    return html[open_end:m.start()]


def divs(html, cls, name="div"):
    return [balanced(html, m.start(), name) for m in re.finditer(r'<%s class="%s"[^>]*>' % (name, re.escape(cls)), html, re.I)]


def number_from(level, heading):
    if heading is None:
        return None
    m = NUM_RE[level].match(heading)
    return m.group(1) if m else None


def parse_section_page(html, url):
    m = SECTION_URL_RE.match(url)
    if not m:
        raise ValueError("not a section url: " + url)
    title_dir, sub_dir, part_dir, _sec_dir, doc_id = m.groups()
    html = re.sub(r"(?is)<APM_DO_NOT_TOUCH>.*?</APM_DO_NOT_TOUCH>", "", html)
    heads = {k: (norm(r.search(html).group(1)) if r.search(html) else None) for k, r in HEAD_RE.items()}
    docs = divs(html, "section-doc")
    contents = [c for d in docs for c in divs(d, "section-content")]
    version_texts = [block_text(c) for c in contents]
    text = "\n".join(t for t in version_texts if t)
    hist_blocks = [block_text(h) for d in divs(html, "history-doc") for h in divs(d, "history-content")]
    history = "\n".join(h for h in hist_blocks if h) or None
    catches = divs(contents[0], "catchline", "span") if contents else []
    first_catch = catches[0] if catches else None
    cit = CITATION_RE.search(first_catch) if first_catch else None
    citation = norm(cit.group(1)) if cit else None
    catch_heading = None
    if first_catch:
        inner = CITATION_RE.sub("", first_catch, count=1)
        inner = re.sub(r'(?is)<span class="effective-clause">.*?</span>', "", inner)
        catch_heading = norm(inner).lstrip(". ").rstrip(" .") or None
    return {
        "url": url, "doc_id": doc_id, "title_dir": title_dir, "sub_dir": sub_dir, "part_dir": part_dir,
        "heads": heads, "citation": citation, "catch_heading": catch_heading, "text": text, "history": history,
        "versions": len(contents), "section_docs": len(docs), "has_img": bool(re.search(r"(?i)<img\b", "".join(docs))),
        "has_table": bool(re.search(r"(?i)<table\b", "".join(docs))),
        "skip_running_header": 'class="skip-running-header"' in "".join(docs),
    }


def toc_heading(label, citation):
    """Heading printed in the part's section TOC line, without the leading citation / section number."""
    if label is None:
        return None
    if citation and label.startswith(citation):
        rest = label[len(citation):].strip()
        # "1-1-210 through 1-1-213 reserved": the printed line is the heading, not its tail
        return rest if rest[:1].isupper() or rest[:1].isdigit() else label
    m = re.match(r"^([0-9]+[A-Za-z]?)\.\s*(.*)$", label)
    return (m.group(2).strip() or None) if m else label


def status_line(row, heading):
    """The printed status wording of a status-only page ("Repealed. Sec. 10, Ch. 367, L. 2019."), else None."""
    one_line = row["versions"] == 1 and "\n" not in row["text"]
    if not one_line or not (row["skip_running_header"] or (heading and STATUS_HEADING_RE.match(heading))):
        return None
    lead = (row["citation"] or "") + ". "
    text = row["text"]
    return text[len(lead):].strip() if row["citation"] and text.startswith(lead) else text


def squash(t):
    return re.sub(r"\s+", "", html_mod.unescape(t or ""))


def build(work, reviewer):
    arc = sc.Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    pages = {p["url"]: p for p in inv["pages"]}
    edition = inv["edition"]["edition"]
    statement = inv["edition"]["statement"]
    if not edition or not statement:
        raise SystemExit("edition/currency statement missing from the retained home page")
    currency = {"basis": "publisher_statement", "statement": f"{edition} \u2014 {statement}", "through_date": None,
                "edition": edition}
    out = os.path.join(work, "landing")
    os.makedirs(os.path.join(out, "derivatives"), exist_ok=True)
    objects, units, sections, gaps, notes = {}, [], [], [], collections.Counter()
    seen_paths = collections.Counter()
    proof_pages = []
    status_labels = collections.Counter()
    heading_source = collections.Counter()
    per_toc = collections.Counter()
    for s in inv["sections"]:
        rec = arc.index.get(s["url"])
        if not rec or rec.get("state") != "complete":
            gaps.append({"url": s["url"], "reason": "section page not captured"})
            continue
        raw = arc.read(rec)
        page_html = sc.decode_html(raw)[0]
        row = parse_section_page(page_html, s["url"])
        if row["section_docs"] != 1:
            gaps.append({"url": s["url"], "reason": "page carries %d section-doc blocks" % row["section_docs"]})
            continue
        if not row["text"].strip():
            gaps.append({"url": s["url"], "citation_toc": s["citation_toc"], "reason": "no printed section text"})
            continue
        const = row["title_dir"] == "title_0000"
        h = row["heads"]
        sub_level = "article" if row["sub_dir"].startswith("article") else "chapter"
        if const:
            sec_num_m = re.match(r"^([0-9]+[A-Za-z]?)\.", s["toc_label"] or "")
            sec_num = sec_num_m.group(1) if sec_num_m else None
            art = number_from("article", h["chapter"]) or (h["chapter"] or "").strip().lower().replace(" ", "")
            if not sec_num or not art:
                gaps.append({"url": s["url"], "reason": "constitution section number/article not printed"})
                continue
            citation = row["citation"] or (h["section"] or "")
            if citation.startswith("Section"):
                citation = f"Article {art}, {citation}" if number_from("article", h["chapter"]) else citation
            path = f"const-{art}-{sec_num}"
            number = sec_num
        else:
            citation = row["citation"]
            if not citation or citation != s["citation_toc"]:
                gaps.append({"url": s["url"], "citation_toc": s["citation_toc"], "citation_page": citation,
                             "reason": "page citation differs from the TOC citation"})
                continue
            path = citation
            number = citation
        heading = toc_heading(s["toc_label"], s["citation_toc"])
        if heading and squash(heading) in squash(sc.html_text(page_html)):
            heading_source["toc"] += 1
        else:
            heading = row["catch_heading"] or h["section"]
            heading_source["page"] += 1
        status_note = status_line(row, heading)
        if status_note is not None:
            word = re.match(r"[A-Za-z]+", status_note)
            status_labels["reserved" if status_note.rstrip(".").endswith("reserved") else
                          (word.group(0).lower() if word else "other")] += 1
        seen_paths[path] += 1
        if seen_paths[path] > 1:
            notes["repeated_citation_path"] += 1
            path = f"{path}~{seen_paths[path]}"
        hierarchy = [
            {"level": "title", "number": "0" if const else number_from("title", h["title"]), "heading": h["title"]},
            {"level": sub_level, "number": number_from(sub_level, h["chapter"]), "heading": h["chapter"]},
            {"level": "part", "number": number_from("part", h["part"]), "heading": h["part"]},
            {"level": "section", "number": number, "heading": heading},
        ]
        derivative = row["text"] + ("\n" + row["history"] if row["history"] else "") + "\n"
        dsha = sc.sha256_hex(derivative)
        dpath = os.path.join(out, "derivatives", dsha)
        if not os.path.exists(dpath):
            with open(dpath, "w", encoding="utf-8", newline="") as f:
                f.write(derivative)
        src = {"source_url": rec["url"], "retrieved_at": rec["retrieved_at"], "http_status": 200,
               "retrieval_method": "publisher_page" if rec["route"] == "direct" else "proxied_fetch",
               "proxy": None if rec["route"] == "direct" else rec["route"]}
        if rec["http_status"] != 200:
            raise SystemExit("non-200 receipt marked complete: " + rec["url"])
        o = objects.setdefault(rec["sha256"], {"sha256": rec["sha256"], "bytes": rec["bytes"], "kind": "publisher_original",
                                               "path": os.path.abspath(os.path.join(work, rec["file"])), "sources": []})
        if src not in o["sources"]:
            o["sources"].append(src)
        d = objects.setdefault(dsha, {"sha256": dsha, "bytes": len(derivative.encode("utf-8")), "kind": "unit_text_derivative",
                                      "path": dpath, "code_points": len(derivative), "sources": []})
        if src not in d["sources"]:
            d["sources"].append(src)
        unit_key = row["doc_id"]
        units.append({"unit_key": unit_key, "unit_kind": "section_page", "heading": heading, "original_sha256": rec["sha256"],
                      "publisher_member": None, "raw_member_sha256": None, "text_sha256": dsha,
                      "text_code_points": len(derivative), "sections_expected": 1, "currency": currency,
                      "source_url": rec["url"], "retrieved_at": rec["retrieved_at"],
                      "retrieval_method": src["retrieval_method"], "proxy": src["proxy"]})
        sections.append({"unit_key": unit_key, "citation_path": path, "citation": citation, "heading": heading,
                         "text": row["text"], "hierarchy": hierarchy, "history": row["history"], "status_note": status_note,
                         "span": {"unit": "unicode_code_points", "start": 0, "end": len(row["text"])},
                         "currency": currency, "source_url": rec["url"]})
        per_toc[s["toc_page"]] += 1
        proof_pages.append({"url": rec["url"], "markers": row["section_docs"], "sections": 1})
        for k in ("has_img", "has_table", "skip_running_header"):
            notes[k] += bool(row[k])
        notes["multi_version"] += row["versions"] > 1
    for p in pages.values():
        if p["level"] == "part":
            linked = sum(1 for e in p["entries"] if e.get("url"))
            proof_pages.append({"url": p["url"], "markers": linked, "sections": per_toc.get(p["url"], 0)})
    linked_children = {e["url"] for p in pages.values() for e in p["entries"] if e.get("url")}
    captured = {u for u, r in arc.index.items() if r.get("state") == "complete"}
    unfetched = sorted(linked_children - captured)
    unfetched += sorted({p["url"] + " -> " + e["unlinked_html"][:200] for p in pages.values() for e in p["entries"]
                         if not e.get("url") and "href=" in e.get("unlinked_html", "")})
    regex = re.compile(SECTION_ID_REGEX)
    bad = [s["citation_path"] for s in sections if not regex.match(s["citation_path"])]
    if bad:
        raise SystemExit("citation_path outside the manifest regex: %r" % bad[:5])
    manifest = {
        "schema_version": "publisher-code-manifest/2", "jurisdiction": "MT",
        "publisher": "Montana Legislature, Legislative Services Division", "publisher_url": BASE,
        "source_system": SOURCE_SYSTEM, "code_title": "Montana Code Annotated", "parser": PARSER,
        "retrieval": {"methods": sorted({x["retrieval_method"] for o in objects.values() for x in o["sources"]}),
                      "source_url_patterns": [r"^https://mca\.legmt\.gov/bills/mca/title_\w+/(?:chapter|article)_\w+/part_\w+/section_\w+/[\w-]+\.html$"],
                      "terms_gate": False, "official_source": True, "rate_limit_ms": 100},
        "structure": {"levels": ["title", "chapter", "article", "part", "section"],
                      "unit": "one official MCA section page (the retained HTML); title 0 is the Constitution as listed in the MCA table of contents"},
        "section_id": {"scheme": "official_citation_path", "regex": SECTION_ID_REGEX, "example": "27-2-204",
                       "citation_format": "MCA <title>-<chapter>-<section>; the Constitution as const-<article>-<section> (~N marks a printed repeat)"},
        "currency": {"basis": "publisher_statement", "location": "mca.legmt.gov/bills/mca/index.html heading and the line beneath it"},
        "review": {"reviewed_by": reviewer, "reviewed_at": datetime.date.today().isoformat()},
    }
    if not regex.match(manifest["section_id"]["example"]):
        raise SystemExit("section_id example does not match its regex")

    def dump(name, rows):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")

    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1, ensure_ascii=False)
    dump("objects.jsonl", sorted(objects.values(), key=lambda o: o["sha256"]))
    dump("units.jsonl", units)
    dump("sections.jsonl", sections)
    json.dump({"marker": "part sections_index.html: linked lines in the page's section-toc-content list; section page: "
                         "the publisher's section-doc block (one per official section page)",
               "pages": proof_pages, "unfetched_child_pages": unfetched}, open(os.path.join(out, "toc-proof.json"), "w"), indent=0)
    json.dump(gaps, open(os.path.join(out, "gaps.json"), "w"), indent=1)
    toc_links = len(inv["sections"])
    mismatched = [p for p in proof_pages if p["markers"] != p["sections"]]
    report = {
        "edition": edition, "currency_statement": statement, "toc_section_links": toc_links,
        "unique_section_urls": len({s["url"] for s in inv["sections"]}), "sections_parsed": len(sections),
        "toc_match": toc_links == len(sections) and not mismatched and not unfetched,
        "toc_pages_mismatched": len(mismatched), "unfetched_child_pages": len(unfetched), "gaps": len(gaps),
        "units": len(units), "objects": len(objects), "object_bytes": sum(o["bytes"] for o in objects.values()),
        "status_only_sections": dict(status_labels), "heading_source": dict(heading_source), "notes": dict(notes),
        "constitution_sections": sum(1 for s in sections if s["citation_path"].startswith("const-")),
        "counts_by_level": inv["counts"],
        "reserved_toc_lines": sum(1 for p in pages.values() for e in p["entries"] if not e.get("url")),
    }
    json.dump(report, open(os.path.join(out, "parse-report.json"), "w"), indent=1)
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/mt")
    ap.add_argument("--reviewer", default="state-codes MT worker (bc-f9928fc8)")
    a = ap.parse_args()
    print(json.dumps(build(a.work, a.reviewer), indent=1))


if __name__ == "__main__":
    main()
