"""Read the data rows of a U.S. Courts table PDF (pdftotext -layout text layer) into labelled number lists.

Only simple row-oriented tables are read this way: one label ("TOTAL", "DC", "1ST", "NY,S") followed by whitespace-
separated figures on the same line. Figures are copied exactly as printed (thousands commas removed, a printed dash is
a dash, a decimal stays a decimal); a line whose figure count differs from the expected column count is rejected, never
padded. Columns are named by the caller from the table's workbook edition and every table family read this way is
checked by arithmetic identities (see utx_checks.py) before anything is kept.
"""
import re
import subprocess

# Older appeals tables spell the circuits out ("DISTRICT OF COLUMBIA", "FIRST" ... "ELEVENTH", "FEDERAL").
CIRCUIT_WORDS = {"DISTRICT OF COLUMBIA": "DC", "FIRST": "1ST", "SECOND": "2ND", "THIRD": "3RD", "FOURTH": "4TH", "FIFTH": "5TH", "SIXTH": "6TH",
                 "SEVENTH": "7TH", "EIGHTH": "8TH", "NINTH": "9TH", "TENTH": "10TH", "ELEVENTH": "11TH", "FEDERAL": "Fed."}
LABEL = re.compile(
    r"^\s*(TOTAL|Total|DISTRICT OF COLUMBIA|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|FEDERAL|DC|D\.C\.|\d{1,2}(?:ST|ND|RD|TH|st|nd|rd|th)|NMI|GUAM|GU|VI|PR|[A-Z]{2}(?:,\s?[A-Z])?\d?|U\.S\. TOTAL)\b[\s\t]*(?P<rest>.*)$"
)
TOKEN = re.compile(r"^(?:-?\d[\d,]*(?:\.\d+)?%?|-?\.\d+|-|—|–|\(NA\)|NA|\*)$")


def pdf_text(data_or_path, layout=True):
    args = ["pdftotext"] + (["-layout"] if layout else []) + [str(data_or_path), "-"]
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def to_number(token):
    """Printed token -> (number | None, flag). '-' is a dash; '(NA)' / 'NA' / '*' are text flags; nothing else is guessed."""
    t = token.strip()
    if t in ("-", "—", "–"):
        return None, "dash"
    if t in ("(NA)", "NA", "*"):
        return None, "na"
    pct = t.endswith("%")
    t = t.rstrip("%").replace(",", "")
    try:
        if re.fullmatch(r"-?\d+", t):
            return int(t), ("pct" if pct else None)
        return float(t), ("pct" if pct else None)
    except ValueError:
        return None, "bad"


def rows_from_text(text, width):
    """[(label, [tokens...])] for lines that begin with a court label and carry exactly `width` figures.

    Returns (rows, rejected) where rejected lists (line, count) for label lines whose figure count differs."""
    rows, rejected = [], []
    for line in text.splitlines():
        m = LABEL.match(line.replace("\t", " "))
        if not m:
            continue
        label = m.group(1)
        parts = m.group("rest").split()
        if not parts or not all(TOKEN.match(p) for p in parts):
            continue
        if len(parts) != width:
            rejected.append((line.strip()[:100], len(parts)))
            continue
        rows.append((label, parts))
    return rows, rejected
