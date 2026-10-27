"""Rule-based reading of expert-admissibility rulings from printed docket text and order titles (pure; no I/O).

A ruling is recorded only where the printed text decides a motion to exclude, strike, preclude or limit expert testimony, opinions or
reports (or a motion the text itself calls a Rule 702 or Daubert motion). Scheduling, stipulation, extension, discovery and briefing orders
are not rulings, even when they mention experts or Daubert. The outcome comes from the decretal words of the same clause:

  granted           "granting" / "is granted" (also "granted in its entirety")
  granted_in_part   any partial grant ("granting in part and denying in part", "... and denying in part as moot", "... reserving in part")
  denied            "denying" / "is denied" (also "without prejudice")
  denied_as_moot    "denying as moot" / "is denied as moot"
  deferred          only deferred / reserved / held in abeyance
  not_determined    anything else that still decides such a motion (e.g. "resolving", "denying in part and reserving in part")

The movant is the possessive printed before the word Motion ("Defendants' Motion", "Bard's Motion"); its side is 'plaintiffs' or
'defendants' only when those words are printed, else 'not_printed' (the name stays in movant_as_printed). Nothing is inferred.
"""
import re
import unicodedata

VERSION = "rulings-parse/1"
OUTCOMES = ("granted", "granted_in_part", "denied", "denied_as_moot", "deferred", "not_determined")
ABBREV = {"dr", "drs", "no", "nos", "inc", "co", "corp", "jr", "sr", "mr", "ms", "mrs", "st", "v", "vs", "ph", "sc", "m", "d", "u", "s", "fed", "r", "evid",
          "civ", "p", "doc", "docs", "ecf", "dkt", "f", "a", "c", "e", "dvm", "facs", "ltd", "llc", "al", "et", "seq", "approx", "hon"}

MOVANT = r"(?P<movant>(?:Defendants?|Plaintiffs?)(?:'s|s'|')?(?:\s+[A-Z][\w.&-]*(?:'s|s'))?|[A-Z][\w.&-]*(?:'s|s'))"
MOTION = re.compile(
    r"(?:(?P<num1>\(?\[?\d{2,6}\]?\)?)\s+)?(?:" + MOVANT + r"\s+)?(?:(?P<num2>\(?\[?\d{2,6}\]?\)?)\s+)?"
    r"(?P<kind>(?:Rule\s+702\s+|Omnibus\s+|Daubert\s+|Second\s+|Renewed\s+)*Motions?(?:\s+in\s+Limine(?:\s+No\.?\s*\d+)?)?)"
    r"(?:\s+\[[\d,\s]+\])?(?:\s+of\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})?\s+(?:to|To|TO)\s+(?P<verb>Exclude|Strike|Preclude|Limit)\b",
    re.I)
EXPERT_OBJECT = re.compile(r"\b(expert|experts|opinion|opinions|testimony|report|reports|Dr\.|Drs\.|Ph\.?\s?D|M\.?\s?D\.|Sc\.?D|D\.?V\.?M)", re.I)
PLAIN_702 = re.compile(r"\b(Rule\s+702|Daubert)\s+motions?\b", re.I)
NOT_RULING = re.compile(r"\b(stipulat\w*|schedul\w*|deadline\w*|due by|extension|extend\w*|excess pages|leave to file|protocol|continue\w*|"
                        r"show cause|clarification|compel\w*|preservation|briefing|modify|amend\w*|reply|replies|opposition brief)\b", re.I)
SIGNER = re.compile(
    r"(?:Signed(?:\s+\d{1,2}/\d{1,2}/\d{2,4})?\s+by|SIGNED\s+BY|(?<![A-Za-z])by|^|[\s(.;])\s*"
    r"(?P<title>the\s+Honorable|(?:(?:Senior|SENIOR|Chief|CHIEF|District|DISTRICT|U\.S\.|Magistrate|MAGISTRATE)\s+)*(?:Judge|JUDGE))\s+"
    r"(?P<name>[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4})")
NAME_ONLY = re.compile(r"(?:Dr\.\s+)?[A-Z][a-z'-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][A-Za-z'-]+){1,2}")


def norm(text):
    s = unicodedata.normalize("NFKC", text or "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).strip()


def fold(text):
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z ]", " ", s).split()


def sentences(text):
    """Split printed text into sentences at '. ' + capital, never after an abbreviation, an initial or a number."""
    out, start = [], 0
    for m in re.finditer(r"\.\s+(?=[A-Z(\[*])", text):
        before = text[start:m.start()].split()
        last = re.sub(r"[^A-Za-z]", "", before[-1]).lower() if before else ""
        if last in ABBREV or len(last) == 1 or (before and re.fullmatch(r"[\d/]+", before[-1])):
            continue
        out.append(text[start:m.start() + 1].strip())
        start = m.end()
    out.append(text[start:].strip())
    return [s for s in out if s]


def clauses(text):
    """Sentences split further at ';', 'IT IS FURTHER ORDERED' and ', and <disposition>' / ' and <DISPOSITION>' boundaries."""
    out = []
    for s in sentences(text):
        for piece in re.split(r";|\bIT IS (?:FURTHER )?ORDERED\b", s):
            # ', and denying ...' starts a new clause only after a motion was named ('granting in part and denying in part' stays whole)
            cut = 0
            for m in re.finditer(r",?\s+and\s+(?=(?:granting|denying)\b)", piece, re.I):
                if MOTION.search(piece[cut:m.start()]):
                    out.append(piece[cut:m.start()])
                    cut = m.end()
            out.append(piece[cut:])
    return [p.strip(" ,.") for p in out if p.strip(" ,.")]


def outcome_of(phrase):
    p = phrase.lower()
    grant = re.search(r"\bgrant\w*", p) is not None
    deny = re.search(r"\b(den(y|ie)\w*)", p) is not None
    moot = "moot" in p
    defer = re.search(r"\b(defer\w*|reserv\w*|abeyance)", p) is not None
    partial = "in part" in p
    if "in its entirety" in p and grant and not deny:
        return "granted"
    if partial:
        return "granted_in_part" if grant else "not_determined"
    if grant and not deny and not defer:
        return "granted"
    if deny and moot and not grant:
        return "denied_as_moot"
    if deny and not grant and not defer:
        return "denied"
    if defer and not grant and not deny:
        return "deferred"
    return "not_determined"


VERB = r"(?:grant\w*|deny\w*|denied|denies|defer\w*|reserv\w*|resolv\w*)"
MOD = r"(?:\s+(?:in\s+part|as\s+moot|in\s+its\s+entirety|without\s+prejudice))*"
DISPOSITION_BEFORE = re.compile(r"\b(" + VERB + MOD + r"(?:,?\s*(?:and\s+)?" + VERB + MOD + r")*(?:\s+as\s+moot\s+in\s+part)?)\b", re.I)
DISPOSITION_AFTER = re.compile(r"\b(?:is|are)\s+(?:hereby\s+)?((?:granted|denied|deferred|reserved)(?:[\w\s,]*?)(?=[.;]|$))", re.I)


def movant_side(movant):
    if not movant:
        return "not_printed", None
    m = movant.strip()
    low = m.lower()
    if low.startswith("plaintiff"):
        return "plaintiffs", m
    if low.startswith("defendant"):
        return "defendants", m
    return "not_printed", m


def trailer_dispositions(text):
    """ECF trailer ('by Judge X Denying 2291 Motion; Granting in Part and Denying in Part 2292 Motion'): [(number, outcome)]."""
    out = []
    for m in re.finditer(r"\b((?:Granting|Denying|granting|denying)(?:\s+(?:in\s+Part|as\s+Moot|in\s+part|as\s+moot)|\s+and\s+(?:Granting|Denying|granting|denying))*)\s+\(?(\d{2,6})\)?\s+Motion\b(?!\s+(?:to|for)\b)", text):
        out.append((m.group(2), outcome_of(m.group(1))))
    return out


def parse(text):
    """[{outcome, movant_side, movant_as_printed, motion_kind, motion_numbers, expert_as_printed, quote}] for one printed text."""
    t = norm(text)
    expert_text = EXPERT_OBJECT.search(t) is not None
    rulings = []
    for clause in clauses(t):
        motions = list(MOTION.finditer(clause))
        parts = []
        for i, m in enumerate(motions):
            end = motions[i + 1].start() if i + 1 < len(motions) else len(clause)
            obj = clause[m.end():end]
            passive = DISPOSITION_AFTER.search(obj)
            obj_text = obj[:passive.start()] if passive else obj
            joined = re.search(r"\s+and\s*$", obj_text) is not None  # '... Motion to Exclude X and 632 Motion to Exclude Y are DENIED'
            obj_text = re.split(r"\s+(?:Signed|SIGNED|by Judge|See |\(Related|\(Written|\(Doc|Ethicon is)", obj_text)[0].strip(" ,.")
            obj_text = re.sub(r"\s+and$", "", obj_text)
            parts.append({"m": m, "obj": obj_text, "passive": passive.group(1) if passive else None, "joined": joined})
        # a disposition printed after the last of several motions joined by 'and' applies to each of them; so does the movant printed first
        for i in range(len(parts) - 2, -1, -1):
            if parts[i]["passive"] is None and parts[i]["joined"] and parts[i + 1]["passive"]:
                parts[i]["passive"] = parts[i + 1]["passive"]
        movant = None
        for i, p in enumerate(parts):
            m = p["m"]
            mv = m.group("movant") or (movant if i and parts[i - 1]["joined"] else None)
            movant = mv
            obj_text = p["obj"]
            named_witness = expert_text and NAME_ONLY.fullmatch(obj_text) is not None
            if not (EXPERT_OBJECT.search(obj_text) or named_witness or re.search(r"Rule\s+702|Daubert", m.group("kind"), re.I)):
                continue
            head = clause[:m.start()]
            verbs = list(DISPOSITION_BEFORE.finditer(head))
            # the order decides something else (schedule, stipulation, leave to file, extension ...) about such a motion: the words
            # between the deciding verb (or the start, when the decision is printed after the motion) and the motion say so
            if NOT_RULING.search(head if p["passive"] or not verbs else head[verbs[-1].end():]):
                continue
            if p["passive"]:
                phrase = p["passive"]
            else:
                if not verbs:
                    continue
                phrase = verbs[-1].group(1)
            nums = sorted({re.sub(r"\D", "", n) for n in (m.group("num1"), m.group("num2")) if n})
            if m.group("kind").lower().rstrip().endswith("motions") and p["passive"]:
                bare = re.sub(r"(?i)(rule|evidence|evid\.)\s+702", " ", obj_text)
                nums = sorted(set(nums) | set(re.findall(r"\b(\d{3,6})\b", bare)))
            side, as_printed = movant_side(mv)
            rulings.append({"outcome": outcome_of(phrase), "movant_side": side, "movant_as_printed": as_printed, "motion_kind": m.group("kind"),
                            "motion_numbers": nums, "expert_as_printed": obj_text[:240], "quote": clause[:600], "plural": m.group("kind").lower().rstrip().endswith("motions")})
    # one plural headline + an ECF trailer of numbered motions: one ruling per numbered motion, outcome from the trailer
    tr = trailer_dispositions(t)
    if len(rulings) == 1 and rulings[0]["plural"] and not rulings[0]["motion_numbers"] and len(tr) > 1:
        base = rulings[0]
        rulings = [{**base, "outcome": o, "motion_numbers": [n], "quote": base["quote"]} for n, o in tr]
    # plural motions with several printed numbers (passive form): one ruling per number
    out = []
    for r in rulings:
        if r["plural"] and len(r["motion_numbers"]) > 1 and not tr:
            out += [{**r, "motion_numbers": [n]} for n in r["motion_numbers"]]
        else:
            out.append(r)
    for r in out:
        r.pop("plural", None)
    return out


def signers(text):
    """[(title, name)] of every judge printed as signing or entering the order."""
    t = norm(text)
    found = []
    for m in SIGNER.finditer(t):
        name = re.split(r"\s+(?:on|On|ON|Granting|Denying|granting|denying|See|in)\b", m.group("name"))[0].strip(" .,")
        found.append((m.group("title").strip(), name))
    for m in re.finditer(r"\bJudge\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}\s+and\s+(?:(?P<mt>Magistrate\s+Judge)\s+)?(?P<name>[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4})", t):
        name = re.split(r"\s+(?:on|On)\b", m.group("name"))[0].strip(" .,")
        found.append(((m.group("mt") or "Judge").strip(), name))
    seen, out = set(), []
    for title, name in found:
        key = tuple(fold(name))
        if key and key not in seen:
            seen.add(key)
            out.append((title, name))
    return out


def surname(name):
    words = [w for w in fold(name) if w not in {"jr", "sr", "ii", "iii", "iv"}]
    return words[-1] if words else None


def attribution(text, judge_name):
    """(basis, signer) for attributing a ruling in an MDL to the MDL's exactly linked transferee judge."""
    t = norm(text)
    if re.search(r"report\s+and\s+recommendation", t, re.I):
        return "report_and_recommendation", None
    if not judge_name:
        return "mdl_judge_not_linked", None
    sig = signers(t)
    if any("magistrate" in title.lower() for title, _ in sig) or re.search(r"\bMagistrate\s+Judge\b", t, re.I):
        return "magistrate_judge_named", "; ".join(n for _, n in sig) or None
    if not sig:
        return "no_signer_printed", None
    if len(sig) > 1:
        return "several_signers", "; ".join(n for _, n in sig)
    _, name = sig[0]
    if surname(name) and surname(name) == surname(judge_name) and first_given_compatible(name, judge_name):
        return "mdl_transferee_judge+printed_signer", name
    return "signer_differs", name


def first_given(name):
    words = [w for w in fold(name) if w not in {"jr", "sr", "ii", "iii", "iv"}]
    return words[0] if len(words) >= 2 else None


def first_given_compatible(signer, judge_name):
    """The printed signer's first given name (or initial) agrees with the linked judge's: the same word, or a lone initial of the same
    letter ('M CASEY RODGERS' and Margaret Catharine Rodgers). A signer printed with no given name, or with another one, never agrees."""
    a, b = first_given(signer), first_given(judge_name)
    if not a or not b:
        return False
    if len(a) == 1 or len(b) == 1:
        return a[0] == b[0]
    return a == b
