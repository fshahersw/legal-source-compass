"""Map the labelled rows of an FCMS profile page to stable measure keys, in printed order.

Each spec entry is (key, label regex, required, unit, description). Rows are matched in order: for every row
the first not-yet-used spec entry at or after the current position whose regex matches the row label is taken.
Optional entries are rows printed only in some editions (supervised release hearings, confidence bounds).
A page is accepted only when every required key is found; otherwise it is reported and excluded.
The look-ahead from the current position crosses optional entries only, never a required one.
"""
import re

# ------------------------------------------------------------------ district profile
DISTRICT = [
    ("filings", r"\bfilings\b", True, "count", "Total filings (civil cases plus criminal felony defendants, incl. criminal transfers)"),
    ("terminations", r"terminations", True, "count", "Total terminations"),
    ("pending", r"pending", True, "count", "Total pending"),
    # September 2011 prints the change over last year on its own line above the label (label "Statistics")
    ("pct_change_filings_last_year", r"^statistics$", False, "percent", "Percent change in total filings over last year (separate first line of some 2011 editions)"),
    ("pct_change_filings", r"percent change|earlier year|over last year", True, "percent", "Percent change in total filings, current year over the earlier year shown in that column"),
    # 2004-2009 editions print the change over last year and the changes over earlier years on two lines
    ("pct_change_filings_earlier_years", r"^current year( over earlier years?)?$", False, "percent", "Percent change in total filings over earlier years (second printed line of 2004-2009 and 2011 editions)"),
    ("judgeships", r"judgeships", True, "count", "Number of authorized judgeships"),
    ("vacant_judgeship_months", r"vacant", True, "months", "Vacant judgeship months"),
    ("pj_filings_total", r"\btotal\b", True, "per judgeship", "Total filings per judgeship"),
    ("pj_filings_civil", r"\bcivil\b", True, "per judgeship", "Civil filings per judgeship"),
    ("pj_filings_felony", r"felony|criminal", True, "per judgeship", "Criminal felony filings per judgeship"),
    ("pj_supervised_release_hearings", r"supervised|release|hearings", False, "per judgeship", "Supervised release hearings per judgeship"),
    ("pj_pending", r"pending", True, "per judgeship", "Pending cases per judgeship"),
    ("pj_weighted_filings", r"weighted", True, "per judgeship", "Weighted filings per judgeship"),
    ("pj_weighted_ci_upper", r"upper|confidence", False, "per judgeship", "Weighted filings per judgeship, 95% confidence upper bound"),
    ("pj_weighted_ci_lower", r"lower", False, "per judgeship", "Weighted filings per judgeship, 95% confidence lower bound"),
    ("pj_terminations", r"terminations", True, "per judgeship", "Terminations per judgeship"),
    ("pj_trials", r"trials", True, "per judgeship", "Trials completed per judgeship"),
    ("median_months_felony", r"felony|criminal", True, "months", "Median months from filing to disposition, criminal felony"),
    ("median_months_civil", r"civil", True, "months", "Median months from filing to disposition, civil"),
    ("median_months_civil_to_trial", r"trial", True, "months", "Median months from filing to trial, civil only"),
    ("civil_over_3y_count", r"number|civil cases", True, "count", "Number of civil cases over 3 years old"),
    ("civil_over_3y_pct", r"years old|over 3|over years", True, "percent", "Percent of civil cases over 3 years old"),
    ("felony_defendants_per_case", r"defendants|per case", True, "average", "Average number of felony defendants filed per case"),
    ("jurors_present_avg", r"present|jury selection", False, "average", "Average number of jurors present for jury selection"),
    ("jurors_pct_not_selected", r"not selected|challenged|percent not", False, "percent", "Percent of jurors not selected or challenged"),
]

# ------------------------------------------------------------------ courts of appeals profile (two panels)
CIRCUIT_LEFT = [
    ("filings", r"\btotal\b", True, "count", "Appeals filed, total"),
    ("filings_prisoner", r"prisoner", True, "count", "Appeals filed, prisoner"),
    ("filings_other", r"\bother\b", True, "count", "Appeals filed, all other civil (U.S. and private civil, bankruptcy)"),
    ("filings_criminal", r"criminal", True, "count", "Appeals filed, criminal"),
    ("filings_administrative", r"administrative", True, "count", "Appeals filed, administrative agency"),
    # September 2011 to September 2012 print the change over last year on its own unlabelled line above the label row
    ("pct_change_filings_last_year", r"^$", False, "percent", "Percent change in total filings over last year (separate unlabelled first line of 2011-2012 editions)"),
    ("pct_change_filings", r"percent change|current year|earlier", True, "percent", "Percent change in total filings, current year over the earlier year shown in that column"),
    ("pct_change_filings_earlier_years", r"^current year( over earlier years?)?$|^$", False, "percent", "Percent change in total filings over earlier years (second printed line of 2004-2009 and 2011 editions)"),
    ("terminations", r"\btotal\b", True, "count", "Appeals terminated, total"),
    ("terminations_consolidations", r"consolidation", False, "count", "Terminated by consolidation and cross appeals"),
    ("terminations_procedural", r"procedural", True, "count", "Procedural terminations"),
    ("merits_terminations", r"\btotal\b", True, "count", "Terminations on the merits, total"),
    ("merits_prisoner", r"prisoner", True, "count", "Merits terminations, prisoner"),
    ("merits_other", r"\bother\b", True, "count", "Merits terminations, other civil"),
    ("merits_criminal", r"criminal", True, "count", "Merits terminations, criminal"),
    ("merits_administrative", r"administrative", True, "count", "Merits terminations, administrative"),
    ("merits_pct_by_active_judges", r"active judges|percent by", False, "percent", "Percent of merits terminations by active judges"),
    ("pending", r"pending", True, "count", "Pending appeals"),
    ("paj_merits_terminations", r"merits|meri\b|erminations on", False, "per active judge", "Terminations on the merits per active judge"),
    ("paj_procedural_terminations", r"procedural", False, "per active judge", "Procedural terminations per active judge"),
    ("paj_written_decisions", r"\btotal\b", False, "per active judge", "Written decisions per active judge, total"),
    ("paj_signed", r"\bsigned\b", False, "per active judge", "Signed written decisions per active judge"),
    ("paj_unsigned", r"unsigned", False, "per active judge", "Unsigned written decisions per active judge"),
    ("paj_without_comment", r"without|comment", False, "per active judge", "Written decisions without comment per active judge"),
]
CIRCUIT_RIGHT = [
    ("judgeships", r"judgeships", True, "count", "Number of authorized judgeships"),
    # 2004-2009 editions print "12/4.0" (judgeships/panels) in the judgeships row, so there is no separate panels row
    ("panels", r"panels|^$", False, "count", "Number of panels (judgeships / 3)"),
    ("senior_judges", r"senior", False, "count", "Number of sitting senior judges"),
    ("vacant_judgeship_months", r"vacant", True, "months", "Vacant judgeship months"),
    ("pp_filings", r"\btotal\b", True, "per panel", "Appeals filed per panel, total"),
    ("pp_filings_prisoner", r"prisoner", True, "per panel", "Appeals filed per panel, prisoner"),
    ("pp_filings_other", r"\bother\b", True, "per panel", "Appeals filed per panel, other civil"),
    ("pp_filings_criminal", r"criminal", True, "per panel", "Appeals filed per panel, criminal"),
    ("pp_filings_administrative", r"administrative", True, "per panel", "Appeals filed per panel, administrative"),
    ("pp_terminations", r"\btotal\b", True, "per panel", "Appeals terminated per panel, total"),
    ("pp_terminations_consolidations", r"consolidation", False, "per panel", "Consolidations and cross appeals per panel"),
    ("pp_terminations_procedural", r"procedural", True, "per panel", "Procedural terminations per panel"),
    ("pp_merits_terminations", r"\btotal\b", True, "per panel", "Merits terminations per panel, total"),
    ("pp_merits_prisoner", r"prisoner", True, "per panel", "Merits terminations per panel, prisoner"),
    ("pp_merits_other", r"\bother\b", True, "per panel", "Merits terminations per panel, other civil"),
    ("pp_merits_criminal", r"criminal", True, "per panel", "Merits terminations per panel, criminal"),
    ("pp_merits_administrative", r"administrative", True, "per panel", "Merits terminations per panel, administrative"),
    ("pp_pending", r"pending", True, "per panel", "Pending appeals per panel"),
    ("median_months_notice_to_disposition", r"notice of appeal|median", True, "months", "Median months from filing notice of appeal to disposition"),
    ("pj_interlocutory_applications", r"interlocutory", False, "per judgeship", "Applications for interlocutory appeals per judgeship"),
    ("pj_rehearing_petitions", r"rehearing", False, "per judgeship", "Petitions for rehearing per judgeship"),
]

NUM = re.compile(r"^-?[\d,]*\.?\d+%?$")


def parse_value(token):
    """Printed token -> (number or None, flag). Dashes are kept as flag 'dash'; anything else unparsable as 'bad'."""
    if token is None:
        return None, "absent"
    t = token.strip()
    for ch in ("−", "­", "‐", "‑"):
        t = t.replace(ch, "-")
    if t in ("-", "–", "—"):
        return None, "dash"
    if not NUM.match(t):
        return None, "bad"
    t = t.replace(",", "").rstrip("%")
    try:
        return (float(t) if "." in t else int(t)), None
    except ValueError:
        return None, "bad"


def classify(rows, spec):
    """Assign rows to spec keys in order. Returns (assigned {key: row}, unmatched rows, missing required keys)."""
    compiled = [(k, re.compile(rx, re.I), req) for k, rx, req, *_ in spec]
    pos, assigned, unmatched = 0, {}, []
    for row in rows:
        if not row["values"] and not row["label"].strip():
            continue  # e.g. the "2026" caption above a standing column
        hit = None
        # look ahead only across optional entries: a row may skip an optional measure the edition does not
        # print, never a required one (so one odd label cannot shift every later row)
        # rotated captions are sometimes split ("Administr ative"), so a label also matches with its spaces removed
        despaced = row["label"].replace(" ", "")
        for j in range(pos, len(compiled)):
            key, rx, req = compiled[j]
            if rx.search(row["label"]) or (despaced and rx.search(despaced)):
                hit = j
                break
            if req:
                break
        if hit is None:
            unmatched.append(row)
            continue
        assigned[compiled[hit][0]] = row
        pos = hit + 1
    missing = [k for k, _, req in compiled if req and k not in assigned]
    return assigned, unmatched, missing


def classify_positional(rows, keys, first_token_slash=False):
    """Fallback for pages whose labels sit several points off their values (2004-2009 appeals pages).

    The page has a fixed sequence of value lines; it is accepted only when the number of lines that carry values
    equals len(keys) exactly (and, with first_token_slash, the first line prints judgeships/panels as "12/4.0").
    Returns the same triple as classify().
    """
    value_rows = [r for r in rows if r["values"]]
    if len(value_rows) != len(keys):
        return {}, value_rows, list(keys)
    if first_token_slash and not any("/" in tok for tok in value_rows[0]["values"].values()):
        return {}, value_rows, list(keys)
    return dict(zip(keys, value_rows)), [], []


def keys_of(spec, drop=()):
    return [k for k, *_ in spec if k not in drop]


def spec_meta(spec):
    return {k: {"unit": unit, "label": desc, "optional": not req} for k, _, req, unit, desc in spec}
