"""Official Wyoming Statutes download inventory (wyoleg.gov/stateStatutes/StatutesDownload)."""

BASE = "https://wyoleg.gov/"
DOWNLOAD_PAGE = BASE + "stateStatutes/StatutesDownload"
STATUTES_HOME = BASE + "stateStatutes/StateStatutes"

CURRENCY_STATEMENT = (
    "This version of the Wyoming Statutes contains changes from the 2026 Budget Session "
    "and reflects the contents of the statutes as they exist as of July 1, 2026."
)

# (pdf_key, link label on download page)
TITLE_PDFS = [
    ("97", "The Wyoming Constitution"),
    ("01", "Title 1 Civil Procedure"),
    ("02", "Title 2 Wills, Decedents' Estates and Probate Code"),
    ("03", "Title 3 Guardian and Ward"),
    ("04", "Title 4 Fiduciaries"),
    ("05", "Title 5 Courts"),
    ("06", "Title 6 Crimes and Offenses"),
    ("07", "Title 7 Criminal Procedure"),
    ("08", "Title 8 General Provisions"),
    ("09", "Title 9 Administration of the Government"),
    ("10", "Title 10 Aeronautics"),
    ("11", "Title 11 Agriculture, Livestock and Other Animals"),
    ("12", "Title 12 Alcoholic Beverages"),
    ("13", "Title 13 Banks, Banking and Finance"),
    ("14", "Title 14 Children"),
    ("15", "Title 15 Cities and Towns"),
    ("16", "Title 16 City, County, State and Local Powers"),
    ("17", "Title 17 Corporations, Partnerships and Associations"),
    ("18", "Title 18 Counties"),
    ("19", "Title 19 Defense Forces and Affairs"),
    ("20", "Title 20 Domestic Relations"),
    ("21", "Title 21 Education"),
    ("22", "Title 22 Elections"),
    ("23", "Title 23 Game and Fish"),
    ("24", "Title 24 Highways"),
    ("25", "Title 25 Institutions of the State"),
    ("26", "Title 26 Insurance Code"),
    ("27", "Title 27 Labor and Employment"),
    ("28", "Title 28 Legislature"),
    ("29", "Title 29 Liens"),
    ("30", "Title 30 Mines and Minerals"),
    ("31", "Title 31 Motor Vehicles"),
    ("32", "Title 32 Notaries"),
    ("33", "Title 33 Professions and Occupations"),
    ("34", "Title 34 Property, Conveyances and Security Transactions"),
    ("34.1", "Title 34.1 Uniform Commercial Code"),
    ("35", "Title 35 Public Health and Safety"),
    ("36", "Title 36 Public Land"),
    ("37", "Title 37 Public Utilities"),
    ("38", "Title 38 Sureties"),
    ("39", "Title 39 Taxation and Revenue"),
    ("40", "Title 40 Trade and Commerce"),
    ("41", "Title 41 Water"),
    ("42", "Title 42 Welfare"),
    ("99", "Title 99 Water Projects"),
]


def pdf_url(key):
    return f"{BASE}statutes/compress/title{key}.pdf"
