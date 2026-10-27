"""Pure helpers for the judges-cross lane: name parsing, court ids, JPML report parsing, company-name normalisation.

Everything here is deterministic and unit-tested in test_judges_cross.py. Nothing here guesses: helpers return
None (or an empty list) when the input cannot be parsed exactly.
"""
import re
import unicodedata
from datetime import date

TODAY = date.today()

STATES = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co",
    "Connecticut": "ct", "Delaware": "de", "District of Columbia": "dc", "Florida": "fl", "Georgia": "ga",
    "Guam": "gu", "Hawaii": "hi", "Idaho": "id", "Illinois": "il", "Indiana": "in", "Iowa": "ia", "Kansas": "ks",
    "Kentucky": "ky", "Louisiana": "la", "Maine": "me", "Maryland": "md", "Massachusetts": "ma", "Michigan": "mi",
    "Minnesota": "mn", "Mississippi": "ms", "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv",
    "New Hampshire": "nh", "New Jersey": "nj", "New Mexico": "nm", "New York": "ny", "North Carolina": "nc",
    "North Dakota": "nd", "Northern Mariana Islands": "nmi", "Ohio": "oh", "Oklahoma": "ok", "Oregon": "or",
    "Pennsylvania": "pa", "Puerto Rico": "pr", "Rhode Island": "ri", "South Carolina": "sc", "South Dakota": "sd",
    "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt", "Virgin Islands": "vi", "Virginia": "va",
    "Washington": "wa", "West Virginia": "wv", "Wisconsin": "wi", "Wyoming": "wy", "Canal Zone": "cz",
}
STATE_NAMES = {v: k for k, v in STATES.items()}
DIRECTIONS = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}
SPECIAL = {"gu": "gud", "nmi": "nmid", "vi": "vid"}
CIRCUIT_OF_STATE = {
    "me": 1, "ma": 1, "nh": 1, "ri": 1, "pr": 1, "ct": 2, "ny": 2, "vt": 2, "de": 3, "nj": 3, "pa": 3, "vi": 3,
    "md": 4, "nc": 4, "sc": 4, "va": 4, "wv": 4, "la": 5, "ms": 5, "tx": 5, "ky": 6, "mi": 6, "oh": 6, "tn": 6,
    "il": 7, "in": 7, "wi": 7, "ar": 8, "ia": 8, "mn": 8, "mo": 8, "ne": 8, "nd": 8, "sd": 8, "ak": 9, "az": 9,
    "ca": 9, "hi": 9, "id": 9, "mt": 9, "nv": 9, "or": 9, "wa": 9, "gu": 9, "nmi": 9, "co": 10, "ks": 10, "nm": 10,
    "ok": 10, "ut": 10, "wy": 10, "al": 11, "fl": 11, "ga": 11, "dc": 0,
}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()


def district_court_id(name: str):
    """FJC court name ("U.S. District Court for the Eastern District of Louisiana") -> CourtListener-style id."""
    name = (name or "").strip()
    if name == "U.S. District Court for the District of Columbia":
        return "dcd"
    m = re.match(r"U\.S\. District Court for the (?:(\w+) )?District of (.+)$", name)
    if not m:
        return None
    state = STATES.get(m.group(2))
    if not state:
        return None
    if m.group(1):
        direction = DIRECTIONS.get(m.group(1))
        return state + direction + "d" if direction else None
    return SPECIAL.get(state, state + "d")


def jpml_district_court_id(name: str):
    """JPML terminated-report district heading ("LOUISIANA EASTERN", "DISTRICT OF COLUMBIA") -> court id."""
    words = fold(name).strip().title().replace(" Of ", " of ")
    if words == "District of Columbia":
        return "dcd"
    parts = words.rsplit(" ", 1)
    if len(parts) == 2 and parts[1] in DIRECTIONS and parts[0] in STATES:
        return STATES[parts[0]] + DIRECTIONS[parts[1]] + "d"
    if words in STATES:
        state = STATES[words]
        return SPECIAL.get(state, state + "d")
    return None


def pending_district_court_id(code: str):
    """JPML pending-report district code ("NJ", "OHS", "DC") -> court id."""
    code = (code or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2,4}", code):
        return None
    return "dcd" if code == "DC" else code.lower() + "d"


def court_state(court_id: str):
    if not court_id:
        return None
    if court_id == "dcd":
        return "District of Columbia"
    for code, name in sorted(STATE_NAMES.items(), key=lambda kv: -len(kv[0])):
        if court_id == SPECIAL.get(code, code + "d") or (
            court_id.startswith(code) and len(court_id) == len(code) + 2 and court_id[len(code)] in "nsewmc" and court_id.endswith("d")
        ):
            return name
    return None


def court_circuit(court_id: str):
    state = court_state(court_id)
    if not state:
        return None
    return CIRCUIT_OF_STATE.get(STATES[state])


def name_tokens(text: str):
    """Lower-case ascii tokens of a person name, without generational suffixes."""
    text = fold(text).lower().replace("-", " ")
    text = re.sub(r"[.,'’()\[\]]", " ", text)
    return [t for t in text.split() if t and t not in SUFFIXES]


def suffix_key(text: str):
    """Generational suffix ("Jr.", "III") as a lower-case key, or None."""
    m = re.search(r"\b(Jr|Sr|III|II|IV)\b\.?", text or "", re.I)
    return m.group(1).lower() if m else None


def _fjc_given_variants(first: str, middle: str):
    """FJC given names; bracketed names (not used by the judge, e.g. "[Percy] Whitman") may be skipped."""
    full = name_tokens(f"{first} {middle}")
    used = name_tokens(re.sub(r"\[[^\]]*\]", " ", f"{first} {middle}"))
    return [full] if used == full else [full, used]


def parse_jpml_judges(raw: str):
    """Parse a transferee-judge string as printed in the JPML terminated report.

    Returns a list (two judges may share a docket) of {"surname": [...tokens], "given": [...tokens], "court": hint}.
    "given" tokens of length 1 are initials. Returns [] when the string cannot be parsed exactly.
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    raw = raw.replace("Castel. ", "Castel, ")
    court = None
    m = re.search(r"\(([A-Z]{2,4})\)\s*$", raw)
    if m:
        court = pending_district_court_id(m.group(1))
        raw = raw[: m.start()].strip()
    m = re.search(r"\(\d{1,2}(?:st|nd|rd|th) Circuit\)\s*$", raw)
    if m:
        # A circuit judge sitting by designation: no district court to match against.
        court = "circuit"
        raw = raw[: m.start()].strip()
    pieces = [p.strip() for p in re.split(r"\s+&\s+", raw)]
    if len(pieces) == 1:
        m = re.fullmatch(r"([^,]+,(?:\s*(?:Jr|Sr|III|II|IV)\.?,)?\s*(?:[A-Z]\.){1,3}),\s*([^,]+,(?:\s*(?:Jr|Sr|III|II|IV)\.?,)?\s*(?:[A-Z]\.){1,3})", raw)
        if m:
            pieces = [m.group(1), m.group(2)]
    out = []
    for piece in pieces:
        if "," in piece:
            surname, _, given = piece.partition(",")
            given = re.sub(r"^\s*(?:Jr|Sr|III|II|IV)\b\.?\s*,?", "", given.strip())
        elif len(piece.split()) >= 2 and piece == pieces[0] and len(pieces) == 1 and re.fullmatch(r"[A-Z][a-z]+(?: [A-Z]\.?)* [A-Z][A-Za-z'\-]+", piece):
            parts = piece.split()
            surname, given = parts[-1], " ".join(parts[:-1])
        else:
            surname, given = piece, ""
        given_tokens = []
        for token in given.replace("-", " ").split():
            letters = re.sub(r"[^A-Za-z]", "", token)
            if re.fullmatch(r"[A-Z.]+", token) and 1 <= len(letters) <= 3:
                given_tokens.extend(ch.lower() for ch in letters)
            else:
                given_tokens.extend(name_tokens(token))
        surname_tokens = name_tokens(surname)
        if not surname_tokens:
            return []
        out.append({"surname": surname_tokens, "given": given_tokens, "court": court, "suffix": suffix_key(piece)})
    return out


def parse_pending_judge(raw: str):
    """Judge as printed in the JPML pending reports ("Edmund A. Sargus, Jr") -> {"tokens", "suffix"} or None."""
    raw = (raw or "").strip()
    tokens = name_tokens(raw)
    return {"tokens": tokens, "suffix": suffix_key(raw)} if len(tokens) >= 2 else None


def pending_name_split(parsed, surname_tokens):
    """Given tokens left after removing an FJC surname from the end of a pending-report name, or None."""
    k = len(surname_tokens)
    if not k or k >= len(parsed["tokens"]) or parsed["tokens"][-k:] != surname_tokens:
        return None
    return parsed["tokens"][:-k]


def given_consistent(given, first: str, middle: str) -> bool:
    """Do parsed JPML given-name tokens agree with an FJC first/middle name? Initials must match positionally;
    a full given-name token must equal the FJC name at that position."""
    if not given:
        return True
    for fjc in _fjc_given_variants(first, middle):
        if len(given) > len(fjc):
            continue
        if all((actual[0] == token) if len(token) == 1 else (token == actual) for token, actual in zip(given, fjc)):
            return True
    return False


def first_initial_consistent(given, first: str, middle: str) -> bool:
    """Weaker check: only the first printed given name/initial must agree with the FJC first (used) name."""
    if not given:
        return True
    token = given[0]
    for fjc in _fjc_given_variants(first, middle):
        if fjc and ((fjc[0][0] == token) if len(token) == 1 else (fjc[0] == token)):
            return True
    return False


# ----------------------------------------------------------------------------------------------- JPML report

TERMINATED_HEADER = re.compile(r"^\s*(?P<code>[0-9][0-9A-Z]{2,3})\s+(?P<name>[A-Z][A-Z .,'()-]+?)\s+\(?(?P<count>\d+) Litigations?\)?\s*$")
TERMINATED_CIRCUIT = re.compile(r"^\s+([A-Z ]+CIRCUIT)\s*$")
_N = r"[\d,]+"
_YEAR = r"(?P<year>\d,?\d{3})"
_JUDGE = r"(?P<judge>[A-Z](?:[^\d]|\(\d{1,2}(?:st|nd|rd|th) Circuit\))*?)"
TERMINATED_ROW = re.compile(
    rf"^\s*(?P<mdl>\d{{1,5}}[A-Z]?)\s+(?P<caption>.+?)\s{{2,}}{_JUDGE}\s+(?P<transferred>{_N})\s+(?P<filed>{_N})\s+(?P<closed>{_N})\s+(?:(?P<remanded>{_N})\s+)?{_YEAR}\s*$"
)
# Rows printed without a transferee judge (e.g. MDL 2641): caption followed directly by the counts.
TERMINATED_ROW_NO_JUDGE = re.compile(
    rf"^\s*(?P<mdl>\d{{1,5}}[A-Z]?)\s+(?P<caption>.*?[A-Za-z)].*?)\s{{20,}}(?P<transferred>{_N})\s+(?P<filed>{_N})\s+(?P<closed>{_N})\s+(?P<remanded>{_N})\s+{_YEAR}\s*$"
)
CUMULATIVE_TOTAL = re.compile(r"CUMULATIVE TOTALS\s+\(([\d,]+) Litigations\)")


def _int(value):
    return int(value.replace(",", ""))


def parse_terminated_text(text: str):
    """Parse `pdftotext -layout` output of the JPML 'Multidistrict Litigations Terminated Through ...' report.

    Returns (rows, headers, unparsed, printed_total): rows carry the district heading they were printed under;
    headers carry the printed litigation count per district so the caller can check every district parsed
    completely; printed_total is the report's own cumulative litigation count.

    A row with an empty remanded column is accepted only when transferred + filed = closed (so the blank can only be
    the remanded column); its remanded value stays None. A row without a printed judge gets judge "" and
    judge_printed False. MDL numbers keep printed letter suffixes ("8A") as strings; plain numbers are ints.
    """
    rows, headers, unparsed = [], [], []
    circuit = district = None
    printed_total = None
    for line in text.splitlines():
        tm = CUMULATIVE_TOTAL.search(line)
        if tm:
            printed_total = _int(tm.group(1))
            continue
        cm = TERMINATED_CIRCUIT.match(line)
        if cm:
            circuit = cm.group(1).strip().title()
            continue
        hm = TERMINATED_HEADER.match(line)
        if hm and not TERMINATED_ROW.match(line):
            district = {"code": hm.group("code"), "name": re.sub(r"\s+", " ", hm.group("name")).strip(), "printed": int(hm.group("count")), "circuit": circuit}
            district["court_id"] = jpml_district_court_id(district["name"])
            headers.append(district)
            continue
        rm = TERMINATED_ROW.match(line)
        judge_printed = True
        if rm and rm.group("remanded") is None and _int(rm.group("transferred")) + _int(rm.group("filed")) != _int(rm.group("closed")):
            rm = None
        if not rm:
            rm = TERMINATED_ROW_NO_JUDGE.match(line)
            judge_printed = False
        if rm and district:
            mdl = rm.group("mdl")
            rows.append({
                "mdl": int(mdl) if mdl.isdigit() else mdl,
                "caption": re.sub(r"\s+", " ", rm.group("caption")).strip(),
                "transferee_judge": rm.group("judge").strip() if judge_printed else "",
                "judge_printed": judge_printed,
                "district_code": district["code"], "district_name": district["name"].title().replace(" Of ", " of "), "court_id": district["court_id"],
                "circuit": district["circuit"],
                "actions_transferred": _int(rm.group("transferred")),
                "actions_filed_in_transferee": _int(rm.group("filed")),
                "actions_closed": _int(rm.group("closed")),
                "actions_remanded": _int(rm.group("remanded")) if rm.group("remanded") else None,
                "termination_year": _int(rm.group("year")),
            })
        elif district and re.match(r"^\s*\d{1,5}[A-Z]?\s+\S", line):
            unparsed.append(line.strip())
    return rows, headers, unparsed, printed_total


# ------------------------------------------------------------------------------------------ company names

CORPORATE = {"inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "llc", "lp", "llp",
             "nv", "sa", "ag", "se", "spa", "pllc"}
SECURITY = {"common", "stock", "stocks", "shares", "share", "com", "adr", "ads", "ord", "ordinary", "sponsored", "units", "unit", "cs"}


def company_key(text: str) -> str:
    """Normalised company name used for exact comparison.

    Rules (applied in order, nothing else): ascii-fold and lower-case; drop parenthetical annotations; keep only the
    text before " - "; "&" -> "and"; "et al." removed; punctuation removed; runs of single letters joined ("c r" ->
    "cr"); then repeatedly drop trailing security words (common, stock, shares, adr, ...), "class/cl X", corporate
    suffixes (inc, corp, co, company, llc, plc, ...) and a dangling "and"; a leading "the" is dropped.
    """
    text = fold(text).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.split(r"\s+-\s+", text)[0]
    text = text.replace("&", " and ")
    text = re.sub(r"\bet\.?\s+al\.?", " ", text)
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    tokens, run = [], []
    for token in text.split() + [""]:
        if len(token) == 1 and token.isalpha():
            run.append(token)
            continue
        if run:
            tokens.append("".join(run))
            run = []
        if token:
            tokens.append(token)
    while tokens:
        if len(tokens) >= 2 and tokens[-2] in ("class", "cl") and len(tokens[-1]) == 1:
            tokens = tokens[:-2]
        elif tokens[-1] in SECURITY or tokens[-1] in CORPORATE or tokens[-1] == "and":
            tokens = tokens[:-1]
        else:
            break
    if tokens and tokens[0] == "the":
        tokens = tokens[1:]
    return " ".join(tokens)


def years_between(start: str, end: date = TODAY):
    if not start:
        return None
    try:
        d = date.fromisoformat(start[:10])
    except ValueError:
        return None
    return round((end - d).days / 365.25, 1)


def median(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else round((values[mid - 1] + values[mid]) / 2, 1)


def hhi(shares):
    """Herfindahl-Hirschman index (0-10,000) from raw amounts."""
    total = sum(shares)
    if not total:
        return None
    return round(sum((100 * s / total) ** 2 for s in shares))


def profile_ids_by_nid(fjc_profile_ids, crosswalk_rows):
    """{FJC nid: /judges profile id} by exact ids only.

    fjc_profile_ids: {nid: judge_profile_id stored on the judge_profiles_fjc record (or None)}
    crosswalk_rows: judge_cl_crosswalk rows {"id": judges id, "item": {"profile": {"fjc_nid": ...}}} (the directory record's own FJC bridge)

    A nid gets a profile when the FJC record names one, or else when exactly one directory record carries that nid. A nid whose two sources
    disagree, a nid carried by several directory records, and a profile claimed by several nids get no profile (never a guess)."""
    by_nid = {}
    for r in crosswalk_rows:
        nid = (((r.get("item") or {}).get("profile") or {}).get("fjc_nid"))
        if nid:
            by_nid.setdefault(str(nid), set()).add(r["id"])
    out = {}
    for nid in set(fjc_profile_ids) | set(by_nid):
        stored = fjc_profile_ids.get(nid)
        bridged = by_nid.get(nid, set())
        if len(bridged) > 1 or (stored and bridged and bridged != {stored}):
            continue
        pid = stored or (next(iter(bridged)) if bridged else None)
        if pid:
            out[nid] = pid
    owners = {}
    for nid, pid in out.items():
        owners.setdefault(pid, []).append(nid)
    return {nid: pid for nid, pid in out.items() if len(owners[pid]) == 1}
