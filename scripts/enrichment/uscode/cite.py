"""Citations, display labels and official URL candidates for US Code units.

citation() builds the label from the unit's printed number (OLRC's <num value>) and the title; parse_citation()
reads it back (verify_uscode.py checks every citation round-trips to the record's title and number).
  section:              "42 U.S.C. § 1983"; ranges print "§§" ("26 U.S.C. §§ 54A to 54F")
  appendix section:     "18 U.S.C. App. § 2"
  appendix court rule:  "28 U.S.C. App., Federal Rules of Civil Procedure, Rule 4"
  reorganization plan:  "5 U.S.C. App., Reorganization Plan No. I of 1939"
"""
import re

SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per",
         "the", "to", "under", "upon", "via", "with", "within", "without"}
ROMAN = re.compile(r"^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$")


def smart_title(text):
    """Title-case a heading OLRC prints in capitals ("FEDERAL RULES OF CIVIL PROCEDURE" -> "Federal Rules of Civil
    Procedure"); headings with lower-case letters are returned unchanged. Roman numerals stay upper case."""
    if not text or re.search(r"[a-z]", text):
        return text
    state = {"first": True}

    def word(m):
        w = m.group(0)
        first = state["first"]
        state["first"] = False
        if ROMAN.match(w) and (w != "I" or not first):
            return w
        if w.lower() in SMALL and not first:
            return w.lower()
        return w[0].upper() + w[1:].lower()

    return re.sub(r"[A-Za-z][A-Za-z'’]*", word, text)


def title_number(title_key):
    return title_key[:-1] if title_key.endswith("a") else title_key


def title_label(title_key):
    """'42' -> 'Title 42'; '5a' -> 'Title 5 Appendix'."""
    return f"Title {title_number(title_key)} Appendix" if title_key.endswith("a") else f"Title {title_key}"


def num_display(num_value):
    return (num_value or "").strip()


def is_range(num_value):
    return bool(re.search(r"\bto\b|,|\.\.\.", num_value or ""))


def citation(title_key, unit, group_heading=None):
    n = title_number(title_key)
    app = " App." if title_key.endswith("a") else ""
    kind = unit["kind"]
    if kind == "courtRule":
        group = smart_title(group_heading or "Court Rules")
        return f"{n} U.S.C. App., {group}, Rule {num_display(unit['num_value'])}"
    if kind == "reorganizationPlan":
        return f"{n} U.S.C. App., {smart_title(unit['heading'] or 'Reorganization Plan')}"
    num = num_display(unit["num_value"])
    sign = "§§" if is_range(num) else "§"
    return f"{n} U.S.C.{app} {sign} {num}"


CITE = re.compile(r"^(?P<t>\d{1,2}) U\.S\.C\.(?P<app> App\.)? (?P<sign>§§?) (?P<num>.+)$")
RULE = re.compile(r"^(?P<t>\d{1,2}) U\.S\.C\. App\., (?P<group>.+), Rule (?P<num>.+)$")
PLAN = re.compile(r"^(?P<t>\d{1,2}) U\.S\.C\. App\., (?P<plan>Reorganization Plan .+)$")


def parse_citation(text):
    """-> {'title_key', 'num', 'kind'} or None."""
    m = RULE.match(text)
    if m:
        return {"title_key": m.group("t") + "a", "num": m.group("num"), "kind": "courtRule", "group": m.group("group")}
    m = PLAN.match(text)
    if m:
        return {"title_key": m.group("t") + "a", "num": None, "kind": "reorganizationPlan", "plan": m.group("plan")}
    m = CITE.match(text)
    if m:
        if (m.group("sign") == "§§") != is_range(m.group("num")):
            return None
        return {"title_key": m.group("t") + ("a" if m.group("app") else ""), "num": m.group("num"), "kind": "section"}
    return None


BASE = "https://uscode.house.gov/us/usc/"


def plain_section_path(title_key, unit):
    """Path of a section page OLRC serves for every numbered section of a title (hyphen for the en dash)."""
    ident = unit.get("identifier") or ""
    m = re.fullmatch(r"/us/usc/t" + re.escape(title_key) + r"/s([^/\s]+)", ident)
    if unit["kind"] != "section" or not m or "..." in m.group(1):
        return None
    return f"t{title_key}/s{m.group(1).replace(chr(0x2013), '-')}/"


def url_candidates(release, title_key, unit, parent_identifier):
    """Official per-unit page candidates on uscode.house.gov, most likely first (verified by check_official_urls)."""
    out = []
    plain = plain_section_path(title_key, unit)
    if plain:
        return [BASE + f"{release}/" + plain]
    ident = (unit.get("identifier") or "").replace("–", "-")
    if not ident or "..." in ident or " " in ident:
        return []
    seg = ident.rsplit("/", 1)[-1]
    if unit["kind"] == "courtRule":
        if parent_identifier and parent_identifier.startswith(f"/us/usc/t{title_key}/"):
            out.append(BASE + f"{release}/" + parent_identifier[len("/us/usc/"):] + f"/{seg}/")
        if title_key == "11a":
            # OLRC's title 11 appendix identifiers omit the title ("/us/usc/ptI/rule1002"); its pages sit under
            # t11a/courtRules/Bankr/<part>/<rule>/ (rule 1001, outside any part, directly under Bankr/)
            m = re.fullmatch(r"/us/usc/(pt[IVXLC]+)", parent_identifier or "")
            out.append(BASE + f"{release}/t11a/courtRules/Bankr/" + (f"{m.group(1)}/" if m else "") + f"{seg}/")
    if unit["kind"] == "reorganizationPlan":
        m = re.fullmatch(r"/us/usc/t" + re.escape(title_key) + r"/reorgPlan/(.+)", ident)
        if m:
            out.append(BASE + f"{release}/t{title_key}/reorgPlans/{m.group(1)}/")
    if ident.startswith(f"/us/usc/t{title_key}/"):
        out.append(BASE + f"{release}/" + ident[len("/us/usc/"):] + "/")
    seen = []
    for u in out:
        if u not in seen:
            seen.append(u)
    return seen


def title_page(release, title_key):
    return BASE + f"{release}/t{title_key}/"
