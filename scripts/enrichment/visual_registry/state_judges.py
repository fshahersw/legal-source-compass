"""State and special-court judges: bind a registry portrait to a judges record only by an exact, unique name match
within a state that one of the person's registry-recorded roles or courts names (owner decision relayed 2026-10-24).

  python3 -I -B state_judges.py sql      # print the read-only SELECT that returns the candidate judges records

Name normalisation (both sides, identical in SQL and Python): lower case, every run of characters other than a-z and
0-9 replaced by one space, trimmed. A state is named by a role/court label when the label contains the state's full
name as whole words ("West Virginia" is read before "Virginia"; "District of Columbia" means DC; "Washington" is not
read when followed by "D.C."). A person with no state in any recorded role/court label is held. A match is accepted
only when exactly one judges record in one of those states has the same normalised title.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import load_registry  # noqa: E402

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
    "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC",
    "Puerto Rico": "PR", "Guam": "GU",
}
STATE_GROUP = "state_or_special_court_judicial_biography"


def norm(name):
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def states_named(label):
    """Full state names a role/court label contains as whole words (longest names first)."""
    text = " " + re.sub(r"\s+", " ", label or "") + " "
    text = re.sub(r"Washington,? D\.? ?C\.?", " District of Columbia ", text)
    found = []
    for name in sorted(STATES, key=len, reverse=True):
        pattern = r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])"
        if re.search(pattern, text):
            found.append(name)
            text = re.sub(pattern, " ", text)
    return found


def role_labels(asset):
    out = []
    for r in asset.get("source_recorded_roles") or []:
        for k in ("roleLabel", "employerLabel"):
            if r.get(k):
                out.append(r[k])
    out += [c for c in asset.get("state_highest_category_evidence") or [] if c]
    return out


def leads(assets):
    """[(asset, name_norm, [state names])] for state/special-court judges; held [(asset, reason)]."""
    out, held = [], []
    for a in assets:
        if a.get("entity_type") != "judge" or a.get("selection_group") != STATE_GROUP:
            continue
        if (a.get("source_ids") or {}).get("fjc_alpha_ids"):
            continue
        states = sorted({s for label in role_labels(a) for s in states_named(label)})
        if not states:
            held.append((a, "no state in any registry-recorded role or court"))
            continue
        out.append((a, norm(a.get("entity_name")), states))
    return out, held


def match(name_norm, states, judges_rows):
    """(judge id, None) when exactly one judges row in one of the states has this normalised title; else reason."""
    hits = [r for r in judges_rows if norm(r["title"]) == name_norm and set(r["states"]) & set(states)]
    if len(hits) == 1:
        return hits[0]["id"], None
    return None, ("no judges record with this exact name in the recorded state" if not hits else
                  f"{len(hits)} judges records with this exact name in the recorded state")


def sql(assets):
    found, _ = leads(assets)
    pairs = sorted({(n, s) for _, n, ss in found for s in ss})
    values = ",".join("('" + n.replace("'", "''") + "','" + s.replace("'", "''") + "')" for n, s in pairs)
    return ("with want(n, s) as (values " + values + ") "
            "select string_agg(r.id || '=' || r.title || '=' || coalesce((select string_agg(x, ';' order by x) from "
            "jsonb_array_elements_text(coalesce(r.item->'states', jsonb_build_array(r.state))) x), '') || '=' || "
            "(case when coalesce(r.item->>'photo_url','') <> '' then '1' else '0' end), '|' order by r.id collate \"C\") "
            "as rows, count(*) as n from public.corpus_records r where r.dataset = 'judges' and exists (select 1 from "
            "want w where w.n = trim(regexp_replace(lower(r.title), '[^a-z0-9]+', ' ', 'g')) and (w.s = r.state or "
            "coalesce(r.item->'states', '[]'::jsonb) ? w.s))")


if __name__ == "__main__":
    reg = load_registry()["assets"]
    if sys.argv[1:] == ["sql"]:
        print(sql(reg))
    else:
        found, held = leads(reg)
        print(json.dumps({"with_state": len(found), "held": len(held)}))
