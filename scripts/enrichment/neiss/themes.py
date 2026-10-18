"""Narrative keyword themes: this builder's own classification of the free-text NEISS narrative (NOT a CPSC product category).

A case belongs to a theme when its narrative matches an include pattern (after the theme's "strip" phrases are removed) and no
exclude pattern. Matching is case-insensitive on the narrative as recorded. The narrative is read to classify and is never
published or excerpted. Product codes are not used: a theme counts a case once however many of its three product codes relate.
Themes measure how often hospital staff wrote the words, so they under-count cases whose narrative omits them and can include
off-topic mentions; each theme's definition is published beside its estimates. definitions_hash() changes whenever a pattern changes.
"""
import hashlib
import json
import re

# id -> definition. "prefilter": any of these substrings must occur (cheap test before the regexes).
DEFS = {
    "escooter": {
        "label": "Electric scooters (stand-up, kick or shared)",
        "description": "Narrative names an e-scooter, electric/motorized/powered scooter or a shared-scooter brand with 'scooter'.",
        "prefilter": ("scoot",),
        "strip": [r"\b(?:non|un)[- ]?(?:motorized|powered|electric)\s+(?:push\s+|kick\s+)?scooters?",
                  r"\b(?:manual|push|kick)\s+scooters?",
                  r"\b(?:mobility|handicap(?:ped)?|disability|medical)\s+scooters?"],
        "include": [r"\be[- ]?scooters?\b", r"\belectric(?:[- ](?:kick|stand[- ]?up|push))?\s+scooters?\b",
                    r"\b(?:motorized|powered|power|motor)\s+(?:stand[- ]?up\s+|kick\s+)?scooters?\b",
                    r"\b(?:bird|lime|spin|lyft|uber|veo)\s+(?:electric\s+)?scooters?\b", r"\brental\s+scooters?\b",
                    r"\bshared\s+(?:electric\s+)?scooters?\b"],
        "exclude": [],
        "related_products": [5022, 5042],
    },
    "ebike": {
        "label": "Electric bicycles (e-bikes)",
        "description": "Narrative names an e-bike, electric(-assist) bicycle or a pedal/power-assist bicycle.",
        "prefilter": ("bike", "bicycle", "cycle"),
        "strip": [],
        "include": [r"\be[- ]?bikes?\b", r"\belectric(?:[- ]assist(?:ed)?)?\s+(?:mountain\s+|road\s+|fat[- ]tire\s+)?(?:bike|bicycle|cycle)s?\b",
                    r"\b(?:pedal|power|motor)[- ]?assist(?:ed)?\s+(?:bike|bicycle|cycle)s?\b", r"\bemtb\b", r"\bfat[- ]?tire\s+e[- ]?bikes?\b"],
        "exclude": [],
        "related_products": [5045, 5046],
    },
    "hoverboard": {
        "label": "Hoverboards (self-balancing boards)",
        "description": "Narrative names a hoverboard / hover board, self-balancing scooter or board, or swegway.",
        "prefilter": ("hover", "balanc", "swegway"),
        "strip": [],
        "include": [r"\bhover\s?boards?\b", r"\bself[- ]balancing\s+(?:scooter|board)s?\b", r"\bswegways?\b", r"\bhover\s?carts?\b"],
        "exclude": [],
        "related_products": [],
    },
    "onewheel_eskate": {
        "label": "Electric skateboards and one-wheel boards",
        "description": "Narrative names a OneWheel / FloatWheel, electric skateboard or longboard, or electric unicycle.",
        "prefilter": ("wheel", "skate", "longboard", "unicycle"),
        "strip": [],
        "include": [r"\bone[- ]?wheels?\b", r"\bfloat[- ]?wheels?\b", r"\belectric\s+(?:skate\s?boards?|longboards?|unicycles?)\b",
                    r"\be[- ]?(?:skate\s?boards?|longboards?)\b", r"\b(?:motorized|powered)\s+(?:skate\s?boards?|longboards?)\b",
                    r"\bboosted\s+(?:board|skate)"],
        "exclude": [r"\bone[- ]?wheel(?:ie)?\s+(?:bike|bicycle|wheelie)"],
        "related_products": [5042],
    },
    "battery_fire": {
        "label": "Battery fire, explosion or overheating",
        "description": "Narrative ties a battery (any type, excluding vehicle batteries) to fire, explosion, overheating, melting or smoke.",
        "prefilter": ("batter",),
        "strip": [r"\bsmoke\s*(?:detector|alarm)s?\b", r"\b(?:co|carbon monoxide)\s*(?:detector|alarm)s?\b"],
        "include": [r"\bbatter(?:y|ies)\b.{0,60}\b(?:explo\w*|caught fire|catch(?:es|ing)? fire|on fire|burst into flame\w*|ignit\w*|overheat\w*|over heat\w*|melt\w*|smok\w*|blew up|combust\w*|flames?|burst)\b",
                    r"\b(?:explo\w*|caught fire|catch(?:es|ing)? fire|burst into flame\w*|ignit\w*|overheat\w*|over heat\w*|blew up|combust\w*|smoking|melted)\b.{0,50}\bbatter(?:y|ies)\b"],
        "exclude": [r"\b(?:car|truck|automotive|vehicle|boat|marine|jump(?:er)?[- ]?start\w*|jumper cables?|lead[- ]acid)\s+batter",
                    r"\bbatter(?:y|ies)\s+(?:acid|powered game)"],
        "related_products": [],
    },
    "battery_ingestion": {
        "label": "Battery swallowed, aspirated or inserted",
        "description": "Narrative ties a battery (button/coin or any other) to swallowing, ingestion, aspiration or insertion in the nose, ear or mouth.",
        "prefilter": ("batter", "button cell", "coin cell"),
        "strip": [],
        "include": [r"\bbatter(?:y|ies)\b.{0,50}\b(?:swallow\w*|ingest\w*|aspirat\w*|inhal\w*|\bate\b|eaten|eating|stuck|lodged|nose|nostril|ear\b|mouth|throat|esophag\w*)",
                    r"\b(?:swallow\w*|ingest\w*|aspirat\w*|inhal\w*|\bate\b|eating|inserted|put|placed|stuck)\b.{0,50}\bbatter(?:y|ies)\b",
                    r"\b(?:button|coin|watch|disc|disk)[- ](?:cell|batter(?:y|ies))\b"],
        "exclude": [r"\bbatter(?:y|ies)\b.{0,40}\b(?:car|truck)\b"],
        "related_products": [],
    },
    "magnet_ingestion": {
        "label": "Magnet swallowed, aspirated or inserted",
        "description": "Narrative ties a magnet or magnetic balls/beads/cubes to swallowing, ingestion, aspiration or insertion.",
        "prefilter": ("magnet", "buckyball", "neodymium"),
        "strip": [r"\bnon[- ]?magnet\w*"],
        "include": [r"\bmagnet\w*\b.{0,60}\b(?:swallow\w*|ingest\w*|aspirat\w*|inhal\w*|\bate\b|eaten|eating|stuck|nose|nostril|ear\b|mouth)",
                    r"\b(?:swallow\w*|ingest\w*|aspirat\w*|inhal\w*|\bate\b|eating|inserted|put|placed)\b.{0,60}\bmagnet\w*\b",
                    r"\bbuckyballs?\b", r"\bneodymium\b"],
        "exclude": [r"\bmagnetic resonance\b", r"\bmagnet(?:ic)? (?:imaging|resonance)\b", r"\bmri\b"],
        "related_products": [],
    },
    "detergent_pod": {
        "label": "Laundry and dish detergent pods",
        "description": "Narrative names a laundry, detergent, dishwasher or dish pod / packet / capsule, or a Tide Pod.",
        "prefilter": ("pod", "pac", "capsule"),
        "strip": [],
        "include": [r"\b(?:laundry|detergent|dishwasher|dish\s?washer|dish|washing|soap|cleaning)\s+(?:detergent\s+|soap\s+)?(?:pods?|pacs?|packets?|packs?|capsules?)\b",
                    r"\btide\s+pods?\b", r"\bgain\s+(?:flings|pods?)\b", r"\bpods?\s+of\s+(?:laundry|detergent)\b"],
        "exclude": [r"\b(?:seed|pea|bean|coffee|keurig|k[- ]cup|nicotine|vape|vaping|juul|puff)\s+(?:pods?|packs?|packets?|capsules?)\b"],
        "related_products": [],
    },
    "water_beads": {
        "label": "Water beads (expanding gel beads)",
        "description": "Narrative names water beads, Orbeez, hydrogel or expanding gel/jelly beads or water crystals.",
        "prefilter": ("bead", "orbeez", "hydrogel", "hydro gel", "water gel", "water crystal"),
        "strip": [],
        "include": [r"\bwater[- ]?beads?\b", r"\borbeez\b", r"\bhydro[- ]?gel\s+(?:beads?|balls?)\b", r"\b(?:expanding|growing)\s+(?:water\s+|gel\s+|jelly\s+)?(?:beads?|balls?)\b",
                    r"\bjelly\s+beads?\b", r"\bwater\s+(?:crystals?|gel\s+(?:beads?|balls?))\b"],
        "exclude": [r"\bgel\s+(?:blasters?|guns?)\b", r"\bblasters?\b"],
        "related_products": [],
    },
    "pickleball": {
        "label": "Pickleball",
        "description": "Narrative names pickleball (the sport has no NEISS product code of its own before 2021).",
        "prefilter": ("pickle",),
        "strip": [],
        "include": [r"\bpickle[- ]?ball\w*\b"],
        "exclude": [],
        "related_products": [],
    },
}

_COMPILED = {}


def _compile():
    if _COMPILED:
        return
    for tid, d in DEFS.items():
        _COMPILED[tid] = {
            "pre": tuple(d["prefilter"]),
            "strip": [re.compile(p) for p in d["strip"]],
            "inc": [re.compile(p) for p in d["include"]],
            "exc": [re.compile(p) for p in d["exclude"]],
        }


def match(narrative, p1=None, p2=None, p3=None):
    """Theme ids whose definition the narrative satisfies (product codes are accepted for interface symmetry and ignored)."""
    if not narrative:
        return ()
    _compile()
    t = narrative.lower()
    hits = []
    for tid, c in _COMPILED.items():
        if not any(s in t for s in c["pre"]):
            continue
        u = t
        for s in c["strip"]:
            u = s.sub(" ", u)
        if any(r.search(u) for r in c["inc"]) and not any(r.search(u) for r in c["exc"]):
            hits.append(tid)
    return tuple(hits)


def definitions_hash():
    blob = json.dumps({k: {f: v[f] for f in ("prefilter", "strip", "include", "exclude")} for k, v in sorted(DEFS.items())}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
