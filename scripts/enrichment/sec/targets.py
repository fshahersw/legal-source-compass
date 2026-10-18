"""Which MDLs this lane links to SEC registrants, and the exact text each evidence tier searches for.

Tiers (strongest first):
  A  number  - the company's own filing contains "MDL No. <n>", "MDL <n>" or "MDL Docket No. <n>".
  B  caption - the company's own filing contains the official JPML caption (without "In re:").
  C  subject - the filing contains "MDL"/"multidistrict" within 500 characters of a subject term taken
               from the official caption, plus a products-liability term, plus every required term; the
               filing must be dated on or after the JPML transfer date. Always labelled "requires review".

Subject terms are copied from the JPML caption (the product, device or event named in it). They are
never brand names that the caption does not contain, except the caption's own abbreviation.
"""
import re

NUMBER_TEMPLATES = ("MDL No. {n}", "MDL {n}", "MDL Docket No. {n}")

# mdl -> (subject terms, required terms). Required terms must also appear within 1,000 characters;
# a required term written "A|B|C" is satisfied by any of its alternatives.
SUBJECTS: dict[int, tuple[tuple[str, ...], tuple[str, ...]]] = {
    2738: (("talc", "talcum powder"), ()),
    # Becton Dickinson (owner of Bard/Davol) calls them "hernia repair devices" / "Hernia Product Claims";
    # the transferee court (S.D. Ohio, per JPML) is accepted as the disambiguator from MDL 3029.
    2846: (("hernia mesh", "hernia repair", "hernia product"), ("Bard|Davol|Southern District of Ohio",)),
    2873: (("AFFF", "film-forming foam"), ()),
    3060: (("hair relaxer",), ()),
    2789: (("proton pump inhibitor", "proton-pump inhibitor"), ()),
    2666: (("Bair Hugger",), ()),
    3004: (("paraquat",), ()),
    2570: (("IVC filter",), ("Cook",)),
    3140: (("Depo-Provera", "medroxyprogesterone"), ()),
    2974: (("Paragard",), ()),
    3081: (("port catheter", "implanted port", "implantable port", "implantable ports"), ("Bard|Davol|District of Arizona",)),
    # "incretin" is the drug class of the captioned GLP-1 receptor agonists; filers such as Eli Lilly
    # describe the MDL as covering "incretin medicines". The date gate keeps the terminated 2013-2023
    # Incretin-Based Therapies MDL 2452 out.
    3094: (("GLP-1", "glucagon-like peptide", "incretin"), ()),
    3047: (("social media",), ("adolescent",)),
    # Medtronic describes Covidien as "certain subsidiaries"; the transferee court (D. Mass., per JPML) disambiguates.
    3029: (("hernia mesh",), ("Covidien|District of Massachusetts",)),
    3092: (("Suboxone",), ("film",)),
    3044: (("Exactech",), ()),
    2875: (("valsartan", "losartan", "irbesartan"), ()),
    2921: (("Biocell", "textured breast implant"), ()),
    2741: (("Roundup",), ()),
    2924: (("Zantac", "ranitidine"), ()),
    3026: (("preterm infant", "necrotizing enterocolitis"), ()),
    3014: (("CPAP",), ("Philips",)),
    2243: (("Fosamax", "alendronate"), ()),
    3101: (("baby food",), ()),
    3125: (("port catheter",), ("AngioDynamics",)),
    3079: (("Tepezza",), ()),
    3163: (("NAION", "optic neuropathy"), ()),
    2973: (("Elmiron", "pentosan"), ()),
    3087: (("Future Motion",), ()),
    3023: (("Taxotere", "docetaxel"), ("eye",)),
    2814: (("DPS6", "PowerShift"), ()),
    2672: (("clean diesel",), ("Volkswagen",)),
    2197: (("ASR",), ("DePuy",)),
    3043: (("acetaminophen",), ("ADHD",)),
    2753: (("C-Qur",), ()),
    3052: (("vehicle theft",), ()),
    2599: (("Takata",), ()),
    2768: (("LFIT",), ()),
    3181: (("spinal cord stimulator",), ("Boston Scientific",)),
    3180: (("Dupixent", "dupilumab"), ()),
    3006: (("Tasigna", "nilotinib"), ()),
    2905: (("airbag control unit",), ("ZF",)),
    3051: (("ARC",), ("inflator",)),
    3178: (("ByHeart",), ()),
    3172: (("Cartiva",), ()),
    2740: (("Taxotere", "docetaxel"), ("alopecia",)),
    3050: (("Chantix", "varenicline"), ()),
    2841: (("MONAT",), ()),
    3040: (("Pacifica",), ("fire",)),
    2913: (("JUUL",), ()),
    3078: (("Generac",), ("solar",)),
    2441: (("Rejuvenate",), ()),
    3036: (("Gardasil",), ()),
    2151: (("unintended acceleration",), ()),
    3037: (("infant formula",), ("recall",)),
    1358: (("MTBE", "methyl tertiary butyl ether"), ()),
    2816: (("heater-cooler",), ()),
    1871: (("Avandia",), ()),
    2885: (("Combat Arms",), ()),
    2859: (("M/L Taper",), ()),
    2782: (("Physiomesh",), ()),
    2848: (("Zostavax",), ()),
    3015: (("sunscreen",), ()),
    2179: (("Deepwater Horizon",), ()),
    # Recently terminated (left the JPML pending report during the series) with a products-liability caption.
    2938: (("Evenflo",), ()),
    2047: (("Chinese drywall", "Chinese-manufactured drywall"), ()),
    3009: (("Seresto",), ()),
    2903: (("Rock 'n Play",), ()),
    3021: (("SoClean",), ()),
    2949: (("Profemur",), ()),
    2244: (("Pinnacle",), ("DePuy",)),
    2592: (("Xarelto", "rivaroxaban"), ()),
    2642: (("fluoroquinolone",), ()),
    2775: (("Birmingham Hip",), ()),
    2777: (("EcoDiesel",), ()),
    2433: (("C-8",), ("personal injury",)),
}

PL_TERMS = re.compile(
    r"product[s]?\s+liabilit|personal\s+injur|wrongful\s+death|bodily\s+injur|injur(?:y|ies|ed)|cancer|mesothelioma|lymphoma"
    r"|leukemia|death|disease|adverse (?:event|effect|reaction)|side effect|punitive|compensatory damages|meningioma|tumou?r"
    r"|ovarian|asbestos|medical monitoring",
    re.I,
)
MDL_TERMS = re.compile(r"\bMDLs?\b|multi-?district", re.I)
MASS_TORT_TYPES = {"Products Liability", "Common Disaster", "Air Disaster"}
# MDL 1570 (September 11 attacks) names foreign sovereign and charity defendants; its caption phrase is
# quoted by thousands of unrelated insurers and funds, so it is not a corporate-defendant MDL for this view.
EXCLUDED = {1570}
TERMINATED_PL = re.compile(r"Products Liability|Personal Injury", re.I)
HISTORY_PL = re.compile(r"\bPL\b|Products Liability|Personal Injury", re.I)


def caption_core(title: str) -> str:
    core = re.sub(r"^\s*IN RE:?\s*", "", title, flags=re.I).strip()
    core = re.sub(r"\s*\(No\.\s*[IVX]+\)\s*$", "", core).strip()
    return core


def select_targets(inputs: dict) -> list[dict]:
    """Pending mass-tort MDLs, recently terminated products-liability MDLs, and products-liability MDLs
    terminated since 2012 per the JPML terminated-litigations report (number search only)."""
    out: dict[int, dict] = {}
    for m in inputs["mdls"]:
        pending_mass = m["status"] == "pending" and m["type"] in MASS_TORT_TYPES
        recent_pl = m["status"] != "pending" and TERMINATED_PL.search(m["title"] or "")
        if not (pending_mass or recent_pl) or m["mdl"] in EXCLUDED:
            continue
        out[m["mdl"]] = {
            "mdl": m["mdl"], "title": m["title"], "caption": caption_core(m["title"]), "status": m["status"],
            "type": m["type"], "pending": m["pending"], "as_of": m["as_of"], "district": m["district"],
            "judge": m["judge"], "date_filed": m.get("date_filed"), "date_transferred": m["date_transferred"],
            "date_closed": m["date_closed"], "master_docket": m.get("master_docket"),
            "source": "mdl_analytics", "use_caption": True,
        }
    for h in inputs["terminated"]:
        if h["termination_year"] < 2012 or not HISTORY_PL.search(h["caption"]) or h["mdl"] in out:
            continue
        out[h["mdl"]] = {
            "mdl": h["mdl"], "title": h["caption"], "caption": h["caption"], "status": "terminated",
            "type": "Products Liability (caption)", "pending": None, "as_of": None, "district": h["district_name"],
            "judge": h["transferee_judge"], "date_filed": None, "date_transferred": None, "date_closed": None,
            "master_docket": None,
            "termination_year": h["termination_year"],
            "source": "mdl_terminated_history", "use_caption": False,
        }
    return sorted(out.values(), key=lambda t: t["mdl"])


def _words(term: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", term.lower()))


def other_terms(mdl: int) -> list[str]:
    """Subject terms of every other target MDL that share no word with this MDL's own terms (so 'hernia
    mesh' for MDL 2846 and MDL 3029, or 'Taxotere' for 2740 and 3023, never exclude each other)."""
    own = set().union(*(_words(t) for t in SUBJECTS[mdl][0])) if mdl in SUBJECTS else set()
    out = []
    for n, (terms, _) in SUBJECTS.items():
        if n == mdl:
            continue
        out.extend(t for t in terms if not (_words(t) & own))
    return sorted(set(out))
