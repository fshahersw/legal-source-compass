"""Shared helpers for the FTC builders: display formats, analytics formulas, exact-name matching, input manifest."""
import json
import os
import re

NOT_RECORDED = "Not recorded"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_sentinel")
BUILD = os.path.join(ROOT, "private", "build", "ftc_sentinel")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")


# --------------------------------------------------------------------------------------------------------------------
# Display formats. Every missing value renders as 'Not recorded', never as zero or an estimate.

def fmt_int(value):
    return NOT_RECORDED if value is None else f"{int(value):,}"


def fmt_usd(value):
    if value is None:
        return NOT_RECORDED
    if abs(value - round(value)) < 0.005:
        return f"${int(round(value)):,}"
    return f"${value:,.2f}"


def fmt_pct(value, digits=1):
    return NOT_RECORDED if value is None else f"{value:.{digits}f}%"


def fmt_signed_pct(value, digits=1):
    return NOT_RECORDED if value is None else f"{value:+.{digits}f}%"


def fmt_signed_int(value):
    return NOT_RECORDED if value is None else f"{int(value):+d}"


def fmt_rank(value):
    return NOT_RECORDED if value is None else str(int(value))


# --------------------------------------------------------------------------------------------------------------------
# Analytics. Each returns None when an input is missing; nothing is imputed.

def yoy_pct(current, previous):
    """Year-over-year change in percent: (current / previous - 1) * 100. None when previous is missing or zero."""
    if current is None or previous in (None, 0):
        return None
    return round((current / previous - 1) * 100, 2)


def cagr_pct(first, last, years):
    """Compound annual growth rate in percent: ((last / first) ** (1 / years) - 1) * 100. Needs first > 0, last > 0, years >= 1."""
    if first is None or last is None or first <= 0 or last <= 0 or not years or years < 1:
        return None
    return round(((last / first) ** (1 / years) - 1) * 100, 2)


def rank_change(previous_rank, current_rank):
    """Places gained toward rank 1: previous_rank - current_rank (positive = moved up). None for unranked entries."""
    if previous_rank is None or current_rank is None:
        return None
    return previous_rank - current_rank


def share_pct(part, total):
    """part / total * 100, rounded to 2 places."""
    if part is None or not total:
        return None
    return round(part / total * 100, 2)


def ratio(numerator, denominator, digits=2):
    if numerator is None or not denominator:
        return None
    return round(numerator / denominator, digits)


# --------------------------------------------------------------------------------------------------------------------
# Exact-name matching (company_sec_profiles titles, refund program pages)

def name_key(name):
    """Documented normalisation for exact matching: lower case, '&amp;' decoded, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", (name or "").replace("&amp;", "&").lower())


def unique_exact_matches(names, targets):
    """For each name, the target id when exactly one target has the same name_key; ambiguous and absent are reported.

    names: {name_id: name}; targets: {target_id: name}. Returns (matches, ambiguous, unmatched) where matches maps
    name_id -> target_id, ambiguous maps name_id -> [target_ids], unmatched is a list of name_ids.
    """
    by_key = {}
    for target_id, target_name in targets.items():
        key = name_key(target_name)
        if key:
            by_key.setdefault(key, []).append(target_id)
    matches, ambiguous, unmatched = {}, {}, []
    for name_id, name in names.items():
        hits = by_key.get(name_key(name), [])
        if len(hits) == 1:
            matches[name_id] = hits[0]
        elif len(hits) > 1:
            ambiguous[name_id] = sorted(hits)
        else:
            unmatched.append(name_id)
    return matches, ambiguous, unmatched


# --------------------------------------------------------------------------------------------------------------------
# Input manifest

def load_manifest(path=MANIFEST):
    entries = {}
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                entry = json.loads(line)
                entries[os.path.basename(entry["path"])] = entry
    return entries


def input_ref(entry):
    return {"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60] or "x"
