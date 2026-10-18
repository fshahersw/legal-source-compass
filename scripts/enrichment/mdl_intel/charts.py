"""Extract printed bar-chart value labels from JPML Calendar Year Statistics PDFs (editions 2016+ print charts only).

A label is assigned to a year column when its x-centre lies within half a column spacing of that year's axis label;
labels inside a column are ordered left-to-right and mapped to the legend order. Columns whose label count does not
equal the number of legend series are dropped (never guessed).
"""
import re

import pdfplumber

LEGENDS = {
    "category": [("denied", r"Denied"), ("moot", r"Moot"), ("withdrawn", r"Motion\s+Withdrawn|Withdrawn"), ("closed", r"Closed/?\s*Consol\.?|Admin\.?\s*Closed|Closed"), ("stricken", r"Stricken")],
    "granted_denied": [("granted", r"Granted"), ("denied", r"Denied")],
    "hearing": [("matters_set", r"Matters\s+Set"), ("matters_decided", r"Matters\s+(?:Decided|Considered)")],
}


def _year_axis(words):
    years = {}
    for w in words:
        m = re.fullmatch(r"(20\d\d)\*?", w["text"])
        if m:
            years.setdefault(int(m.group(1)), w)
    if len(years) < 3:
        return None, None
    top = max(set(round(w["top"]) for w in years.values()), key=lambda t: sum(1 for w in years.values() if abs(round(w["top"]) - t) <= 2))
    axis = {y: (w["x0"] + w["x1"]) / 2 for y, w in years.items() if abs(w["top"] - top) <= 3}
    return axis, top


def classify_page(words):
    text = " ".join(w["text"] for w in words)
    if re.search(r"Moot", text) and re.search(r"Withdrawn", text):
        return "category"
    if re.search(r"Matters\s+Set", text):
        return "hearing"
    if re.search(r"Granted", text) and re.search(r"Denied", text):
        return "granted_denied"
    return None


def legend_order(kind, words, axis_top):
    below = sorted((w for w in words if w["top"] > axis_top + 5), key=lambda w: (round(w["top"]), w["x0"]))
    joined = []
    for w in below:
        joined.append((w["x0"], w["text"]))
    text = " ".join(t for _, t in joined)
    found = []
    for key, pattern in LEGENDS[kind]:
        m = re.search(pattern, text)
        if m:
            found.append((m.start(), key))
    return [k for _, k in sorted(found)]


def extract(pdf_path):
    """Return {kind: {year: {series: value}}} for each recognised chart page."""
    out = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            kind = classify_page(words)
            if not kind:
                continue
            axis, top = _year_axis(words)
            if not axis:
                continue
            series = legend_order(kind, words, top)
            if not series:
                continue
            centres = sorted(axis.items(), key=lambda kv: kv[1])
            spacing = min(b[1] - a[1] for a, b in zip(centres, centres[1:]))
            first_x = centres[0][1] - spacing / 2
            values = {}
            for year, cx in centres:
                labels = sorted(
                    (w for w in words if re.fullmatch(r"\d+", w["text"]) and w["top"] < top - 2 and w["x0"] >= first_x - 2 and abs((w["x0"] + w["x1"]) / 2 - cx) < spacing / 2),
                    key=lambda w: w["x0"],
                )
                if len(labels) == len(series):
                    values[year] = dict(zip(series, (int(w["text"]) for w in labels)))
            if values:
                out.setdefault(kind, {}).update(values)
    return out


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(extract(sys.argv[1]), indent=1))
