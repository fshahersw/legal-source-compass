"""Deterministic extractors for enforcement texts (DOJ press releases, SEC litigation releases, settlement pages).

Every extracted value is a verbatim span of the text it came from (`as_written`), with its character offset, so it
can be re-checked against the source. Nothing is inferred: an amount is a dollar figure as written, its `kind` is
only the first keyword found in the same sentence (labelled as such), a court id is attached only when the court
name maps exactly to one court in the fixed table below, and a party name is the title's grammatical subject as
written. Values that cannot be read exactly are left out.
"""
import html
import re

# ------------------------------------------------------------------ text

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")
_BLOCK = re.compile(r"</(?:p|div|h[1-6]|li|tr|table|blockquote|ul|ol)>|<br\s*/?>", re.I)


def html_to_text(fragment):
    """HTML -> plain text with one line per block; entities decoded; no markup survives."""
    if not fragment:
        return ""
    text = re.sub(r"<!--.*?-->", " ", fragment, flags=re.S)
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<!--|-->", " ", text)
    text = _BLOCK.sub("\n", text)
    text = _TAG.sub(" ", text)
    text = html.unescape(text).replace("\xa0", " ").replace("\u200b", "")
    lines = [_WS.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


# ------------------------------------------------------------------ sentences

_ABBREV = {
    "u.s", "inc", "corp", "co", "ltd", "no", "nos", "mr", "mrs", "ms", "dr", "jr", "sr", "st", "v", "vs", "gen", "atty",
    "sen", "rep", "gov", "lt", "sgt", "capt", "col", "maj", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep",
    "sept", "oct", "nov", "dec", "a.m", "p.m", "l.l.c", "llc", "n.a", "s.a", "u.s.c", "c.f.r", "d.c", "ave", "blvd",
    "fla", "cal", "calif", "tex", "ill", "pa", "va", "mass", "mich", "minn", "wis", "wash", "ariz", "colo", "conn",
    "del", "ga", "ky", "la", "md", "mo", "mont", "neb", "nev", "okla", "or", "tenn", "dist", "ct", "cir", "e.g", "i.e",
    "etc", "approx", "dept", "est", "fig", "jud", "u.s.a", "n.y", "n.j", "s.d", "n.d", "e.d", "w.d", "m.d", "c.d",
    "sec", "secs", "par", "para", "ch", "art", "supp", "f", "op", "jd", "esq", "hon", "prof", "rev", "messrs", "pp",
}
_BOUNDARY = re.compile(r"[.!?][\"”’)\]]*\s+(?=[\"“(\[]?[A-Z0-9])")


def sentence_spans(text):
    """[(start, end)] sentence spans; newlines always end a sentence; common abbreviations never do."""
    spans = []
    for line in re.finditer(r"[^\n]+", text):
        seg, base = line.group(0), line.start()
        start = 0
        for m in _BOUNDARY.finditer(seg):
            before = seg[start:m.start() + 1]
            token = re.search(r"([A-Za-z.]+)\.$", before)
            word = token.group(1).lower().rstrip(".") if token else ""
            if word in _ABBREV or re.fullmatch(r"[a-z]", word or "x") or re.fullmatch(r"(?:[a-z]\.)+[a-z]", word):
                continue
            spans.append((base + start, base + m.start() + 1 + len(m.group(0)[1:].rstrip())))
            start = m.end()
        spans.append((base + start, base + len(seg)))
    return [(a, b) for a, b in spans if b > a]


def sentence_at(text, pos, spans=None, limit=400):
    """The sentence containing offset pos (trimmed to `limit` chars around pos when long)."""
    for a, b in spans or sentence_spans(text):
        if a <= pos < b:
            s = text[a:b].strip()
            if len(s) <= limit:
                return s
            # a window around pos, cut at word boundaries (still a verbatim span of the text)
            rel = pos - a
            lo = max(0, rel - limit // 2)
            hi = min(b - a, lo + limit)
            window = text[a + lo:a + hi]
            if lo > 0 and " " in window[:40]:
                window = window[window.index(" ") + 1:]
            if a + hi < b and " " in window[-40:]:
                window = window[:window.rindex(" ")]
            return window.strip()
    return None


# ------------------------------------------------------------------ dollar amounts

_MULT = {"thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}
_AMOUNT = re.compile(
    r"\$\s?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s?(?P<mult>thousand|million|billion|trillion)\b)?",
    re.I,
)
_RANGE_AFTER = re.compile(r"^\s?(?:to|-|–|—|and|or)\s?\$\s?[\d.,]+\s?(?:thousand|million|billion|trillion)\b", re.I)
KIND_KEYWORDS = [
    ("statutory maximum", re.compile(r"\bmaximum|\bpunishable|\bfaces? up to|\bcarr(?:y|ies) (?:a|up)|\bup to \$", re.I)),
    ("settlement", re.compile(r"\bsettlements?\b|\bto settle\b|\bsettles\b|\bresolv|\bagree[sd]? to pay", re.I)),
    ("penalty or fine", re.compile(r"\bpenalt|\bfine[ds]?\b", re.I)),
    ("restitution", re.compile(r"\brestitution", re.I)),
    ("forfeiture", re.compile(r"\bforfeit", re.I)),
    ("disgorgement", re.compile(r"\bdisgorge", re.I)),
    ("judgment", re.compile(r"\bjudgment", re.I)),
    ("alleged loss or scheme", re.compile(r"\b(?:loss|defraud|fraud|scheme|brib|kickback|launder|embezzl|stole|stolen|bill|obtain|misappropriat|steal)", re.I)),
]
# proper names that contain a keyword but say nothing about the figure ("Bank for International Settlements")
_NOT_KEYWORDS = re.compile(r"Bank (?:for|of) (?:the )?International Settlements", re.I)
# a resolution figure is a stated settlement/penalty/...; figures of $1 trillion or more are listed but never used as one
RESOLUTION_CAP_USD = 1e12
RESOLUTION_KINDS = {"settlement", "penalty or fine", "restitution", "forfeiture", "disgorgement", "judgment"}


def amount_value(num, mult):
    try:
        value = float(num.replace(",", ""))
    except ValueError:
        return None
    if mult:
        value *= _MULT[mult.lower()]
    return round(value, 2)


def extract_amounts(text, spans=None, limit=None):
    """Dollar figures as written, each with its value in USD, sentence and the first keyword found in the sentence."""
    spans = spans if spans is not None else sentence_spans(text)
    out = []
    for m in _AMOUNT.finditer(text):
        as_written = m.group(0)
        value = amount_value(m.group("num"), m.group("mult"))
        ranged = not m.group("mult") and _RANGE_AFTER.match(text[m.end():m.end() + 40]) is not None
        # "$6,705,000 million": a multiplier on a number of 1,000 or more is ambiguous as written; no value is computed
        ambiguous = bool(m.group("mult")) and float(m.group("num").replace(",", "")) >= 1000
        sentence = sentence_at(text, m.start(), spans)
        kind = None
        if sentence:
            probe = _NOT_KEYWORDS.sub(" ", sentence)
            for name, pattern in KIND_KEYWORDS:
                if pattern.search(probe):
                    kind = name
                    break
        out.append({
            "as_written": as_written,
            "offset": m.start(),
            "value_usd": None if ranged or ambiguous else value,
            "range_start": ranged or None,
            "ambiguous_as_written": ambiguous or None,
            "sentence": sentence,
            "keyword": kind,
        })
        if limit and len(out) >= limit:
            break
    return [{k: v for k, v in a.items() if v is not None} for a in out]


# ------------------------------------------------------------------ statutes

_USC = re.compile(
    r"\b(?P<title>\d{1,2})\s?U\.?\s?S\.?\s?C\.?(?:\s?A\.)?\s?(?:§§?|[Ss]ections?|[Ss]ecs?\.)\s?"
    r"(?P<section>\d+[a-zA-Z]{0,3}(?:-\d+[a-zA-Z]?)?(?:\([0-9A-Za-z]{1,4}\))*)"
)
_USC_LONG = re.compile(
    r"\b[Tt]itle\s(?P<title>\d{1,2}),?\s(?:of\s(?:the\s)?)?United\sStates\sCode,?\s(?:[Ss]ections?|§§?)\s?"
    r"(?P<section>\d+[a-zA-Z]{0,3}(?:-\d+[a-zA-Z]?)?(?:\([0-9A-Za-z]{1,4}\))*)"
)
_CFR = re.compile(r"\b(?P<title>\d{1,2})\s?C\.?\s?F\.?\s?R\.?\s?(?:§§?|[Pp]art|[Ss]ection)?\s?(?P<section>\d+(?:\.\d+[a-z]?)?)")
NAMED_ACTS = [
    "False Claims Act", "Foreign Corrupt Practices Act", "Controlled Substances Act", "Clean Water Act", "Clean Air Act",
    "Sherman Act", "Clayton Act", "Anti-Kickback Statute", "Bank Secrecy Act", "Lacey Act",
    "Resource Conservation and Recovery Act", "Comprehensive Environmental Response, Compensation, and Liability Act",
    "Safe Drinking Water Act", "Oil Pollution Act", "Endangered Species Act", "Migratory Bird Treaty Act",
    "Toxic Substances Control Act", "Federal Insecticide, Fungicide, and Rodenticide Act",
    "Americans with Disabilities Act", "Fair Housing Act", "Equal Credit Opportunity Act", "Voting Rights Act",
    "Civil Rights Act", "Servicemembers Civil Relief Act", "Uniformed Services Employment and Reemployment Rights Act",
    "Fair Labor Standards Act", "Arms Export Control Act", "International Emergency Economic Powers Act",
    "Export Control Reform Act", "Trading with the Enemy Act", "Foreign Agents Registration Act", "Travel Act",
    "Racketeer Influenced and Corrupt Organizations Act", "Hobbs Act", "Mann Act", "Federal Food, Drug, and Cosmetic Act",
    "Food, Drug, and Cosmetic Act", "Financial Institutions Reform, Recovery, and Enforcement Act",
    "Consumer Product Safety Act", "Fair Credit Reporting Act", "Fair Debt Collection Practices Act",
    "Telemarketing Sales Rule", "Telephone Consumer Protection Act", "Children's Online Privacy Protection Act",
    "Federal Trade Commission Act", "Securities Act of 1933", "Securities Exchange Act of 1934",
    "Investment Advisers Act of 1940", "Investment Company Act of 1940", "Commodity Exchange Act",
    "Hart-Scott-Rodino Act", "Stark Law", "Emergency Planning and Community Right-to-Know Act",
    "Hazardous Materials Transportation Act", "Occupational Safety and Health Act", "Internal Revenue Code",
    "Identity Theft Penalty Enhancement Act", "Computer Fraud and Abuse Act", "Economic Espionage Act",
    "Digital Millennium Copyright Act", "Animal Welfare Act", "Archaeological Resources Protection Act",
    "Freedom of Access to Clinic Entrances Act", "Matthew Shepard and James Byrd, Jr. Hate Crimes Prevention Act",
    "Church Arson Prevention Act", "Religious Land Use and Institutionalized Persons Act", "Fair Sentencing Act",
    "First Step Act", "PREP Act", "CARES Act", "Paycheck Protection Program",
]
_ACT_RE = re.compile(r"\b(" + "|".join(re.escape(a) for a in sorted(NAMED_ACTS, key=len, reverse=True)) + r")\b")


def extract_statutes(text, limit=None):
    """U.S.C. / C.F.R. citations and named federal acts, as written, with a normalised cite."""
    found = []
    seen = set()

    def add(item):
        key = item["cite"]
        if key in seen:
            return
        seen.add(key)
        found.append(item)

    for m in _USC.finditer(text):
        add({"as_written": m.group(0), "offset": m.start(), "cite": f"{int(m.group('title'))} U.S.C. § {m.group('section')}", "kind": "U.S.C."})
    for m in _USC_LONG.finditer(text):
        add({"as_written": m.group(0), "offset": m.start(), "cite": f"{int(m.group('title'))} U.S.C. § {m.group('section')}", "kind": "U.S.C."})
    for m in _CFR.finditer(text):
        add({"as_written": m.group(0), "offset": m.start(), "cite": f"{int(m.group('title'))} C.F.R. § {m.group('section')}", "kind": "C.F.R."})
    for m in _ACT_RE.finditer(text):
        add({"as_written": m.group(0), "offset": m.start(), "cite": m.group(0), "kind": "named act"})
    found.sort(key=lambda x: x["offset"])
    return found[:limit] if limit else found


# ------------------------------------------------------------------ docket / case numbers

_DOCKET = re.compile(
    r"(?<![\w-])(?:\d{1,2}:)?\d{2,4}-(?:cr|CR|Cr|cv|CV|Cv|civ|CIV|mj|MJ|Mj|mc|MC|po|PO|bk|BK|ap|AP|md|MD|mdl|MDL|sw|SW)-?\d{2,6}"
    r"(?:-[A-Za-z]{1,5}(?:-[A-Za-z]{1,5})*|-\d{1,3})*(?![\w])"
)
_PREFIXED = re.compile(
    r"\b(?:Case|Docket|Criminal|Civil Action|Civil Case|Civil|Cause|Indictment|Misc\.)\s(?:No|Nos|Number)\.?:?\s?"
    r"(?P<num>(?=[0-9A-Z:\-]*\d)(?=[0-9A-Za-z:\-.]*-)[0-9A-Za-z][0-9A-Za-z:\-.]{3,28}[0-9A-Za-z])"
)
_MDL = re.compile(r"\bMDL\s?(?:No\.\s?)?(?P<num>\d{3,4})\b")
# older SDNY/NDIL-style civil numbers written with spaces: "Civil Action No. 01 C 6574", "No. 98 Civ. 2183"
_SPACED = re.compile(
    r"\b(?:Civil Action|Case|Civ\. Action|Civil)? ?No\.? (?P<num>(?:\d:)?\d{2} (?:C|CV|Civ\.|CIV|Cr\.|CR) ?\d{2,6})(?![\w])"
)


def extract_dockets(text, limit=None):
    """Court case / docket numbers as written (federal 'yy-cr-nnnn' forms and numbers following 'Case No.' etc.)."""
    out, seen = [], set()
    for m in _DOCKET.finditer(text):
        value = m.group(0)
        if value not in seen:
            seen.add(value)
            out.append({"as_written": value, "offset": m.start(), "form": "federal docket"})
    for m in _PREFIXED.finditer(text):
        value = m.group("num").rstrip(".")
        if value not in seen and not any(value in s or s in value for s in seen):
            seen.add(value)
            out.append({"as_written": value, "offset": m.start("num"), "form": "after '" + m.group(0).split()[0] + " No.'"})
    for m in _SPACED.finditer(text):
        value = m.group("num")
        if value not in seen and not any(value in s or s in value for s in seen):
            seen.add(value)
            out.append({"as_written": value, "offset": m.start("num"), "form": "civil number (spaced form)"})
    for m in _MDL.finditer(text):
        value = m.group(0)
        if value not in seen:
            seen.add(value)
            out.append({"as_written": value, "offset": m.start(), "form": "MDL number", "mdl": int(m.group("num"))})
    out.sort(key=lambda d: d["offset"])
    return out[:limit] if limit else out


# ------------------------------------------------------------------ courts

STATES = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co",
    "Connecticut": "ct", "Delaware": "de", "Columbia": "dc", "Florida": "fl", "Georgia": "ga", "Hawaii": "hi",
    "Idaho": "id", "Illinois": "il", "Indiana": "in", "Iowa": "ia", "Kansas": "ks", "Kentucky": "ky",
    "Louisiana": "la", "Maine": "me", "Maryland": "md", "Massachusetts": "ma", "Michigan": "mi", "Minnesota": "mn",
    "Mississippi": "ms", "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv", "New Hampshire": "nh",
    "New Jersey": "nj", "New Mexico": "nm", "New York": "ny", "North Carolina": "nc", "North Dakota": "nd",
    "Ohio": "oh", "Oklahoma": "ok", "Oregon": "or", "Pennsylvania": "pa", "Rhode Island": "ri",
    "South Carolina": "sc", "South Dakota": "sd", "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt",
    "Virginia": "va", "Washington": "wa", "West Virginia": "wv", "Wisconsin": "wi", "Wyoming": "wy",
    "Puerto Rico": "pr", "Guam": "gu", "the Virgin Islands": "vi", "Virgin Islands": "vi",
    "the Northern Mariana Islands": "nmi", "Northern Mariana Islands": "nmi",
}
# The 94 current U.S. district courts: (state code, division letter or "") -> court_spine id.
DISTRICTS = {
    ("al", "n"): "alnd", ("al", "m"): "almd", ("al", "s"): "alsd", ("ak", ""): "akd", ("az", ""): "azd",
    ("ar", "e"): "ared", ("ar", "w"): "arwd", ("ca", "n"): "cand", ("ca", "e"): "caed", ("ca", "c"): "cacd",
    ("ca", "s"): "casd", ("co", ""): "cod", ("ct", ""): "ctd", ("de", ""): "ded", ("dc", ""): "dcd",
    ("fl", "n"): "flnd", ("fl", "m"): "flmd", ("fl", "s"): "flsd", ("ga", "n"): "gand", ("ga", "m"): "gamd",
    ("ga", "s"): "gasd", ("hi", ""): "hid", ("id", ""): "idd", ("il", "n"): "ilnd", ("il", "c"): "ilcd",
    ("il", "s"): "ilsd", ("in", "n"): "innd", ("in", "s"): "insd", ("ia", "n"): "iand", ("ia", "s"): "iasd",
    ("ks", ""): "ksd", ("ky", "e"): "kyed", ("ky", "w"): "kywd", ("la", "e"): "laed", ("la", "m"): "lamd",
    ("la", "w"): "lawd", ("me", ""): "med", ("md", ""): "mdd", ("ma", ""): "mad", ("mi", "e"): "mied",
    ("mi", "w"): "miwd", ("mn", ""): "mnd", ("ms", "n"): "msnd", ("ms", "s"): "mssd", ("mo", "e"): "moed",
    ("mo", "w"): "mowd", ("mt", ""): "mtd", ("ne", ""): "ned", ("nv", ""): "nvd", ("nh", ""): "nhd",
    ("nj", ""): "njd", ("nm", ""): "nmd", ("ny", "n"): "nynd", ("ny", "s"): "nysd", ("ny", "e"): "nyed",
    ("ny", "w"): "nywd", ("nc", "e"): "nced", ("nc", "m"): "ncmd", ("nc", "w"): "ncwd", ("nd", ""): "ndd",
    ("oh", "n"): "ohnd", ("oh", "s"): "ohsd", ("ok", "n"): "oknd", ("ok", "e"): "oked", ("ok", "w"): "okwd",
    ("or", ""): "ord", ("pa", "e"): "paed", ("pa", "m"): "pamd", ("pa", "w"): "pawd", ("ri", ""): "rid",
    ("sc", ""): "scd", ("sd", ""): "sdd", ("tn", "e"): "tned", ("tn", "m"): "tnmd", ("tn", "w"): "tnwd",
    ("tx", "n"): "txnd", ("tx", "e"): "txed", ("tx", "s"): "txsd", ("tx", "w"): "txwd", ("ut", ""): "utd",
    ("vt", ""): "vtd", ("va", "e"): "vaed", ("va", "w"): "vawd", ("wa", "e"): "waed", ("wa", "w"): "wawd",
    ("wv", "n"): "wvnd", ("wv", "s"): "wvsd", ("wi", "e"): "wied", ("wi", "w"): "wiwd", ("wy", ""): "wyd",
    ("pr", ""): "prd", ("gu", ""): "gud", ("vi", ""): "vid", ("nmi", ""): "nmid",
}
CIRCUITS = {
    "First": "ca1", "Second": "ca2", "Third": "ca3", "Fourth": "ca4", "Fifth": "ca5", "Sixth": "ca6",
    "Seventh": "ca7", "Eighth": "ca8", "Ninth": "ca9", "Tenth": "ca10", "Eleventh": "ca11",
    "District of Columbia": "cadc", "D.C.": "cadc", "Federal": "cafc",
}
DIVISION = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}
_STATE_ALT = "|".join(re.escape(s) for s in sorted(STATES, key=len, reverse=True))
_DISTRICT_COURT = re.compile(
    r"\b(?:U\.\s?S\.|United States|[Ff]ederal)\s(?:[Dd]istrict\s[Cc]ourt)\s(?:for|in|of)\sthe\s"
    r"(?:(?P<div>Northern|Southern|Eastern|Western|Middle|Central)\s)?District\sof\s(?P<state>" + _STATE_ALT + r")\b"
)
_APPEALS = re.compile(
    r"\b(?:U\.\s?S\.|United States)\sCourt\sof\sAppeals\sfor\sthe\s(?P<cir>First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|District of Columbia|D\.C\.|Federal)\sCircuit\b"
)
_SPECIAL = [
    (re.compile(r"\b(?:U\.\s?S\.|United States)\sCourt\sof\sFederal\sClaims\b"), "uscfc"),
    (re.compile(r"\b(?:U\.\s?S\.|United States)\sCourt\sof\sInternational\sTrade\b"), "cit"),
    (re.compile(r"\b(?:U\.\s?S\.|United States)\sTax\sCourt\b"), "tax"),
    (re.compile(r"\b(?:U\.\s?S\.\sSupreme\sCourt|Supreme\sCourt\sof\sthe\sUnited\sStates|United\sStates\sSupreme\sCourt)\b"), "scotus"),
    (re.compile(r"\bJudicial\sPanel\son\sMultidistrict\sLitigation\b"), "jpml"),
]


def district_id(division_word, state_name):
    code = STATES.get(state_name)
    if not code:
        return None
    div = DIVISION.get(division_word or "", "")
    return DISTRICTS.get((code, div))


def extract_courts(text, limit=None):
    """Federal court names as written, with a court id only when the name maps to exactly one current court."""
    out, seen = [], set()
    for m in _DISTRICT_COURT.finditer(text):
        cid = district_id(m.group("div"), m.group("state"))
        key = (m.group(0), cid)
        if key not in seen:
            seen.add(key)
            out.append({"as_written": m.group(0), "offset": m.start(), "court_id": cid})
    for m in _APPEALS.finditer(text):
        key = (m.group(0), CIRCUITS[m.group("cir")])
        if key not in seen:
            seen.add(key)
            out.append({"as_written": m.group(0), "offset": m.start(), "court_id": CIRCUITS[m.group("cir")]})
    for pattern, cid in _SPECIAL:
        for m in pattern.finditer(text):
            key = (m.group(0), cid)
            if key not in seen:
                seen.add(key)
                out.append({"as_written": m.group(0), "offset": m.start(), "court_id": cid})
    out.sort(key=lambda c: c["offset"])
    out = [{k: v for k, v in c.items() if v is not None} for c in out]
    return out[:limit] if limit else out


# Bluebook district citations as used in SEC litigation releases, e.g. "(M.D. Fla. filed ...)", "(S.D.N.Y.)".
BLUEBOOK_STATE = {
    "ala": "al", "alaska": "ak", "ariz": "az", "ark": "ar", "cal": "ca", "calif": "ca", "colo": "co", "conn": "ct",
    "del": "de", "dc": "dc", "fla": "fl", "ga": "ga", "haw": "hi", "hawaii": "hi", "idaho": "id", "ill": "il",
    "ind": "in", "iowa": "ia", "kan": "ks", "kans": "ks", "ky": "ky", "la": "la", "me": "me", "md": "md",
    "mass": "ma", "mich": "mi", "minn": "mn", "miss": "ms", "mo": "mo", "mont": "mt", "neb": "ne", "nev": "nv",
    "nh": "nh", "nj": "nj", "nm": "nm", "ny": "ny", "nc": "nc", "nd": "nd", "ohio": "oh", "okla": "ok", "or": "or",
    "ore": "or", "pa": "pa", "penn": "pa", "ri": "ri", "sc": "sc", "sd": "sd", "tenn": "tn", "tex": "tx",
    "utah": "ut", "vt": "vt", "va": "va", "wash": "wa", "wva": "wv", "wis": "wi", "wisc": "wi", "wyo": "wy",
    "pr": "pr", "guam": "gu", "vi": "vi",
}
_CITE = re.compile(r"\((?P<cite>(?:[NSEWMC]\.\s?)?D\.\s?[A-Z][A-Za-z.\s]{0,10}?)(?=\s(?:filed|Filed|[A-Z][a-z]{2,4}\.?\s\d)|,|\))")


def bluebook_district_id(cite):
    """'M.D. Fla.' -> 'flmd'; 'S.D.N.Y.' -> 'nysd'; 'D.D.C.' -> 'dcd'; unknown -> None."""
    key = re.sub(r"[.\s]", "", cite).lower()
    m = re.fullmatch(r"([nsewmc]?)d(.+)", key)
    if not m:
        return None
    state = BLUEBOOK_STATE.get(m.group(2))
    if not state:
        return None
    return DISTRICTS.get((state, m.group(1)))


def extract_court_cites(text, limit=None):
    out, seen = [], set()
    for m in _CITE.finditer(text):
        cite = m.group("cite").strip()
        cid = bluebook_district_id(cite)
        if cid and cite not in seen:
            seen.add(cite)
            out.append({"as_written": cite, "offset": m.start("cite"), "court_id": cid})
    return out[:limit] if limit else out


# ------------------------------------------------------------------ parties named in a title

_VERBS = (
    r"Pleads?|Pleaded|Pled|Sentenced|Re-?[Ss]entenced|Agrees?|Agreed|Charged|Indicted|Convicted|Pays?|Paid|Settles?|"
    r"Settled|Admits?|Admitted|Found|Arrested|Ordered|Enters?|Entered|Resolves?|Resolved|Will|[Tt]o\s(?:Pay|Plead|Settle|"
    r"Serve|Forfeit|Resolve|Spend|Return|Implement|Divest|Sell|Refund)|Extradited|Receives?|Received|Faces?|Accused|Sued|"
    r"Files?|Filed|Consents?|Barred|Banned|Enjoined|Acquitted|Gets?|Given|Jailed|Imprisoned|Is|Are|Was|Were|Has|Have|"
    r"Had|Must|Reach|Reaches|Reached|Plead|Forfeits?|Forfeited|Loses?|Lost|Avoids?|Ends?|Pay|Commits?|Committed|Signs?|"
    r"Signed|Owes?|Returns?|Returned|Surrenders?|Surrendered|Waives?|Waived|Withdraws?|Joins?|Joined|Seeks?|Sought|"
    r"Wins?|Won|Appears?|Testifies|Testified|Guilty|Charges|Sues|Sue|Indicts|Convicts|Obtains?|Obtained|Secures?|"
    r"Secured|Announces?|Announced|Takes|Took|Facing|Sentence|Plea|Accepts?|Accepted|Divests?|Abandons?|Abandoned"
)
_SUBJECT = re.compile(r"^(?P<subject>.+?)\s(?=(?:" + _VERBS + r")\b)")
_OBJECT = re.compile(
    r"\b(?:Against|Sues|Charges|Indicts|Settles With|Settlement With|Agreement With|Resolution With|Lawsuit Against|"
    r"Complaint Against|Action Against|Suit Against)\s(?P<object>[A-Z0-9][^,:;]{2,120}?)"
    r"(?=\s(?:[Ff]or|[Oo]ver|[Tt]o|[Ii]n|[Aa]fter|[Aa]lleging|[Rr]egarding|[Oo]n|[Tt]hat|[Ff]ollowing|[Aa]nd\s(?:Its|Their|Others))\b|,|$)"
)
_VERSUS = re.compile(r"\b(?:United States|U\.S\.)\sv\.\s(?P<object>[A-Z0-9][^,:;()]{1,120}?)(?=\s(?:[-–—(]|[Ff]or|[Ii]n)\b|[,:;(]|$)")
_DESCRIPTORS = {
    "former", "ex", "man", "woman", "men", "women", "couple", "husband", "wife", "father", "mother", "son", "daughter",
    "brothers", "sisters", "brother", "sister", "family", "owner", "owners", "operator", "operators", "executive",
    "executives", "officer", "officers", "official", "officials", "employee", "employees", "doctor", "doctors",
    "physician", "physicians", "nurse", "nurses", "pharmacist", "dentist", "chiropractor", "lawyer", "attorney",
    "accountant", "ceo", "cfo", "coo", "president", "vice", "director", "manager", "chief", "head", "leader",
    "leaders", "member", "members", "resident", "residents", "national", "nationals", "citizen", "citizens",
    "company", "companies", "firm", "firms", "corporation", "business", "businessman", "businesswoman", "contractor",
    "contractors", "defendant", "defendants", "individual", "individuals", "people", "persons", "person", "two",
    "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "dozens", "several",
    "multiple", "more", "than", "and", "of", "the", "a", "an", "in", "for", "from", "with", "to", "at", "on", "by",
    "as", "who", "after", "local", "area", "county", "city", "state", "federal", "u.s", "us", "united", "states",
    "department", "justice", "attorney's", "office", "convicted", "felon", "felons", "gang", "drug", "trafficker",
    "traffickers", "dealer", "dealers", "fugitive", "inmate", "inmates", "prisoner", "police", "sheriff", "deputy",
    "agent", "agents", "soldier", "veteran", "pastor", "priest", "teacher", "coach", "student", "students",
    "investor", "investors", "broker", "adviser", "advisor", "banker", "bank", "hospital", "clinic", "pharmacy",
    "pharmacies", "group", "ring", "conspirators", "co-conspirators", "others", "other", "another", "one", "all",
    "both", "new", "old", "west", "east", "north", "south", "southern", "northern", "eastern", "western", "central",
    "middle", "district", "jury", "judge", "court", "grand", "partner", "partners", "founder", "co-founder",
    "employer", "landlord", "landlords", "tax", "preparer", "return", "repeat", "offender", "suspect", "suspects",
    "alleged", "admitted", "registered", "sex", "child", "minor", "teen", "teenager", "youth", "physician's",
    "assistant", "nursing", "home", "medical", "health", "care", "provider", "providers", "therapist", "consultant",
    "employee's", "worker", "workers", "driver", "drivers", "pilot", "captain", "crew", "military", "army", "navy",
    "marine", "airman", "sailor", "guard", "correctional", "jail", "prison", "postal", "mail", "carrier", "clerk",
    "cashier", "teller", "secretary", "bookkeeper", "treasurer", "mayor", "councilman", "councilwoman", "commissioner",
    "senator", "representative", "legislator", "politician", "candidate", "lobbyist", "contractor's", "illegal",
    "alien", "aliens", "immigrant", "immigrants", "foreign", "russian", "chinese", "mexican", "iranian",
}
ORG_SUFFIX = re.compile(
    r"\b(?:Inc\.?|Incorporated|LLC|L\.L\.C\.|Corp\.?|Corporation|Co\.|Company|Ltd\.?|Limited|LP|L\.P\.|LLP|L\.L\.P\.|PLC|plc|"
    r"AG|S\.A\.|N\.V\.|GmbH|N\.A\.|Bank|Bancorp|Holdings?|Group|Partners|Pharmaceuticals?|Pharma|Healthcare|"
    r"Hospital|Systems|Technologies|Industries|University|Foundation|Association|Trust|Capital|Securities|"
    r"Laboratories|Labs|Motors|Airlines|Energy|Services)\b"
)
_NOT_A_NAME = re.compile(
    r"^(?:Justice Department|Department of Justice|Departments? of|U\.S\.|United States|Attorney General|Acting|Deputy|"
    r"Assistant|Statement|Readout|Remarks|Federal|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Dozens|Several|"
    r"Multiple|More Than|Over|Nearly|Almost|About|Approximately|\d|FBI|DEA|ATF|IRS|HHS|OIG|Grand Jury|Jury|Court|Judge)\b"
)


def _words(phrase):
    return re.findall(r"[A-Za-z][A-Za-z.'’&-]*", phrase)


def _looks_like_name(phrase):
    words = _words(phrase)
    if not words or _NOT_A_NAME.match(phrase):
        return False
    if words[0].lower().strip(".'’") in _DESCRIPTORS:
        return False
    proper = [w for w in words if w[0].isupper() and w.lower().strip(".'’") not in _DESCRIPTORS]
    if not proper:
        return False
    # every word that is not a connector must be a proper (non-descriptor) word, unless the phrase is an organisation
    connectors = {"and", "of", "the", "&", "de", "la", "del", "van", "von", "der", "y", "et", "al.", "al"}
    descriptor_words = [w for w in words if w.lower().strip(".'’") in _DESCRIPTORS and w.lower() not in connectors]
    if descriptor_words and not ORG_SUFFIX.search(phrase):
        return False
    return True


def title_parties(title, body_text=None):
    """Parties named in a release title, exactly as written.

    A candidate is the title's grammatical subject (text before the first action verb), the object after
    "Against"/"Sues"/"Charges"/"Indicts"/"Settles With", or the name after "United States v.". It is kept only when
    it looks like a name (no descriptor words such as "Former", "Man", "Owner" unless it carries a corporate suffix)
    and, when body text is given, appears verbatim (case-sensitive) in the release body. kind is
    "organization (suffix in name)" when the phrase carries a corporate suffix, otherwise "named in title";
    nothing is inferred about whether a name is a person.
    """
    if not title:
        return []
    t = re.sub(r"\s+", " ", html.unescape(title)).strip()
    candidates = []
    m = _SUBJECT.match(t)
    if m:
        candidates.append(("subject", m.group("subject")))
    for pattern, role in ((_OBJECT, "object"), (_VERSUS, "v.")):
        for mm in pattern.finditer(t):
            candidates.append((role, mm.group("object")))
    out, seen = [], set()

    def accept(role, phrase):
        if len(phrase) < 3 or len(phrase) > 160 or phrase in seen or not _looks_like_name(phrase):
            return False
        if phrase in STATES or phrase in ("U.S.", "United States"):
            return False
        if body_text is not None and phrase not in body_text:
            return False
        seen.add(phrase)
        kind = "organization (suffix in name)" if ORG_SUFFIX.search(phrase) else "named in title"
        out.append({"as_written": phrase, "role": role, "kind": kind})
        return True

    for role, phrase in candidates:
        phrase = phrase.strip(" ,:;-–—")
        phrase = re.sub(r"^(?:the|The)\s", "", phrase) if role != "subject" else phrase
        if accept(role, phrase):
            continue
        # two or more parties joined by "and" ("Iron Mountain and Recall Holdings"): each part is checked on its own,
        # still as written, and only when every part is itself a multi-word name or carries a corporate suffix
        if "," in phrase or re.search(r"\s(?:of|for|at|in|from|with)\s", phrase):
            continue
        parts = [p.strip() for p in re.split(r"\sand\s", phrase) if p.strip()]
        if len(parts) > 1 and all(_is_party_part(p) for p in parts):
            for part in parts:
                accept(role, part)
    return out


def _is_party_part(part):
    if part in STATES or part.lower() in {s.lower() for s in STATES}:
        return False
    if ORG_SUFFIX.search(part):
        return True
    words = _words(part)
    return 2 <= len(words) <= 5 and all(w[0].isupper() for w in words)


# ------------------------------------------------------------------ names (exact-key matching)

_SUFFIXES = {"inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "plc", "sa",
             "ag", "nv", "the"}


def normalize_company(name):
    """Documented exact-key normalisation: drop a trailing EDGAR marker ("/DE", "/NEW/"), casefold, '&' -> 'and',
    drop punctuation, collapse spaces, drop a
    leading 'the' and trailing corporate suffix tokens (inc, incorporated, corp, corporation, co, company, llc, ltd,
    limited, plc, sa, ag, nv; partnership markers LP/LLP are kept). Two names match only when these keys are equal."""
    if not name:
        return ""
    s = re.sub(r"\s*/(?:[A-Za-z]{2,4})?/?\s*$", "", name)  # EDGAR state/"NEW" markers: "SEALED AIR CORP/DE", "/NEW/"
    s = s.casefold().replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    tokens = s.split()
    while tokens and tokens[0] == "the":
        tokens = tokens[1:]
    while tokens and tokens[-1] in _SUFFIXES:
        tokens = tokens[:-1]
    return " ".join(tokens)


def verify_spans(text, items):
    """Count items whose as_written text is not found verbatim at its offset in text (should be 0)."""
    bad = 0
    for item in items:
        off = item.get("offset")
        aw = item.get("as_written")
        if off is None or aw is None or text[off:off + len(aw)] != aw:
            bad += 1
    return bad
