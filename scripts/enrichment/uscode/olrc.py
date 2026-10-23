"""Parsers for the Office of the Law Revision Counsel download pages (uscode.house.gov).

- download.html: the current release point ("All files are current through Public Law 119-124 (October 15, 2026)"),
  the per-title rows (title label, positive-law mark, "Current Through" release point, changed-title flag, XML zip href).
- priorreleasepoints.html: one line per prior release point
  ("Public Law 119-121 (October 9, 2026), affecting title 15." / "... 119-102not101 (July 12, 2026), except 119-101, ...").
Only what the pages print is recorded; nothing is inferred beyond the release-point id grammar documented by OLRC
(<congress>-<law>[not<law>...]).
"""
import datetime
import html
import re

BASE = "https://uscode.house.gov/"
RP_ID = re.compile(r"^(\d{2,3})-(\d{1,4})((?:not\d{1,4})*)$")
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
     "December"], 1)}


def parse_rp_id(rp):
    """'119-102not101' -> {'congress': 119, 'through_law': 102, 'except_laws': [101]}; None when malformed."""
    m = RP_ID.match(rp or "")
    if not m:
        return None
    return {"congress": int(m.group(1)), "through_law": int(m.group(2)),
            "except_laws": [int(x) for x in re.findall(r"not(\d+)", m.group(3))]}


def parse_us_date(text):
    """'October 15, 2026' -> '2026-10-15' (None when not a full date)."""
    m = re.fullmatch(r"\s*([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s*", text or "")
    if not m or m.group(1) not in MONTHS:
        return None
    return datetime.date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))).isoformat()


def _text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ")


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def title_file_key(href):
    """'.../xml_usc05a@119-124.zip' -> '05a'."""
    m = re.search(r"xml_usc([0-9]{2}a?)@", href)
    return m.group(1) if m else None


def parse_current(page):
    """The current release point from download.html."""
    m = re.search(r'class="releasepointinformation">\s*Public Law\s+([0-9a-z-]+)\s*<', page)
    if not m:
        raise ValueError("release point heading not found")
    rp = m.group(1)
    desc = _norm(_text(page))
    d = re.search(r"current through Public Law\s+" + re.escape(rp) + r"\s+\(([A-Za-z]+ \d{1,2}, \d{4})\)", desc)
    titles = parse_title_rows(page, rp)
    return {"id": rp, "law_date": parse_us_date(d.group(1)) if d else None,
            "law_date_text": d.group(1) if d else None, "titles": titles,
            "all_xml_href": _abs(re.search(r'href="([^"]*xml_uscAll@[^"]+\.zip)"', page).group(1))}


def _abs(href, base=BASE):
    if href.startswith("http"):
        return href
    return base + href.lstrip("/")


def parse_title_rows(page, rp, base=BASE):
    """Per-title rows: [{'key','number','label','positive_law','changed','current_through','xml_url'}]."""
    rows = []
    for block in re.findall(r'<div class="uscitem">(.*?)</div>\s*</div>', page, flags=re.S):
        lab = re.search(r'<div class="(usctitle(?:appendix)?(?:changed)?)"[^>]*>(.*?)</div>', block, flags=re.S)
        href = re.search(r'href="([^"]*xml_usc[0-9]{2}a?@[^"]+\.zip)"', block)
        if not lab or not href:
            continue
        key = title_file_key(href.group(1))
        raw_label = lab.group(2)
        positive = "&#1645;" in raw_label or "٭" in raw_label
        label = _norm(_text(re.sub(r'<span class="footnote">.*?</span>', "", raw_label, flags=re.S)))
        if key and key.endswith("a") and label == "Appendix":
            label = f"{key[:-1].lstrip('0')} - Appendix"
        cur = re.search(r'<div class="itemcurrency">(.*?)</div>', block, flags=re.S)
        rows.append({
            "key": key,
            "number": key.lstrip("0") if key else None,
            "label": label,
            "positive_law": positive,
            "changed": lab.group(1).endswith("changed"),
            "current_through": _norm(_text(cur.group(1))) if cur else None,
            "xml_url": _abs(href.group(1), base),
        })
    return rows


PRIOR_LINE = re.compile(
    r"Public Law\s+(?P<rp>\d{2,3}-\d{1,4}(?:not\d{1,4})*)\s+\((?P<date>[A-Za-z]+ \d{1,2}, \d{4})\)"
    r"(?P<except>,\s*except\s+[0-9, and-]+?)?,\s*affecting\s+titles?\s+(?P<titles>[0-9A-Za-z ,and]+?)\.")


def parse_prior(page):
    """Prior release points in page order: [{'id','law_date','law_date_text','titles_affected':[...],'except_text'}]."""
    text = _norm(_text(page))
    out = []
    for m in PRIOR_LINE.finditer(text):
        titles = [t for t in re.split(r"[,\s]+(?:and\s+)?", m.group("titles").strip()) if t and t != "and"]
        hrefs = re.findall(r'href="(download/' + re.escape(m.group("rp")) + r'\.html)"', page)
        out.append({
            "id": m.group("rp"),
            "law_date": parse_us_date(m.group("date")),
            "law_date_text": m.group("date"),
            "titles_affected": titles,
            "except_text": _norm(m.group("except").lstrip(",")) if m.group("except") else None,
            "page_url": _abs(hrefs[0]) if hrefs else None,
        })
    return out


def release_dir_url(rp):
    """Directory of a release point's files: releasepoints/us/pl/<congress>/<law[notN]>/."""
    c, rest = rp.split("-", 1)
    return f"{BASE}download/releasepoints/us/pl/{c}/{rest}/"


def title_zip_url(rp, key):
    return f"{release_dir_url(rp)}xml_usc{key}@{rp}.zip"


def section_url(rp, title_key, section_num):
    """Official per-section page at a release point, e.g. https://uscode.house.gov/us/usc/119-124/t42/s1983/."""
    return f"{BASE}us/usc/{rp}/t{title_key}/s{section_num}/"


def laws_between(prev_rp, rp):
    """Public law numbers a release point adds after the previous one, from the two ids alone.

    Returns (congress, [law numbers]) or None when the congresses differ or an id is malformed. A release point
    'C-NnotX' covers C-1..C-N except X; the next one covers the excepted laws it no longer excludes."""
    a, b = parse_rp_id(prev_rp), parse_rp_id(rp)
    if not a or not b or a["congress"] != b["congress"]:
        return None
    before = set(range(1, a["through_law"] + 1)) - set(a["except_laws"])
    after = set(range(1, b["through_law"] + 1)) - set(b["except_laws"])
    return b["congress"], sorted(after - before)
