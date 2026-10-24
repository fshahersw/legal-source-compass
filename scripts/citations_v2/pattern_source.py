"""Hand-written part of the canonical citation pattern table (citations-v2).

This module only declares data. `build_patterns.py` combines it with the vendored Free Law Project reporter list
(scripts/vendor/reporters-db) and writes the one table both runtimes read:

  src/lib/citations/patterns.json      the table (Python engine: scripts/citations_v2/engine.py)
  src/lib/citations/patterns.data.ts   the same table as a TypeScript module (TS engine, Deno edge function)

Pattern dialect (checked by build_patterns.py; both engines compile it the same way):
  * JavaScript regular-expression syntax without the u flag: \\w and \\d are ASCII, \\s is JavaScript whitespace
    (the Python engine rewrites the three classes into explicit sets);
  * named groups are written (?<name>...) (the Python engine rewrites them to (?P<name>...));
  * lookbehinds have a fixed width; no \\b, no atomic groups, no possessive quantifiers, no inline flags, no "." wildcard,
    no named backreferences, no {,n} quantifiers;
  * {{NAME}} inserts fragment NAME (fragments may use other fragments).
Rule fields: id, kind, builder, pattern, flags ("" or "i"), priority (wins a tie on the same span), anchors (literal
strings; the rule runs only when one occurs in the text), and builder options (templates, item patterns, ...).
Templates: {group|filter|...} with filters int, upper, lower, squash, nospace, dash, roman, nocomma, slug, state,
rule_set, strip_sign; [ ... ] is kept only when every group inside it is non-empty.
"""

from __future__ import annotations

VERSION = "citations-v2/2026-10-25.5"

# ------------------------------------------------------------------------------------------------ fragments
FRAGMENTS: dict[str, str] = {
    # not directly after a word character or a period (a citation never starts inside a word or a number)
    "NB": r"(?<![\w.])",
    "SUBS": r"(?:\([a-zA-Z0-9]{1,5}\))*",
    "RANGE": r"\s*(?:[-–—]|\s(?:to|through)\s)\s*",
    "LIST_SEP": r"\s*(?:,\s*(?:and\s+|or\s+|&\s*)?|(?:and|or|&)\s+)",
    # a list item never starts the next citation ("§§ 1983, 1985 and 18 U.S. 1": the "18" belongs to the case)
    "NOT_NEXT": (
        r"(?![\d\s]*(?:U\.?\s?S|C\.?\s?F\.?\s?R|Stat\.|Fed\.\s?Reg|F\.\s?R\.|FR(?![A-Za-z0-9_])|Pub\.|P\.\s?L\.|"
        r"[A-Z][A-Za-z]{0,12}\.(?:\s?[A-Z0-9][A-Za-z0-9'’]{0,12}\.?){0,4}\s+\d))"
    ),
    # a section number split by a text-layer space before its last character ("§ 1301.7 l(a)" for § 1301.71(a)) is not
    # read as a shorter, different section
    "NO_SPLIT": r"(?![.\d]*[ ][A-Za-z0-9]\()",
    # U.S.C. sections: "1983", "78j", "2000e-2", "1320a-7b" (a hyphen follows letters; digit-hyphen-digit is a range)
    "USC_SEC": r"\d{1,6}(?:[a-zA-Z]{1,4}(?:-\d{1,4}[a-zA-Z]{0,4})*)?",
    # C.F.R. section after the part: "9", "10b-5", "401(k)-1", never swallowing a following "-63.15" range end
    "CFR_SEC": r"\d{1,6}[a-zA-Z]{0,4}(?:(?:\([a-z0-9]{1,4}\)){0,3}-\d{1,4}[a-zA-Z]{0,4}(?!\.\d))*",
    "USC_ITEM": r"{{USC_SEC}}{{SUBS}}(?:{{RANGE}}{{USC_SEC}}{{SUBS}})?{{NO_SPLIT}}",
    "CFR_NUM": r"\d{1,5}(?:\.{{CFR_SEC}})?",
    "CFR_ITEM": r"{{CFR_NUM}}{{SUBS}}(?:{{RANGE}}{{CFR_NUM}}{{SUBS}})?{{NO_SPLIT}}",
    # further paragraphs of the same C.F.R. section: "52.38(a)(5)(iv)-(v), (a)(6), (b)(10)(i)" (pins of that one section)
    "CFR_SUBS_TAIL": (r"(?:\s*[-–]\s*(?:\([a-zA-Z0-9]{1,5}\))+)?"
                      r"(?:\s*,\s*(?:\([a-zA-Z0-9]{1,5}\))+(?:\s*[-–]\s*(?:\([a-zA-Z0-9]{1,5}\))+)?)*"),
    # C.F.R. lists also run on semicolons ("40 CFR 52.38(a)(2), (b)(2); 52.39(c); 52.2140")
    "CFR_LIST_SEP": r"\s*(?:[,;]\s*(?:and\s+|or\s+|&\s*)?|(?:and|or|&)\s+)",
    "SEC_LABEL": r"(?:§§|§|[Ss]ecs?\.|[Ss]ections?|SECS?\.|SECTIONS?)",
    # pin cites
    "PIN_PAGE": r"\*{0,2}\d{1,7}(?:\s*[-–—]\s*\*{0,2}\d{1,7})?(?:\s*nn?\.\s*\d{1,3}(?:\s*[-–&]\s*\d{1,3})?)?",
    # state code sections: "13-202", "2A:58C-2", "95.11(3)", "17200", "5/13-202"
    # a hyphen at a line break continues the section ("24-5-0.5-\n2(a)(8)", "24-5-0.5- 2(a)(8)"); the key drops the break
    "STATE_SEC": r"[0-9][0-9A-Za-z]*(?:(?:[.:/–—]|-(?:[ \t]{0,2}\n?[ \t]{0,2})?)[0-9A-Za-z]+)*(?:\([0-9A-Za-z]{1,5}\))*",
    # states whose section is chapter.section with exactly one dot (a second ".4" is a footnote glued to the citation);
    # the UCC chapters add an article-section part: Mo. "400.2-313", Minn. "336.2-313", "400.4A-101"
    "STATE_SEC_DOTTED": r"[0-9]{1,4}[A-Z]?\.[0-9]{1,5}[A-Za-z]?(?:-[0-9]{1,4}[A-Za-z]?)?(?:\([0-9A-Za-z]{1,5}\))*(?!\.?[0-9])",
    # administrative-code sections: "335-3-1-.02", "R18-2-101", "7:26-1.4", "26.11.01.01", "Env-A 101.01"
    "REG_SEC": r"(?:R\s?)?[0-9][0-9A-Za-z]*(?:(?:[.:\-–]|-\.)[0-9A-Za-z]+)*(?:\([0-9A-Za-z]{1,5}\))*",
    "STATE_TAIL": r"(?![A-Za-z0-9_])(?!\s+Supp\.)(?![-–]\s)(?![¬­])",
    "SIGN": r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?)\s*",
    "OPT_SIGN": r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?)?\s*",
    "ANN": r"(?:\s+Ann\.)?",
    "WORD": r"(?:[A-Z][A-Za-z'’]*\.?|&)",
    "ROMAN_OR_NUM": r"(?:[IVXLC]{1,7}|\d{1,3}[A-Za-z]?)",
}

# Case-name capture and parentheticals (used by the case builder).
CASE = {
    # signal words stripped from the front of a captured case name
    "signals": (
        r"^(?:(?:[Ss]ee|[Cc]f\.|[Bb]ut|[Aa]ccord|[Cc]ompare|[Cc]ontra|[Aa]lso|[Gg]enerally|[Ee]\.\s?g\.,?|"
        r"[Qq]uoting|[Cc]iting|[Aa]nd|[Ww]ith|[Ii]n|[Aa]ff'd|[Rr]ev'd|[Aa]ff’d|[Rr]ev’d|[Cc]ert\.|[Dd]enied|"
        r"[Pp]er|[Ss]ub\s+nom\.)[,]?\s+)+"
    ),
    "name_tail": (
        r"(?<name>(?:(?:In\s+re|IN\s+RE|Ex\s+parte|EX\s+PARTE|(?:In\s+the\s+)?Matter\s+of|Estate\s+of|Application\s+of|"
        r"Petition\s+of)\s+[A-Z0-9][^,;()\n]{0,80}?|[A-Z0-9][^;()]{0,120}?\s+v(?:s)?\.?\s+[A-Za-z0-9][^;()]{0,120}?))\s*,\s*$"
    ),
    # words that never end a sentence when followed by a period (Bluebook T6 and common name abbreviations)
    "abbreviations": sorted({
        "no", "nos", "v", "vs", "inc", "co", "corp", "ltd", "llc", "l.l.c", "l.p", "lp", "mr", "mrs", "ms", "dr", "jr",
        "sr", "st", "cir", "fed", "supp", "e.g", "i.e", "etc", "stat", "reg", "cf", "al", "ex", "art", "ch", "sec",
        "secs", "p", "pp", "para", "app", "ct", "dist", "id", "ann", "rev", "gen", "civ", "proc", "prac", "rem", "dkt",
        "doc", "ecf", "hon", "u.s", "u.s.c", "c.f.r", "dept", "dep't", "assn", "ass'n", "int'l", "nat'l", "bros",
        "mfg", "pub", "bd", "comm'n", "cnty", "cty", "sch", "dist", "twp", "auth", "educ", "envtl", "gov't", "indus",
        "mgmt", "transp", "tel", "univ", "hosp", "med", "fin", "mut", "sav", "ctr", "ins", "elec", "prods", "liab",
        "litig", "pharm", "pharms", "servs", "sys", "tech", "am", "cal", "n.y", "ill", "tex", "fla", "pa", "mass",
        "mich", "ohio", "wash", "ga", "va", "md", "minn", "mo", "wis", "la", "ky", "ala", "ariz", "colo", "conn",
        "del", "haw", "ind", "kan", "me", "miss", "mont", "neb", "nev", "n.j", "n.m", "n.c", "n.d", "n.h", "okla",
        "or", "r.i", "s.c", "s.d", "tenn", "vt", "w.va", "wyo", "assocs", "agric", "admin", "advert", "amend", "ass",
        "bhd", "bldg", "cas", "chem", "cmty", "commc'ns", "comp", "cont'l", "coop", "corr", "crim", "def", "dev",
        "distrib", "div", "econ", "emp", "eng'g", "ent", "equip", "exch", "fid", "gen", "grp", "guar", "hous",
        "info", "inst", "inv", "invs", "lab", "mach", "mkt", "mktg", "muni", "mun", "nw", "ne", "se", "sw", "org",
        "pers", "prop", "prot", "pub", "rehab", "res", "ret", "rr", "ry", "sec", "serv", "soc'y", "sols", "steamship",
        "subcomm", "sur", "tr", "util", "vill", "w", "e", "n", "s", "rel", "seq", "op", "cert", "nn", "cl", "pt", "pts",
        "subch", "subd", "paras", "vol", "ed", "eds", "viz", "approx", "aff'd", "rev'd", "aff’d", "rev’d", "dkt", "nos",
    }),
    "paren": (
        r"^\s*\((?<court>[^()]{0,80}?)\s*(?<date>(?:(?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?"
        r"\s+\d{1,2},?\s+)?(?<year>1[6-9]\d\d|20\d\d))\)"
    ),
    "pin": r"^,\s*(?:at\s+)?(?<pin>{{PIN_PAGE}}(?:\s*,\s*{{PIN_PAGE}})*)",
    "join": r"^\s*,\s*$",
}

# Pins after other kinds ("85 Fed. Reg. 12,345, 12,350"; "124 Stat. 119, 242"; "Pub. L. No. 111-148, § 1501").
PINS = {
    "federal_register": r"^,\s*(?:at\s+)?(?<pin>(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\s*[-–—]\s*(?:\d{1,3}(?:,\d{3})+|\d{1,6}))?)",
    "statutes_at_large": r"^,\s*(?:at\s+)?(?<pin>\d{1,5}(?:\s*[-–—]\s*\d{1,5})?)",
    "public_law": r"^,\s*(?<pin>(?:§§?|[Ss]ec\.)\s*\d[0-9A-Za-z.\-–]*{{SUBS}})",
}

# ------------------------------------------------------------------------------------------------ states
# USPS -> Bluebook T10 abbreviation(s) and full name (used by constitutions and statute/regulation names).
STATES: dict[str, list[str]] = {
    "AL": ["Ala.", "Alabama"], "AK": ["Alaska"], "AZ": ["Ariz.", "Arizona"], "AR": ["Ark.", "Arkansas"],
    "CA": ["Cal.", "Calif.", "California"], "CO": ["Colo.", "Colorado"], "CT": ["Conn.", "Connecticut"],
    "DE": ["Del.", "Delaware"], "DC": ["D.C.", "District of Columbia"], "FL": ["Fla.", "Florida"],
    "GA": ["Ga.", "Georgia"], "HI": ["Haw.", "Hawaii"], "ID": ["Idaho"], "IL": ["Ill.", "Illinois"],
    "IN": ["Ind.", "Indiana"], "IA": ["Iowa"], "KS": ["Kan.", "Kans.", "Kansas"], "KY": ["Ky.", "Kentucky"],
    "LA": ["La.", "Louisiana"], "ME": ["Me.", "Maine"], "MD": ["Md.", "Maryland"], "MA": ["Mass.", "Massachusetts"],
    "MI": ["Mich.", "Michigan"], "MN": ["Minn.", "Minnesota"], "MS": ["Miss.", "Mississippi"], "MO": ["Mo.", "Missouri"],
    "MT": ["Mont.", "Montana"], "NE": ["Neb.", "Nebraska"], "NV": ["Nev.", "Nevada"], "NH": ["N.H.", "New Hampshire"],
    "NJ": ["N.J.", "New Jersey"], "NM": ["N.M.", "New Mexico"], "NY": ["N.Y.", "New York"],
    "NC": ["N.C.", "North Carolina"], "ND": ["N.D.", "North Dakota"], "OH": ["Ohio"], "OK": ["Okla.", "Oklahoma"],
    "OR": ["Or.", "Ore.", "Oregon"], "PA": ["Pa.", "Penn.", "Pennsylvania"], "RI": ["R.I.", "Rhode Island"],
    "SC": ["S.C.", "South Carolina"], "SD": ["S.D.", "South Dakota"], "TN": ["Tenn.", "Tennessee"],
    "TX": ["Tex.", "Texas"], "UT": ["Utah"], "VT": ["Vt.", "Vermont"], "VA": ["Va.", "Virginia"],
    "WA": ["Wash.", "Washington"], "WV": ["W. Va.", "W.Va.", "West Virginia"], "WI": ["Wis.", "Wisc.", "Wisconsin"],
    "WY": ["Wyo.", "Wyoming"],
}

# ------------------------------------------------------------------------------------------------ state statutes
# (USPS, code id, form before the section, dotted?). The code id groups spellings of one compilation (Bluebook and the
# official short form); "*" means the compilation is named in the citation ("Cal. Bus. & Prof. Code", "N.Y. Gen. Bus.
# Law", "Tex. Civ. Prac. & Rem. Code", "Md. Code Ann., Cts. & Jud. Proc."): the code id is then the slug of the name.
# Each form names one state; the state is never inferred from context.
STATE_STATUTES: list[tuple[str, str, str]] = [
    ("AL", "code", r"Ala\.\s+Code{{ANN}}{{SIGN}}"),
    ("AK", "stat", r"Alaska\s+Stat\.{{ANN}}{{SIGN}}"),
    ("AZ", "rev-stat", r"(?:Ariz\.\s+Rev\.\s+Stat\.{{ANN}}|A\.R\.S\.){{SIGN}}"),
    ("AR", "code", r"Ark\.\s+Code{{ANN}}{{SIGN}}"),
    ("CA", "*", r"Cal\.\s+(?:{{WORD}}\s+){1,5}Code{{ANN}}{{SIGN}}"),
    ("CA", "civ-proc", r"Cal\.\s+Code\s+Civ\.\s+Proc\.{{SIGN}}"),
    ("CO", "rev-stat", r"(?:Colo\.\s+Rev\.\s+Stat\.{{ANN}}|C\.R\.S\.){{SIGN}}"),
    ("CT", "gen-stat", r"Conn\.\s+Gen\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("DE", "code", r"Del\.\s+Code{{ANN}}\s+tit\.\s*(?<title>\d{1,2}),?{{SIGN}}"),
    ("DE", "code", r"(?<title>\d{1,2})\s+Del\.\s+(?:C\.|Code{{ANN}}){{SIGN}}"),
    ("DC", "code", r"D\.C\.\s+Code{{ANN}}{{SIGN}}"),
    ("FL", "stat", r"Fla\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("GA", "code", r"(?:O\.C\.G\.A\.|Ga\.\s+Code{{ANN}}){{SIGN}}"),
    ("HI", "rev-stat", r"(?:Haw\.\s+Rev\.\s+Stat\.{{ANN}}|HRS){{SIGN}}"),
    ("ID", "code", r"Idaho\s+Code{{ANN}}{{SIGN}}"),
    ("IL", "ilcs", r"(?<title>\d{1,4})\s+(?:ILCS|Ill\.\s+Comp\.\s+Stat\.{{ANN}})\s+(?<act>\d{1,4}[A-Za-z]?)/"),
    ("IL", "rev-stat", r"Ill\.\s+Rev\.\s+Stat\.(?:\s+\d{4})?,?\s+ch\.\s*(?<chapter>\d{1,3}(?:\s?1/2)?),?\s+(?:par\.|¶|pars\.|¶¶)\s*"),
    ("IN", "code", r"Ind\.\s+Code{{ANN}}{{SIGN}}"),
    ("IA", "code", r"Iowa\s+Code{{ANN}}{{SIGN}}"),
    ("KS", "stat", r"(?:Kan\.\s+Stat\.{{ANN}}|K\.S\.A\.)(?:\s+\d{4}\s+Supp\.)?{{OPT_SIGN}}"),
    ("KY", "rev-stat", r"(?:Ky\.\s+Rev\.\s+Stat\.{{ANN}}|KRS){{OPT_SIGN}}"),
    ("LA", "rev-stat", r"(?:La\.\s+R\.\s?S\.|La\.\s+Rev\.\s+Stat\.{{ANN}}|La\.\s+Stat\.{{ANN}}){{OPT_SIGN}}"),
    ("LA", "civ-code", r"La\.\s+Civ\.\s+Code{{ANN}}\s+(?:art\.|arts\.|Art\.)\s*"),
    ("ME", "rev-stat", r"(?:Me\.\s+(?:Rev\.\s+)?Stat\.{{ANN}}\s+tit\.\s*(?<title>\d{1,2}(?:-[A-Z])?),?|(?<title2>\d{1,2}(?:-[A-Z])?)\s+M\.R\.S\.(?:A\.)?){{SIGN}}"),
    ("MD", "*", r"Md\.\s+Code{{ANN}},?\s*(?:{{WORD}}\s+){1,6}(?=§){{SIGN}}"),
    ("MA", "gen-laws", r"(?:Mass\.\s+Gen\.\s+Laws(?:\s+Ann\.)?|Mass\.\s+Ann\.\s+Laws|M\.G\.L\.(?:A\.)?|G\.\s?L\.)\s+(?:[Cc]h\.\s*|c\.\s*)?(?<chapter>\d{1,3}[A-Z]{0,2}),?{{SIGN}}"),
    ("MI", "comp-laws", r"(?:Mich\.\s+Comp\.\s+Laws(?:\s+Ann\.|\s+Serv\.)?|MCL){{SIGN}}"),
    ("MN", "stat", r"Minn\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("MS", "code", r"Miss\.\s+Code{{ANN}}{{SIGN}}"),
    ("MO", "rev-stat", r"(?:Mo\.\s+(?:Rev\.\s+)?Stat\.{{ANN}}|Mo\.\s+Ann\.\s+Stat\.|RSMo){{SIGN}}"),
    ("MT", "code", r"Mont\.\s+Code{{ANN}}{{SIGN}}"),
    ("NE", "rev-stat", r"Neb\.\s+Rev\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("NV", "rev-stat", r"(?:Nev\.\s+Rev\.\s+Stat\.{{ANN}}|NRS){{OPT_SIGN}}"),
    ("NH", "rev-stat", r"(?:N\.H\.\s+Rev\.\s+Stat\.{{ANN}}|RSA){{SIGN}}"),
    ("NJ", "stat", r"(?:N\.J\.S\.A\.|N\.J\.\s+(?:Rev\.\s+)?Stat\.{{ANN}}){{OPT_SIGN}}"),
    ("NM", "stat", r"(?:N\.M\.\s+Stat\.{{ANN}}|NMSA\s+1978,?){{OPT_SIGN}}"),
    ("NY", "*", r"N\.Y\.\s+(?:{{WORD}}\s+){0,4}(?:Law|L\.)(?:\s+Ann\.)?{{SIGN}}"),
    ("NY", "cplr", r"(?:N\.Y\.\s*)?C\.P\.L\.R\.\s*(?:§§?\s*|[Rr]ule\s+)?"),
    ("NC", "gen-stat", r"N\.C\.\s+Gen\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("ND", "cent-code", r"N\.D\.\s+Cent\.\s+Code{{ANN}}{{SIGN}}"),
    ("OH", "rev-code", r"(?:Ohio\s+Rev\.\s+Code{{ANN}}|R\.C\.){{SIGN}}"),
    ("OK", "stat", r"Okla\.\s+Stat\.{{ANN}}\s+tit\.\s*(?<title>\d{1,2}),?{{SIGN}}"),
    ("OK", "stat", r"(?<title>\d{1,2})\s+Okla\.\s+Stat\.{{ANN}}{{SIGN}}"),
    ("OR", "rev-stat", r"(?:Or\.\s+Rev\.\s+Stat\.{{ANN}}|ORS){{OPT_SIGN}}"),
    ("PA", "cons-stat", r"(?<title>\d{1,3})\s+(?:Pa\.\s*C\.\s*S\.(?:\s*A\.)?|Pa\.\s+Cons\.\s+Stat\.{{ANN}}|Pa\.\s+Stat\.\s+and\s+Cons\.\s+Stat\.{{ANN}}){{SIGN}}"),
    ("PA", "stat", r"(?<title>\d{1,3})\s+(?:Pa\.\s+Stat\.{{ANN}}|P\.S\.){{SIGN}}"),
    ("RI", "gen-laws", r"R\.I\.\s+Gen\.\s+Laws{{ANN}}{{SIGN}}"),
    ("SC", "code", r"S\.C\.\s+Code{{ANN}}{{SIGN}}"),
    ("SD", "cod-laws", r"(?:S\.D\.\s+Codified\s+Laws|SDCL){{SIGN}}"),
    ("TN", "code", r"Tenn\.\s+Code{{ANN}}{{SIGN}}"),
    ("TX", "*", r"Tex\.\s+(?:{{WORD}}\s+){1,6}Code{{ANN}}{{SIGN}}"),
    ("UT", "code", r"Utah\s+Code{{ANN}}{{SIGN}}"),
    ("VT", "stat", r"Vt\.\s+Stat\.{{ANN}}\s+tit\.\s*(?<title>\d{1,2}),?{{SIGN}}"),
    ("VA", "code", r"Va\.\s+Code{{ANN}}{{SIGN}}"),
    ("WA", "rev-code", r"(?:Wash\.\s+Rev\.\s+Code{{ANN}}|RCW){{OPT_SIGN}}"),
    ("WV", "code", r"W\.\s?Va\.\s+Code{{ANN}}{{SIGN}}"),
    ("WI", "stat", r"Wis\.\s+Stat\.{{ANN}}{{OPT_SIGN}}"),
    ("WY", "stat", r"Wyo\.\s+Stat\.{{ANN}}{{SIGN}}"),
]
# states whose section number is chapter.section with exactly one dot (src/lib/law/exactCitationPath.ts DOTTED_PATH_STATES)
DOTTED_STATES = ["FL", "IA", "KY", "MI", "MN", "MO", "NV", "OH", "OR", "WI"]

# ------------------------------------------------------------------------------------------------ state regulations
# (USPS, code id, pattern). Bluebook T1 administrative compilations (checked against reporters-db laws.json) and the
# official short forms printed by each publisher. The section is the named group "sec" (REG_SEC unless given).
STATE_REGULATIONS: list[tuple[str, str, str]] = [
    ("AL", "admin-code", r"Ala\.\s+Admin\.\s+Code\s+(?:r\.\s*)?(?<sec>{{REG_SEC}})"),
    ("AK", "admin-code", r"Alaska\s+Admin\.\s+Code\s+tit\.\s*(?<title>\d{1,2}),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("AK", "admin-code", r"(?<title>\d{1,2})\s+AAC\s+(?<sec>\d{1,3}\.\d{3}{{SUBS}})"),
    ("AZ", "admin-code", r"(?:Ariz\.\s+Admin\.\s+Code|A\.A\.C\.)\s*(?:§§?\s*)?(?<sec>R\d{1,2}-\d{1,2}-\d{1,4}[A-Z]?{{SUBS}})"),
    ("AR", "code-r", r"(?:(?<title>\d{3}\.\d{2}\.\d{1,3})\s+)?Ark\.\s+Code\s+R\.\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("CA", "code-regs", r"Cal\.\s+Code\s+(?:of\s+)?Regs\.,?\s+tit\.\s*(?<title>\d{1,2}),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("CA", "code-regs", r"(?<title>\d{1,2})\s+(?:C\.C\.R\.|CCR|Cal\.\s+Code\s+Regs\.)\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("CA", "code-regs", r"[Tt]itle\s+(?<title>\d{1,2})\s+of\s+(?:the\s+)?California\s+Code\s+of\s+Regulations,?\s*(?:§§?|[Ss]ections?)\s*(?<sec>{{REG_SEC}})"),
    ("CO", "code-regs", r"(?<title>\d{1,2})\s+(?:Colo\.\s+Code\s+Regs\.|CCR)\s+(?:§§?\s*)?(?<sec>\d{3,4}-\d{1,3}(?::[0-9.]+)?{{SUBS}})"),
    ("CT", "agencies-regs", r"(?:Conn\.\s+Agencies\s+Regs\.|R\.C\.S\.A\.)\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("DE", "admin-code", r"(?<title>\d{1,2})\s+(?:Del\.|DE)\s+Admin\.\s+Code\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("DC", "mun-regs", r"D\.C\.\s+(?:Code\s+)?Mun\.\s+Regs\.,?\s+tit\.\s*(?<title>\d{1,2}[A-Z]?),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("DC", "mun-regs", r"(?<title>\d{1,2}[A-Z]?)\s+DCMR\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("FL", "admin-code", r"Fla\.\s+Admin\.\s+Code(?:\s+Ann\.)?\s+(?:[Rr]\.|[Rr]ule)\s*(?<sec>\d{1,3}[A-Z]{0,2}-\d{1,3}\.\d{1,4}{{SUBS}})"),
    ("FL", "admin-code", r"(?:[Rr]ule\s+)(?<sec>\d{1,3}[A-Z]{0,2}-\d{1,3}\.\d{1,4}{{SUBS}}),?\s+(?:F\.A\.C\.|Fla\.\s+Admin\.\s+Code)"),
    ("GA", "comp-r-regs", r"Ga\.\s+Comp\.\s+R\.\s+&\s+Regs\.\s*(?:r\.\s*)?(?<sec>{{REG_SEC}})"),
    ("HI", "code-r", r"(?:Haw\.\s+Code\s+R\.|Haw\.\s+Admin\.\s+R\.|HAR)\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("ID", "admin-code", r"(?:Idaho\s+Admin\.\s+Code\s+r\.|IDAPA)\s*(?<sec>\d{2}\.\d{2}\.\d{2}(?:\.\d{3})?{{SUBS}})"),
    ("IL", "admin-code", r"Ill\.\s+Admin\.\s+Code\s+tit\.\s*(?<title>\d{1,2}),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("IL", "admin-code", r"(?<title>\d{1,2})\s+Ill\.\s+Adm(?:in)?\.\s+Code\s+(?:§§?\s*)?(?<sec>\d{1,4}\.\d{1,5}{{SUBS}})"),
    ("IN", "admin-code", r"(?<title>\d{1,3})\s+Ind\.\s+Admin\.\s+Code\s+(?<sec>{{REG_SEC}})"),
    ("IA", "admin-code", r"Iowa\s+Admin\.\s+Code\s+r\.\s*(?<sec>{{REG_SEC}})"),
    ("KS", "admin-regs", r"(?:Kan\.\s+Admin\.\s+Regs\.|K\.A\.R\.)\s*(?:§§?\s*)?(?<sec>\d{1,3}-\d{1,3}-\d{1,4}[a-z]?{{SUBS}})"),
    ("KY", "admin-regs", r"(?<title>\d{1,3})\s+(?:Ky\.\s+Admin\.\s+Regs\.|KAR)\s+(?<sec>\d{1,3}[ ]?:\d{2,3}{{SUBS}})"),
    ("LA", "admin-code", r"La\.\s+Admin\.\s+Code\s+tit\.\s*(?<title>\d{1,2}),?\s*(?:pt\.\s*(?<part>[IVXL]{1,6}),?\s*)?§§?\s*(?<sec>{{REG_SEC}})"),
    ("LA", "admin-code", r"L\.?A\.?C\.?\s+(?<title>\d{1,2}):(?<part>[IVXL]{1,6})\.(?<sec>\d{1,4}{{SUBS}})"),
    ("ME", "code-r", r"(?<title>\d{2}-\d{3})\s+(?:Me\.\s+Code\s+R\.|C\.M\.R\.|CMR)\s*(?:ch\.|§§?)?\s*(?<sec>\d{1,4}{{SUBS}})"),
    ("MD", "code-regs", r"(?:Md\.\s+Code\s+Regs\.|COMAR)\s*(?<sec>\d{2}\.\d{2}\.\d{2}(?:\.\d{2,3})?{{SUBS}})"),
    ("MA", "code-regs", r"(?<title>\d{3})\s+(?:Mass\.\s+Code\s+Regs\.|C\.M\.R\.|CMR)\s*(?:§§?\s*)?(?<sec>\d{1,3}\.\d{2,3}(?:[-–]\d{2,3}(?![\d.]))?{{SUBS}})"),
    ("MI", "admin-code", r"Mich\.\s+Admin\.\s+Code\s+(?:r\.|R)\s*(?<sec>\d{1,3}\.\d{1,5}[a-z]?{{SUBS}})"),
    ("MN", "rules", r"Minn\.\s+R\.\s*(?:pt\.\s*)?(?<sec>\d{4}\.\d{4}{{SUBS}})"),
    ("MS", "code-r", r"(?<title>\d{1,2}-\d{1,3})\s+Miss\.\s+Code\s+R\.\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("MO", "code-regs", r"Mo\.\s+Code\s+(?:of\s+State\s+)?Regs\.(?:\s+Ann\.)?\s+tit\.\s*(?<title>\d{1,2}),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("MO", "code-regs", r"(?<title>\d{1,2})\s+CSR\s+(?<sec>\d{1,3}-\d{1,3}\.\d{2,4}{{SUBS}})"),
    ("MT", "admin-r", r"(?:Mont\.\s+Admin\.\s+R\.|ARM)\s+(?<sec>\d{1,2}\.\d{1,3}\.\d{3,4}{{SUBS}})"),
    ("NE", "admin-code", r"(?<title>\d{1,3})\s+Neb\.\s+Admin\.\s+Code\s*(?:ch\.\s*|§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("NV", "admin-code", r"(?:Nev\.\s+Admin\.\s+Code|NAC)\s*(?:ch\.\s*|§§?\s*)?(?<sec>\d{1,3}[A-Z]?\.\d{1,4}{{SUBS}})"),
    ("NH", "code-admin-r", r"N\.H\.\s+Code\s+Admin\.\s+R\.(?:\s+Ann\.)?\s*(?<agency>[A-Z][A-Za-z]{1,8}(?:-[A-Z][a-z]{0,3})?)\s*(?<sec>\d{1,4}\.\d{1,3}{{SUBS}})"),
    ("NJ", "admin-code", r"(?:N\.J\.\s+Admin\.\s+Code|N\.J\.A\.C\.)\s*(?:§§?\s*)?(?<sec>\d{1,2}[A-Z]?:\d{1,3}[A-Z]?-\d{1,3}(?:\.\d{1,3})?{{SUBS}})"),
    ("NM", "code-r", r"N\.M\.\s+(?:Code\s+R\.|Admin\.\s+Code)\s*(?:§§?\s*)?(?<sec>\d{1,2}\.\d{1,3}\.\d{1,3}(?:\.\d{1,4})?{{SUBS}})"),
    ("NM", "code-r", r"(?<sec>\d{1,2}\.\d{1,3}\.\d{1,3}(?:\.\d{1,4})?{{SUBS}})\s+NMAC"),
    ("NY", "comp-codes", r"N\.Y\.\s+Comp\.\s+Codes\s+R\.\s+&\s+Regs\.,?\s+tit\.\s*(?<title>\d{1,2}[A-Z]?),?\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("NY", "comp-codes", r"(?<title>\d{1,2}[A-Z]?)\s+N\.?Y\.?C\.?R\.?R\.?\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("NC", "admin-code", r"(?<title>\d{1,2}[A-Z]?)\s+(?:N\.C\.\s+Admin\.\s+Code|NCAC)\s+(?<sec>\d{1,2}[A-Z]{1,2}\s?\.\d{4}{{SUBS}})"),
    ("ND", "admin-code", r"(?:N\.D\.\s+Admin\.\s+Code|N\.D\.A\.C\.)\s*(?:§§?\s*)?(?<sec>\d{2,3}-\d{2}-\d{2}(?:-\d{2}(?:\.\d)?)?{{SUBS}})"),
    ("OH", "admin-code", r"(?:Ohio\s+Admin\.\s+Code|Ohio\s+Adm\.\s?Code|O\.A\.C\.)\s*(?:§§?\s*)?(?<sec>\d{3,4}(?::\d{1,2})?-\d{1,3}-\d{2}(?:\.\d{1,3})?{{SUBS}})"),
    ("OK", "admin-code", r"(?:Okla\.\s+Admin\.\s+Code|OAC)\s*(?:§§?\s*)?(?<sec>\d{2,3}:\d{1,3}-\d{1,3}-\d{1,3}{{SUBS}})"),
    ("OR", "admin-r", r"(?:Or\.\s+Admin\.\s+R\.|OAR)\s*(?<sec>\d{3}-\d{3}-\d{4}{{SUBS}})"),
    ("PA", "code", r"(?<title>\d{1,3})\s+Pa\.\s+Code\s*§§?\s*(?<sec>{{REG_SEC}})"),
    ("RI", "code-r", r"(?:(?<title>\d{1,3}-\d{1,3})\s+R\.I\.\s+Code\s+R\.\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})|(?<sec2>\d{3}-RICR-\d{2,3}-\d{2}-\d{1,2}(?:\.\d{1,2})?))"),
    ("SC", "code-regs", r"S\.C\.\s+Code(?:\s+Ann\.)?\s+Regs\.\s*(?<sec>\d{1,3}-\d{1,4}(?:\.\d{1,3})?{{SUBS}})"),
    ("SD", "admin-r", r"(?:S\.D\.\s+Admin\.\s+R\.|ARSD)\s*(?<sec>\d{1,2}:\d{2}(?::\d{2}){1,2}(?:\.\d{1,2})?{{SUBS}})"),
    ("TN", "comp-r-regs", r"Tenn\.\s+Comp\.\s+R\.\s+&\s+Regs\.\s*(?:r\.\s*)?(?<sec>{{REG_SEC}})"),
    ("TX", "admin-code", r"(?<title>\d{1,2})\s+(?:Tex\.\s+Admin\.\s+Code|TAC|T\.A\.C\.)\s*(?:§§?\s*)?(?<sec>\d{1,4}\.\d{1,4}{{SUBS}})"),
    ("UT", "admin-code", r"Utah\s+Admin\.\s+Code\s+(?:r\.\s*|§§?\s*)?(?<sec>R\d{1,3}-\d{1,4}(?:-\d{1,4}[a-z]?)?{{SUBS}})"),
    ("VT", "code-r", r"(?<title>\d{1,2}-\d{3})\s+Vt\.\s+Code\s+R\.\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
    ("VA", "admin-code", r"(?<title>\d{1,2})\s?(?:Va\.\s+Admin\.\s+Code|VAC)\s?(?:§§?\s*)?(?<sec>\d{1,3}-\d{1,3}-\d{1,4}{{SUBS}})"),
    ("WA", "admin-code", r"(?:Wash\.\s+Admin\.\s+Code|WAC)\s*(?:§§?\s*)?(?<sec>\d{1,3}[A-Z]?-\d{1,3}[A-Z]?-\d{1,4}[A-Z]?{{SUBS}})"),
    ("WV", "code-r", r"(?:W\.\s?Va\.\s+Code\s+(?:R\.|St\.\s+R\.)|W\.\s?Va\.\s+C\.S\.R\.)\s*(?:§§?\s*)?(?<sec>\d{1,3}-\d{1,3}-\d{1,3}(?:\.\d{1,3})?{{SUBS}})"),
    ("WI", "admin-code", r"Wis\.\s+Admin\.\s+Code\s+(?<agency>[A-Z][A-Za-z&]{1,8})\s*§§?\s*(?<sec>\d{1,4}\.\d{1,4}{{SUBS}})"),
    ("WY", "code-r", r"(?:(?<title>\d{3}\.\d{4})\s+)?Wyo\.\s+Code\s+R\.\s*(?:§§?\s*)?(?<sec>{{REG_SEC}})"),
]

# ------------------------------------------------------------------------------------------------ federal rules
RULE_SETS = {
    # captured set text (letters only, lower case) -> set id; ids follow court_rule_documents ("us-frcp" ...)
    "civ": "frcp", "civil": "frcp", "civp": "frcp", "civproc": "frcp", "civpro": "frcp", "civilprocedure": "frcp",
    "civprocedure": "frcp", "frcp": "frcp", "crim": "frcrp", "criminal": "frcrp", "crimp": "frcrp", "crimproc": "frcrp",
    "crimpro": "frcrp", "criminalprocedure": "frcrp", "crimprocedure": "frcrp", "frcrp": "frcrp", "frcrimp": "frcrp",
    "evid": "fre", "evidence": "fre", "fre": "fre", "app": "frap", "appp": "frap", "appproc": "frap", "apppro": "frap",
    "appellate": "frap", "appellateprocedure": "frap", "appprocedure": "frap", "frap": "frap", "bankr": "frbp",
    "bankrp": "frbp", "bankrproc": "frbp", "bankrpro": "frbp", "bankruptcy": "frbp", "bankruptcyprocedure": "frbp",
    "bankrprocedure": "frbp", "frbp": "frbp",
}
RULE_SET_NAMES = {
    "frcp": "Fed. R. Civ. P.", "frcrp": "Fed. R. Crim. P.", "fre": "Fed. R. Evid.", "frap": "Fed. R. App. P.",
    "frbp": "Fed. R. Bankr. P.",
}

# ------------------------------------------------------------------------------------------------ rules
# {{REPORTER}} (reporter editions and variations, a prefix trie), {{NEUTRAL}} (public-domain citation forms) and
# {{STATE_NAME}} (state names of STATES) are generated by build_patterns.py.
RULES: list[dict] = [
    # ---------------------------------------------------------------- cases
    {"id": "case", "kind": "case", "builder": "case", "priority": 40,
     "pattern": r"(?<![\w.§-])(?<volume>\d{1,4})\s+(?<reporter>{{REPORTER}}),?\s+(?<page>\d{1,7})(?![\w])(?!\s*[:/]\s*\d)"},
    {"id": "case_neutral", "kind": "case", "builder": "case", "priority": 41,
     "pattern": r"(?<![\w.§-])(?<volume>(?:19|20)\d\d)(?:\s+|\s?-\s?)(?<reporter>{{NEUTRAL}})(?:\s+|\s?-\s?)(?<page>\d{1,7}(?:-[A-Z]|[A-Z])?)(?![\w])"},
    {"id": "case_tc_memo", "kind": "case", "builder": "case", "priority": 41, "anchors": ["T.C.", "T. C."],
     "pattern": r"{{NB}}(?<reporter>T\.\s?C\.\s?(?:Memo\.?|Summary\s+Opinion))\s+(?<volume>(?:19|20)\d\d)-(?<page>\d{1,4})(?![\w])"},
    {"id": "case_short", "kind": "case", "builder": "case_short", "priority": 39,
     "pattern": r"(?<![\w.§-])(?<volume>\d{1,4})\s+(?<reporter>{{REPORTER}})\s*,?\s+at\s+(?<pin>{{PIN_PAGE}})(?![\w])"},
    # ---------------------------------------------------------------- federal statutes and regulations
    {"id": "usc", "kind": "usc", "builder": "statute_list", "family": "usc", "priority": 50,
     "pattern": (r"{{NB}}(?<title>\d{1,2})\s*(?:U\.?\s?S\.?\s?(?:Code|C\.?(?:\s?A\.?|\s?S\.?)?)|United\s+States\s+Code(?:\s+Annotated)?)"
                 r"(?![A-Za-z])(?:\s*(?<app>app\.|App\.|Appendix))?\s*(?<label>{{SEC_LABEL}})?\s*"
                 r"(?<items>{{USC_ITEM}}(?:{{LIST_SEP}}{{NOT_NEXT}}{{USC_ITEM}})*)(?<etseq>\s*,?\s*et\s+seq\.?)?"),
     "item": r"(?<section>{{USC_SEC}})(?<subs>{{SUBS}})(?:{{RANGE}}(?<section_end>{{USC_SEC}})(?<subs_end>{{SUBS}}))?"},
    {"id": "usc_chapter", "kind": "usc", "builder": "single", "priority": 49,
     "pattern": (r"{{NB}}(?<title>\d{1,2})\s*U\.?\s?S\.?\s?C\.?(?:\s?A\.?)?(?![A-Za-z])\s*,?\s*(?:[Cc]hapters?|[Cc]hs?\.|CHAPTER)\s*(?<chapter>\d{1,4}[A-Z]?)(?![\w])"),
     "key": "usc-ch:{title|int}:{chapter|upper}", "normalized": "{title|int} U.S.C. ch. {chapter|upper}",
     "fields": {"title": "{title|int}", "chapter": "{chapter|upper}"}},
    {"id": "cfr", "kind": "cfr", "builder": "statute_list", "family": "cfr", "priority": 50,
     "pattern": (r"{{NB}}(?<title>\d{1,2})\s*C\.?\s?F\.?\s?R\.?(?![A-Za-z])\s*(?<label>§§|§|[Ss]ecs?\.|[Ss]ections?|[Pp]arts?|[Pp]ts?\.|PARTS?|PTS?\.)?\s*"
                 r"(?<items>{{CFR_ITEM}}{{CFR_SUBS_TAIL}}(?:{{CFR_LIST_SEP}}{{NOT_NEXT}}{{CFR_ITEM}}{{CFR_SUBS_TAIL}})*)"),
     # an item never starts inside a paragraph designation ("(b)(10)") or a number
     "item": r"(?<![\w.(])(?<part>\d{1,5})(?:\.(?<section>{{CFR_SEC}}))?(?<subs>{{SUBS}})(?:{{RANGE}}(?<part_end>\d{1,5})(?:\.(?<section_end>{{CFR_SEC}}))?(?<subs_end>{{SUBS}}))?"},
    {"id": "treas_reg", "kind": "cfr", "builder": "statute_list", "family": "cfr", "priority": 50, "const": {"title": "26"},
     "anchors": ["Treas", "TREAS"],
     "pattern": (r"{{NB}}(?:Treas\.\s?Reg\.|TREAS\.\s?REG\.|Treasury\s+Regulations?)\s*(?<label>§§|§)?\s*"
                 r"(?<items>{{CFR_ITEM}}(?:{{LIST_SEP}}{{NOT_NEXT}}{{CFR_ITEM}})*)"),
     "item": r"(?<part>\d{1,5})(?:\.(?<section>{{CFR_SEC}}))?(?<subs>{{SUBS}})(?:{{RANGE}}(?<part_end>\d{1,5})(?:\.(?<section_end>{{CFR_SEC}}))?(?<subs_end>{{SUBS}}))?"},
    {"id": "federal_register", "kind": "federal_register", "builder": "single", "priority": 45, "pin": "federal_register",
     "pattern": r"{{NB}}(?<volume>\d{1,3})\s+(?:Fed\.\s?Reg\.|FED\.\s?REG\.|F\.\s?R\.|FR)(?![A-Za-z.])\s+(?<page>\d{1,3}(?:,\d{3})+|\d{1,6})(?![\w])",
     "key": "fr:{volume|int}:{page|nocomma|int}", "normalized": "{volume|int} Fed. Reg. {page|nocomma|int}",
     "fields": {"volume": "{volume|int}", "page": "{page|nocomma|int}"}},
    {"id": "statutes_at_large", "kind": "statutes_at_large", "builder": "single", "priority": 45, "pin": "statutes_at_large",
     "anchors": ["Stat."],
     "pattern": r"{{NB}}(?<volume>\d{1,3}A?)\s+Stat\.\s+(?<page>\d{1,5})(?![\w])",
     "key": "stat:{volume|int}:{page|int}", "normalized": "{volume|int} Stat. {page|int}",
     "fields": {"volume": "{volume|int}", "page": "{page|int}"}},
    # "76 FR at 48213", "124 Stat. at 242": short forms of a Federal Register or Statutes at Large page cited before
    {"id": "federal_register_short", "kind": "federal_register", "builder": "at_short", "priority": 44,
     "pattern": (r"{{NB}}(?<volume>\d{1,3})\s+(?:Fed\.\s?Reg\.|FED\.\s?REG\.|F\.\s?R\.|FR)(?![A-Za-z.])\s*,?\s+at\s+"
                 r"(?<pin>\d{1,3}(?:,\d{3})+|\d{1,6})(?:\s*[-–]\s*\d{1,6})?(?![\w])"),
     "normalized": "{volume|int} Fed. Reg. at {pin|nocomma|int}", "fields": {"volume": "{volume|int}"}},
    {"id": "statutes_at_large_short", "kind": "statutes_at_large", "builder": "at_short", "priority": 44, "anchors": ["Stat."],
     "pattern": r"{{NB}}(?<volume>\d{1,3}A?)\s+Stat\.\s*,?\s+at\s+(?<pin>\d{1,5})(?:\s*[-–]\s*\d{1,5})?(?![\w])",
     "normalized": "{volume|int} Stat. at {pin|int}", "fields": {"volume": "{volume|int}"}},
    {"id": "public_law", "kind": "public_law", "builder": "single", "priority": 45, "pin": "public_law",
     "pattern": r"{{NB}}(?:Pub(?:lic)?\.?\s*L(?:aw)?\.?|P\.\s?L\.|PUB\.\s*L\.|PUBLIC\s+LAW)\s*(?:No\.?\s*|NO\.\s*|Number\s+)?(?<congress>\d{1,3})\s*[-–‑—]\s*(?<law>\d{1,4})(?![\w])",
     "key": "pl:{congress|int}:{law|int}", "normalized": "Pub. L. No. {congress|int}-{law|int}",
     "fields": {"congress": "{congress|int}", "law": "{law|int}"}},
    # ---------------------------------------------------------------- constitutions
    {"id": "constitution_us", "kind": "constitution_us", "builder": "single", "priority": 46, "flags": "i",
     "anchors": ["Const", "CONST"],
     "pattern": (r"{{NB}}(?:U\.\s?S\.|United\s+States)\s+Const(?:itution|\.)?\s*,?\s*(?:amend(?:ment)?s?\.?\s*(?<amend>[IVXLC]{1,7}|\d{1,2})(?![A-Za-z0-9])"
                 r"|art(?:icle)?s?\.?\s*(?<article>[IVX]{1,4}|\d{1,2})(?![A-Za-z0-9]))"
                 r"(?:\s*,\s*(?:§§?|sec(?:tion)?\.?)\s*(?<section>\d{1,2})(?![\d]))?(?:\s*,\s*cl\.\s*(?<clause>\d{1,2})(?![\d]))?"),
     "key": "const-us:[amend-{amend|roman}][art-{article|roman}][:sec-{section|int}][:cl-{clause|int}]",
     "normalized": "U.S. Const.[ amend. {amend|roman|upper_roman}][ art. {article|roman|upper_roman}][, § {section|int}][, cl. {clause|int}]",
     "fields": {"amendment": "{amend|roman}", "article": "{article|roman}", "section": "{section|int}", "clause": "{clause|int}"}},
    {"id": "constitution_state", "kind": "constitution_state", "builder": "single", "priority": 46, "flags": "i",
     "anchors": ["Const", "CONST"],
     "pattern": (r"{{NB}}(?<state>{{STATE_NAME}})\s*Const(?:itution|\.)?(?:\s+(?:of\s+)?\d{4})?\s*,?\s*"
                 r"(?:art(?:icle)?\.?\s*(?<article>{{ROMAN_OR_NUM}})(?![A-Za-z0-9])(?:\s*,\s*(?:§§?|sec(?:tion)?s?\.?|¶¶?|para\.)\s*(?<section>\d{1,3}[a-zA-Z]?(?:\.\d{1,2})?)(?![\d]))?"
                 r"|pt\.\s*(?<part>[IV]{1,3}|\d)\s*,\s*art\.\s*(?<part_article>{{ROMAN_OR_NUM}})(?![A-Za-z0-9]))"),
     "key": "const:{state|state}:[pt-{part|roman}:][art-{article|roman}][art-{part_article|roman}][:sec-{section|lower}]",
     "normalized": "{state|state_abbr} Const.[ pt. {part|roman}][ art. {article|roman|upper_roman}][, art. {part_article|roman}][, § {section}]",
     "fields": {"state": "{state|state}", "part": "{part|roman}", "article": "{article|roman}{part_article|roman}", "section": "{section}"},
     "required": ["state"]},
    # ---------------------------------------------------------------- court rules
    {"id": "federal_rule", "kind": "federal_rule", "builder": "single", "priority": 44,
     "pattern": (r"{{NB}}(?:Fed(?:eral)?\.?\s*R(?:ules?)?\.?\s*(?:of\s+)?(?<set>Civ(?:il)?\.?\s*P(?:ro(?:c(?:edure)?)?)?\.?|Crim(?:inal)?\.?\s*P(?:ro(?:c(?:edure)?)?)?\.?"
                 r"|Evid(?:ence)?\.?|App(?:ellate)?\.?\s*P(?:ro(?:c(?:edure)?)?)?\.?|Bankr(?:uptcy)?\.?\s*P(?:ro(?:c(?:edure)?)?)?\.?)"
                 r"|(?<abbr>F\.?\s?R\.?\s?C\.?\s?P\.?|F\.?\s?R\.?\s?Cr(?:im)?\.?\s?P\.?|F\.?\s?R\.?\s?E\.?|F\.?\s?R\.?\s?A\.?\s?P\.?|F\.?\s?R\.?\s?B\.?\s?P\.?))"
                 r"(?![A-Za-z])\s*(?:R(?:ule)?\.?\s*)?(?<rule>\d{1,4}(?:\.\d{1,2})?(?:[a-z](?![a-z]))?)(?![\d])(?![:\-–]\d)(?<subs>{{SUBS}})"),
     "key": "rule:{set|rule_set}{abbr|rule_set}:{rule}", "normalized": "{set|rule_set_name}{abbr|rule_set_name} {rule}",
     "fields": {"set": "{set|rule_set}{abbr|rule_set}", "rule": "{rule}"}, "pin_group": "subs", "required": ["set"]},
    {"id": "federal_rule_named", "kind": "federal_rule", "builder": "single", "priority": 44, "anchors": ["Federal Rule"],
     "pattern": (r"{{NB}}Rules?\s+(?<rule>\d{1,4}(?:\.\d{1,2})?(?:[a-z](?![a-z]))?)(?<subs>{{SUBS}})\s+of\s+the\s+Federal\s+Rules\s+of\s+"
                 r"(?<set>Civil\s+Procedure|Criminal\s+Procedure|Evidence|Appellate\s+Procedure|Bankruptcy\s+Procedure)"),
     "key": "rule:{set|rule_set}:{rule}", "normalized": "{set|rule_set_name} {rule}",
     "fields": {"set": "{set|rule_set}", "rule": "{rule}"}, "pin_group": "subs", "required": ["set"]},
    {"id": "federal_rule_list", "kind": "federal_rule", "builder": "rule_list", "priority": 45, "anchors": ["Federal Rules"],
     "pattern": (r"{{NB}}Rules\s+(?<items>\d{1,4}(?:\.\d{1,2})?[a-z]?{{SUBS}}(?:{{LIST_SEP}}\d{1,4}(?:\.\d{1,2})?[a-z]?{{SUBS}}){1,12})\s+of\s+the\s+Federal\s+Rules\s+of\s+"
                 r"(?<set>Civil\s+Procedure|Criminal\s+Procedure|Evidence|Appellate\s+Procedure|Bankruptcy\s+Procedure)"),
     "item": r"(?<rule>\d{1,4}(?:\.\d{1,2})?[a-z]?)(?<subs>{{SUBS}})"},
    {"id": "bankruptcy_rule", "kind": "federal_rule", "builder": "single", "priority": 44, "anchors": ["Bankr"],
     "pattern": r"{{NB}}(?<set>Bankruptcy|Bankr\.)\s+Rule\s+(?<rule>\d{4}(?:\.\d)?)(?![\d])(?<subs>{{SUBS}})",
     "key": "rule:frbp:{rule}", "normalized": "Fed. R. Bankr. P. {rule}",
     "fields": {"set": "frbp", "rule": "{rule}"}, "pin_group": "subs"},
    {"id": "local_rule", "kind": "local_rule", "builder": "single", "priority": 43,
     "pattern": (r"{{NB}}(?:(?<court>(?:[NSEWMC]\.\s?)?D\.\s?(?:[A-Z][a-z]{0,6}\.\s?){1,3})\s*)?"
                 r"(?<label>L\.\s?(?:Civ\.\s?|Cr(?:im)?\.\s?|Pat\.\s?|B\.\s?|Bankr\.\s?)?R\.(?:\s?Civ\.\s?P\.)?|Local\s+(?:Civil\s+|Criminal\s+|Patent\s+|Bankruptcy\s+|Admiralty\s+)?Rules?|"
                 r"Civ(?:il)?\.?\s?L\.\s?R\.|Crim(?:inal)?\.?\s?L\.\s?R\.|L\.\s?R\.|LR|LCvR|LCrR|LCR|LBR|Local\s+R\.)"
                 r"\s*(?<rule>\d{1,3}(?:[.\-]\d{1,3}){0,3}[A-Za-z]?)(?![\d])(?<subs>{{SUBS}})"),
     "key": "local-rule:{court|slug}:{rule}", "normalized": "[{court|squash} ]L.R. {rule}",
     "fields": {"court": "{court|squash}", "rule": "{rule}"}, "pin_group": "subs"},
    # ---------------------------------------------------------------- mentions (never membership)
    {"id": "mdl", "kind": "mdl", "builder": "single", "priority": 30,
     "pattern": (r"(?<![A-Za-z0-9_])(?:MDL|M\.D\.L\.|Multi-?\s?[Dd]istrict\s+Litigation)(?:\s*[-–]\s*|\s+)(?:(?:Docket\s+|DOCKET\s+)?(?:No|NO)\.?\s*:?\s*|Number\s+)?"
                 r"(?<n>\d{1,5})(?![0-9A-Za-z_:/])(?!\s*[-–]\s*(?:[0-9a-z]|M[DLdl](?![A-Za-z])|[A-Z][a-z]))(?![.,]\d)"),
     "key": "mdl:{n|int}", "normalized": "MDL No. {n|int}", "fields": {"number": "{n|int}"}, "nonzero": "n"},
    # District of Minnesota style: "MDL No. 24-3108 (DWF/DJF)" is MDL 3108 filed in 2024
    {"id": "mdl_year_number", "kind": "mdl", "builder": "single", "priority": 31, "anchors": ["MDL"],
     "pattern": r"(?<![A-Za-z0-9_])MDL\s+(?:No\.?|NO\.?)\s*(?<yy>\d{2})-(?<n>\d{4})(?![0-9A-Za-z_:/-])",
     "key": "mdl:{n|int}", "normalized": "MDL No. {n|int}", "fields": {"number": "{n|int}"}, "nonzero": "n"},
    {"id": "docket", "kind": "docket", "builder": "single", "priority": 30, "flags": "i",
     "pattern": (r"(?<![A-Za-z0-9_/.-])(?<![0-9]:)(?:(?<office>\d{1,2}):)?(?<yy>\d{2}|\d{4})-(?<type>cv|cr|md|mc|ml|bk|ap|mj|po|sw|gj|dp|ms|cb|ad)-(?<num>\d{1,6})"
                 r"(?:-(?<judge>[A-Z]{1,5}(?:-[A-Z]{1,5}){0,3}))?(?![A-Za-z0-9_])"),
     "key": "docket:[{office|int}:]{yy|last2}-{type|lower}-{num|docketnum}", "normalized": "[{office|int}:]{yy|last2}-{type|lower}-{num|docketnum}",
     "fields": {"office": "{office|int}", "judge_suffix": "{judge}"}},
    {"id": "docket_compact", "kind": "docket", "builder": "single", "priority": 29, "flags": "i",
     "pattern": r"(?<![A-Za-z0-9_/.-])(?<![0-9]:)(?<office>\d{1,2}):(?<yy>\d{2})(?<type>cv|cr|md|mc|ml)(?<num>\d{1,6})(?![A-Za-z0-9_])",
     "key": "docket:{office|int}:{yy|last2}-{type|lower}-{num|docketnum}", "normalized": "{office|int}:{yy|last2}-{type|lower}-{num|docketnum}",
     "fields": {"office": "{office|int}"}},
    {"id": "ecf_header", "kind": "ecf_header", "builder": "furniture", "priority": 99, "flags": "i", "anchors": ["Case", "CASE"],
     "pattern": (r"Case:?\s*(?:MDL\s+No\.\s*\d{1,5}|\d{1,2}:\d{2}-[A-Za-z]{2,4}-\d{1,6}(?:-[A-Za-z0-9]{1,6}){0,4})\s+(?:Document|Doc\.?)\s*#?:?\s*"
                 r"\d{1,6}(?:-\d{1,3})?\s+(?:Filed:?|Entered\s+on\s+[A-Za-z]{2,6}\s+Docket:?)\s*\d{1,2}/\d{1,2}/(?:\d{4}|\d{2})\s+Page:?\s*"
                 r"\d{1,5}\s+of\s+\d{1,5}(?:\s+Page\s?ID\s*#?:?\s*\d{1,9})?")},
    # ---------------------------------------------------------------- short forms
    {"id": "id", "kind": "short", "builder": "id", "priority": 20,
     "pattern": (r"(?<![\w.])(?<!\d\s)(?:[Ii]d\.|ID\.|[Ii]bid\.?|IBID\.?)(?![\w])(?:(?:\s*,)?\s+at\s+(?<pin>{{PIN_PAGE}})(?![\w])|"
                 r"\s*(?<sec>§§?\s*\d[0-9A-Za-z]*(?:[.\-–:][0-9A-Za-z]+)*{{SUBS}})|\s*,?\s*(?<para>¶¶?\s*\d{1,4}))?")},
    {"id": "supra", "kind": "short", "builder": "supra", "priority": 20, "anchors": ["supra", "Supra", "SUPRA"],
     "pattern": (r"(?<![\w'’&.\-])(?<name>[A-Z][\w'’&.\-]*(?:\s+(?:[A-Z][\w'’&.\-]*|\d{1,5}|of|the|&|and)){0,4}),\s+supra(?![\w])"
                 r"(?:\s*,?\s*at\s+(?<pin>{{PIN_PAGE}})(?![\w]))?")},
    {"id": "section_short", "kind": "short", "builder": "section_short", "priority": 10, "anchors": ["§"],
     "pattern": r"(?<![\w.§])(?<label>§§?)\s*(?<section>\d{1,6}[A-Za-z]{0,4}(?:[.:\-–]\d{1,6}[A-Za-z]{0,4})*)(?<subs>{{SUBS}})(?![\w])(?!\.\d)"},
    # the Government Publishing Office text of the Federal Register and the C.F.R. writes "§" as "Sec." ("Sec.  210.30(e)")
    {"id": "section_short_gpo", "kind": "short", "builder": "section_short", "priority": 10, "anchors": ["Sec."],
     "pattern": r"(?<![\w.§])(?<label>Sec\.)[ ]{1,3}(?<section>\d{1,6}\.\d{1,6}[A-Za-z]{0,4}(?:-\d{1,4}[A-Za-z]{0,2})?)(?<subs>{{SUBS}})(?![\w])(?!\.\d)"},
    {"id": "rule_short", "kind": "short", "builder": "rule_short", "priority": 10, "anchors": ["Rule"],
     "pattern": r"(?<![\w.])Rules?\s+(?<rule>\d{1,4}(?:\.\d{1,2})?(?:[a-z](?![a-z]))?)(?![\d])(?![:\-–.]\d)(?<subs>{{SUBS}})"},
]
