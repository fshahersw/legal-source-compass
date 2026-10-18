"""Turn the printed rows of CJRA Appendix A (see cjra_extract.py) into structured, validated period data.

Appendix A lists, for every district (grouped by circuit), each district judge and magistrate judge with five counts:
civil cases pending more than three years, motions pending more than six months, bench trials submitted more than six
months, bankruptcy appeals pending more than six months and Social Security appeal cases pending more than six months.
Report layouts changed over time (2004-2009 lists magistrate judges first with SUBTOTAL rows; 2010-2018 and 2019-2026
print district and judge-type totals above the names); the parser recognises each printed total row and checks that
the listed rows add up to it. Nothing is imputed: a row is either read as printed or reported as unparsed.
"""
import re
import unicodedata

MEASURES = ["civil_3y", "motions_6m", "bench_trials_6m", "bankruptcy_appeals_6m", "ss_appeals_6m"]
MEASURE_LABELS = {
    "civil_3y": "Civil cases pending more than three years",
    "motions_6m": "Motions pending more than six months",
    "bench_trials_6m": "Bench trials submitted more than six months",
    "bankruptcy_appeals_6m": "Bankruptcy appeals pending more than six months",
    "ss_appeals_6m": "Social Security appeal cases pending more than six months",
}

STATES = {
    "AK": "ALASKA", "AL": "ALABAMA", "AR": "ARKANSAS", "AZ": "ARIZONA", "CA": "CALIFORNIA", "CO": "COLORADO", "CT": "CONNECTICUT", "DC": "DISTRICT OF COLUMBIA",
    "DE": "DELAWARE", "FL": "FLORIDA", "GA": "GEORGIA", "GU": "GUAM", "HI": "HAWAII", "IA": "IOWA", "ID": "IDAHO", "IL": "ILLINOIS", "IN": "INDIANA", "KS": "KANSAS",
    "KY": "KENTUCKY", "LA": "LOUISIANA", "MA": "MASSACHUSETTS", "MD": "MARYLAND", "ME": "MAINE", "MI": "MICHIGAN", "MN": "MINNESOTA", "MO": "MISSOURI", "MP": "NORTHERN MARIANA ISLANDS",
    "MS": "MISSISSIPPI", "MT": "MONTANA", "NC": "NORTH CAROLINA", "ND": "NORTH DAKOTA", "NE": "NEBRASKA", "NH": "NEW HAMPSHIRE", "NJ": "NEW JERSEY", "NM": "NEW MEXICO", "NV": "NEVADA",
    "NY": "NEW YORK", "OH": "OHIO", "OK": "OKLAHOMA", "OR": "OREGON", "PA": "PENNSYLVANIA", "PR": "PUERTO RICO", "RI": "RHODE ISLAND", "SC": "SOUTH CAROLINA", "SD": "SOUTH DAKOTA",
    "TN": "TENNESSEE", "TX": "TEXAS", "UT": "UTAH", "VA": "VIRGINIA", "VI": "VIRGIN ISLANDS", "VT": "VERMONT", "WA": "WASHINGTON", "WI": "WISCONSIN", "WV": "WEST VIRGINIA", "WY": "WYOMING",
}
DIRECTIONS = {"e": "EASTERN", "w": "WESTERN", "n": "NORTHERN", "s": "SOUTHERN", "m": "MIDDLE", "c": "CENTRAL"}
# Regional circuit of each district (28 U.S.C. 41); the report's own circuit grouping is checked against it.
CIRCUITS = {
    "dc": ["dcd"],
    "1": ["med", "mad", "nhd", "prd", "rid"],
    "2": ["ctd", "nyed", "nynd", "nysd", "nywd", "vtd"],
    "3": ["ded", "njd", "paed", "pamd", "pawd", "vid"],
    "4": ["mdd", "nced", "ncmd", "ncwd", "scd", "vaed", "vawd", "wvnd", "wvsd"],
    "5": ["laed", "lamd", "lawd", "msnd", "mssd", "txed", "txnd", "txsd", "txwd"],
    "6": ["kyed", "kywd", "mied", "miwd", "ohnd", "ohsd", "tned", "tnmd", "tnwd"],
    "7": ["ilcd", "ilnd", "ilsd", "innd", "insd", "wied", "wiwd"],
    "8": ["ared", "arwd", "iand", "iasd", "mnd", "moed", "mowd", "ned", "ndd", "sdd"],
    "9": ["akd", "azd", "cacd", "caed", "cand", "casd", "gud", "hid", "idd", "mtd", "nvd", "nmid", "ord", "wawd", "waed"],
    "10": ["cod", "ksd", "nmd", "oked", "oknd", "okwd", "utd", "wyd"],
    "11": ["almd", "alnd", "alsd", "flmd", "flnd", "flsd", "gamd", "gand", "gasd"],
}
CIRCUIT_OF = {d: c for c, ds in CIRCUITS.items() for d in ds}
CIRCUIT_WORDS = {"FIRST": "1", "SECOND": "2", "THIRD": "3", "FOURTH": "4", "FIFTH": "5", "SIXTH": "6", "SEVENTH": "7", "EIGHTH": "8", "NINTH": "9", "TENTH": "10",
                 "ELEVENTH": "11", "DISTRICT OF COLUMBIA": "dc", "D.C.": "dc", "DC": "dc"}
CIRCUIT_NAMES = {"dc": "D.C. Circuit", "1": "First Circuit", "2": "Second Circuit", "3": "Third Circuit", "4": "Fourth Circuit", "5": "Fifth Circuit", "6": "Sixth Circuit",
                 "7": "Seventh Circuit", "8": "Eighth Circuit", "9": "Ninth Circuit", "10": "Tenth Circuit", "11": "Eleventh Circuit"}
# Printed district labels that are not "<STATE> <DIRECTION>" or "<STATE>".
EXTRA_ALIASES = {"NORTHERN MARIANAS": "nmid", "NORTHERN MARIANA ISLANDS": "nmid", "NORTHERN MARIANA": "nmid", "N. MARIANA ISLANDS": "nmid", "DISTRICT OF COLUMBIA": "dcd"}
# Assignment codes printed in the judge column that are not persons.
PLACEHOLDER = re.compile(r"^(UNASSIGNED\b.*|.*\bAPPEALS?|CRIMINAL FUGITIVES?|LOCAL/STATE JUDGE|.*\bDOCKET\b.*|PRO SE.*|DRAW\b.*|MAGISTRATE\b.*POOL.*|.*\bPOOL)$", re.I)
DESIGNATION = re.compile(r"\s*\((CJ|VJ|CIR|CIT|FCR|SJ|RJ|MJ|CJA|CHIEF)\)\s*", re.I)
SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}


def district_aliases(courts):
    """{printed label (upper case) -> court id} built from the court ids and the state table."""
    aliases = dict(EXTRA_ALIASES)
    per_state = {}
    for cid in courts:
        per_state.setdefault(cid[:2], []).append(cid)
    for cid in courts:
        st = cid[:2].upper()
        name = STATES.get(st)
        if cid == "nmid":
            continue
        if not name:
            continue
        rest = cid[2:-1]
        if rest and rest in DIRECTIONS:
            d = DIRECTIONS[rest]
            aliases[f"{name} {d}"] = cid
            aliases[f"{d} {name}"] = cid
            aliases[f"{d} DISTRICT OF {name}"] = cid
        else:
            aliases[name] = cid
            aliases[f"DISTRICT OF {name}"] = cid
    return aliases


def clean(label):
    """The label as printed: only runs of white space collapsed."""
    return re.sub(r"\s+", " ", label or "").strip()


def norm_label(label):
    """Classification form of a label: NFKC, typographic quotes straightened, white space collapsed."""
    s = unicodedata.normalize("NFKC", label or "").replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip()


def district_key(label):
    """Upper-case label with trailing TOTAL(S)/(CONTINUED)/asterisks/colon removed, for district matching."""
    s = norm_label(label).upper().rstrip("*:").strip()
    s = re.sub(r"\s*\(CONTINUED\)$", "", s)
    s = re.sub(r"\s+TOTALS?$", "", s)
    return s.strip()


def circuit_key(label):
    s = norm_label(label).upper().rstrip("*:").strip()
    s = re.sub(r"\s*\(CONTINUED\)$", "", s)
    m = re.match(r"^(.*?)\s*CIRCUIT(?:\s+TOTALS?)?$", s)
    if not m:
        return None
    word = m.group(1).strip()
    return CIRCUIT_WORDS.get(word, "?" if word == "" else None)


def parse_name(printed):
    """Split a printed judge label into display parts. Returns dict with surname, given, suffix, designations, format.

    Accepted format: "SURNAME, GIVEN NAMES[, SUFFIX] [(FLAG)]" (comma with or without a following space).
    Anything else (no comma, a period in place of the comma, given-first order) is kept as printed and marked
    format="unparsed": it is still counted but never linked to a profile.
    """
    s = norm_label(printed)
    flags = [m.upper() for m in re.findall(r"\((\w+)\)", s)]
    s = DESIGNATION.sub(" ", s)
    s = re.sub(r"\(\w+\)", " ", s)
    stars = s.count("*")
    s = s.replace("*", " ")
    s = re.sub(r"\s+", " ", s).strip(" ,")
    out = {"printed": clean(printed), "designations": flags, "asterisk": stars > 0, "surname": None, "given": None, "suffix": None, "format": "unparsed"}
    if "," not in s:
        return out
    parts = [p.strip() for p in s.split(",")]
    surname, rest = parts[0], [p for p in parts[1:] if p]
    if not surname or not rest:
        return out
    suffix = None
    if len(rest) > 1 and rest[-1].replace(".", "").upper() in SUFFIXES:
        suffix = rest[-1].replace(".", "").upper()
        rest = rest[:-1]
    given = " ".join(rest)
    toks = given.split()
    if not suffix and len(toks) > 1 and toks[-1].replace(".", "").upper() in SUFFIXES:
        suffix = toks[-1].replace(".", "").upper()
        given = " ".join(toks[:-1])
    if not re.search(r"[A-Za-z]", given) or not re.search(r"[A-Za-z]", surname):
        return out
    out.update({"surname": surname, "given": given, "suffix": suffix, "format": "surname_first"})
    return out


def fold(s):
    """Case-fold, strip accents, treat hyphens/apostrophes/periods as removable punctuation, collapse spaces."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.upper().replace("’", "'")
    s = re.sub(r"[.'`]", "", s)
    s = re.sub(r"[-,]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def series_key(court_id, group, name):
    """Stable key for one judge's listing in one district and judge-type group across periods."""
    flags = sorted(f for f in name["designations"] if f != "CJ")
    base = fold(name["printed"])
    base = re.sub(r"\((\w+)\)", " ", base)
    base = fold(DESIGNATION.sub(" ", name["printed"]).replace("*", " "))
    return f"{court_id}|{group}|{base}|{'+'.join(flags)}"


def classify(label, aliases):
    s = norm_label(label)
    up = s.upper().rstrip("*:").strip()
    if re.fullmatch(r"NATIONAL TOTALS?|TOTAL,? ALL DISTRICTS|NATIONAL", up):
        return ("national", None)
    ck = circuit_key(s)
    if ck:
        return ("circuit_total", ck)
    if re.fullmatch(r"CIRCUIT TOTALS?(?:\s+[\d,]+)?", up):
        return ("circuit_total", "?")
    if re.fullmatch(r"DISTRICT TOTALS?", up):
        return ("district_total", "?")
    dk = district_key(s)
    if dk in aliases:
        return ("district_total", aliases[dk])
    if re.fullmatch(r"DISTRICT JUDGES?", up):
        return ("type_total", "district")
    if re.fullmatch(r"MAGISTRATE JUDGES?", up):
        return ("type_total", "magistrate")
    if re.fullmatch(r"SUB-?TOTALS?", up):
        return ("subtotal", None)
    if PLACEHOLDER.match(up) and "," not in up:
        return ("placeholder", None)
    return ("person", None)


def appendix_bounds(lines):
    """Index range of Appendix A rows: from its first heading to the next appendix heading or the endnotes page."""
    start = end = None
    for i, l in enumerate(lines):
        lab = norm_label(l["label"]).upper()
        if start is None and re.fullmatch(r"(CJRA )?APPENDIX A\.?", lab):
            start = i
        elif start is not None and re.fullmatch(r"(CJRA )?APPENDIX [B-E]\.?|ENDNOTES", lab):
            end = i
            break
    return (start or 0), (end if end is not None else len(lines))


def endnotes(lines):
    """Endnote texts printed in Appendix A: {marker: [texts]} (a marker can be reused for different texts)."""
    notes = {}
    for i, l in enumerate(lines):
        if l["nums"]:
            continue
        m = re.match(r"^(\d{1,2})\s+([A-Z][^\n]{15,})$", norm_label(l["label"]))
        if not m or not re.search(r"(?i)case|caseload|multidistrict|litigation|pending|report", m.group(2)):
            continue
        text = m.group(2)
        j = i + 1
        while j < len(lines) and lines[j]["page"] == l["page"] and not lines[j]["nums"] and 0 < lines[j]["top"] - lines[j - 1]["top"] <= 13:
            nxt = norm_label(lines[j]["label"])
            if re.match(r"^(\d{1,2})\s+[A-Z]", nxt) or re.match(r"^\(\w+\) =", nxt) or re.match(r"(?i)^page \d", nxt):
                break
            text += " " + nxt
            j += 1
        notes.setdefault(int(m.group(1)), [])
        if text not in notes[int(m.group(1))]:
            notes[int(m.group(1))].append(text)
    return notes


def parse_period(lines, courts):
    """Parse one report's printed rows. Returns dict(rows, totals, checks, warnings)."""
    aliases = district_aliases(courts)
    lo, hi = appendix_bounds(lines)
    rows, totals, warnings = [], [], []
    circuit = None
    district = None
    group = None
    for idx in range(lo, hi):
        l = lines[idx]
        label = norm_label(l["label"])
        if not label:
            continue
        if not l["nums"]:
            # heading lines
            ck = circuit_key(label)
            if ck and ck != "?":
                circuit = ck
                continue
            dk = district_key(label)
            if dk in aliases:
                if district != aliases[dk]:
                    district, group = aliases[dk], None
                continue
            up = label.upper()
            if re.fullmatch(r"DISTRICT JUDGES?", up):
                group = "district"
            elif re.fullmatch(r"MAGISTRATE JUDGES?", up):
                group = "magistrate"
            continue
        if len(l["nums"]) != 5:
            continue
        kind, key = classify(label, aliases)
        nums = dict(zip(MEASURES, l["nums"]))
        ref = {"page": l["page"], "top": l["top"], "label": label}
        if kind == "national":
            totals.append({"level": "national", "key": "us", "values": nums, **ref})
        elif kind == "circuit_total":
            key = (circuit or CIRCUIT_OF.get(district)) if key == "?" else key
            if key is None:
                warnings.append(f"circuit total without circuit at p{l['page']}")
            else:
                circuit = key
            totals.append({"level": "circuit", "key": key, "values": nums, **ref})
        elif kind == "district_total":
            if key == "?":
                key = district
            else:
                if district != key:
                    group = None
                district = key
                if key == "dcd":
                    circuit = "dc"
            totals.append({"level": "district", "key": key, "values": nums, **ref})
        elif kind == "type_total":
            group = key
            totals.append({"level": "type", "key": f"{district}|{key}", "values": nums, **ref})
        elif kind == "subtotal":
            totals.append({"level": "type", "key": f"{district}|{group}", "values": nums, **ref})
        else:
            if district is None:
                warnings.append(f"row before any district at p{l['page']}: {label}")
                continue
            name = parse_name(label) if kind == "person" else None
            rows.append({"court_id": district, "circuit": circuit, "group": group, "kind": kind, "printed": label, "name": name,
                         "values": nums, "markers": l.get("markers") or [], "page": l["page"], "top": l["top"]})
    return {"rows": rows, "totals": totals, "warnings": warnings}


def validate(parsed):
    """Arithmetic checks against every printed total. Returns list of {level, key, ok, printed, summed}."""
    rows, totals = parsed["rows"], parsed["totals"]
    checks = []

    def add(a, b):
        return {m: a.get(m, 0) + b.get(m, 0) for m in MEASURES}

    by_type, by_district = {}, {}
    for r in rows:
        k = f"{r['court_id']}|{r['group']}"
        by_type[k] = add(by_type.get(k, {}), r["values"])
        by_district[r["court_id"]] = add(by_district.get(r["court_id"], {}), r["values"])
    seen_type = {}
    for t in totals:
        if t["level"] == "type":
            seen_type.setdefault(t["key"], []).append(t)
    for k, ts in seen_type.items():
        printed = ts[0]["values"]
        summed = by_type.get(k, {m: 0 for m in MEASURES})
        checks.append({"level": "type", "key": k, "ok": printed == summed, "printed": printed, "summed": summed, "page": ts[0]["page"]})
    dist_totals = {}
    for t in totals:
        if t["level"] == "district" and t["key"]:
            dist_totals.setdefault(t["key"], t)
    for k, t in dist_totals.items():
        summed = by_district.get(k, {m: 0 for m in MEASURES})
        checks.append({"level": "district", "key": k, "ok": t["values"] == summed, "printed": t["values"], "summed": summed, "page": t["page"]})
    circ = {}
    for k, t in dist_totals.items():
        c = CIRCUIT_OF.get(k)
        circ[c] = add(circ.get(c, {}), t["values"])
    circ_totals = {}
    for t in totals:
        if t["level"] == "circuit" and t["key"] and t["key"] != "?":
            circ_totals.setdefault(t["key"], t)
    for k, t in circ_totals.items():
        summed = circ.get(k, {m: 0 for m in MEASURES})
        checks.append({"level": "circuit", "key": k, "ok": t["values"] == summed, "printed": t["values"], "summed": summed, "page": t["page"]})
    nat = [t for t in totals if t["level"] == "national"]
    if nat:
        summed = {m: 0 for m in MEASURES}
        for t in dist_totals.values():
            summed = add(summed, t["values"])
        checks.append({"level": "national", "key": "us", "ok": nat[0]["values"] == summed, "printed": nat[0]["values"], "summed": summed, "page": nat[0]["page"]})
    return checks
