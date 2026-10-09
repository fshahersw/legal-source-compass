#!/usr/bin/env python3
"""Kansas recovery, step 3: parse retained Revisor pages into a landing packet for
scripts/legal/state-codes/common/land_publisher_code_v2.py.

Inputs (from retained.py and toc.py): <work>/sources.jsonl, <work>/objects/<sha>, <work>/toc/fetched.jsonl, <work>/toc/<sha>.

Rules
- One source unit per publisher section page; its text derivative is the page's printed statute text
  (section number, caption, body, history) and every section is an exact span of it.
- Revisor editorial annotations (class ksa_8pt_*: prior law, law review, case notes) are not statute text.
- A page printing two versions of one section yields <stem> and <stem>:2 (two identities, never merged).
- Identity is the publisher's page key (chapter_article_section), never the body hash: repeated wording
  ("Repealed.") never collapses distinct sections.
- When a URL was captured more than once, the latest capture that carries a section marker is used;
  older captures stay retained and listed in report.json.
- Chapter and article titles come only from the Revisor's ksa_chN.html index pages.
- Currency is the publisher's own statement (2025 session). Sections listed in the Revisor's 2026
  "New, Amended & Repealed" list are flagged as changed by a later session, not rewritten.
- Kansas Constitution pages retained from kslegislature.gov are outside K.S.A. and not landed.
"""
import argparse, hashlib, html as H, json, os, re, subprocess, sys
from collections import defaultdict

BASE = "https://www.ksrevisor.gov"
STATEMENT = "These statutes include amendments and new laws enacted during the 2025 legislative session."
EDITION = "Kansas Statutes Annotated, Revisor of Statutes online text (2025 legislative session)"
CHANGE_LIST = BASE + "/rpts/2026NewAmendsAndRepealsKSAOrder.pdf"
STATUS = re.compile(r"^(Repealed|Reserved|Transferred|Expired|Recodified|Revived|Not in force)\b", re.I)
BLOCK = re.compile(r"(?is)</?(p|div|br|tr|li|h[1-6]|table|ul|ol)\b[^>]*>")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def clean(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"(?s)<[^>]+>", " ", s))).strip()


def lines(fragment):
    fragment = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", fragment)
    parts = BLOCK.split(fragment)
    out = []
    for p in BLOCK.sub("\n", fragment).split("\n"):
        t = clean(p)
        if t:
            out.append(t)
    return out


def parse_toc(page):
    """-> chapter (number, heading), {url: (article_number, article_heading, entry_label, title)}"""
    m = re.search(r"(?s)<h2>\s*(Chapter\s+([0-9]+[a-z]?)\..*?)</h2>", page)
    ch = (m.group(2), clean(m.group(1))) if m else (None, None)
    art = (None, None)
    entries = {}
    for t in re.finditer(r'(?s)<a class="collapsed"[^>]*>(.*?)</a>|<li>\s*([^<]*?)\s*<a href="(/statutes/chapters/[^"]+\.html)">(.*?)</a>', page):
        if t.group(1) is not None:
            head = clean(t.group(1))
            n = re.match(r"Article\s+([0-9]+[a-z]?)\.", head)
            art = (n.group(1) if n else None, head)
        else:
            entries[BASE + t.group(3)] = (art[0], art[1], clean(t.group(2)), clean(t.group(4)))
    return ch, entries


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


LEAVES = {"p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd"}


def _print_box(page):
    from lxml import html as LH
    if not page.strip():
        return None
    box = LH.fromstring(page).xpath('//div[@id="print"]')
    return box[0] if box else None


def _blocks(box):
    """Outermost block leaves inside the print box, in document order (tables row by row; a div
    holding only inline content, e.g. a printed formula line, is a leaf). Everything inside the
    print box is statute text: the Revisor's editorial annotations sit after it."""
    out, leafdivs = [], set()
    for el in box.iter():
        if not isinstance(el.tag, str):
            continue
        if el.tag == "div":
            if el is box or any(isinstance(d.tag, str) and (d.tag in LEAVES or d.tag in ("div", "table")) for d in el.iterdescendants()):
                continue
        elif el.tag not in LEAVES:
            continue
        a, nested = el.getparent(), False
        while a is not None and a is not box:
            if a.tag in LEAVES or a.tag == "div" and a in leafdivs:
                nested = True
                break
            a = a.getparent()
        if not nested:
            out.append(el)
            if el.tag == "div":
                leafdivs.add(el)
    return out


def _text(el):
    if el.tag == "tr":  # table cells keep their order, separated by a tab
        return "\t".join(_norm(td.text_content()) for td in el if isinstance(td.tag, str))
    return _norm(el.text_content())


def parse_page_full(page):
    """-> (lead_lines, sections). sections: [{citation, caption, lines, history}], one per printed
    section. lead_lines: printed text before the first section number (an article subheading such
    as "TECHNICAL COLLEGES"); it stays in the unit text, outside every section span.

    Text is confined to the Revisor's <div id="print"> block, so navigation, comments and the
    editorial annotations after it never enter stored text. A new section starts only at a block
    whose stat_number span is non-empty: some pages carry an empty second span after the number,
    which is markup, not a second version."""
    box = _print_box(page)
    if box is None:
        return [], []
    lead, out = [], []
    for p in _blocks(box):
        nums = [n for n in (_norm(s.text_content()) for s in p.xpath('.//span[@class="stat_number"]')) if n]
        text = _text(p)
        if nums:
            cap = p.xpath('.//span[@class="stat_caption"]')
            out.append({"citation": nums[0], "caption": (_norm(cap[0].text_content()) or None) if cap else None,
                        "lines": [], "history": None})
        if not text.strip():
            continue
        if not out:
            lead.append(text)
            continue
        out[-1]["lines"].append(text)
        if text.startswith("History:"):
            out[-1]["history"] = text if out[-1]["history"] is None else out[-1]["history"] + " " + text
    return lead, out


def parse_page(page):
    return parse_page_full(page)[1]


def box_markers(page):
    box = _print_box(page)
    return 0 if box is None else sum(1 for sp in box.xpath('.//span[@class="stat_number"]') if _norm(sp.text_content()))


def coverage_gap(page, lead, parsed):
    """Non-whitespace character counts: whole print box, its block leaves, and the stored lines."""
    box = _print_box(page)
    if box is None:
        return {"box": 0, "blocks": 0, "stored": 0}
    nows = lambda t: len(re.sub(r"\s", "", t))
    return {"box": nows(box.text_content()), "blocks": nows("".join(_text(b) for b in _blocks(box))),
            "stored": nows("".join(lead) + "".join(l for p in parsed for l in p["lines"]))}


ROW = re.compile(r"^\s*([0-9]{1,2}[a-z]?-[0-9][0-9a-z,]*)(?:\s+\(Supp\.\))?\s+(New|Am|Rep)\s+(\d+)\s+(\d+)\s+(\d+)\b(.*)$")
# A row whose Type cell wraps onto the lines above and below it (e.g. "Rev" / "& Am": revived and amended).
WRAPPED = re.compile(r"^\s*([0-9]{1,2}[a-z]?-[0-9][0-9a-z,]*)(?:\s+\(Supp\.\))?\s+(\d+)\s+(\d+)\s+(\d+)\b(.*)$")
TYPE_PART = re.compile(r"^\s+((?:&\s*)?(?:Rev|New|Am|Rep)(?:\s*&\s*(?:Rev|New|Am|Rep))*)\s*$")


def parse_change_text(txt):
    """Rows of the Revisor's 2026 composite list (K.S.A. order): KSA, Type (New/Am/Rep, or a wrapped
    combination such as "Rev & Am"), Bill, Sec, SL Ch, rest. Rows outside K.S.A. ("New Section 1.",
    "Will not be included in K.S.A.") are not section rows."""
    changes, table = {}, None
    ls = txt.splitlines()
    for i, line in enumerate(ls):
        t = re.match(r"^\s*Table (One|Two|Three|Four)\s*$", line)
        if t:
            table = "Table " + t.group(1)
            continue
        m = ROW.match(line)
        if m:
            key, typ, bill, sec, slch = m.groups()[:5]
        else:
            m = WRAPPED.match(line)
            before = TYPE_PART.match(ls[i - 1]) if i else None
            after = TYPE_PART.match(ls[i + 1]) if i + 1 < len(ls) else None
            if not (m and (before or after)):
                continue
            key, bill, sec, slch = m.groups()[:4]
            typ = _norm(" ".join(x.group(1) for x in (before, after) if x))
        changes.setdefault(key, []).append({"type": typ, "bill": bill, "sec": sec, "sl_ch": slch, "table": table,
                                            "row": _norm(line)})
    return changes


def change_list(work, fetched):
    rec = fetched.get(CHANGE_LIST)
    if not rec:
        return None, {}
    path = os.path.join(work, "toc", rec["sha256"])
    txt = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout
    return rec, parse_change_text(txt)


def build(work, out, cfg):
    os.makedirs(os.path.join(out, "text"), exist_ok=True)
    sources = [json.loads(l) for l in open(os.path.join(work, "sources.jsonl"))]
    fetched = {}
    for l in open(os.path.join(work, "toc", "fetched.jsonl")):
        r = json.loads(l)
        fetched[r["source_url"]] = r
    caps = defaultdict(list)
    for r in sources:
        caps[r["source_url"]].append({**r, "path": os.path.join(work, "objects", r["sha256"])})
    for u, r in fetched.items():
        if "/statutes/chapters/" in u:
            caps[u].append({**r, "path": os.path.join(work, "toc", r["sha256"])})
    toc = {}
    chapters = {}
    for u, r in fetched.items():
        if re.search(r"/ksa_ch[0-9a-z]+\.html$", u):
            ch, entries = parse_toc(open(os.path.join(work, "toc", r["sha256"]), encoding="utf-8", errors="replace").read())
            for e, v in entries.items():
                toc[e] = (ch, v)
            chapters[u] = ch
    clist_rec, changes = change_list(work, fetched)
    objects, units, sections, pages, unfetched, superseded = {}, [], [], [], [], []
    noted, subheads = [], []
    for url in sorted(toc):
        (chnum, chhead), (artnum, arthead, label, title) = toc[url]
        chosen, parsed = None, None
        for c in sorted(caps.get(url, []), key=lambda c: c["retrieved_at"], reverse=True):
            page = open(c["path"], encoding="utf-8", errors="replace").read()
            lead_l, p = parse_page_full(page)
            if p and chosen is None:
                chosen, parsed, lead = c, p, lead_l
                markers = box_markers(page)
                cov = coverage_gap(page, lead_l, p)
                whole = sum(1 for m in re.finditer(r'(?s)<span class="stat_number">(.*?)</span>', page) if clean(m.group(1)))
                if whole > markers:  # another version printed in the Revisor's note after the statute text
                    noted.append({"url": url, "numbers_in_page": whole, "numbers_in_statute_text": markers})
            else:
                superseded.append({"source_url": url, "sha256": c["sha256"], "retrieved_at": c["retrieved_at"],
                                   "markers": page.count('class="stat_number"'), "reason": "older or markerless capture of the same page"})
        if chosen is None:
            unfetched.append(url)
            continue
        stem = url.rsplit("/", 1)[1][:-5]
        blocks, spans, pos = ([ "\n".join(lead) ], [], len("\n".join(lead)) + 2) if lead else ([], [], 0)
        if lead:
            subheads.append({"url": url, "lead": lead})
        for p in parsed:
            t = "\n".join(p["lines"])
            spans.append((pos, pos + len(t)))
            blocks.append(t)
            pos += len(t) + 2
        unit_text = "\n\n".join(blocks)
        tsha = sha(unit_text.encode("utf-8"))
        tpath = os.path.join(out, "text", tsha + ".txt")
        with open(tpath, "w", encoding="utf-8") as f:
            f.write(unit_text)
        if chosen.get("http_status") != 200 or chosen.get("proxy") is not None:
            raise SystemExit(f"capture without a recorded direct HTTP 200: {url}")
        src = {"source_url": url, "retrieved_at": chosen["retrieved_at"], "http_status": 200,
               "retrieval_method": chosen.get("retrieval_method") or "publisher_page", "proxy": None}
        objects.setdefault(chosen["sha256"], {"sha256": chosen["sha256"], "bytes": os.path.getsize(chosen["path"]),
                                               "kind": "publisher_original", "path": chosen["path"], "sources": [src]})
        o = objects.setdefault(tsha, {"sha256": tsha, "bytes": len(unit_text.encode("utf-8")), "kind": "unit_text_derivative",
                                      "path": tpath, "sources": []})
        if src not in o["sources"]:
            o["sources"].append(src)
        cur = {"basis": "publisher_statement", "statement": STATEMENT, "through_date": None, "edition": EDITION}
        units.append({"unit_key": stem, "unit_kind": "section_page", "heading": title or None, "original_sha256": chosen["sha256"],
                      "publisher_member": None, "raw_member_sha256": None, "text_sha256": tsha, "text_code_points": len(unit_text),
                      "sections_expected": markers, "currency": cur, "source_url": url, "retrieved_at": chosen["retrieved_at"],
                      "retrieval_method": "publisher_page", "proxy": None})
        pages.append({"url": url, "markers": markers, "sections": len(parsed), "coverage": cov})
        for i, p in enumerate(parsed):
            path = stem if i == 0 else f"{stem}:{i + 1}"
            heading = p["caption"] or title or None
            status = title if title and STATUS.match(title) else None
            key = re.sub(r"\.$", "", p["citation"]).strip()
            later = changes.get(key)
            scur = dict(cur)
            if later:
                scur["statement"] = STATEMENT + " Listed by the Revisor as changed by the 2026 legislative session (" + CHANGE_LIST + "); this text predates that change."
            sections.append({"unit_key": stem, "citation_path": path, "citation": p["citation"], "heading": heading,
                             "text": unit_text[spans[i][0]:spans[i][1]],
                             "hierarchy": [{"level": "chapter", "number": chnum, "heading": chhead},
                                           {"level": "article", "number": artnum, "heading": arthead},
                                           {"level": "section", "number": p["citation"], "heading": heading}],
                             "history": p["history"], "status_note": status,
                             "span": {"unit": "unicode_code_points", "start": spans[i][0], "end": spans[i][1]}, "currency": scur,
                             "later_session": later})
    manifest = json.load(open(cfg, encoding="utf-8"))
    rx = re.compile(manifest["section_id"]["regex"])
    bad = [s["citation_path"] for s in sections if not rx.search(s["citation_path"])]
    if bad:
        raise SystemExit(f"{len(bad)} citation paths fail the manifest regex, first {bad[0]}")
    ids = [s["citation_path"] for s in sections]
    assert len(ids) == len(set(ids)), "duplicate section identity"
    w = lambda name, rows: open(os.path.join(out, name), "w", encoding="utf-8").write(
        "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows))
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1, sort_keys=True)
    w("objects.jsonl", sorted(objects.values(), key=lambda o: o["sha256"]))
    w("units.jsonl", units)
    w("sections.jsonl", [{k: v for k, v in s.items() if k != "later_session"} for s in sections])
    json.dump({"marker": 'Revisor section marker <span class="stat_number"> on each section page listed by ksa_chN.html',
               "pages": pages, "unfetched_child_pages": unfetched}, open(os.path.join(out, "toc-proof.json"), "w"), indent=0)
    out_of_scope = sorted({r["source_url"] for r in sources if "kslegislature.gov" in r["source_url"]})
    report = {"toc_chapters": len(chapters), "toc_pages": len(toc), "units": len(units), "sections": len(sections),
              "multi_version_pages": sum(1 for p in pages if p["sections"] > 1), "objects": len(objects),
              "superseded_captures": superseded, "unfetched_child_pages": unfetched,
              "out_of_scope_retained": {"reason": "Kansas Constitution pages (kslegislature.gov); not part of K.S.A.", "urls": out_of_scope},
              "change_list": {"url": CHANGE_LIST, "sha256": clist_rec and clist_rec["sha256"], "ksa_entries": len(changes),
                              "matched_sections": sum(1 for s in sections if s["later_session"]),
                              "unmatched": sorted(set(changes) - {re.sub(r"\.$", "", s["citation"]).strip() for s in sections})},
              "prior_version_in_revisor_note": noted,
              "retained_section_pages_not_in_index": sorted(u for u in caps if "/statutes/chapters/" in u and u not in toc),
              "printed_lead_text_outside_sections": subheads,
              "coverage_mismatch": [p for p in pages if not (p["coverage"]["box"] == p["coverage"]["blocks"] == p["coverage"]["stored"])],
              "marker_section_mismatch": [p["url"] for p in pages if p["markers"] != p["sections"]],
              "repealed_or_reserved": sum(1 for s in sections if s["status_note"])}
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, (list, dict))}))
    print(json.dumps({k: (len(v) if isinstance(v, list) else {kk: (len(vv) if isinstance(vv, list) else vv) for kk, vv in v.items()})
                      for k, v in report.items() if isinstance(v, (list, dict))}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/ks/work")
    ap.add_argument("--out", default="/tmp/ks/work/landing")
    ap.add_argument("--manifest", default=os.path.join(os.path.dirname(__file__), "manifest.json"))
    a = ap.parse_args()
    build(a.work, a.out, a.manifest)
