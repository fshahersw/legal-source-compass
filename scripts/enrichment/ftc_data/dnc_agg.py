"""Deterministic aggregation of Do Not Call reported-call records (pure functions; no I/O, no network).

One record (api.ftc.gov /v0/dnc-complaints, `attributes`) is counted under the key
    (consumer-state as published, subject as published, robocall flag as published)
for the day it was created. Values are only trimmed of surrounding whitespace; nothing is repaired, mapped or guessed here.
State names are mapped to USPS codes later, by exact name match (state_code()); unmatched values stay visible.

Quality counters describe the published records themselves (the FTC states that none of the information is verified):
  records, bad_created (created-date is not YYYY-MM-DD HH:MM:SS), created_other_day (valid but not the day requested),
  bad_violation (blank or not YYYY-MM-DD HH:MM:SS), violation_after_created, state_blank, state_not_a_jurisdiction,
  subject_blank, robo_blank (flag is neither Y nor N), phone_not_10_digits, area_code_not_3_digits.
"""
import re

TS = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$")

# Exact published names of the jurisdictions the platform has pages or rows for (50 states, DC, Puerto Rico), keyed by USPS.
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}
_BY_NAME = {name.lower(): usps for usps, name in STATE_NAMES.items()}

QUALITY_KEYS = (
    "records", "bad_created", "created_other_day", "bad_violation", "violation_after_created", "state_blank",
    "state_not_a_jurisdiction", "subject_blank", "robo_blank", "phone_not_10_digits", "area_code_not_3_digits",
)


def state_code(name):
    """USPS code when `name` is exactly (case-insensitively) a jurisdiction name in STATE_NAMES; else None."""
    return _BY_NAME.get((name or "").strip().lower())


def parse_ts(value):
    """(year, month, day, hour, minute, second) for 'YYYY-MM-DD HH:MM:SS' with valid calendar values, else None."""
    match = TS.match(value or "")
    if not match:
        return None
    parts = tuple(int(x) for x in match.groups())
    year, month, day, hour, minute, second = parts
    if not (1 <= month <= 12 and 1 <= day <= 31 and hour < 24 and minute < 60 and second < 60):
        return None
    dim = [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if day > dim[month - 1]:
        return None
    return parts


def new_quality():
    return {key: 0 for key in QUALITY_KEYS}


def tidy(value):
    """A published label with edge whitespace removed and runs of spaces collapsed ('Medical  & prescriptions' is shown as
    'Medical & prescriptions'); letters, case and punctuation are untouched."""
    return " ".join(str(value or "").split())


def key_for(attrs):
    return tidy(attrs.get("consumer-state")), tidy(attrs.get("subject")), tidy(attrs.get("recorded-message-or-robocall"))


def add_record(attrs, day, agg, quality):
    """Count one record's `attributes` for the requested `day` (YYYY-MM-DD) into agg {key: n} and the quality counters."""
    quality["records"] += 1
    created = parse_ts((attrs.get("created-date") or "").strip())
    if created is None:
        quality["bad_created"] += 1
    elif "%04d-%02d-%02d" % created[:3] != day:
        quality["created_other_day"] += 1
    violation = parse_ts((attrs.get("violation-date") or "").strip())
    if violation is None:
        quality["bad_violation"] += 1
    elif created is not None and violation > created:
        quality["violation_after_created"] += 1
    state, subject, robo = key_for(attrs)
    if not state:
        quality["state_blank"] += 1
    elif state_code(state) is None:
        quality["state_not_a_jurisdiction"] += 1
    if not subject:
        quality["subject_blank"] += 1
    if robo not in ("Y", "N"):
        quality["robo_blank"] += 1
    if not re.fullmatch(r"\d{10}", (attrs.get("company-phone-number") or "").strip()):
        quality["phone_not_10_digits"] += 1
    if not re.fullmatch(r"\d{3}", str(attrs.get("consumer-area-code") or "").strip()):
        quality["area_code_not_3_digits"] += 1
    k = "\t".join(key_for(attrs))
    agg[k] = agg.get(k, 0) + 1


def merge_quality(into, other):
    for key in QUALITY_KEYS:
        into[key] += other.get(key, 0)
    return into


def month_of(day):
    return day[:7]


def sum_agg(day_aggs):
    """Sum several {key: n} dicts."""
    out = {}
    for agg in day_aggs:
        for k, n in agg.items():
            out[k] = out.get(k, 0) + n
    return out


def split_key(k):
    state, subject, robo = k.split("\t")
    return state, subject, robo
