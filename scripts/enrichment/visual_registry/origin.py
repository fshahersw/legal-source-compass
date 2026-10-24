"""Facts read at origins: Wikidata entities and FJC pages (identity, used by the builds), and Commons file pages and
Library of Congress items (licences; used only by compare_origin.py, an informational comparison of responses cached
before the owner decision of 2026-10-24 that dropped the licence check).

Commons licences are decided by court_images/licenses.py (licence_family, file_facts), the same rules the existing
court_images rows were built with; the ARTWORK title rule and the scaled-rendition check come from
court_images/build_court_images.py.
"""
import csv
import gzip
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "court_images"))
sys.path.insert(0, str(HERE.parent))
from build_court_images import ARTWORK, scaled  # noqa: E402
from licenses import file_facts, load_responses, plain, resolve, thumb_facts  # noqa: E402

LICENCE_LABEL = {"public domain": "Public domain", "cc0": "CC0", "cc by": "CC BY", "cc by-sa": "CC BY-SA"}
HIGHSMITH_STATEMENT = "482_high.html"
HIGHSMITH_CONTRIBUTOR = re.compile(r"^Highsmith, Carol M\.(,|$)")
HIGHSMITH_CREDIT = "Library of Congress, Prints & Photographs Division, photograph by Carol M. Highsmith"
# Public-domain basis from the file's hidden licence categories; first match wins. Unknown -> as stated on the page.
PD_BASIS = [
    (re.compile(r"(?i)^PD[ -]US[ -]?Gov|^PD US Government|^PD US (Courts|Congress|Federal)|^PD-USGov"),
     "U.S. government work"),
    (re.compile(r"(?i)^PD (US )?(state|states)|^PD-US-state|^PD US (state|county|municipal)"),
     "government work released into the public domain"),
    (re.compile(r"(?i)^PD[ -]self|^Self-published work released into the public domain|released into the public domain by the copyright holder"),
     "released into the public domain by its author"),
    (re.compile(r"(?i)^PD[ -]old|^PD[ -]US[ -]expired|^PD[ -]US[ -]no[ -]notice|^PD[ -]US[ -](not[ -]renewed|1923|1927|1928|1929)|^PD-1923|expired"),
     "copyright expired or not renewed"),
    (re.compile(r"(?i)^PD[ -]textlogo|^PD-text|^PD[ -]shape|^PD[ -]simple|^Public domain text logos|threshold of originality"),
     "below the threshold of originality (simple text or shapes)"),
]
KINDS = ("building", "portrait", "logo")
STD = (330, 500, 960)


# ---------------------------------------------------------------- Commons

class Commons:
    """Stored Commons responses: display/thumb/mid passes (court_images readers) and the categories pass."""

    def __init__(self, cache_root):
        manifest = Path(cache_root) / "commons" / "_manifest.jsonl"
        latest = {}
        for line in open(manifest):
            e = json.loads(line)
            if e["status"] == 200:
                latest[e["path"]] = e
        self.entries = list(latest.values())
        self.retrieved = {}
        paths = {p: [e["path"] for e in self.entries if e["pass"] == p] for p in ("display", "thumb", "mid", "cats")}
        self.display = load_responses(paths["display"])
        self.thumb = load_responses(paths["thumb"])
        self.mid = load_responses(paths["mid"])
        self.categories = {}
        cat_alias = {}
        for path in paths["cats"]:
            data = json.loads(gzip.open(path).read())
            q = data.get("query") or {}
            for n in (q.get("normalized") or []) + (q.get("redirects") or []):
                cat_alias[n["from"]] = n["to"]
            for page in q.get("pages") or []:
                self.categories.setdefault(page["title"], []).extend(
                    c["title"].removeprefix("Category:") for c in page.get("categories") or [])
        self.cat_alias = cat_alias
        for e in self.entries:
            if e["pass"] == "display":
                data = json.loads(gzip.open(e["path"]).read())
                for page in (data.get("query") or {}).get("pages") or []:
                    self.retrieved[page["title"]] = e["retrieved_at"]

    def page(self, title):
        return resolve(title, *self.display)

    def cats(self, title):
        seen = set()
        while title in self.cat_alias and title not in seen:
            seen.add(title)
            title = self.cat_alias[title]
        return self.categories.get(title, [])


def pd_basis(categories):
    for cat in categories:
        for pattern, label in PD_BASIS:
            if pattern.search(cat):
                return label
    return None


def rendition_plan(width, mime, kind):
    """(display_width, thumb_width) or (None, reason) from the original's width and type."""
    vector = mime == "image/svg+xml"
    w = width or 0
    if kind == "building":
        if w > 960:
            return (960, 330), None
        if w > 500:
            return (500, 330), None
        return None, "original 500 px wide or less (no standard display rendition)"
    if vector:
        return (500, 330), None
    if w > 500:
        return (500, 330), None
    if w > 330:
        return (330, 330), None
    return None, "original 330 px wide or less (too small for a standard rendition)"


def commons_photo(commons, title, kind):
    """(photo facts, None) or (None, reason): licence and renditions read from the file's own Commons page."""
    page = commons.page(title)
    facts = file_facts(page)
    if not facts:
        return None, "file missing or unreadable at origin"
    if not facts["family"]:
        return None, facts["exclusion"]
    if kind != "logo" and ARTWORK.search(facts["title"]):
        return None, "photograph of an artwork (title names a sculpture, statue, mural, relief or fresco)"
    plan, why = rendition_plan(facts["width"], facts["mime"], kind)
    if not plan:
        return None, why
    display_width, thumb_width = plan
    sets = {960: commons.display, 500: commons.mid, 330: commons.thumb}
    if display_width == 960:
        disp = {"thumb_url": facts["display_url"], "thumb_width": facts["display_width"],
                "thumb_height": facts["display_height"]}
    else:
        disp = thumb_facts(resolve(title, *sets[display_width])) or {}
    thumb = thumb_facts(resolve(title, *sets[thumb_width])) or {}
    if not (disp.get("thumb_url") and scaled(disp["thumb_url"], display_width) and disp.get("thumb_width")
            == display_width and disp.get("thumb_height")):
        return None, f"no scaled {display_width} px rendition returned"
    if not (thumb.get("thumb_url") and scaled(thumb["thumb_url"], thumb_width) and thumb.get("thumb_width")
            == thumb_width and thumb.get("thumb_height")):
        return None, f"no scaled {thumb_width} px rendition returned"
    author = facts["artist"] or None
    family = facts["family"]
    if family in ("cc by", "cc by-sa") and not (author or facts["credit"]):
        return None, "licence requires attribution but the file page names no author or credit"
    deed = facts["license_url"] if re.match(r"^https://creativecommons\.org/", facts["license_url"] or "") else None
    if family in ("cc by", "cc by-sa", "cc0") and not deed:
        return None, "licence deed link missing or not a creativecommons.org deed"
    licence = facts["license"] or LICENCE_LABEL[family]
    basis = pd_basis(commons.cats(title)) if family == "public domain" else None
    if family == "public domain":
        credit = f"Public domain ({basis})" if basis else "Public domain (as stated on the file page)"
    elif family == "cc0":
        credit = f"{author + ' · ' if author else ''}CC0 1.0 (public domain dedication)"
    else:
        credit = f"{author or facts['credit']} · {licence}"
    return {
        "file": facts["title"],
        "file_page": facts["description_url"],
        "display": {"url": disp["thumb_url"], "width": disp["thumb_width"], "height": disp["thumb_height"]},
        "thumb": {"url": thumb["thumb_url"], "width": thumb["thumb_width"], "height": thumb["thumb_height"]},
        "original": {"width": facts["width"], "height": facts["height"], "mime": facts["mime"]},
        "license": licence,
        "license_family": family,
        "license_code": facts["license_code"],
        "license_url": deed or (facts["description_url"] + "#Licensing"),
        "license_url_is_deed": bool(deed),
        "author": author,
        "credit": credit,
        "pd_basis": basis,
        "restrictions": facts["restrictions"] or None,
        "date_original": facts["date_original"] or None,
        "object_name": facts["object_name"] or None,
        "sha1": facts["sha1"],
        "verified_at": commons.retrieved.get(facts["title"]) or commons.retrieved.get(title),
        "origin": "commons",
    }, None


# ---------------------------------------------------------------- Library of Congress

def loc_statements(csv_path):
    """{statement id: plain text of its intro/access/publication paragraphs} from the P&P rights statements CSV."""
    out = {}
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:  # one stray non-UTF-8 byte
        for row in csv.DictReader(f):
            out[row["id"]] = " ".join(plain(row.get(k) or "") for k in ("intro", "access", "publication"))
    return out


def loc_rights(item, statements):
    """('highsmith' | 'statement:<id>', None) when the item's own record establishes public domain; else (None, why).

    Highsmith: the item names Carol M. Highsmith as photographer AND its rights field links the 482_high statement.
    Other items: only when the P&P statement the rights field links says the photographs are in the public domain.
    """
    rights = " ".join(item.get("rights") or [])
    linked = re.findall(r'href="https?://(?:www\.)?loc\.gov/rr/print/res/([0-9a-z_]+\.html)"', rights)
    contributors = item.get("contributor_names") or []
    if HIGHSMITH_STATEMENT in linked:
        if any(HIGHSMITH_CONTRIBUTOR.match(c) and c.endswith("photographer") for c in contributors):
            if "in the public domain" in statements.get(HIGHSMITH_STATEMENT, ""):
                return "highsmith", None
            return None, "Highsmith statement text not found in the rights statements file"
        return None, "rights link the Highsmith statement but the item does not name her as photographer"
    for sid in linked:
        text = statements.get(sid, "")
        if re.search(r"(?i)\bare in the public domain\b", text) and not re.search(r"(?i)\bmay be\b", text):
            return f"statement:{sid}", None
    advisory = item.get("rights_advisory") or "none"
    return None, f"no public-domain statement linked by the item (rights advisory: {advisory})"


def loc_iiif_base(item):
    """(IIIF service base, master width, master height) from the item's resources (the jp2 info URL)."""
    for res in item.get("resources") or []:
        for files in res.get("files") or []:
            for f in files:
                info = f.get("info") or ""
                if info.startswith("https://tile.loc.gov/image-services/iiif/") and info.endswith("/info.json"):
                    return info[: -len("/info.json")], f.get("width"), f.get("height")
    return None, None, None


def loc_photo(item_json, statements, measured, kind="building"):
    """(photo facts, None, urls_to_measure) or (None, reason, urls_to_measure)."""
    item = item_json.get("item") or {}
    basis, why = loc_rights(item, statements)
    if not basis:
        return None, why, []
    title = item.get("title") or ""
    if ARTWORK.search(title):
        return None, "photograph of an artwork (title names a sculpture, statue, mural, relief or fresco)", []
    base, width, height = loc_iiif_base(item)
    if not base or not width:
        return None, "no IIIF image service for the item", []
    if width <= 960:
        return None, "master 960 px wide or less", []
    urls = {"display": f"{base}/full/960,/0/default.jpg", "thumb": f"{base}/full/330,/0/default.jpg"}
    sizes = {}
    pending = []
    for name, url in urls.items():
        m = measured.get(url)
        if not m:
            pending.append(url)
            continue
        if m.get("status") != 200 or not m.get("width"):
            return None, f"IIIF {name} rendition did not return an image (HTTP {m.get('status')})", []
        want = 960 if name == "display" else 330
        if m["width"] != want:
            return None, f"IIIF {name} rendition is {m['width']} px wide, not {want}", []
        sizes[name] = (m["width"], m["height"])
    if pending:
        return None, "IIIF rendition size not measured yet", pending
    repro = (item.get("reproduction_number") or "").split(" (")[0].strip()
    page = (item.get("url") or "").replace("http://", "https://")
    is_highsmith = basis == "highsmith"
    statement_url = "https://www.loc.gov/rr/print/res/482_high.html" if is_highsmith else (
        "https://www.loc.gov/rr/print/res/" + basis.split(":", 1)[1])
    credit = f"{HIGHSMITH_CREDIT} [{repro}]" if is_highsmith and repro else (
        HIGHSMITH_CREDIT if is_highsmith else "Library of Congress, Prints & Photographs Division")
    return {
        "file": f"loc:{item.get('id', '').rstrip('/').split('/')[-1]}",
        "file_page": page,
        "title": title,
        "display": {"url": urls["display"], "width": sizes["display"][0], "height": sizes["display"][1]},
        "thumb": {"url": urls["thumb"], "width": sizes["thumb"][0], "height": sizes["thumb"][1]},
        "original": {"width": width, "height": height, "mime": "image/jp2"},
        "license": "Public domain",
        "license_family": "public domain",
        "license_code": "loc-highsmith" if is_highsmith else basis,
        "license_url": statement_url,
        "license_url_is_deed": False,
        "author": "Carol M. Highsmith" if is_highsmith else None,
        "credit": credit,
        "pd_basis": ("Carol M. Highsmith's photographs are in the public domain (Library of Congress rights "
                     "statement)") if is_highsmith else "Library of Congress rights statement",
        "reproduction_number": repro or None,
        "photo_date": "; ".join(item.get("created_published") or []) or None,
        "restrictions": ("Photographs of sculpture or other works of art may be restricted by the copyright of the "
                         "artist.") if is_highsmith else None,
        "verified_at": None,
        "origin": "loc",
    }, None, []


# ---------------------------------------------------------------- Wikidata

def wikidata_entity(body, qid):
    data = json.loads(body)
    ents = data.get("entities") or {}
    if qid in ents:
        return ents[qid]
    if len(ents) == 1:  # redirected (merged) item: the response names the target entity
        return next(iter(ents.values()))
    return None


def claims(entity, prop):
    """[(statement id, rank, value, start, end)] for a property, deprecated statements excluded."""
    out = []
    for st in (entity or {}).get("claims", {}).get(prop) or []:
        if st.get("rank") == "deprecated":
            continue
        snak = st.get("mainsnak") or {}
        if snak.get("snaktype") != "value":
            continue
        value = (snak.get("datavalue") or {}).get("value")
        q = st.get("qualifiers") or {}

        def qtime(p):
            for s in q.get(p) or []:
                v = (s.get("datavalue") or {}).get("value")
                if isinstance(v, dict) and v.get("time"):
                    return v["time"]
                if s.get("snaktype") == "somevalue":
                    return "somevalue"
            return None

        out.append((st.get("id"), st.get("rank"), value, qtime("P580"), qtime("P582")))
    return out


def file_key(name):
    """Commons file name compared as MediaWiki does: no 'File:' prefix, underscores as spaces, first letter upper."""
    n = (name or "").removeprefix("File:").replace("_", " ").strip()
    return n[:1].upper() + n[1:]


def judge_identity(entity, slug, file_title):
    """None when the entity's P2736 includes the FJC slug and its P18 includes this file; else the reason."""
    if not entity:
        return "Wikidata entity not readable"
    slugs = {v for _, _, v, _, _ in claims(entity, "P2736")}
    if slug not in slugs:
        return "Wikidata entity's FJC id (P2736) does not include the registry FJC id"
    if len(slugs) > 1:
        return "Wikidata entity has more than one FJC id (P2736)"
    images = {file_key(v) for _, _, v, _, _ in claims(entity, "P18")}
    if file_key(file_title) not in images:
        return "file is not the entity's image (P18) at Wikidata now"
    return None


def normalise_cik(value):
    s = str(value or "").strip()
    return s.zfill(10) if re.fullmatch(r"\d{1,10}", s) else None


def company_logo(entity, cik):
    """(statement dict, None) for the entity's P154 logo (preferred, or the sole normal-rank statement); else reason."""
    if not entity:
        return None, "Wikidata entity not readable"
    ciks = {normalise_cik(v) for _, _, v, _, _ in claims(entity, "P5531")}
    ciks.discard(None)
    if cik not in ciks:
        return None, "Wikidata entity's CIK (P5531) does not include the registry CIK"
    if len(ciks) > 1:
        return None, "Wikidata entity has more than one CIK (P5531)"
    logos = claims(entity, "P154")
    preferred = [s for s in logos if s[1] == "preferred"]
    normal = [s for s in logos if s[1] == "normal"]
    if len(preferred) == 1:
        chosen = preferred[0]
    elif len(preferred) > 1:
        return None, "more than one preferred logo (P154) statement"
    elif len(normal) == 1:
        chosen = normal[0]
    elif not logos:
        return None, "no logo (P154) statement"
    else:
        return None, "several normal-rank logo (P154) statements and none preferred"
    sid, rank, value, start, end = chosen
    if end:
        return None, "the chosen logo statement has an end time (P582)"
    return {"statement_id": sid, "rank": rank, "file": "File:" + file_key(value), "start": start}, None


# ---------------------------------------------------------------- FJC

def fjc_nid(page_html):
    """The page's own node id from its shortlink / canonical node link; None unless exactly one id is stated."""
    text = page_html.decode("utf-8", "replace") if isinstance(page_html, bytes) else page_html
    found = set(re.findall(r'<link[^>]+rel="shortlink"[^>]+href="https://www\.fjc\.gov/node/(\d+)"', text))
    found |= set(re.findall(r'<link[^>]+href="https://www\.fjc\.gov/node/(\d+)"[^>]+rel="shortlink"', text))
    return next(iter(found)) if len(found) == 1 else None


def fjc_page_name(page_html):
    text = page_html.decode("utf-8", "replace") if isinstance(page_html, bytes) else page_html
    m = re.search(r"<title>([^<]+)</title>", text)
    return html.unescape(m.group(1)).split("|")[0].strip() if m else None
