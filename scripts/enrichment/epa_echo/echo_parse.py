"""Pure parsing and aggregation helpers for the epa_echo stream (EPA ECHO ICIS-FE&C case files, ECHO Exporter).

Nothing here guesses: a value that does not match a stated pattern comes back as None, and every sum is a computed sum
of recorded values.
"""
import collections
import re

# ---------------------------------------------------------------- field parsers


def clean(value):
    """Trim leading/trailing whitespace only (internal spacing and case kept exactly as recorded)."""
    return (value or "").strip()


def money(value):
    """ECHO dollar field -> float as recorded (negatives kept), or None when blank/unparseable."""
    text = clean(value).replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def count(value):
    """Exporter count field -> int, or None when blank/unparseable ('3', '3.0')."""
    text = clean(value)
    if re.fullmatch(r"\d+(\.0+)?", text):
        return int(float(text))
    return None


def fiscal_year(value):
    text = clean(value)
    return int(text) if re.fullmatch(r"(19|20)\d\d", text) else None


def us_date(value):
    """MM/DD/YYYY -> YYYY-MM-DD or None."""
    match = re.fullmatch(r"(\d\d)/(\d\d)/(\d{4})", clean(value))
    return f"{match.group(3)}-{match.group(1)}-{match.group(2)}" if match else None


def fy_complete(fy, file_date):
    """A federal fiscal year ends September 30; complete when that date is before the source file date (YYYY-MM-DD)."""
    return fy is not None and bool(file_date) and f"{fy:04d}-09-30" < file_date


def primary_statute(sections):
    """sections: (rank_order, statute_code) in file order; the first RANK_ORDER == '1' row wins; none -> None."""
    for rank, statute in sections:
        if clean(rank) == "1" and clean(statute):
            return clean(statute)
    return None


def state_codes(values):
    """Sorted unique two-letter codes (upper-cased) from facility state fields; blanks and other shapes dropped."""
    return sorted({clean(v).upper() for v in values if re.fullmatch(r"[A-Za-z]{2}", clean(v))})


# ---------------------------------------------------------------- name matching (exact, documented normalisation)


def name_key(name):
    """Case-insensitive key with whitespace runs collapsed. Used only for exact-match linking and for reporting
    spelling variants; never to merge defendant rows."""
    return re.sub(r"\s+", " ", clean(name)).casefold()


def title_index(rows):
    """rows: [(cik, title)] -> {name_key(title): sorted [cik, ...]}."""
    index = collections.defaultdict(set)
    for cik, title in rows:
        if clean(title):
            index[name_key(title)].add(cik)
    return {key: sorted(ciks) for key, ciks in index.items()}


def match_company(name, index):
    """('matched', cik) on a unique exact key match, ('ambiguous', [ciks]) when several profiles share the key,
    ('none', None) otherwise."""
    hits = index.get(name_key(name))
    if not hits:
        return "none", None
    if len(hits) > 1:
        return "ambiguous", hits
    return "matched", hits[0]


# ---------------------------------------------------------------- analytics helpers


def rank_desc(values):
    """{key: value} -> {key: rank}, standard competition ranking (1 + number of strictly larger values); None values unranked."""
    present = {k: v for k, v in values.items() if v is not None}
    return {k: 1 + sum(1 for other in present.values() if other > v) for k, v in present.items()}


def pct_change(current, previous):
    """Percent change, None when the previous value is missing or zero (undefined)."""
    if previous in (None, 0) or current is None:
        return None
    return round((current - previous) / previous * 100.0, 2)


def top_share(values, k=10):
    """Share (0-1) of the positive total held by the k largest positive values; None when the total is not positive."""
    positive = sorted((v for v in values if v and v > 0), reverse=True)
    total = sum(positive)
    if total <= 0:
        return None
    return round(sum(positive[:k]) / total, 6)


def median(values):
    data = sorted(v for v in values if v is not None)
    if not data:
        return None
    mid = len(data) // 2
    return data[mid] if len(data) % 2 else (data[mid - 1] + data[mid]) / 2


# ---------------------------------------------------------------- case series aggregation

SETTLED_MONEY = ("fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "cost_recovery", "penalty_collected")
CASE_MONEY = ("fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "fed_cost_recovery", "st_cost_recovery", "penalty_collected")
DIM_MONEY = ("fed_penalty", "st_lcl_penalty", "sep", "compliance_cost", "cost_recovery")
PROGRAM_MONEY = ("fed_penalty",)


def case_scopes(case):
    """Scopes a case counts in: national, its case region (REGION_CODE) and every facility state (CASE_FACILITIES);
    'NR' when no region / no facility state is recorded."""
    scopes = ["US", "region:" + (case.get("region") or "NR")]
    scopes += ["state:" + s for s in case.get("states") or []] or ["state:NR"]
    return scopes


def _dim_cell(money_keys):
    return {"opened": 0, "conclusions": 0, "concluded": set(), **{m: 0.0 for m in money_keys}}


def _cell():
    return {
        "opened": 0, "opened_jdc": 0, "opened_afr": 0,
        "conclusions": 0, "penalty_conclusions": 0, "concluded": set(), "concluded_jdc": set(), "concluded_afr": set(),
        **{m: 0.0 for m in SETTLED_MONEY},
        "case_level": {m: 0.0 for m in CASE_MONEY}, "case_level_cases": 0,
        "unattributed": {"conclusions": 0, **{m: 0.0 for m in SETTLED_MONEY}},
        "dims": {"type": {}, "statute": {}, "program": {}, "region": {}},
        "bundles": collections.defaultdict(float),
    }


def _dims_for(case, scope):
    dims = [("type", case.get("type") or "NR", DIM_MONEY), ("statute", case.get("statute") or "NR", DIM_MONEY)]
    dims += [("program", p, PROGRAM_MONEY) for p in case.get("programs") or []]
    if not scope.startswith("region:"):
        dims.append(("region", case.get("region") or "NR", DIM_MONEY))
    return dims


def aggregate_series(cases, bundle_of=None):
    """cases: dicts with id, case_number, type ('JDC'/'AFR'), fy, region, statute, programs, states,
    pen (case-level CASE_PENALTIES dict or None) and conclusions [{fy, fed_penalty, st_lcl_penalty, sep,
    compliance_cost, cost_recovery, penalty_collected}].
    Returns {(scope, fy_key): cell} where fy_key is an int FY or 'all'. Opened counts use the case FY; settlement
    dollars and concluded counts use each conclusion's SETTLEMENT_FY; case-level dollars use the case FY opened."""
    bundle_of = bundle_of or {}
    acc = collections.defaultdict(_cell)
    for case in cases:
        cid = case["id"]
        bundle = bundle_of.get(case["case_number"], case["case_number"])
        for scope in case_scopes(case):
            dims = _dims_for(case, scope)
            for key in ([case["fy"]] if case.get("fy") else []) + ["all"]:
                cell = acc[(scope, key)]
                cell["opened"] += 1
                if case.get("type") == "JDC":
                    cell["opened_jdc"] += 1
                elif case.get("type") == "AFR":
                    cell["opened_afr"] += 1
                if case.get("pen") is not None:
                    cell["case_level_cases"] += 1
                    for m in CASE_MONEY:
                        cell["case_level"][m] += case["pen"].get(m) or 0.0
                for dim, value, money_keys in dims:
                    cell["dims"][dim].setdefault(value, _dim_cell(money_keys))["opened"] += 1
            for conc in case.get("conclusions") or []:
                keys = ([conc["fy"]] if conc.get("fy") else []) + ["all"]
                for key in keys:
                    cell = acc[(scope, key)]
                    cell["conclusions"] += 1
                    cell["concluded"].add(cid)
                    if case.get("type") == "JDC":
                        cell["concluded_jdc"].add(cid)
                    elif case.get("type") == "AFR":
                        cell["concluded_afr"].add(cid)
                    if (conc.get("fed_penalty") or 0) > 0:
                        cell["penalty_conclusions"] += 1
                    for m in SETTLED_MONEY:
                        cell[m] += conc.get(m) or 0.0
                    cell["bundles"][bundle] += conc.get("fed_penalty") or 0.0
                    if key == "all" and not conc.get("fy"):
                        cell["unattributed"]["conclusions"] += 1
                        for m in SETTLED_MONEY:
                            cell["unattributed"][m] += conc.get(m) or 0.0
                    for dim, value, money_keys in dims:
                        d = cell["dims"][dim].setdefault(value, _dim_cell(money_keys))
                        d["conclusions"] += 1
                        d["concluded"].add(cid)
                        for m in money_keys:
                            d[m] += conc.get(m) or 0.0
    return acc


def _r(value):
    return round(value, 2)


def finalize_cell(cell):
    """Sets -> counts, money rounded to cents, dims -> lists sorted by opened then key, top-10 bundle share."""
    largest = max(cell["bundles"].items(), key=lambda kv: (kv[1], kv[0])) if cell["bundles"] else None
    total_fed = cell["fed_penalty"]
    out = {
        "largest_case": ({"case_number": largest[0], "fed_penalty": _r(largest[1]),
                          "share_of_fed_penalty": round(largest[1] / total_fed, 6) if total_fed > 0 else None}
                         if largest and largest[1] > 0 else None),
        "opened": cell["opened"], "opened_judicial": cell["opened_jdc"], "opened_administrative": cell["opened_afr"],
        "conclusions": cell["conclusions"], "penalty_conclusions": cell["penalty_conclusions"],
        "concluded_cases": len(cell["concluded"]), "concluded_judicial": len(cell["concluded_jdc"]),
        "concluded_administrative": len(cell["concluded_afr"]),
        **{m: _r(cell[m]) for m in SETTLED_MONEY},
        "case_level": {"cases_with_penalty_record": cell["case_level_cases"], **{m: _r(v) for m, v in cell["case_level"].items()}},
        "top10_case_share": top_share(cell["bundles"].values(), 10),
        "penalty_cases": sum(1 for v in cell["bundles"].values() if v > 0),
    }
    if cell["unattributed"]["conclusions"]:
        out["unattributed"] = {k: (_r(v) if isinstance(v, float) else v) for k, v in cell["unattributed"].items()}
    dims = {}
    for dim, values in cell["dims"].items():
        money_keys = PROGRAM_MONEY if dim == "program" else DIM_MONEY
        rows = [[value, d["opened"], d["conclusions"], len(d["concluded"])] + [_r(d[m]) for m in money_keys] for value, d in values.items()]
        rows.sort(key=lambda r: (-r[1], -r[3], r[0]))
        if rows:
            dims[dim] = rows
    out["dims"] = dims
    return out


# Column order of each entry in finalize_cell()["dims"][dim] (compact arrays, declared once in the dataset summary).
DIM_COLUMNS = {
    "type": ["code", "opened", "conclusions", "concluded_cases", *DIM_MONEY],
    "statute": ["code", "opened", "conclusions", "concluded_cases", *DIM_MONEY],
    "region": ["code", "opened", "conclusions", "concluded_cases", *DIM_MONEY],
    "program": ["code", "opened", "conclusions", "concluded_cases", *PROGRAM_MONEY],
}


def add_yoy(rows_by_fy, in_progress=()):
    """rows_by_fy: {fy: finalized cell}; adds yoy_* percent changes against FY-1 of the same scope (absent FY = 0).
    FYs listed in in_progress get null changes (a partial year is not comparable)."""
    for fy, row in rows_by_fy.items():
        if fy in in_progress:
            row["yoy"] = {"opened_pct": None, "concluded_cases_pct": None, "fed_penalty_pct": None, "note": "fiscal year in progress at file date"}
            continue
        prev = rows_by_fy.get(fy - 1)
        row["yoy"] = {
            "opened_pct": pct_change(row["opened"], prev["opened"] if prev else 0),
            "concluded_cases_pct": pct_change(row["concluded_cases"], prev["concluded_cases"] if prev else 0),
            "fed_penalty_pct": pct_change(row["fed_penalty"], prev["fed_penalty"] if prev else 0),
        }
    return rows_by_fy


# ---------------------------------------------------------------- defendants


def defendant_table(cases, twins=None, dupes=None):
    """One entry per exact recorded defendant name (leading/trailing whitespace trimmed only).
    Each case naming the defendant credits its full case-level federal penalty (CASE_PENALTIES.FED_PENALTY) to the
    defendant (joint credit: totals overlap across defendants); 'sole' sums only cases where it is the only name.
    twins: {member_case_number: lead_case_number}; dupes: list of look-alike groups (lists of case numbers)."""
    twins = twins or {}
    dupe_of = {}
    for index, group in enumerate(dupes or []):
        for number in group:
            dupe_of[number] = index
    table = {}
    for case in cases:
        names = case.get("defendants") or []
        if not names:
            continue
        pen = case.get("pen") or {}
        for entry in names:
            name = entry["name"]
            row = table.setdefault(name, {
                "name": name, "cases": [], "sole": 0, "judicial": 0, "administrative": 0, "complaint": 0, "settlement": 0,
                "with_penalty": 0, "no_penalty_record": 0, **{m: 0.0 for m in CASE_MONEY}, "fed_penalty_sole": 0.0,
                "fys": [], "settlement_fys": [], "statutes": collections.Counter(), "states": collections.Counter(),
                "regions": collections.Counter(), "national_cases": set(), "dupe_hits": collections.Counter(),
                "codefendants_max": 0,
            })
            row["codefendants_max"] = max(row["codefendants_max"], len(names) - 1)
            fed = pen.get("fed_penalty") or 0.0
            row["cases"].append((fed, case["case_number"], case.get("name"), case.get("fy"), case.get("type")))
            if len(names) == 1:
                row["sole"] += 1
                row["fed_penalty_sole"] += fed
            row["judicial"] += case.get("type") == "JDC"
            row["administrative"] += case.get("type") == "AFR"
            row["complaint"] += bool(entry.get("complaint"))
            row["settlement"] += bool(entry.get("settlement"))
            if case.get("pen") is None:
                row["no_penalty_record"] += 1
            if fed > 0:
                row["with_penalty"] += 1
            for m in CASE_MONEY:
                row[m] += pen.get(m) or 0.0
            if case.get("fy"):
                row["fys"].append(case["fy"])
            row["settlement_fys"].extend(c["fy"] for c in case.get("conclusions") or [] if c.get("fy"))
            row["statutes"][case.get("statute") or "NR"] += 1
            for state in case.get("states") or ["NR"]:
                row["states"][state] += 1
            row["regions"][case.get("region") or "NR"] += 1
            number = case["case_number"]
            lead = twins.get(number) or (number if number in set(twins.values()) else None)
            if lead:
                row["national_cases"].add(lead)
            if number in dupe_of:
                row["dupe_hits"][dupe_of[number]] += 1
    return table


def dupe_extra(row, dupe_amounts):
    """Federal penalty counted more than once for a defendant named on several records of one look-alike group."""
    return round(sum((n - 1) * dupe_amounts[g] for g, n in row["dupe_hits"].items() if n > 1), 2)


# ---------------------------------------------------------------- ECHO Exporter state programs

PROGRAMS = {
    # program: (id flag, status column, 5-year formal action count, current SNC/HPV flag, 5-year inspection count)
    "CAA": ("AIR_FLAG", "CAA_COMPLIANCE_STATUS", "CAA_FORMAL_ACTION_COUNT", "CAA_HPV_FLAG", "CAA_EVALUATION_COUNT"),
    "CWA": ("NPDES_FLAG", "CWA_COMPLIANCE_STATUS", "CWA_FORMAL_ACTION_COUNT", "CWA_SNC_FLAG", "CWA_INSPECTION_COUNT"),
    "RCRA": ("RCRA_FLAG", "RCRA_COMPLIANCE_STATUS", "RCRA_FORMAL_ACTION_COUNT", "RCRA_SNC_FLAG", "RCRA_INSPECTION_COUNT"),
    "SDWA": ("SDWIS_FLAG", "SDWA_COMPLIANCE_STATUS", "SDWA_FORMAL_ACTION_COUNT", "SDWA_SNC_FLAG", None),
}


def new_program_acc():
    return {
        "facilities": 0, "active_flag": 0, "any_formal_5y": 0, "any_formal_date_older": 0, "fec_cases_5y": 0, "any_snc_now": 0,
        "fac_snc_flag_y": 0, "inspected_5y": 0, "informal_5y": 0, "fac_status": collections.Counter(),
        "programs": {p: {"with_id": 0, "formal_5y": 0, "formal_actions_5y": 0, "snc_now": 0, "inspected_5y": 0,
                         "status": collections.Counter()} for p in PROGRAMS},
    }


def add_exporter_row(acc, row, cutoff):
    """Accumulate one ECHO Exporter facility row. cutoff: YYYY-MM-DD five years before the file date (diagnostic only)."""
    acc["facilities"] += 1
    acc["active_flag"] += clean(row.get("FAC_ACTIVE_FLAG")) == "Y"
    formal = count(row.get("FAC_FORMAL_ACTION_COUNT")) or 0
    if formal > 0:
        acc["any_formal_5y"] += 1
        last = us_date(row.get("FAC_DATE_LAST_FORMAL_ACTION"))
        if not last or last < cutoff:
            acc["any_formal_date_older"] += 1
    acc["fec_cases_5y"] += (count(row.get("FEC_NUMBER_OF_CASES")) or 0) > 0
    acc["inspected_5y"] += (count(row.get("FAC_INSPECTION_COUNT")) or 0) > 0
    acc["informal_5y"] += (count(row.get("FAC_INFORMAL_COUNT")) or 0) > 0
    acc["fac_snc_flag_y"] += clean(row.get("FAC_SNC_FLG")) == "Y"
    status = clean(row.get("FAC_COMPLIANCE_STATUS"))
    if status:
        acc["fac_status"][status] += 1
    snc_any = False
    for program, (flag, status_col, formal_col, snc_col, insp_col) in PROGRAMS.items():
        p = acc["programs"][program]
        if clean(row.get(flag)) == "Y":
            p["with_id"] += 1
        s = clean(row.get(status_col))
        if s:
            p["status"][s] += 1
        n = count(row.get(formal_col)) or 0
        if n > 0:
            p["formal_5y"] += 1
            p["formal_actions_5y"] += n
        if clean(row.get(snc_col)) == "Y":
            p["snc_now"] += 1
            snc_any = True
        if insp_col and (count(row.get(insp_col)) or 0) > 0:
            p["inspected_5y"] += 1
    acc["any_snc_now"] += snc_any
    return acc
