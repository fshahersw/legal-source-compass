"""Pure helpers for recall_patterns: keyword themes, firm keys, supplier statements, co-occurrence clusters and anomaly flags.

Themes are this builder's keyword rules over the agency's own reason text (openFDA reason_for_recall, CPSC hazard categories,
NHTSA component); they are labelled as such and are not agency categories. A recall may carry several themes or none.
"""
from __future__ import annotations

import re
import statistics
from collections import defaultdict

# (theme id, label, regex). Order matters only for display.
THEMES = {
    "fda_drug": [
        ("sterility", "Sterility assurance", r"steril|aseptic"),
        ("microbial", "Microbial contamination", r"microb|bacteri|fung|mold|mould|yeast|burkholderia|bacillus|pseudomonas|endotoxin|bioburden"),
        ("nitrosamine", "Nitrosamine impurities (NDMA, NDEA, NMBA and others)", r"\bnitrosamine|\bN-?nitroso|\bNDMA\b|\bNDEA\b|\bNMBA\b|\bNMPA\b|\bNDIPA\b|\bNEIPA\b"),
        ("benzene", "Benzene contamination", r"\bbenzene\b"),
        ("impurity", "Impurity or degradation results", r"impurit|degradat"),
        ("potency", "Subpotent or superpotent", r"subpoten|superpoten|potency|out of specification.{0,40}assay|\bassay\b"),
        ("dissolution", "Dissolution failure", r"dissolution"),
        ("cgmp", "CGMP deviations", r"\bc?gmp\b|good manufacturing|processing controls"),
        ("temperature", "Temperature or storage excursion", r"temperature|excursion|storage condition|cold chain|refrigerat"),
        ("particulate", "Particulate or foreign matter", r"particulate|particle|foreign (matter|substance|material|object)|glass|fiber|fibre"),
        ("labeling", "Labeling or product mix-up", r"label|mix-?up|wrong (drug|strength|product)|carton|incorrect (strength|expir|lot)|misbrand"),
        ("undeclared_drug", "Undeclared drug ingredient", r"undeclared (sildenafil|tadalafil|vardenafil|sibutramine|phenolphthalein|dmaa|desmethyl|fluoxetine|diclofenac|dexamethasone|meloxicam|steroid|drug)|contains? (sildenafil|tadalafil|sibutramine)"),
        ("cross_contamination", "Penicillin or cross-contamination", r"penicillin|cross[- ]contamina|beta[- ]lactam"),
        ("container", "Container, closure or packaging defect", r"container|closure|leak|seal|crack|packag|vial|stopper|cap "),
        ("unapproved", "Marketed without approval", r"unapproved|without an approved|new drug application|not approved"),
        ("adverse_reports", "Recall following adverse-event reports", r"adverse (event|reaction)s?|reports? of (infection|illness|injur)|patients? (who|were|developed)"),
    ],
    "fda_food": [
        ("listeria", "Listeria monocytogenes", r"listeria"),
        ("salmonella", "Salmonella", r"salmonella"),
        ("ecoli", "E. coli (including O157:H7 and STEC)", r"e\.? ?coli|\bO157|\bSTEC\b|shiga"),
        ("botulism", "Clostridium botulinum", r"botulin|botulism"),
        ("cyclospora", "Cyclospora", r"cyclospora"),
        ("hepatitis_a", "Hepatitis A", r"hepatitis a"),
        ("norovirus", "Norovirus", r"norovirus"),
        ("cronobacter", "Cronobacter", r"cronobacter"),
        ("other_microbe", "Other microbial contamination (mold, yeast, Staphylococcus, Bacillus cereus)", r"\bmold|\bmould|\byeast|staphyloc|bacillus cereus|microb|bacteri|coliform"),
        ("allergen_milk", "Undeclared milk", r"(undeclared|contain).{0,60}\b(milk|dairy|whey|casein|lactose)\b"),
        ("allergen_egg", "Undeclared egg", r"(undeclared|contain).{0,60}\beggs?\b"),
        ("allergen_peanut", "Undeclared peanut", r"(undeclared|contain).{0,60}\bpeanuts?\b"),
        ("allergen_treenut", "Undeclared tree nuts", r"(undeclared|contain).{0,60}\b(tree ?nuts?|almonds?|cashews?|walnuts?|pecans?|hazelnuts?|pistachios?|coconut|macadamia|brazil nuts?|pine nuts?)\b"),
        ("allergen_soy", "Undeclared soy", r"(undeclared|contain).{0,60}\b(soy|soya|soybeans?)\b"),
        ("allergen_wheat", "Undeclared wheat or gluten", r"(undeclared|contain).{0,60}\b(wheat|gluten)\b"),
        ("allergen_fish", "Undeclared fish", r"(undeclared|contain).{0,60}\b(fish|anchov|tuna|salmon|cod|pollock|tilapia)\b"),
        ("allergen_shellfish", "Undeclared shellfish", r"(undeclared|contain).{0,60}\b(shellfish|shrimp|crab|lobster|crustacean)\b"),
        ("allergen_sesame", "Undeclared sesame", r"(undeclared|contain).{0,60}\bsesame\b"),
        ("sulfites", "Undeclared sulfites", r"sulfit|sulphit"),
        ("color_additive", "Undeclared or unapproved color additive", r"(fd&c|yellow ?#?\s?\d|red ?#?\s?\d|color additive|colour additive|tartrazine)"),
        ("foreign_metal", "Foreign material: metal", r"metal"),
        ("foreign_plastic", "Foreign material: plastic or rubber", r"plastic|rubber"),
        ("foreign_glass", "Foreign material: glass", r"\bglass\b"),
        ("foreign_other", "Foreign material: other (wood, stone, bone, insects)", r"foreign (object|material|matter)|wood|stone|rock|bone fragment|insect|rodent"),
        ("heavy_metal", "Lead, arsenic, cadmium or mercury", r"\blead\b|arsenic|cadmium|mercury"),
        ("toxin", "Natural toxins (histamine, aflatoxin, patulin, ciguatoxin)", r"histamine|scombro|aflatoxin|patulin|ciguat|mycotoxin"),
        ("chemical", "Chemical contaminant (pesticide, ethylene oxide, cleaning agent)", r"pesticide|ethylene oxide|sanitiz|cleaning (agent|solution|chemical)|chemical contamin"),
        ("undeclared_drug", "Undeclared drug ingredient in a supplement", r"sildenafil|tadalafil|sibutramine|phenolphthalein|\bdmaa\b|desmethyl|undeclared drug"),
        ("process", "Process control, GMP or temperature", r"\bgmp|haccp|temperature|under[- ]?process|processing|not (manufactured|held|stored)|seal|low[- ]acid|registration"),
        ("labeling", "Labeling error", r"label|mislabel|misbrand|nutrition facts"),
    ],
    "fda_device": [
        ("sterility", "Sterility or package integrity", r"steril|package integrity|packaging integrity|seal|pouch|breach"),
        ("software", "Software", r"software|firmware|algorithm|\bbug\b|application version"),
        ("electrical", "Electrical, battery or power", r"electric|battery|batteries|power supply|short circuit|voltage|charg"),
        ("thermal", "Overheating, burn or fire", r"overheat|burn|fire|smoke|thermal|melt"),
        ("mechanical", "Mechanical failure, breakage or fracture", r"break|broke|fractur|crack|detach|disconnect|separat|wear|fail to (lock|deploy|open|close)"),
        ("leak", "Leak or fluid path", r"leak|occlu|backflow|flow rate|air in line|bubble"),
        ("incorrect_results", "Incorrect or unreliable results", r"incorrect result|false (positive|negative|result)|inaccura|erroneous|calibrat|falsely (elevated|low|high)|bias"),
        ("labeling", "Labeling or instructions for use", r"label|instructions for use|\bifu\b|\bdfu\b|manual|expiration date"),
        ("alarm", "Alarm or alert failure", r"alarm|alert"),
        ("contamination", "Contamination (particulate, endotoxin, bioburden)", r"contamina|particulate|endotoxin|bioburden|foreign"),
        ("supplier_component", "Component or supplier issue", r"supplier|component|sub-?assembl|recalled by|affected by the fda safety|recall of .{0,40}(syringe|glove|component)"),
        ("quality_system", "Quality system or validation", r"quality system|validat|qualification|nonconform|out of specification|specification"),
    ],
}
NHTSA_GROUPS = {
    "AIR BAGS": "Air bags", "ELECTRICAL SYSTEM": "Electrical system", "STRUCTURE": "Structure", "POWER TRAIN": "Power train",
    "STEERING": "Steering", "SUSPENSION": "Suspension", "EXTERIOR LIGHTING": "Exterior lighting", "SERVICE BRAKES, HYDRAULIC": "Hydraulic brakes",
    "ENGINE AND ENGINE COOLING": "Engine and cooling", "SEAT BELTS": "Seat belts", "TIRES": "Tires", "SEATS": "Seats", "VISIBILITY": "Visibility",
    "FUEL SYSTEM, GASOLINE": "Gasoline fuel system", "SERVICE BRAKES, AIR": "Air brakes", "BACK OVER PREVENTION": "Back-over prevention",
    "LATCHES/LOCKS/LINKAGES": "Latches, locks and linkages", "WHEELS": "Wheels", "EQUIPMENT": "Equipment", "CHILD SEAT": "Child seats",
    "FUEL SYSTEM, DIESEL": "Diesel fuel system", "VEHICLE SPEED CONTROL": "Speed control", "PARKING BRAKE": "Parking brake",
    "FORWARD COLLISION AVOIDANCE": "Forward collision avoidance", "HYBRID PROPULSION SYSTEM": "Hybrid propulsion", "ELECTRONIC STABILITY CONTROL": "Stability control",
}
CPSC_LABELS = {
    "fire_burn": "Fire or burn", "fall": "Fall", "choking": "Choking", "laceration": "Laceration", "chemical": "Chemical",
    "suffocation": "Suffocation", "shock": "Electric shock", "ingestion": "Ingestion (magnets, batteries, poisoning)", "crash": "Crash",
    "strangulation": "Strangulation", "impact": "Impact", "tip_over": "Tip-over", "drowning": "Drowning", "other": "Other or unclassified",
}
COMMODITIES = [
    "peanut butter", "peanut", "flour", "cucumber", "onion", "cantaloupe", "romaine", "lettuce", "spinach", "sprouts", "cheese", "ice cream",
    "pistachio", "almond", "tahini", "sesame", "cumin", "black pepper", "red pepper", "paprika", "coconut", "papaya", "mango", "peach",
    "celery", "corn", "cereal", "chocolate", "milk powder", "dry milk", "whey", "egg", "tuna", "oyster", "shrimp", "salad", "sandwich",
    "hummus", "garlic", "cinnamon", "apple", "applesauce", "pouch", "infant formula", "baby food", "pet food", "dog food", "cat food",
    "frozen vegetable", "frozen fruit", "berries", "blueberr", "strawberr", "raspberr", "pomegranate", "cilantro", "parsley", "basil",
    "kale", "broccoli", "carrot", "tomato", "jalapeno", "avocado", "guacamole", "nut butter", "trail mix", "granola", "protein powder",
    "kratom", "supplement", "honey", "smoked fish", "salmon", "sausage", "deli", "dip", "salsa", "soup", "noodle", "rice",
]
CORPORATE = re.compile(r"\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|plc|lp|llp|gmbh|s\.a|sa|ag|nv|bv|pty|dba)\b\.?", re.I)
COMPANYISH = re.compile(r"\b(inc|llc|ltd|corp|corporation|company|co\.|foods?|farms?|mills?|products|laboratories|labs?|pharma\w*|brands?|"
                        r"industries|international|group|packing|produce|dairy|ingredients|nutrition|manufacturing|enterprises|holdings)\b", re.I)
# A company name as written: capitalised words joined by spaces, commas, "&", "and", "of", "de"; it ends at the first lowercase word.
NAME = r"([A-Z][\w&.'’/-]*(?:,?\s+(?:[A-Z][\w&.'’/-]*|&|and|of|de|la|del|du|d/b/a|dba)(?=[\s,.;:)]|$))*)"
SUPPLIER_PATTERNS = [
    re.compile(r"\b(?:supplied|manufactured|produced|packed|processed|sourced|provided|made|distributed|grown) by\s+"
               r"(?:its\s+|their\s+|a\s+|the\s+)?(?:supplier,?\s+)?" + NAME),
    re.compile(r"\b(?:supplier|vendor|co-?packer|contract manufacturer|grower)(?:,|\s+named)?\s+" + NAME),
    re.compile(r"\brecall(?:ed)? (?:initiated |issued |announced |conducted )?by (?:its |their |the )?(?:supplier,?\s+)?" + NAME),
    re.compile(NAME + r"(?:'s|’s) (?:voluntary |nationwide |expanded |recent |ongoing )*recall"),
    re.compile(NAME + r" (?:initiated|issued|announced|conducted|expanded|is conducting|has initiated|has issued|has expanded) "
               r"(?:a |an |its )?(?:voluntary |nationwide |expanded |limited |precautionary )*recall"),
]
GENERIC_SUPPLIER = re.compile(r"^(the|a|an|our|their|its|this|that|fda|us fda|u\.?s\.? fda|food and drug administration|the firm|firm|supplier|manufacturer|"
                              r"recalling firm|company|customers?|consumers?|state|department|usda|cdc)\b", re.I)


def firm_key(name: str | None) -> str:
    """Case, punctuation and corporate-suffix insensitive key; no other merging."""
    s = (name or "").lower().replace("&", " and ")
    s = CORPORATE.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def themes_for(domain: str, text: str | None) -> list[str]:
    t = text or ""
    return [tid for tid, _label, rx in THEMES.get(domain, []) if re.search(rx, t, re.I)]


def theme_label(domain: str, tid: str) -> str:
    for theme_id, label, _rx in THEMES.get(domain, []):
        if theme_id == tid:
            return label
    return tid


def commodity_pattern(term: str) -> str:
    """Whole word with an optional plural; terms ending in "berr" are stems (blueberry, blueberries)."""
    if term.endswith("berr"):
        return r"\b" + re.escape(term) + r"(?:y|ies)\b"
    return r"\b" + re.escape(term) + r"(?:s|es)?\b"


def commodities(text: str | None) -> list[str]:
    t = (text or "").lower()
    found = []
    for term in COMMODITIES:
        if re.search(commodity_pattern(term), t):
            if not any(term in f or f in term for f in found):
                found.append(term)
    return found


ABBREVIATIONS = {"inc", "co", "corp", "ltd", "jr", "sr", "st", "mt", "bros", "assn", "intl", "mfg", "dist", "ft", "no"}
SUFFIX_THEN_SENTENCE = re.compile(r"^(.*?\b(?:Inc|LLC|L\.L\.C|Ltd|Co|Corp|Corporation|Company|Limited))\.\s+[A-Z].*$")


def clean_name(name: str) -> str:
    """Cut a captured name where a sentence ends: at ". X" unless the period closes an abbreviation, and after a corporate suffix
    followed by a new sentence ("ARO Pistachio Inc. Salmonella" -> "ARO Pistachio Inc")."""
    for m in re.finditer(r"\.\s+(?=[A-Z])", name):
        word = re.findall(r"[A-Za-z]+$", name[: m.start()])
        if not word or word[0].lower() not in ABBREVIATIONS:
            name = name[: m.start()]
            break
    m = SUFFIX_THEN_SENTENCE.match(name)
    if m:
        name = m.group(1)
    return name.strip(" ,.-'’")


def suppliers(text: str | None, recalling_firm: str | None = None) -> list[str]:
    """Company names a recall reason states as the supplier or the source recall, as written (trimmed); never the recalling firm."""
    out = []
    own = firm_key(recalling_firm)
    for rx in SUPPLIER_PATTERNS:
        for m in rx.finditer(text or ""):
            name = clean_name(re.sub(r"\s+", " ", m.group(1)).strip(" ,.-'’"))
            name = re.sub(r"(?:\s+(?:and|of|de|la|del|du|&))+$", "", name)
            if len(name) < 3 or GENERIC_SUPPLIER.match(name) or not COMPANYISH.search(name):
                continue
            if len(name.split()) > 9:
                continue
            key = firm_key(name)
            if not key or key == own or (own and (key in own or own in key)):
                continue
            if all(firm_key(x) != key for x in out):
                out.append(name)
    return out


def month(date: str | None) -> str | None:
    return date[:7] if isinstance(date, str) and re.match(r"^\d{4}-\d{2}", date) else None


def month_range(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:7])
    ly, lm = int(last[:4]), int(last[5:7])
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def anomalies(series: dict[str, int], months: list[str], *, window=24, min_excess=10, ratio=3.0, z_min=4.0) -> list[dict]:
    """Months whose count is far above the trailing `window` months: count >= ratio x trailing median, count - median >= min_excess,
    and robust z (MAD scaled by 1.4826, floored at 1) >= z_min. Needs a full trailing window."""
    out = []
    values = [series.get(m, 0) for m in months]
    for i in range(window, len(months)):
        past = values[i - window:i]
        med = statistics.median(past)
        mad = statistics.median([abs(v - med) for v in past]) * 1.4826
        x = values[i]
        z = (x - med) / max(mad, 1.0)
        if x >= ratio * max(med, 1) and x - med >= min_excess and z >= z_min:
            out.append({"month": months[i], "count": x, "trailing_median": med, "robust_z": round(z, 1)})
    return out


CLUSTER_THEMES = {"listeria", "salmonella", "ecoli", "botulism", "cyclospora", "hepatitis_a", "norovirus", "cronobacter", "other_microbe",
                  "heavy_metal", "toxin", "chemical", "foreign_metal", "foreign_plastic", "foreign_glass", "undeclared_drug"}


def clusters(events: list[dict], *, days=90, min_firms=3, themes=CLUSTER_THEMES) -> list[tuple[str, str, list[dict]]]:
    """Groups of events from different firms that cite the same hazard theme and commodity term and began within `days` of the group's
    first event (anchored windows, so groups never chain beyond `days`). Only contaminant and pathogen themes are grouped. A group is
    kept with >= min_firms distinct firms; groups are taken largest first and one sharing half or more of its events with a kept group
    is dropped. Each event: {id, firm_key, start (YYYY-MM-DD), themes, commodities}."""
    from datetime import date

    def d(s):
        return date(int(s[:4]), int(s[5:7]), int(s[8:10]))

    by_key = defaultdict(list)
    for e in events:
        if not e.get("start"):
            continue
        for t in e["themes"]:
            if t in themes:
                for c in e["commodities"]:
                    by_key[(t, c)].append(e)
    candidates = []
    for (theme, commodity), group in by_key.items():
        group = sorted(group, key=lambda e: (e["start"], e["id"]))
        current: list[dict] = []
        for e in group:
            if current and (d(e["start"]) - d(current[0]["start"])).days > days:
                candidates.append((theme, commodity, current))
                current = []
            current.append(e)
        if current:
            candidates.append((theme, commodity, current))
    candidates = [c for c in candidates if len({e["firm_key"] for e in c[2]}) >= min_firms]
    candidates.sort(key=lambda c: (-len({e["firm_key"] for e in c[2]}), -len(c[2]), c[2][0]["start"], c[0], c[1]))
    kept, used = [], set()
    for theme, commodity, g in candidates:
        ids = {e["id"] for e in g}
        if len(ids & used) * 2 >= len(ids):
            continue
        kept.append((theme, commodity, g))
        used |= ids
    return kept
