"""County -> federal judicial district (and division), from official text only.

Primary source: 28 U.S.C. ch. 5 (sections 81-131), U.S. Code 2024 edition as published by GovInfo (GPO). Virginia's
independent cities are not named in 28 U.S.C. 127; they are taken from the courts' own local rules (E.D. Va. Local Civil
Rule 3; W.D. Va. General Rule 2), which name them. A county is assigned only by one of these rules, in order:

  1. exact name match within the state after deterministic normalisation (sa_sources.norm_county);
  2. a county renamed after the Code text was written, from the Census Bureau's list of county changes (RENAMES);
  3. a missing comma in the Code text ('Le Flore Love'): the name splits into two names that each match exactly;
  4. a spelling variant: the Code name is within edit distance 2 of exactly one county of the state that no exact match
     claimed, AND the FJC Integrated Database corroborates it (most of that county's residents' federal civil filings,
     FY2021-FY2025, were filed in that district). Each such alias is listed with its evidence.

Anything else stays unassigned ("Not recorded") with the reason. No county is assigned by elimination or by proximity.
"""
from __future__ import annotations

import re

import sa_sources as S

USC_URL = "https://www.govinfo.gov/content/pkg/USCODE-2024-title28/html/USCODE-2024-title28-partI-chap5.htm"
VAED_URL = "https://www.vaed.uscourts.gov/sites/vaed/files/Local%20Rules%20EDVA%20December%201%202024.pdf"
VAWD_URL = "https://www.vawd.uscourts.gov/sites/Public/assets/File/court/local_rules.pdf"
COUNTY_CHANGES_URL = "https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.html"
# (USPS, name as the Code writes it) -> current Census county name, per the Census Bureau's record of county changes.
RENAMES = {
    ("FL", "Dade"): ("Miami-Dade County", "Dade County, Florida was renamed Miami-Dade County in 1997 (FIPS 12025 became 12086)."),
    ("SD", "Shannon"): ("Oglala Lakota County", "Shannon County, South Dakota was renamed Oglala Lakota County in 2015 (FIPS 46113 became 46102)."),
}


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def district_label(state: str, district_name: str) -> str:
    if district_name.startswith("District of") or district_name == "District of Columbia":
        return district_name
    return f"{district_name} of {state}"


def court_id(usps: str, suffix: str | None) -> str | None:
    if suffix is None:
        return None
    return f"{usps.lower()}{suffix}d"


def parse_va_rules(text: str, court: str, source_url: str, rule: str) -> list[dict]:
    """Division paragraphs of the E.D. Va. / W.D. Va. local rules -> [{court_id, division, counties, cities, text}]."""
    # page numbers stand alone on their lines in the PDF text layer; drop them before joining the lines
    flat = re.sub(r"\s+", " ", "\n".join(line for line in text.splitlines() if not re.fullmatch(r"\s*\d{1,3}\s*", line)))
    out = []
    pat = re.compile(r"\(\d\)\s+(?:The\s+)?([A-Z][A-Za-z ]+?) Division(?:\.\s+The [A-Za-z ]+? Division)? (?:shall consist of|embraces) (.*?)(?:;|\.(?= \(\d\)| \(b\)| \(5\)|$))")
    for m in pat.finditer(flat):
        division, body = m.group(1).strip() + " Division", m.group(2)
        body = re.sub(r",?\s*and any other city or town geographically within the exterior boundaries of said counties", "", body).strip().rstrip(".;")
        counties: list[str] = []
        cities: list[str] = []
        marks = list(re.finditer(r"the (cities|city|counties|county) of\s+", body, re.I))
        for i, mk in enumerate(marks):
            seg = body[mk.end(): marks[i + 1].start() if i + 1 < len(marks) else len(body)]
            seg = re.sub(r"[,\s]*(?:\band\s*)?$", "", seg.strip())
            names = S.split_names(seg)
            kind = mk.group(1).lower()
            if kind in ("city", "county"):
                first, rest = names[:1], names[1:]
                (cities if kind == "city" else counties).extend(first)
                # names after a singular 'city of X' continue the enclosing plural list ('..., the city of Bristol, Dickenson, ...')
                prev_plural = next((marks[k].group(1).lower() for k in range(i - 1, -1, -1) if marks[k].group(1).lower() in ("cities", "counties")), None)
                (cities if prev_plural == "cities" else counties).extend(rest)
            else:
                (cities if kind == "cities" else counties).extend(names)
        out.append({"court_id": court, "division": division, "counties": counties, "cities": cities, "source_url": source_url, "rule": rule,
                    "text": m.group(0)})
    return out


def city_key(name: str) -> str:
    """Key of an independent city named in a 'city of X' clause: the Census names it 'X city'."""
    return S.norm_county(name + " city")


def court_page_text(html_text: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html_text).split())


def assign(sections: list[dict], counties: dict[str, list[tuple[str, str]]], fjc_by_court: dict[str, dict[str, int]],
           va_rules: list[dict], valid_courts: set[str], court_pages: list[dict] | None = None) -> tuple[dict[str, dict], dict]:
    """counties: {USPS: [(fips, Census name)]}; court_pages: [{court_id, division, url, text}] (the courts' own division pages,
    used only to corroborate a spelling variant). Returns ({fips: assignment}, report)."""
    court_pages = court_pages or []
    out: dict[str, dict] = {}
    report: dict = {"unmatched_names": [], "aliases": [], "unassigned": [], "conflicts": [], "partial_clauses": [], "invalid_court_ids": []}
    for sec in sections:
        usps, state = sec["usps"], sec["state"]
        if usps not in counties:
            continue
        cty = counties[usps]
        index: dict[str, list[tuple[str, str]]] = {}
        for fips, name in cty:
            index.setdefault(S.norm_county(name), []).append((fips, name))
        section_ref = f"28 U.S.C. § {sec['section']}"
        if sec["single"]:
            d = sec["districts"][0]
            cid = court_id(usps, "")
            if cid not in valid_courts:
                report["invalid_court_ids"].append(cid)
            div_of: dict[str, dict] = {}
            for dv in d["divisions"]:
                for nm in dv["counties"]:
                    hits = [h for h in index.get(S.norm_county(nm), []) if not h[1].endswith(" city")]
                    if len(hits) == 1:
                        div_of[hits[0][0]] = dv
            for fips, name in cty:
                dv = div_of.get(fips)
                out[fips] = {"court_id": cid, "district": district_label(state, d["name"]), "division": dv["name"] if dv else None,
                             "held_at": (dv or {}).get("held_at") or d.get("held_at") or [], "basis": f"{section_ref}: {d.get('text') or d['name']}",
                             "method": "whole_state", "source_url": USC_URL}
            continue
        claimed: dict[str, list[tuple[dict, dict, str, str]]] = {}
        pending: list[tuple[dict, dict, str, str]] = []
        for d in sec["districts"]:
            for dv in d["divisions"]:
                for clause in dv.get("partial", []):
                    report["partial_clauses"].append({"state": usps, "district": d["name"], "text": clause})
                for kind in ("counties", "cities"):
                    for nm in dv[kind]:
                        key = city_key(nm) if kind == "cities" else S.norm_county(nm)
                        hits = index.get(key, [])
                        hits = [h for h in hits if h[1].endswith(" city")] if kind == "cities" else [h for h in hits if not h[1].endswith(" city")]
                        if len(hits) == 1:
                            claimed.setdefault(hits[0][0], []).append((d, dv, nm, "exact"))
                        else:
                            pending.append((d, dv, nm, kind))
        # rule 2-4 for names that did not match exactly
        for d, dv, nm, kind in pending:
            cid = court_id(usps, d["court_suffix"])
            rn = RENAMES.get((usps, nm))
            if rn:
                hits = [h for h in cty if h[1] == rn[0]]
                if len(hits) == 1:
                    claimed.setdefault(hits[0][0], []).append((d, dv, nm, "renamed"))
                    report["aliases"].append({"state": usps, "code_name": nm, "county": hits[0][1], "fips": hits[0][0], "rule": "renamed", "evidence": rn[1], "source": COUNTY_CHANGES_URL})
                    continue
            words = nm.split()
            split_ok = None
            for i in range(1, len(words)):
                a, b = " ".join(words[:i]), " ".join(words[i:])
                ha, hb = index.get(S.norm_county(a), []), index.get(S.norm_county(b), [])
                if len(ha) == 1 and len(hb) == 1:
                    split_ok = (ha[0], hb[0], a, b)
                    break
            if split_ok:
                for h, part in ((split_ok[0], split_ok[2]), (split_ok[1], split_ok[3])):
                    claimed.setdefault(h[0], []).append((d, dv, part, "missing_comma"))
                    report["aliases"].append({"state": usps, "code_name": nm, "county": h[1], "fips": h[0], "rule": "missing comma in the Code text", "evidence": f"'{nm}' splits into '{split_ok[2]}' and '{split_ok[3]}', each an exact county name", "source": USC_URL})
                continue
            key = S.norm_county(nm)
            near = [(f, n) for f, n in cty if f not in claimed and levenshtein(key, S.norm_county(n)) <= 2]
            if len(near) == 1 and kind == "counties":
                f, n = near[0]
                by = fjc_by_court.get(f, {})
                total = sum(by.values())
                top = max(by.items(), key=lambda kv: kv[1]) if by else (None, 0)
                if cid and top[0] == cid and total >= 5 and top[1] / total > 0.5:
                    claimed.setdefault(f, []).append((d, dv, nm, "spelling"))
                    report["aliases"].append({"state": usps, "code_name": nm, "county": n, "fips": f, "rule": "spelling variant (edit distance <= 2, unique)",
                                              "evidence": f"FJC IDB FY2021-FY2025: {top[1]:,} of {total:,} filings by residents were filed in {cid}", "source": USC_URL})
                    continue
                page = next((pg for pg in court_pages if pg["court_id"] == cid and pg["division"] == dv["name"] and n in pg["text"]), None)
                if page:
                    claimed.setdefault(f, []).append((d, dv, nm, "spelling"))
                    report["aliases"].append({"state": usps, "code_name": nm, "county": n, "fips": f, "rule": "spelling variant (edit distance <= 2, unique)",
                                              "evidence": f"the court's own {dv['name']} page lists '{n}'", "source": page["url"]})
                    continue
                report["unmatched_names"].append({"state": usps, "district": d["name"], "division": dv["name"], "name": nm, "reason": f"near match {n} not corroborated by the IDB ({top[0]}: {top[1]} of {total})"})
                continue
            report["unmatched_names"].append({"state": usps, "district": d["name"], "division": dv["name"], "name": nm,
                                              "reason": "no county of this name in the 2024 Census county list (abolished or merged county, or a place that is not a county)" if not near else "ambiguous near matches"})
        # Virginia: independent cities from the courts' local rules
        if usps == "VA":
            for vr in va_rules:
                for kind in ("cities", "counties"):
                    for nm in vr[kind]:
                        key = city_key(nm) if kind == "cities" else S.norm_county(nm)
                        hits = [h for h in index.get(key, []) if (h[1].endswith(" city") if kind == "cities" else not h[1].endswith(" city"))]
                        if len(hits) != 1:
                            report["unmatched_names"].append({"state": usps, "district": vr["court_id"], "division": vr["division"], "name": nm, "reason": f"local rule names a {kind[:-1] if kind == 'counties' else 'city'} with no county-equivalent of that name"})
                            continue
                        fips = hits[0][0]
                        prior = claimed.get(fips)
                        if kind == "cities":
                            fake_d = {"name": "Eastern District" if vr["court_id"] == "vaed" else "Western District", "court_suffix": vr["court_id"][2]}
                            claimed.setdefault(fips, []).append((fake_d, {"name": vr["division"], "held_at": [], "rule": vr}, nm, "local_rule"))
                        elif prior:
                            # counties come from the Code; the local rule only supplies the division name and must agree on the district
                            d0 = prior[0][0]
                            if court_id(usps, d0["court_suffix"]) != vr["court_id"]:
                                report["conflicts"].append({"fips": fips, "name": hits[0][1], "code": d0["name"], "local_rule": vr["court_id"]})
                            else:
                                prior[0][1].setdefault("va_division", {})[fips] = vr["division"]
        for fips, claims in claimed.items():
            courts = {court_id(usps, c[0]["court_suffix"]) for c in claims}
            name = next(n for f, n in cty if f == fips)
            if len(courts) != 1:
                report["conflicts"].append({"fips": fips, "name": name, "courts": sorted(c or "" for c in courts)})
                continue
            d, dv, nm, how = claims[0]
            cid = courts.pop()
            if cid not in valid_courts:
                report["invalid_court_ids"].append(cid)
                continue
            exc = (dv.get("exceptions") or {}).get(nm)
            division = (dv.get("va_division") or {}).get(fips) or (dv["name"] if dv["name"].endswith("Division") else None)
            if how == "local_rule":
                rule = dv["rule"]
                basis = f"{rule['rule']}: {rule['text'][:400]}"
                src = rule["source_url"]
            else:
                basis = f"{section_ref}: {dv['text'][:400]}"
                src = USC_URL
            out[fips] = {"court_id": cid, "district": district_label(state, d["name"]), "division": division, "held_at": dv.get("held_at") or [],
                         "basis": basis, "method": how, "code_name": nm, "exception": exc, "source_url": src}
        for fips, name in cty:
            if fips not in out:
                report["unassigned"].append({"state": usps, "fips": fips, "name": name})
    return out, report
