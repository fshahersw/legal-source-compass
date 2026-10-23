"""Parse GovInfo USLM Statutes at Large volumes and PLAW files into law records with their US Code references.

  python3 -I -B scripts/enrichment/uscode/statute_parse.py [--volumes 1-138] [--plaw]

Writes private/build/uscode/laws/statute.jsonl.gz and plaw.jsonl.gz, one JSON object per enacted measure:
  source ("statute"|"plaw"), file, url (bulk file), doc_tag (pLaw|resolution), type (dc:type as printed),
  public_private, congress, session, doc_number (as printed), chapter (arabic, when dc:type is Chapter),
  public_law {congress, number, printed} (from citableAs "Public Law C–N", or the longTitle sidenote ref /us/pl/C/N),
  stat {volume, page} (citableAs "V Stat. P"), last_page, enacted (approvedDate, else dc:date when ISO),
  title (dc:title as printed), bill {href, printed}, usc_refs [[href, printed, where]] where is "margin" (sidenote) or
  "text"; references inside quoted text (text being inserted into other law) are not counted.
Nothing is inferred: a field the file does not carry is null.
"""
import argparse
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

NS = "{http://schemas.gpo.gov/xml/uslm}"
DC = "{http://purl.org/dc/elements/1.1/}"
DOCS = {"pLaw", "resolution"}
OUT = fetchlib.BUILD / "laws"
WS = re.compile(r"\s+")
STAT = re.compile(r"^(\d{1,3}) Stat\. (\d{1,5})$")
PL = re.compile(r"^Public Law (\d{1,3})[–-](\d{1,4})$")
PL_SHORT = re.compile(r"^Public Law (\d{1,4})$")
CHAPTER_TEXT = re.compile(r"\[?\b(?:chapter|chap\.)\s+(\d{1,4}|[IVXLCDM]{1,8})\b", re.I)
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def norm(s):
    return WS.sub(" ", s or "").strip()


def roman_to_int(s):
    s = s.upper()
    if not s or any(c not in ROMAN for c in s):
        return None
    total, prev = 0, 0
    for c in reversed(s):
        v = ROMAN[c]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    # reject non-canonical forms (e.g. "IIII" is accepted by the sum but "IC" is not canonical)
    return total if int_to_roman(total) == s else None


def int_to_roman(n):
    out = []
    for v, r in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
                 (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v:
            out.append(r)
            n -= v
    return "".join(out)


def chapter_number(doc_number):
    """'565' -> 565, 'XVI.—' -> 16, 'XVI' -> 16; None when not a plain number."""
    s = re.sub(r"[^0-9A-Za-z]", "", doc_number or "")
    if s.isdigit():
        return int(s)
    return roman_to_int(s)


def text_of(el):
    return norm("".join(el.itertext())) if el is not None else None


def law_record(el, source, file_url, file_name):
    meta = el.find(NS + "meta")
    get = (lambda tag: meta.find(tag)) if meta is not None else (lambda tag: None)
    dtype = text_of(get(DC + "type"))
    doc_number = text_of(get(NS + "docNumber"))
    cites = [text_of(c) for c in (meta.findall(NS + "citableAs") if meta is not None else [])]
    congress = text_of(get(NS + "congress"))
    congress_n = int(congress) if congress and congress.isdigit() else None
    stat = pl = None
    for c in cites:
        m = STAT.match(c or "")
        if m and not stat:
            stat = {"volume": int(m.group(1)), "page": int(m.group(2))}
        m = PL.match(c or "")
        if m and not pl:
            pl = {"congress": int(m.group(1)), "number": int(m.group(2)), "printed": c, "from": "citableAs"}
        m = PL_SHORT.match(c or "")
        if m and not pl and congress_n:
            pl = {"congress": congress_n, "number": int(m.group(1)), "printed": c,
                  "from": "citableAs + congress"}
    if not pl and (dtype or "") == "Public Law" and congress_n and el.tag == NS + "pLaw":
        m = re.fullmatch(r"(?:(\d{1,3})[–-])?(\d{1,4})", doc_number or "")
        if m and (not m.group(1) or int(m.group(1)) == congress_n):
            pl = {"congress": congress_n, "number": int(m.group(2)), "printed": f"Public Law {doc_number}",
                  "from": "docNumber + congress"}
    long_title = el.find(f".//{NS}longTitle")
    bill = None
    if long_title is not None:
        for ref in long_title.iter(NS + "ref"):
            href = ref.get("href") or ""
            if href.startswith("/us/bill/") and not bill:
                bill = {"href": href, "printed": text_of(ref)}
            m = re.fullmatch(r"/us/pl/(\d{1,3})/(\d{1,4})", href)
            printed = text_of(ref) or ""
            pn = re.search(r"(\d{1,4})", printed)
            if m and not pl and (congress_n is None or int(m.group(1)) == congress_n) and pn \
                    and int(pn.group(1)) == int(m.group(2)):
                # kept only when the reference agrees with the measure's Congress and with the number printed
                # ("Public, No. 502" must not become /us/pl/70/520)
                pl = {"congress": int(m.group(1)), "number": int(m.group(2)), "printed": printed,
                      "from": "longTitle sidenote"}
    approved = text_of(get(NS + "approvedDate"))
    dc_date = text_of(get(DC + "date"))
    enacted = approved if approved and re.fullmatch(r"\d{4}-\d{2}-\d{2}", approved) else (
        dc_date if dc_date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", dc_date) else None)
    session = text_of(get(NS + "session"))
    chapter_printed = None
    preface = el.find(NS + "preface")
    if preface is not None:
        m = CHAPTER_TEXT.search(" ".join(preface.itertext()))
        if m:
            chapter_printed = m.group(1)
    pages = []
    for p in el.iter(NS + "page"):
        m = re.fullmatch(r"/us/stat/(\d+)/(\d+)", p.get("identifier") or "")
        if m:
            pages.append(int(m.group(2)))
    in_margin, in_quote = set(), set()
    for sn in el.iter(NS + "sidenote"):
        for r in sn.iter(NS + "ref"):
            in_margin.add(id(r))
    for q in el.iter(NS + "quotedContent"):
        for r in q.iter(NS + "ref"):
            in_quote.add(id(r))
    for q in el.iter(NS + "quotedText"):
        for r in q.iter(NS + "ref"):
            in_quote.add(id(r))
    usc_refs = []
    for r in el.iter(NS + "ref"):
        href = r.get("href") or ""
        if href.startswith("/us/usc/") and id(r) not in in_quote:
            usc_refs.append([href, text_of(r), "margin" if id(r) in in_margin else "text"])
    is_chapter = (dtype or "").lower() == "chapter"
    chapter = chapter_number(doc_number) if is_chapter else (
        chapter_number(chapter_printed) if chapter_printed else None)
    vol_m = re.fullmatch(r"STATUTE-(\d+)\.xml", file_name)
    return {
        "source": source,
        "file": file_name,
        "volume": int(vol_m.group(1)) if vol_m else (stat["volume"] if stat else None),
        "url": file_url,
        "doc_tag": el.tag.replace(NS, ""),
        "type": dtype,
        "public_private": text_of(get(NS + "publicPrivate")),
        "congress": congress_n,
        "session": int(session) if session and session.isdigit() else None,
        "doc_number": doc_number,
        "chapter": chapter,
        "chapter_from": ("docNumber" if is_chapter else "preface") if chapter is not None else None,
        "public_law": pl,
        "stat": stat,
        "first_page": min(pages) if pages else None,
        "last_page": max(pages) if pages else None,
        "enacted": enacted,
        "title": text_of(get(DC + "title")),
        "bill": bill,
        "usc_refs": usc_refs,
    }


def parse_stream(stream, source, file_url, file_name, out):
    n = 0
    depth_docs = 0
    for ev, el in ET.iterparse(stream, events=("start", "end")):
        tag = el.tag.replace(NS, "")
        if ev == "start":
            if tag in DOCS:
                depth_docs += 1
            continue
        if tag in DOCS:
            depth_docs -= 1
            if depth_docs == 0:
                out.write(json.dumps(law_record(el, source, file_url, file_name), ensure_ascii=False) + "\n")
                n += 1
                el.clear()
        elif tag == "component" and depth_docs == 0:
            el.clear()
    return n


def parse_statute(volumes):
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted((fetchlib.ACQ / "statute").glob("STATUTE-*.xml.gz"), key=lambda p: int(p.name.split("-")[1].split(".")[0]))
    total = 0
    with gzip.open(OUT / "statute.jsonl.gz", "wt", encoding="utf-8") as out:
        for path in files:
            vol = int(path.name.split("-")[1].split(".")[0])
            if volumes and vol not in volumes:
                continue
            url = f"https://www.govinfo.gov/bulkdata/STATUTE/{vol}/STATUTE-{vol}.xml"
            with gzip.open(path, "rb") as fh:
                n = parse_stream(fh, "statute", url, f"STATUTE-{vol}.xml", out)
            total += n
            print(json.dumps({"volume": vol, "documents": n}), flush=True)
    return total


def parse_plaw():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    with gzip.open(OUT / "plaw.jsonl.gz", "wt", encoding="utf-8") as out:
        for path in sorted((fetchlib.ACQ / "plaw").glob("PLAW-*-public.zip")):
            congress = int(path.name.split("-")[1])
            z = zipfile.ZipFile(path)
            n = 0
            for name in sorted(z.namelist()):
                if not name.endswith(".xml"):
                    continue
                url = f"https://www.govinfo.gov/bulkdata/PLAW/{congress}/public/{name.rsplit('/', 1)[-1]}"
                with z.open(name) as fh:
                    n += parse_stream(fh, "plaw", url, name.rsplit("/", 1)[-1], out)
            total += n
            print(json.dumps({"congress": congress, "documents": n}), flush=True)
    return total


def parse_range(text):
    out = set()
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def read_laws(name):
    with gzip.open(OUT / name, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--volumes")
    ap.add_argument("--plaw", action="store_true")
    ap.add_argument("--statute", action="store_true")
    args = ap.parse_args()
    if args.statute or not args.plaw:
        print(json.dumps({"statute_documents": parse_statute(parse_range(args.volumes) if args.volumes else None)}))
    if args.plaw:
        print(json.dumps({"plaw_documents": parse_plaw()}))
