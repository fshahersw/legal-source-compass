"""Deterministic FCMS court name -> court_spine id mapping (exact normalised names only, no fuzzy matching).

District names are printed as "<STATE>" or "<STATE> <DIRECTION>" (e.g. "ILLINOIS NORTHERN"); circuit pages as
"DISTRICT OF COLUMBIA", "FIRST CIRCUIT" ... "ELEVENTH CIRCUIT". Normalisation: upper case, collapse whitespace,
drop a trailing period. A derived id is accepted only if it exists in the court_spine lookup as a federal
district court ("District Court" in its title) whose state equals the derived USPS code.
"""
import re

STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA",
    "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS",
    "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK",
    "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
}
SPECIAL = {
    "DISTRICT OF COLUMBIA": ("dcd", "DC"), "PUERTO RICO": ("prd", "PR"), "GUAM": ("gud", "GU"),
    "VIRGIN ISLANDS": ("vid", "VI"), "NORTHERN MARIANAS": ("nmid", "MP"), "NORTHERN MARIANA ISLANDS": ("nmid", "MP"),
}
DIRECTIONS = {"NORTHERN": "n", "SOUTHERN": "s", "EASTERN": "e", "WESTERN": "w", "MIDDLE": "m", "CENTRAL": "c"}
CIRCUITS = {
    "DISTRICT OF COLUMBIA": "cadc", "DC CIRCUIT": "cadc", "D.C. CIRCUIT": "cadc", "FIRST CIRCUIT": "ca1", "SECOND CIRCUIT": "ca2",
    "THIRD CIRCUIT": "ca3", "FOURTH CIRCUIT": "ca4", "FIFTH CIRCUIT": "ca5", "SIXTH CIRCUIT": "ca6",
    "SEVENTH CIRCUIT": "ca7", "EIGHTH CIRCUIT": "ca8", "NINTH CIRCUIT": "ca9", "TENTH CIRCUIT": "ca10",
    "ELEVENTH CIRCUIT": "ca11", "FEDERAL CIRCUIT": "cafc",
}
CIRCUIT_NAMES = {
    "cadc": "D.C. Circuit", "ca1": "First Circuit", "ca2": "Second Circuit", "ca3": "Third Circuit", "ca4": "Fourth Circuit",
    "ca5": "Fifth Circuit", "ca6": "Sixth Circuit", "ca7": "Seventh Circuit", "ca8": "Eighth Circuit", "ca9": "Ninth Circuit",
    "ca10": "Tenth Circuit", "ca11": "Eleventh Circuit", "cafc": "Federal Circuit",
}
# Districts by regional circuit (28 U.S.C. 41 / 81-131). Used only to label rows and to group the
# within-circuit standing; every district id is still verified against court_spine.
CIRCUIT_OF = {}
for _cid, _ids in {
    "cadc": ["dcd"], "ca1": ["med", "mad", "nhd", "rid", "prd"],
    "ca2": ["ctd", "nynd", "nyed", "nysd", "nywd", "vtd"], "ca3": ["ded", "njd", "paed", "pamd", "pawd", "vid"],
    "ca4": ["mdd", "nced", "ncmd", "ncwd", "scd", "vaed", "vawd", "wvnd", "wvsd"],
    "ca5": ["laed", "lamd", "lawd", "msnd", "mssd", "txnd", "txed", "txsd", "txwd"],
    "ca6": ["kyed", "kywd", "mied", "miwd", "ohnd", "ohsd", "tned", "tnmd", "tnwd"],
    "ca7": ["ilnd", "ilcd", "ilsd", "innd", "insd", "wied", "wiwd"],
    "ca8": ["ared", "arwd", "iand", "iasd", "mnd", "moed", "mowd", "ned", "ndd", "sdd"],
    "ca9": ["akd", "azd", "cand", "caed", "cacd", "casd", "hid", "idd", "mtd", "nvd", "ord", "waed", "wawd", "gud", "nmid"],
    "ca10": ["cod", "ksd", "nmd", "oknd", "oked", "okwd", "utd", "wyd"],
    "ca11": ["alnd", "almd", "alsd", "flnd", "flmd", "flsd", "gand", "gamd", "gasd"],
}.items():
    for _d in _ids:
        CIRCUIT_OF[_d] = _cid


# Abbreviated leading words printed in 2004-2011 editions ("NO. CAROLINA EASTERN", "W. VIRGINIA SOUTHERN")
ABBREVIATIONS = {"NO.": "NORTH", "SO.": "SOUTH", "W.": "WEST", "N.": "NORTH", "S.": "SOUTH"}


def normalise(name):
    name = re.sub(r"\s+", " ", (name or "").upper()).strip().rstrip(".")
    parts = name.split(" ")
    if len(parts) > 1 and parts[0] in ABBREVIATIONS:
        parts[0] = ABBREVIATIONS[parts[0]]
    return " ".join(parts)


# Jurisdictions with a single district court: only these may be named without a direction. court_spine also holds
# statewide placeholders for multi-district states (for example "ard", "fld", "texd"); a printed name without a
# direction for such a state must never bind to them.
SINGLE_DISTRICT = {
    "AK", "AZ", "CO", "CT", "DE", "HI", "ID", "KS", "ME", "MD", "MA", "MN", "MT", "NE", "NV", "NH", "NJ", "NM", "ND",
    "OR", "RI", "SC", "SD", "UT", "VT", "WY"}


def district_candidate(name):
    """Printed district name -> (court id, USPS) or (None, None) when the name is not a district name."""
    n = normalise(name)
    if n in SPECIAL:
        return SPECIAL[n]
    parts = n.split(" ")
    direction = DIRECTIONS.get(parts[-1]) if len(parts) > 1 else None
    state_name = " ".join(parts[:-1]) if direction else n
    usps = STATES.get(state_name)
    if not usps:
        return None, None
    if not direction and usps not in SINGLE_DISTRICT:
        return None, usps  # a multi-district state printed without a direction is not a district name
    return f"{usps.lower()}{direction or ''}d", usps


def resolve_district(name, spine):
    """Return (court id, USPS, method) when the derived id exists in court_spine as a district court of that state."""
    cid, usps = district_candidate(name)
    if not cid:
        return None, None, "no_rule"
    row = spine.get(cid)
    if not row:
        return None, usps, "not_in_spine"
    title, state = row
    if "District Court" not in title or state != usps:
        return None, usps, "spine_mismatch"
    return cid, usps, "exact_name_rule"


def resolve_circuit(name, spine):
    n = normalise(name)
    cid = CIRCUITS.get(n)
    if not cid:
        return None, "no_rule"
    if cid not in spine or "Court of Appeals" not in spine[cid][0]:
        return None, "not_in_spine"
    return cid, "exact_name_rule"
