"""Code tables from the USSC Public Release Codebook FY1999-FY2025 (revised April 7, 2026), Appendix A, and the
crosswalk from USSC DISTRICT codes to this project's court ids (court_spine; every id below exists there).

Codebook: https://www.ussc.gov/sites/default/files/pdf/research-and-publications/datafiles/USSC_Public_Release_Codebook_FY99_FY25.pdf
"""
CODEBOOK_URL = "https://www.ussc.gov/sites/default/files/pdf/research-and-publications/datafiles/USSC_Public_Release_Codebook_FY99_FY25.pdf"
DATAFILES_PAGE = "https://www.ussc.gov/research/datafiles/commission-datafiles"

# DISTRICT code -> (codebook label, court id, USPS, readable name)
DISTRICTS = {
    0: ("Maine", "med", "ME", "D. Maine"), 1: ("Massachusetts", "mad", "MA", "D. Massachusetts"),
    2: ("New Hampshire", "nhd", "NH", "D. New Hampshire"), 3: ("Rhode Island", "rid", "RI", "D. Rhode Island"),
    4: ("Puerto Rico", "prd", "PR", "D. Puerto Rico"), 5: ("Connecticut", "ctd", "CT", "D. Connecticut"),
    6: ("New York North", "nynd", "NY", "N.D. New York"), 7: ("New York East", "nyed", "NY", "E.D. New York"),
    8: ("New York South", "nysd", "NY", "S.D. New York"), 9: ("New York West", "nywd", "NY", "W.D. New York"),
    10: ("Vermont", "vtd", "VT", "D. Vermont"), 11: ("Delaware", "ded", "DE", "D. Delaware"),
    12: ("New Jersey", "njd", "NJ", "D. New Jersey"), 13: ("Penn. East", "paed", "PA", "E.D. Pennsylvania"),
    14: ("Penn. Mid", "pamd", "PA", "M.D. Pennsylvania"), 15: ("Penn. West", "pawd", "PA", "W.D. Pennsylvania"),
    16: ("Maryland", "mdd", "MD", "D. Maryland"), 17: ("N Carolina East", "nced", "NC", "E.D. North Carolina"),
    18: ("N Carolina Mid", "ncmd", "NC", "M.D. North Carolina"), 19: ("N Carolina West", "ncwd", "NC", "W.D. North Carolina"),
    20: ("South Carolina", "scd", "SC", "D. South Carolina"), 22: ("Virginia East", "vaed", "VA", "E.D. Virginia"),
    23: ("Virginia West", "vawd", "VA", "W.D. Virginia"), 24: ("W Virginia North", "wvnd", "WV", "N.D. West Virginia"),
    25: ("W Virginia South", "wvsd", "WV", "S.D. West Virginia"), 26: ("Alabama North", "alnd", "AL", "N.D. Alabama"),
    27: ("Alabama Mid", "almd", "AL", "M.D. Alabama"), 28: ("Alabama South", "alsd", "AL", "S.D. Alabama"),
    29: ("Florida North", "flnd", "FL", "N.D. Florida"), 30: ("Florida Mid", "flmd", "FL", "M.D. Florida"),
    31: ("Florida South", "flsd", "FL", "S.D. Florida"), 32: ("Georgia North", "gand", "GA", "N.D. Georgia"),
    33: ("Georgia Mid", "gamd", "GA", "M.D. Georgia"), 34: ("Georgia South", "gasd", "GA", "S.D. Georgia"),
    35: ("Louisiana East", "laed", "LA", "E.D. Louisiana"), 36: ("Louisiana West", "lawd", "LA", "W.D. Louisiana"),
    37: ("Mississippi North", "msnd", "MS", "N.D. Mississippi"), 38: ("Mississippi South", "mssd", "MS", "S.D. Mississippi"),
    39: ("Texas North", "txnd", "TX", "N.D. Texas"), 40: ("Texas East", "txed", "TX", "E.D. Texas"),
    41: ("Texas South", "txsd", "TX", "S.D. Texas"), 42: ("Texas West", "txwd", "TX", "W.D. Texas"),
    43: ("Kentucky East", "kyed", "KY", "E.D. Kentucky"), 44: ("Kentucky West", "kywd", "KY", "W.D. Kentucky"),
    45: ("Michigan East", "mied", "MI", "E.D. Michigan"), 46: ("Michigan West", "miwd", "MI", "W.D. Michigan"),
    47: ("Ohio North", "ohnd", "OH", "N.D. Ohio"), 48: ("Ohio South", "ohsd", "OH", "S.D. Ohio"),
    49: ("Tennessee East", "tned", "TN", "E.D. Tennessee"), 50: ("Tennessee Mid", "tnmd", "TN", "M.D. Tennessee"),
    51: ("Tennessee West", "tnwd", "TN", "W.D. Tennessee"), 52: ("Illinois North", "ilnd", "IL", "N.D. Illinois"),
    53: ("Illinois Cent", "ilcd", "IL", "C.D. Illinois"), 54: ("Illinois South", "ilsd", "IL", "S.D. Illinois"),
    55: ("Indiana North", "innd", "IN", "N.D. Indiana"), 56: ("Indiana South", "insd", "IN", "S.D. Indiana"),
    57: ("Wisconsin East", "wied", "WI", "E.D. Wisconsin"), 58: ("Wisconsin West", "wiwd", "WI", "W.D. Wisconsin"),
    60: ("Arkansas East", "ared", "AR", "E.D. Arkansas"), 61: ("Arkansas West", "arwd", "AR", "W.D. Arkansas"),
    62: ("Iowa North", "iand", "IA", "N.D. Iowa"), 63: ("Iowa South", "iasd", "IA", "S.D. Iowa"),
    64: ("Minnesota", "mnd", "MN", "D. Minnesota"), 65: ("Missouri East", "moed", "MO", "E.D. Missouri"),
    66: ("Missouri West", "mowd", "MO", "W.D. Missouri"), 67: ("Nebraska", "ned", "NE", "D. Nebraska"),
    68: ("North Dakota", "ndd", "ND", "D. North Dakota"), 69: ("South Dakota", "sdd", "SD", "D. South Dakota"),
    70: ("Arizona", "azd", "AZ", "D. Arizona"), 71: ("California North", "cand", "CA", "N.D. California"),
    72: ("California East", "caed", "CA", "E.D. California"), 73: ("California Central", "cacd", "CA", "C.D. California"),
    74: ("California South", "casd", "CA", "S.D. California"), 75: ("Hawaii", "hid", "HI", "D. Hawaii"),
    76: ("Idaho", "idd", "ID", "D. Idaho"), 77: ("Montana", "mtd", "MT", "D. Montana"), 78: ("Nevada", "nvd", "NV", "D. Nevada"),
    79: ("Oregon", "ord", "OR", "D. Oregon"), 80: ("Washington East", "waed", "WA", "E.D. Washington"),
    81: ("Washington West", "wawd", "WA", "W.D. Washington"), 82: ("Colorado", "cod", "CO", "D. Colorado"),
    83: ("Kansas", "ksd", "KS", "D. Kansas"), 84: ("New Mexico", "nmd", "NM", "D. New Mexico"),
    85: ("Oklahoma North", "oknd", "OK", "N.D. Oklahoma"), 86: ("Oklahoma East", "oked", "OK", "E.D. Oklahoma"),
    87: ("Oklahoma West", "okwd", "OK", "W.D. Oklahoma"), 88: ("Utah", "utd", "UT", "D. Utah"), 89: ("Wyoming", "wyd", "WY", "D. Wyoming"),
    90: ("Dist of Columbia", "dcd", "DC", "D. District of Columbia"), 91: ("Virgin Islands", "vid", "VI", "D. Virgin Islands"),
    93: ("Guam", "gud", "GU", "D. Guam"), 94: ("N Mariana Islands", "nmid", "MP", "D. Northern Mariana Islands"),
    95: ("Alaska", "akd", "AK", "D. Alaska"), 96: ("Louisiana Middle", "lamd", "LA", "M.D. Louisiana"),
}

OFFGUIDE = {
    1: "Administration of Justice", 2: "Antitrust", 3: "Arson", 4: "Assault", 5: "Bribery/Corruption",
    6: "Burglary/Trespass", 7: "Child Pornography", 8: "Commercialized Vice", 9: "Drug Possession",
    10: "Drug Trafficking", 11: "Environmental", 12: "Extortion/Racketeering", 13: "Firearms", 14: "Food and Drug",
    15: "Forgery/Counter/Copyright", 16: "Fraud/Theft/Embezzlement", 17: "Immigration", 18: "Individual Rights",
    19: "Kidnapping", 20: "Manslaughter", 21: "Money Launder", 22: "Murder", 23: "National Defense",
    24: "Obscenity/Other Sex Offenses", 25: "Prison Offenses", 26: "Robbery", 27: "Sex Abuse",
    28: "Stalking/Harassing", 29: "Tax", 30: "Other",
}
_OFFTYPE_COMMON = {
    1: "Murder", 2: "Manslaughter", 3: "Kidnapping/Hostage Taking", 4: "Sexual Abuse", 5: "Assault", 6: "Robbery",
    9: "Arson", 10: "Drugs - Trafficking, Manufacturing, and Importing", 11: "Drugs - Communication Facilities",
    12: "Drugs - Simple Possession", 13: "Firearms (Includes Firearms Use, Possession, and Trafficking)",
    15: "Burglary/Breaking and Entering", 16: "Auto Theft", 17: "Larceny", 18: "Fraud", 19: "Embezzlement",
    20: "Forgery/Counterfeiting", 21: "Bribery", 22: "Tax Offenses", 23: "Money Laundering",
    24: "Racketeering/Extortion", 25: "Gambling/Lottery", 26: "Civil Rights Offenses", 27: "Immigration",
    29: "Prison Offenses",
    30: "Administration of Justice (Includes accessory after the fact, misprision of felony, and witness tampering)",
    31: "Environmental, Game, Fish, and Wildlife Offenses", 32: "National Defense Offenses", 33: "Antitrust Violations",
    34: "Food and Drug Offenses",
}
OFFTYPE2 = {
    **_OFFTYPE_COMMON,
    28: "Pornography/Prostitution",
    35: "Traffic Violations and Other Offenses (Includes Other Drug, Environmental, Firearms, Miscellaneous Property Crimes, Violent, and Traffic offenses)",
    42: "Child Pornography", 43: "Obscenity", 44: "Prostitution",
}
OFFTYPSB = {
    **_OFFTYPE_COMMON,
    28: "Child Pornography (includes OFFTYPE2=42, Child Pornography)",
    35: "Traffic Violations and Other Offenses (Includes Other Drug, Environmental, Firearms, Miscellaneous Property Crimes, Violent, Traffic offenses, Obscenity, and Prostitution)",
}
OFFENSE_TABLES = {"OFFGUIDE": OFFGUIDE, "OFFTYPSB": OFFTYPSB, "OFFTYPE2": OFFTYPE2}

SENTIMP = {
    0: "No prison/probation (fine only)", 1: "Prison only (no alternatives)",
    2: "Prison + confinement conditions (alternatives, including Zone C split sentences)",
    3: "Probation + confinement conditions (alternatives)", 4: "Probation only",
}

# Guideline-range position: code -> bucket ("within", "above", "below_gov", "below_other", "below_mixed", None = n/a)
RANGE_SCHEMES = {
    # DEPART (FY1999-FY2003): 3,4,7 are government-sponsored only; 5,6,9 combine government-sponsored and other
    # downward departures; 8 = not applicable.
    "DEPART": {0: "within", 1: "above", 2: "below_other", 3: "below_gov", 4: "below_gov", 5: "below_mixed",
               6: "below_mixed", 7: "below_gov", 8: None, 9: "below_mixed"},
    # DEPART_A (FY2003-FY2006)
    "DEPART_A": {0: "within", 1: "above", 2: "below_gov", 3: "below_gov", 4: "below_gov", 5: "below_other", 8: None},
    # BOOKERCD (FY2005-FY2017)
    "BOOKERCD": {0: "within", 1: "above", 2: "above", 3: "above", 4: "above", 5: "below_gov", 6: "below_gov",
                 7: "below_gov", 8: "below_other", 9: "below_other", 10: "below_other", 11: "below_other"},
    # SENTRNGE (FY2018-present)
    "SENTRNGE": {0: "within", 1: "above", 2: "below_gov", 3: "below_gov", 4: "below_gov", 5: "below_other",
                 6: "above", 7: "below_gov", 8: "below_other"},
}


def range_candidates(fy: int) -> list[str]:
    """Guideline-range variables for a year, preferred first (the FY2003 file carries DEPART but not DEPART_A)."""
    if fy >= 2018:
        return ["SENTRNGE"]
    if fy >= 2005:
        return ["BOOKERCD"]
    if fy >= 2003:
        return ["DEPART_A", "DEPART"]
    return ["DEPART"]


def year_spec(fy: int, available: set[str] | None = None) -> dict:
    """Which codebook variables carry each measure in a fiscal year, following the Commission's own publications.
    With `available` (the variables the year's file carries), the first available range variable is chosen."""
    cands = range_candidates(fy)
    rng = next((c for c in cands if available is None or c in available), cands[0])
    return {
        "offense": "OFFGUIDE" if fy >= 2018 else ("OFFTYPSB" if fy >= 2010 else "OFFTYPE2"),
        "range": rng,
        "prison": "SENTTCAP" if fy >= 2018 else "SENTTOT",
        "sentence": "SENSPCAP" if fy >= 2018 else "SENSPLT0",
        "sentimp": "SENTIMP",
        "statmin": "STATMIN",
        "district": "DISTRICT",
    }


def datafile_url(fy: int) -> str:
    yy = f"{fy % 100:02d}"
    if fy >= 2012:
        return f"https://www.ussc.gov/sites/default/files/zip/opafy{yy}nid_csv.zip"
    return f"https://www.ussc.gov/sites/default/files/zip/opafy{yy}nid.zip"
