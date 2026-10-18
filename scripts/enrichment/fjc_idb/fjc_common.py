"""Pure helpers for the FJC IDB builders (no DuckDB import, so the unit tests can run anywhere)."""
from __future__ import annotations

from collections import defaultdict

import idb_codes as ic

LATEST_FY = 2025  # last complete statistical year
PARTIAL_FY = 2026  # October 1, 2025 - June 30, 2026
WIN = (2021, 2025)  # last five complete fiscal years
ca = ic  # NOS group tables live in idb_codes


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def n(v) -> str:
    return "Not recorded" if v is None else f"{int(round(v)):,}"


def pct(a, b, d: int = 1):
    return None if not b else round(100.0 * a / b, d)


def pct_label(v) -> str:
    return "Not recorded" if v is None else f"{v:.1f}%"


def days_label(v) -> str:
    return "Not recorded" if v is None else f"{int(round(v)):,} days (about {v / 30.4375:.1f} months)"


def rank_desc(values: dict[str, float]) -> dict[str, int]:
    """Competition ranking (1 = highest; ties share the lowest number); Nones are left out."""
    items = sorted(((k, v) for k, v in values.items() if v is not None), key=lambda kv: (-kv[1], kv[0]))
    out = {}
    last = None
    rank = 0
    for i, (k, v) in enumerate(items, 1):
        if v != last:
            rank = i
            last = v
        out[k] = rank
    return out


def series_for(agg: dict, key: str) -> list[dict]:
    filed = {r["fy"]: r for r in agg["filed"] if r["k"] == key}
    term = {r["fy"]: r for r in agg["terminated"] if r["k"] == key}
    pend = {r["fy"]: r["pending"] for r in agg["pending"] if r["k"] == key}
    out = []
    for fy in range(1988, PARTIAL_FY + 1):
        f, t = filed.get(fy), term.get(fy)
        if f is None and t is None:
            continue
        f = f or {}
        t = t or {}
        filings, terms = f.get("filings", 0), t.get("terminations", 0)
        out.append({
            "fy": fy,
            "partial": fy == PARTIAL_FY,
            "filings": filings,
            "terminations": terms,
            "pending_end": int(pend[fy]) if fy in pend else None,
            "median_days": t.get("median_days"),
            "p25_days": t.get("p25_days"),
            "p75_days": t.get("p75_days"),
            "p90_days": t.get("p90_days"),
            "class_action": f.get("class_action"),
            "class_action_pct": pct(f.get("class_action", 0), filings),
            "pro_se_plaintiff_pct": pct(f.get("pro_se_plaintiff", 0), f.get("pro_se_known", 0)),
            "ifp": f.get("ifp"),
            "removed": f.get("removed"),
            "mdl_transfer_in": f.get("mdl_transfer_in"),
            "mdl_originating": f.get("mdl_originating"),
            "with_mdl_number": f.get("with_mdl_number"),
            "federal_question": f.get("federal_question"),
            "diversity": f.get("diversity"),
            "us_party": f.get("us_party"),
            "product": f.get("product"),
            "product_pct": pct(f.get("product", 0), filings),
            "jury_demanded_pct": pct(f.get("jury_demanded", 0), f.get("jury_known", 0)),
            "demand_median_thousands": f.get("demand_median_thousands"),
            "settled": t.get("settled"),
            "settled_pct": pct(t.get("settled", 0), terms),
            "voluntary": t.get("voluntary"),
            "dismissed": t.get("dismissed"),
            "transferred_remanded": t.get("transferred_remanded"),
            "judgment": t.get("judgment"),
            "trial_judgment": t.get("trial_judgment"),
            "trial_pct": pct(t.get("trial_judgment", 0), terms),
            "jury_verdict": t.get("jury_verdict"),
            "court_trial": t.get("court_trial"),
            "median_days_trial": t.get("median_days_trial"),
            "disposition_missing": t.get("disposition_missing"),
        })
    return out


def window_profile(mix: dict, key: str, nos_names: dict) -> dict:
    groups = [r for r in mix["filed_groups"] if r["k"] == key]
    total = sum(r["n"] for r in groups)
    terms = {r["grp"]: r for r in mix["term_groups"] if r["k"] == key}
    top_nos = [{"nos": r["nos"], "label": nos_names.get(r["nos"], f"Code {r['nos']} (not in the codebook)"), "filings": r["n"], "share_pct": pct(r["n"], total)}
               for r in mix["filed_nos"] if r["k"] == key]
    juris = [r for r in mix["filed_juris"] if r["k"] == key]
    jt = sum(r["n"] for r in juris)
    origin = [r for r in mix["filed_origin"] if r["k"] == key]
    ot = sum(r["n"] for r in origin)
    disp = [r for r in mix["term_disp"] if r["k"] == key]
    dt = sum(r["n"] for r in disp)
    disp_groups: dict[str, int] = defaultdict(int)
    for r in disp:
        disp_groups[ic.DISPOSITION.get(r["disp"], ("", "Other / not in the codebook"))[1]] += r["n"]
    prog = [r for r in mix["term_procprog"] if r["k"] == key]
    pt = sum(r["n"] for r in prog)
    judg = [r for r in mix["term_judgment"] if r["k"] == key]
    return {
        "fy_from": WIN[0],
        "fy_to": WIN[1],
        "filings": total,
        "groups": [{
            "group": r["grp"], "label": ca.GROUP_LABEL.get(r["grp"], r["grp"]), "filings": r["n"], "share_pct": pct(r["n"], total),
            "terminations": terms.get(r["grp"], {}).get("n"), "median_days": terms.get(r["grp"], {}).get("median_days"),
            "settled_pct": pct(terms.get(r["grp"], {}).get("settled", 0), terms.get(r["grp"], {}).get("n", 0)),
            "trial_pct": pct(terms.get(r["grp"], {}).get("trial_judgment", 0), terms.get(r["grp"], {}).get("n", 0)),
        } for r in groups],
        "top_nos": top_nos,
        "jurisdiction": [{"code": r["juris"], "label": ic.label(ic.JURISDICTION, r["juris"]), "filings": r["n"], "share_pct": pct(r["n"], jt)} for r in juris],
        "origin": [{"code": r["origin"], "label": ic.label(ic.ORIGIN, r["origin"]), "filings": r["n"], "share_pct": pct(r["n"], ot)} for r in origin][:8],
        "dispositions": [{"code": r["disp"], "label": ic.label(ic.DISPOSITION, r["disp"]), "group": ic.DISPOSITION.get(r["disp"], ("", "Other"))[1],
                          "terminations": r["n"], "share_pct": pct(r["n"], dt)} for r in disp][:12],
        "disposition_groups": [{"group": g, "terminations": v, "share_pct": pct(v, dt)} for g, v in sorted(disp_groups.items(), key=lambda kv: -kv[1])],
        "procedural_progress": [{"code": r["procprog"], "label": ic.label(ic.PROCEDURAL_PROGRESS, r["procprog"]),
                                 "stage": ic.PROCEDURAL_PROGRESS.get(r["procprog"], ("", ""))[1], "terminations": r["n"], "share_pct": pct(r["n"], pt)} for r in prog][:8],
        "judgments": [{"for": ic.label(ic.JUDGMENT_FOR, r["judgment"]), "cases": r["n"], "median_amount_received_thousands": r["median_amtrec_thousands"]} for r in judg],
    }


def metric_ranks(latest: dict[str, dict]) -> dict[str, dict[str, int]]:
    """Ranks among the districts for the latest complete fiscal year."""
    pick = {
        "filings": lambda s: s["filings"],
        "pending_end": lambda s: s["pending_end"],
        "median_days": lambda s: s["median_days"],
        "trial_pct": lambda s: s["trial_pct"],
        "class_action_pct": lambda s: s["class_action_pct"],
        "pro_se_plaintiff_pct": lambda s: s["pro_se_plaintiff_pct"],
        "product_pct": lambda s: s["product_pct"],
        "settled_pct": lambda s: s["settled_pct"],
    }
    return {m: rank_desc({k: f(v) for k, v in latest.items()}) for m, f in pick.items()}
