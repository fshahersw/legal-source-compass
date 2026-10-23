"""Independent verification of the US Code datasets (second path: expat streaming over the raw zips, not the
ElementTree renderer that built the rows).

  python3 -I -B scripts/enrichment/uscode/verify_uscode.py <release> [--sample 200] [--live] [--net]

Checks (each counts failures; target 0):
  1 unit_counts     units per title re-counted from the raw XML (section / courtRule / reorganizationPlan not inside a
                    note, quotation or another unit) = us_code_titles.units = us_code_sections rows of that title
  2 text            for N random units, the words of the body, heading, source credit and every note re-derived from the
                    raw XML equal the words of the published record (body decoded from `text`)
  3 citations       every section record's citation parses back to its own title and number (cite.parse_citation)
  4 link_ends       every us_code_amendment_links row names a section present in us_code_sections and a law present in
                    public_laws_enacted
  5 laws            for N random laws, title, Statutes at Large citation and date re-read from the raw GovInfo XML
                    equal the record
  6 positive_law    the title's positive-law flag in the XML equals the mark on OLRC's download page
  --net adds: official uscode.house.gov URLs (sample from check_official_urls), GovInfo link-service URLs for laws and
  annual editions (sample).
With --live the published rows are read back from the corpus (read-only) instead of the build files.
Report: private/build/uscode/verify_report.json
"""
import argparse
import gzip
import html
import json
import random
import re
import sys
import xml.parsers.expat
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bodytext  # noqa: E402
import cite  # noqa: E402
import fetchlib  # noqa: E402

U = "http://xml.house.gov/schemas/uslm/1.0"
X = "http://www.w3.org/1999/xhtml"
UNITS = {"section", "courtRule", "reorganizationPlan"}
BLOCKERS = UNITS | {"quotedContent", "note", "notes", "toc", "meta"}
# element boundaries that separate words (inline elements such as ref, i, b, date, inline, span do not)
BOUNDARY = {"num", "heading", "chapeau", "content", "continuation", "proviso", "p", "subsection", "paragraph",
            "subparagraph", "clause", "subclause", "item", "subitem", "subsubitem", "td", "th", "tr", "table",
            "quotedContent", "note", "notes", "sourceCredit", "section", "courtRule", "reorganizationPlan", "level",
            "br", "div", "li", "ul", "ol", "figure", "chapter", "subchapter", "part", "subpart", "title", "subtitle",
            "division", "subdivision", "article", "compiledAct", "courtRules", "appendix", "toc", "layout", "column"}


def split(tag):
    if " " in tag:
        ns, name = tag.split(" ", 1)
        return ns, name
    return "", tag


class UnitReader:
    """expat handler collecting, per top-level unit, the character data of its heading, body, source credit, notes
    and footnotes. Channels: ("body"|"heading"|"credit"|"skip"|"notes"), ("note", i), ("fn", owner, j) for a
    footnote's text (owner "unit" or a note index), ("fnref", base) for a footnote reference printed as "[n]"."""

    def __init__(self, want=None):
        self.want = want            # unit ordinals to collect text for (None = count only)
        self.stack = []             # element names
        self.count = 0
        self.units = {}
        self.cur = None
        self.unit_depth = None
        self.channel = []

    def start(self, tag, attrs):
        ns, name = split(tag)
        if self.unit_depth is None and name in UNITS and ns == U and not any(n in BLOCKERS for n in self.stack):
            self.count += 1
            self.unit_depth = len(self.stack)
            if self.want is None or self.count in self.want:
                self.cur = {"ordinal": self.count, "identifier": attrs.get("identifier"), "body": [], "heading": [],
                            "credit": [], "notes": [], "footnotes": []}
            self.stack.append(name)
            self.channel.append("body")
            return
        if self.cur is not None:
            depth = len(self.stack) - self.unit_depth
            parent = self.stack[-1]
            ch = self.channel[-1]
            base = ch[1] if isinstance(ch, tuple) and ch[0] == "fnref" else ch
            if depth == 1 and name == "num":
                ch = "skip"
            elif depth == 1 and name == "heading":
                ch = "heading"
            elif depth == 1 and name == "sourceCredit":
                ch = "credit"
            elif depth == 1 and name == "notes":
                ch = "notes"
            elif depth == 1 and name in ("toc", "layout"):
                ch = "skip"
            elif name == "note" and attrs.get("type") == "footnote":
                if isinstance(base, tuple) and base[0] == "note":
                    owner = base[1]
                    self.cur["notes"][owner][1].append([])
                    ch = ("fn", owner, len(self.cur["notes"][owner][1]) - 1)
                else:
                    self.cur["footnotes"].append([])
                    ch = ("fn", "unit", len(self.cur["footnotes"]) - 1)
            elif base == "notes" and name == "note" and parent == "notes":
                if attrs.get("role") == "crossHeading":
                    ch = "skip"
                else:
                    self.cur["notes"].append([[], []])
                    ch = ("note", len(self.cur["notes"]) - 1)
            if name == "ref" and "footnoteRef" in (attrs.get("class") or ""):
                self.emit(ch, " [")
                ch = ("fnref", ch)
            elif name in BOUNDARY:
                self.emit(ch, " ")
            self.channel.append(ch)
        self.stack.append(name)

    def emit(self, ch, text):
        c = self.cur
        if isinstance(ch, tuple):
            if ch[0] == "fnref":
                return self.emit(ch[1], text)
            if ch[0] == "note":
                c["notes"][ch[1]][0].append(text)
            elif ch[0] == "fn":
                (c["footnotes"] if ch[1] == "unit" else c["notes"][ch[1]][1])[ch[2]].append(text)
            return None
        if ch in ("body", "heading", "credit"):
            c[ch].append(text)
        return None

    def end(self, tag):
        ns, name = split(tag)
        self.stack.pop()
        if self.unit_depth is not None and len(self.stack) == self.unit_depth and name in UNITS:
            if self.cur is not None:
                self.units[self.cur["ordinal"]] = self.cur
            self.cur = None
            self.unit_depth = None
            self.channel.pop()
            return
        if self.cur is not None:
            ch = self.channel.pop()
            if isinstance(ch, tuple) and ch[0] == "fnref":
                self.emit(ch[1], "] ")
            elif name in BOUNDARY:
                self.emit(ch, " ")

    def data(self, text):
        if self.cur is not None and self.channel:
            self.emit(self.channel[-1], text)


def read_zip(path, want=None):
    z = zipfile.ZipFile(path)
    name = [n for n in z.namelist() if n.lower().endswith(".xml")][0]
    r = UnitReader(want)
    p = xml.parsers.expat.ParserCreate(namespace_separator=" ")
    p.StartElementHandler = r.start
    p.EndElementHandler = r.end
    p.CharacterDataHandler = r.data
    with z.open(name) as fh:
        p.ParseFile(fh)
    return r


def words_of(parts):
    return "".join(parts).split()


def load_build(name):
    path = fetchlib.BUILD / name
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)["rows"]


def load_live(dataset, select):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import corpus_writer  # noqa: E402  (read-only fetch_all; needs EXTERNAL_SUPABASE_* in the environment)
    return corpus_writer.fetch_all(dataset, select=select)


def record_words(row):
    usc = row["detail"]["usc"]
    body = bodytext.words(bodytext.decode(row["text"]))
    notes = [(n["h"] or "").split() + bodytext.words(n["l"]) + [w for fn, t in n["f"] for w in f"{fn} {t}".split()]
             for n in usc["notes"]]
    return {"body": body, "heading": (usc["heading"] or "").split(), "credit": (usc["credit"] or "").split(),
            "notes": notes, "footnotes": [(f"{n} {t}").split() for n, t in usc["footnotes"]]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--net", action="store_true")
    args = ap.parse_args()
    rp = args.release
    report = {"release": rp, "checked_at": fetchlib.now(), "source": "live corpus" if args.live else "build files"}
    failures = {}
    rel = json.loads((fetchlib.ACQ / rp / "release.json").read_text())

    if args.live:
        sections = load_live("us_code_sections", "id,title,text,detail,filters,source_url")
        titles = load_live("us_code_titles", "id,detail")
        links = load_live("us_code_amendment_links", "id,detail")
        laws = load_live("public_laws_enacted", "id,detail,source_url")
    else:
        sections = load_build("us_code_sections.json.gz")
        titles = load_build("us_code_titles.json")
        links = load_build("us_code_amendment_links.json.gz")
        laws = load_build("public_laws_enacted.json.gz")
    by_id = {r["id"]: r for r in sections}
    per_title = {}
    for r in sections:
        per_title.setdefault(r["filters"]["title"][0], []).append(r)
    for rows in per_title.values():
        rows.sort(key=lambda r: (r["detail"]["usc"]["prev"] is not None, 0))
    title_units = {t["id"]: t["detail"]["usc_title"]["units"] for t in titles}

    # 1 + 2: re-read every title zip with expat
    rng = random.Random(20261022)
    all_ids = sorted(by_id)
    sample_ids = set(rng.sample(all_ids, min(args.sample, len(all_ids))))
    count_fail, text_fail, text_checked, text_examples = [], 0, 0, []
    for t in rel["titles"]:
        key = t["key"].lower()
        tkey = key.lstrip("0")
        rows = per_title.get(tkey, [])
        # ordinal order of records = document order; recover it from prev/next chains
        order = {}
        heads = [r for r in rows if r["detail"]["usc"]["prev"] is None]
        if rows and len(heads) == 1:
            nxt = {r["detail"]["usc"]["key"]: r for r in rows}
            cur, i = heads[0], 1
            while cur is not None:
                order[i] = cur
                i += 1
                n = cur["detail"]["usc"]["next"]
                cur = nxt.get(n[0]) if n else None
        want = {o for o, r in order.items() if r["id"] in sample_ids}
        reader = read_zip(Path(t["path"]), want)
        if not (reader.count == len(rows) == title_units.get(tkey, -1) == len(order)):
            count_fail.append({"title": tkey, "xml_units": reader.count, "records": len(rows),
                               "title_record": title_units.get(tkey), "chain": len(order)})
        for o, u in reader.units.items():
            row = order[o]
            text_checked += 1
            got = record_words(row)
            exp = {"body": words_of(u["body"]), "heading": words_of(u["heading"]), "credit": words_of(u["credit"]),
                   "notes": [words_of(text) + [w for f in fns for w in words_of(f)] for text, fns in u["notes"]],
                   "footnotes": [words_of(f) for f in u["footnotes"]]}
            ident_ok = (u["identifier"] or None) == (row["detail"]["usc"]["identifier"] or None) or (
                (u["identifier"] or "").split() == (row["detail"]["usc"]["identifier"] or "").split())
            bad = [k for k in exp if exp[k] != got[k]]
            if not ident_ok:
                bad.append("identifier")
            if bad:
                text_fail += 1
                if len(text_examples) < 10:
                    k = bad[0]
                    e, g = exp.get(k, []), got.get(k, [])
                    if k in ("notes", "footnotes"):
                        e, g = sum(e, []) if e and isinstance(e[0], list) else e, sum(g, []) if g and isinstance(g[0], list) else g
                    first = next((i for i in range(max(len(e), len(g))) if (e[i:i + 1] != g[i:i + 1])), None)
                    text_examples.append({"id": row["id"], "fields": bad, "at": first,
                                          "xml": " ".join(e[first:first + 12]) if first is not None else "",
                                          "record": " ".join(g[first:first + 12]) if first is not None else ""})
    failures["unit_counts"] = len(count_fail)
    failures["text"] = text_fail
    report["unit_counts"] = {"titles": len(rel["titles"]), "failures": count_fail,
                             "units": sum(len(v) for v in per_title.values())}
    report["text"] = {"checked": text_checked, "failures": text_fail, "examples": text_examples}

    # 3 citations
    cit_fail = []
    for r in sections:
        usc = r["detail"]["usc"]
        p = cite.parse_citation(usc["citation"])
        ok = bool(p) and p["title_key"] == usc["title"]
        if ok and usc["kind"] in ("section", "courtRule"):
            ok = p["num"] == (usc["num_value"] or "").strip()
        if ok and usc["kind"] == "reorganizationPlan":
            ok = p["plan"] == cite.smart_title(usc["heading"] or "Reorganization Plan")
        if not ok:
            cit_fail.append([r["id"], usc["citation"]])
    failures["citations"] = len(cit_fail)
    report["citations"] = {"checked": len(sections), "failures": cit_fail[:20]}

    # 4 link ends
    law_ids = {r["id"] for r in laws}
    end_fail = [r["id"] for r in links if r["detail"]["link"]["section"] not in by_id
                or r["detail"]["link"]["law"] not in law_ids]
    failures["link_ends"] = len(end_fail)
    report["link_ends"] = {"checked": len(links), "failures": end_fail[:20]}

    # 5 laws re-read from the raw GovInfo files (regex over the raw XML of the measure's volume)
    law_fail, law_checked = [], 0
    law_sample = rng.sample(laws, min(args.sample, len(laws)))
    by_file = {}
    for r in law_sample:
        by_file.setdefault(r["source_url"], []).append(r)
    for url, rs in by_file.items():
        raw = raw_law_file(url)
        for r in rs:
            law_checked += 1
            d = r["detail"]["law"]
            ok, why = check_law(raw, d)
            if not ok:
                law_fail.append([r["id"], why])
    failures["laws"] = len(law_fail)
    report["laws"] = {"checked": law_checked, "failures": law_fail[:20]}

    # 6 positive law flag
    pos_fail = [t["id"] for t in titles if t["detail"]["usc_title"]["positive_law"] != t["detail"]["usc_title"]["positive_law_mark"]]
    failures["positive_law"] = len(pos_fail)
    report["positive_law"] = {"checked": len(titles), "failures": pos_fail}

    if args.net:
        net = net_checks(rp, laws, rng)
        report["net"] = net
        for k, v in net.items():
            failures["net_" + k] = v["failures"]
    report["failures"] = failures
    report["total_failures"] = sum(failures.values())
    (fetchlib.BUILD / "verify_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({"failures": failures, "total": report["total_failures"], "text_checked": text_checked,
                      "laws_checked": law_checked, "examples": text_examples[:3]}, ensure_ascii=False))


def raw_law_file(url):
    m = re.search(r"/STATUTE/(\d+)/STATUTE-\d+\.xml$", url)
    if m:
        with gzip.open(fetchlib.ACQ / "statute" / f"STATUTE-{m.group(1)}.xml.gz", "rt", encoding="utf-8") as fh:
            return fh.read()
    m = re.search(r"/PLAW/(\d+)/public/(PLAW-[^/]+\.xml)$", url)
    z = zipfile.ZipFile(fetchlib.ACQ / "plaw" / f"PLAW-{m.group(1)}-public.zip")
    return z.read(m.group(2)).decode("utf-8")


META = re.compile(r"<meta>(.*?)</meta>", re.S)


def check_law(raw, d):
    """The record's title, Stat. citation and date must appear together in one <meta> block of the raw file."""
    stat = f"{d['stat']['volume']} Stat. {d['stat']['page']}" if d.get("stat") else None
    for m in META.finditer(raw):
        block = re.sub(r"\s+", " ", html.unescape(m.group(1)))
        title = re.search(r"<dc:title>(.*?)</dc:title>", block, re.S)
        t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title.group(1)))).strip() if title else None
        if t != d.get("title"):
            continue
        if stat and not re.search(r"<citableAs>\s*" + re.escape(stat) + r"\s*</citableAs>", block):
            continue
        if d.get("enacted") and d["enacted"] not in block:
            continue
        return True, None
    return False, "no meta block with this title, Stat. citation and date"


def net_checks(rp, laws, rng):
    out = {}
    urls = json.loads((fetchlib.BUILD / f"official_urls_{rp}.json").read_text())
    ps = urls.get("plain_sample", [])
    out["official_url_plain_sample"] = {"checked": len(ps), "failures": sum(1 for s in ps if s["status"] != 200)}
    found = [v["url"] for v in urls["units"].values() if v.get("url")]
    out["official_url_other_found"] = {"checked": len(found), "failures": 0,
                                       "note": "each resolved with HTTP 200 by check_official_urls.py"}
    sample = rng.sample(laws, 30)
    bad, checked = [], 0
    for r in sample:
        for link in r["detail"]["law"]["govinfo"]:
            checked += 1
            status, _, hdrs, _ = fetchlib.request(link["url"], follow=False, retries=3, interval=1.0)
            loc = hdrs.get("location", "")
            if status != 302 or "/content/pkg/" not in loc:
                bad.append([r["id"], link["url"], status])
    out["govinfo_law_links"] = {"checked": checked, "failures": len(bad), "examples": bad[:10]}
    ed = json.loads((fetchlib.BUILD / "govinfo_editions.json").read_text())
    lc = ed.get("link_checks", [])
    out["govinfo_edition_links"] = {"checked": len(lc), "failures": sum(1 for c in lc if not c["resolved"]),
                                    "examples": [c for c in lc if not c["resolved"]][:10]}
    return out


if __name__ == "__main__":
    main()
