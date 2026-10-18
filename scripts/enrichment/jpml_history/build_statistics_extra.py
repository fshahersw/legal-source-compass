"""Build jpml_statistics_extra from the JPML fiscal-year "Statistical Analysis of Multidistrict Litigation" reports
(https://www.jpml.uscourts.gov/statistics-info, type "Fiscal Year", FY1992-FY2025) saved in private/acq/jpml_history/.

Not in mdl_intel_jpml_stats (calendar-year activity: motions, tag-alongs, remands). These editions add, per fiscal year
(September 30 year end): the cumulative summary of actions (transferred, filed in transferee districts, closed,
pending), the Circuit-and-District table (every transferee district), and the Summary by Docket (every MDL pending or
closed in the year: total transferred, total filed in the transferee court, closed, remanded, pending).

Rows (private/build/jpml_history/jpml_statistics_extra.json, publish-ready, never published from here):
  fy:<YYYY>        listing row: one per fiscal-year edition (34)
  district:<key>   detail row: fiscal-year series of one transferee district (district table, all 34 editions)
  mdl:<n>          detail row: fiscal-year-end series of one MDL number (Summary by Docket of every validated edition)
  summary:overview detail row: long-run series, exclusions, reconciliation with the monthly reports

Rules: only printed values; an edition whose table fails its printed-total checks is excluded from that table, never
repaired; derived figures state their formula in the dataset summary.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import corpus_writer as cw  # noqa: E402
import analytics as an  # noqa: E402
import parse_stats as ps  # noqa: E402
import build_jpml_history as bh  # noqa: E402

ROOT = HERE.parents[2]
ACQ = bh.ACQ
OUT = bh.OUT
LOOKUPS = bh.LOOKUPS
STAT_PAGE = "https://www.jpml.uscourts.gov/statistics-info"
DS = "jpml_statistics_extra"
COL = {"into": 0, "out": 1, "net": 2, "filed": 3, "closed": 4, "cum_into": 5, "cum_out": 6, "cum_net": 7, "cum_filed": 8, "cum_closed": 9, "pending": 10}


# ------------------------------------------------------------------ editions

def parse_edition(text: str) -> dict:
    fy = ps.fiscal_year(text)
    d = ps.parse_district_table(text)
    vd = ps.validate_district_table(d)
    k = ps.parse_docket_table(text)
    vk = ps.validate_docket_table(k, d if vd["valid"] else None)
    return {"fy": fy, "district": d, "district_check": vd, "docket": k, "docket_check": vk, "narrative": ps.parse_narrative(text), "pages": ps.line_pages(text)}


def load_editions(manifest: dict) -> list:
    eds = []
    for url, e in sorted(manifest.items()):
        if e.get("stat_type") != "Fiscal Year":
            continue
        bh.verify(e)
        ed = parse_edition(ps.pdftotext(ACQ / e["path"]))
        link_year = int(e["link_text"].split()[-1])
        ed.update({"url": url, "path": e["path"], "sha256": e["sha256"], "bytes": e["bytes"], "link_text": e["link_text"], "listed_on": e.get("listed_on"), "link_year": link_year})
        ed["year_agrees"] = ed["fy"] == link_year
        # the district table is used when its sums add up; the docket table when its numbers add up (attribution flagged apart)
        ed["district_ok"] = ed["year_agrees"] and ed["district_check"]["valid"]
        ed["docket_ok"] = ed["year_agrees"] and ed["docket_check"]["valid"]
        eds.append(ed)
    return sorted(eds, key=lambda x: x["link_year"])


def exclusion_reason(ed: dict, which: str) -> str:
    if not ed["year_agrees"]:
        return f"fiscal year read from the text ({ed['fy']}) differs from the listed year ({ed['link_year']})"
    chk = ed["district_check"] if which == "district" else ed["docket_check"]
    failed = chk.get("failed_required") or chk.get("failed") or []
    return "; ".join(f"{c['check']} (parsed {c.get('parsed')}, printed {c.get('printed')})" for c in failed[:4]) or "table not found"


# ------------------------------------------------------------------ per fiscal year

def entry_pending(r: dict) -> int:
    return r["values"][4] + sum(a["values"][4] for a in r.get("adjustments", []))


def district_pending(ed: dict) -> dict:
    """district key -> (label as printed, JPML code if printed, 11 values)."""
    out = {}
    for c in ed["district"]["circuits"]:
        for x in c["districts"]:
            key = ps.district_key(x["label"])
            prev = out.get(key)
            vals = x["values"] if prev is None else [(a or 0) + (b or 0) for a, b in zip(prev[2], x["values"])]
            out[key] = (x["label"], x.get("code") or (prev[1] if prev else None), vals, c["label"])
    return out


def fy_stats(ed: dict, prev: dict | None) -> dict:
    g = ed["district"]["grand"]["values"]
    rec = {
        "fy": ed["link_year"], "period_months": ed["district"]["period"][0], "period_end": f"{ed['link_year']}-09-30",
        "transferred": g[COL["into"]], "filed_in_transferee": g[COL["filed"]], "closed": g[COL["closed"]],
        "cum_transferred": g[COL["cum_into"]], "cum_filed_in_transferee": g[COL["cum_filed"]], "cum_closed": g[COL["cum_closed"]],
        "pending": g[COL["pending"]],
    }
    rec["subjected"] = rec["transferred"] + rec["filed_in_transferee"]
    rec["cum_subjected"] = rec["cum_transferred"] + rec["cum_filed_in_transferee"]
    consecutive = prev is not None and prev["link_year"] == ed["link_year"] - 1
    pg = prev["district"]["grand"]["values"][COL["pending"]] if consecutive else None
    rec["roll_forward_residual"] = (rec["pending"] - (pg + rec["subjected"] - rec["closed"])) if consecutive else None
    rec["pending_change_vs_prev_fy"] = (rec["pending"] - pg) if consecutive else None
    # circuits
    circ = []
    for c in ed["district"]["circuits"]:
        circ.append({"circuit": c["label"], "pending": c["values"][COL["pending"]], "transferred": c["values"][COL["into"]], "filed_in_transferee": c["values"][COL["filed"]], "closed": c["values"][COL["closed"]], "pending_share_pct": an.share_pct(c["values"][COL["pending"]], rec["pending"], 2)})
    rec["circuits"] = circ
    dist = district_pending(ed)
    dvals = [v[2][COL["pending"]] for v in dist.values()]
    rec["districts_with_pending"] = sum(1 for v in dvals if v)
    rec["hhi_district_pending"] = an.hhi(dvals)
    rec["top_district_pending"] = sorted(((v[2][COL["pending"]], k) for k, v in dist.items()), reverse=True)[:3]
    # docket-derived (only when the Summary by Docket validated)
    rec["docket"] = None
    if ed["docket_ok"]:
        rows = ed["docket"]["rows"]
        pend = [entry_pending(r) for r in rows]
        top = sorted(rows, key=lambda r: (-entry_pending(r), r["mdl"]))[:10]
        rec["docket"] = {
            "entries": len(rows), "mdls_with_pending_actions": sum(1 for p in pend if p > 0), "pending_total": sum(pend),
            "top1_share_pct": an.top_n_share(pend, 1), "top5_share_pct": an.top_n_share(pend, 5), "top10_share_pct": an.top_n_share(pend, 10),
            "hhi_mdl_pending": an.hhi(pend), "median_pending_per_entry": sorted(pend)[len(pend) // 2] if len(pend) % 2 else (sorted(pend)[len(pend) // 2 - 1] + sorted(pend)[len(pend) // 2]) / 2,
            "top10": [{"mdl": r["mdl"], "caption": r["caption"], "pending": entry_pending(r)} for r in top],
            "intro_counts": ed["docket"].get("intro_counts"), "attribution": ed["docket_check"]["attribution"]["status"],
            "duplicates_dropped": len(ed["docket"].get("duplicates_dropped", [])),
        }
    rec["narrative"] = {k: {"value": v["value"], "printed": v["printed"], "sentence": v["sentence"]} for k, v in ed["narrative"].items()}
    # narrative agreement with the district-table grand totals (printed FY2012+ sentences)
    nar = ed["narrative"]
    agree = {}
    for key, want in (("cases_transferred_fy", rec["transferred"]), ("filed_directly_fy", rec["filed_in_transferee"]), ("actions_subjected_fy", rec["subjected"]), ("pending_actions_fy_end", rec["pending"])):
        if key in nar and nar[key]["value"] is not None:
            agree[key] = nar[key]["value"] == want
    rec["narrative_agrees_with_table"] = agree
    return rec


# ------------------------------------------------------------------ per MDL

def mdl_points(editions: list) -> dict:
    """mdl -> [fiscal-year-end point]; one point per (MDL, fiscal year), entries of the same MDL under several districts
    in one edition are summed and the districts joined (counted in `parts`)."""
    out = defaultdict(list)
    for ed in editions:
        if not ed["docket_ok"]:
            continue
        by = defaultdict(list)
        for r in ed["docket"]["rows"]:
            by[r["mdl"]].append(r)
        for mdl, rs in by.items():
            vals = [sum(r["values"][j] for r in rs) for j in range(5)]
            adj = [{"label": a["label"], "values": a["values"]} for r in rs for a in r["adjustments"]]
            out[mdl].append({
                "fy": ed["link_year"], "date": f"{ed['link_year']}-09-30", "parts": len(rs),
                "district": " / ".join(dict.fromkeys(r["district_name"].title() for r in rs)), "district_keys": [r["district_key"] for r in rs],
                "district_code": rs[0]["district_code"], "attribution": ed["docket_check"]["attribution"]["status"],
                "judge": " / ".join(dict.fromkeys(r["judge"] for r in rs if r["judge"])) or None, "caption": rs[0]["caption"].rstrip("*").strip(),
                "transferred": vals[0], "filed_in_transferee": vals[1], "closed": vals[2], "remanded": vals[3], "pending": vals[4],
                "adjustments": adj, "pdf_page": ed["pages"][rs[0]["line"] - 1], "class_action_asterisk": True if all(r["caption"].endswith("*") for r in rs) else None,
            })
    for pts in out.values():
        pts.sort(key=lambda p: p["fy"])
    return out


def mdl_record_data(mdl: int, pts: list, editions: list, term_years: list) -> dict:
    okfys = [e["link_year"] for e in editions if e["docket_ok"]]
    first, last = pts[0], pts[-1]
    pk = an.peak(pts)
    absent = [fy for fy in okfys if first["fy"] <= fy <= last["fy"] and fy not in {p["fy"] for p in pts}]
    excluded_inside = [e["link_year"] for e in editions if not e["docket_ok"] and first["fy"] <= e["link_year"] <= last["fy"]]
    byfy = {p["fy"]: p for p in pts}
    for p in pts:
        prev = byfy.get(p["fy"] - 1)
        p["pending_change_vs_prev_fy"] = p["pending"] - prev["pending"] if prev else None
        p["pending_pct_change_vs_prev_fy"] = an.share_pct(p["pending"] - prev["pending"], prev["pending"], 1) if prev and prev["pending"] else None
    in_last_edition = last["fy"] == okfys[-1]
    return {
        "mdl": mdl, "first_fy": first["fy"], "last_fy": last["fy"], "fiscal_years": len(pts), "in_latest_validated_edition": in_last_edition,
        "absent_validated_years": absent, "edition_excluded_years_inside_span": excluded_inside, "left_censored": first["fy"] == okfys[0],
        "pending": last["pending"], "transferred": last["transferred"], "filed_in_transferee": last["filed_in_transferee"], "closed": last["closed"], "remanded": last["remanded"],
        "peak_pending": pk["pending"], "peak_fy": pk["fy"], "fy_first_to_peak": pk["fy"] - first["fy"],
        "pending_vs_peak_pct": an.share_pct(last["pending"], pk["pending"], 1),
        "district": last["district"], "judge": last["judge"], "caption": last["caption"],
        "districts": _periods(pts, "district"),
        "judges": _periods(pts, "judge"),
        "termination_years_in_jpml_terminated_report": term_years,
        "series": pts,
    }


def _periods(pts: list, key: str) -> list:
    out = []
    for p in pts:
        v = p.get(key)
        if out and out[-1]["value"] == v:
            out[-1]["to"] = p["fy"]
            out[-1]["fiscal_years"] += 1
        else:
            out.append({"value": v, "from": p["fy"], "to": p["fy"], "fiscal_years": 1})
    return out


# ------------------------------------------------------------------ lookups

def load_lookups():
    ids = json.loads((LOOKUPS / "mdl_ids.json").read_text())
    terminated = defaultdict(list)
    pairs = json.loads((LOOKUPS / "terminated_pairs.json").read_text())["pairs"].split(",")
    for p in pairs:
        mdl, year, _code = p.split(":")
        terminated[int(mdl)].append(int(year))
    known = {int(x) for x in ids.get("mdls", [])} | {int(x) for x in ids.get("mdl_analytics", [])} | set(terminated)
    return {"mdls": {int(x) for x in ids.get("mdls", [])}, "analytics": {int(x) for x in ids.get("mdl_analytics", [])}, "terminated": dict(terminated), "known": known}


def monthly_from_hist(hist):
    """mdl -> {month: pending} from the monthly history records of build_jpml_history.build_mdl_history."""
    return {r["mdl"]: {p["month"]: p["pending"] for p in r["series"]} for r in hist}


def load_monthly():
    """Same, read from the monthly dataset file when build_jpml_history.py ran earlier (None when it did not)."""
    p = OUT / "jpml_pending_history_mdls.json"
    if not p.exists():
        return None
    rows = json.loads(p.read_text())["rows"]
    return {int(r["id"]): {pt["month"]: pt["pending"] for pt in (r["item"].get("history") or r["item"].get("analytics"))["series"] if "month" in pt} for r in rows}


# ------------------------------------------------------------------ rows

def fmt_fy_label(ed_or_fy):
    return f"FY{ed_or_fy}"


def fy_rows(editions, stats_by_fy):
    rows = []
    for ed in editions:
        fy = ed["link_year"]
        s = stats_by_fy.get(fy)
        if s is None:
            continue
        dk = s["docket"]
        period = f"{s['period_months']} months ending Sept 30, {fy}" if s["period_months"] else f"fiscal year ending Sept 30, {fy}"
        facts = [
            ["Fiscal year", f"{fy} ({period})"],
            ["Actions pending in transferee districts at Sept 30", an.fmt(s["pending"])],
            ["Change in pending since the previous fiscal-year end", an.signed(s["pending_change_vs_prev_fy"])],
            [f"Actions transferred by Panel order in the period ('Into Dist.')", an.fmt(s["transferred"])],
            ["Actions filed directly in transferee districts in the period", an.fmt(s["filed_in_transferee"])],
            ["Actions subjected to § 1407 proceedings in the period (computed: transferred + filed)", an.fmt(s["subjected"])],
            ["Actions closed (terminated or remanded) in the period", an.fmt(s["closed"])],
            ["Roll-forward residual (computed: pending − [previous pending + subjected − closed])", an.signed(s["roll_forward_residual"])],
            ["Cumulative since Sept 1968: transferred / filed in transferee districts / closed", f"{an.fmt(s['cum_transferred'])} / {an.fmt(s['cum_filed_in_transferee'])} / {an.fmt(s['cum_closed'])}"],
            ["Districts with actions pending / district HHI of pending actions (computed, 0–10,000)", f"{s['districts_with_pending']} / {an.fmt(s['hhi_district_pending'])}"],
        ]
        if dk:
            facts += [
                ["Summary by Docket: entries (MDLs pending + closed in the year) / entries with ≥1 pending action", f"{dk['entries']} / {dk['mdls_with_pending_actions']}"],
                ["Top 10 MDLs' share of pending actions (computed from the docket table)", an.pct(dk["top10_share_pct"], 2)],
                ["Largest MDL's share of pending actions (computed)", an.pct(dk["top1_share_pct"], 2)],
                ["HHI of pending actions across MDLs (computed, 0–10,000)", an.fmt(dk["hhi_mdl_pending"])],
            ]
        else:
            facts.append(["Summary by Docket", "Not recorded: this edition's docket table failed its printed-total checks (" + exclusion_reason(ed, "docket") + ")"])
        for key, label in (("motions_filed_fy", "Motions to centralize filed in the fiscal year (as printed)"), ("motions_granted_fy", "Motions granted (as printed)"), ("motions_denied_fy", "Motions denied (as printed)"), ("pending_mdls_fy_end", "MDLs pending at Sept 30 (as printed)"), ("pending_transferee_districts_fy_end", "Transferee districts with pending MDLs (as printed)")):
            if key in s["narrative"] and s["narrative"][key]["value"] is not None:
                facts.append([label, an.fmt(s["narrative"][key]["value"])])
        facts.append(["Source", f"JPML Statistical Analysis of Multidistrict Litigation, fiscal year {fy} (statistics-info, Fiscal Year): Cumulative Summary / Circuit-and-District table and Summary by Docket; retrieved {ed.get('retrieved_at', '2026-10-18')[:10]}"])
        cells = {
            "year": f"FY{fy}", "period": f"{s['period_months']} mo" if s["period_months"] else "—", "pending": an.fmt(s["pending"]),
            "mdls": f"{dk['entries']}" if dk else "—", "transferred": an.fmt(s["transferred"]), "direct": an.fmt(s["filed_in_transferee"]),
            "closed": an.fmt(s["closed"]), "top10": an.pct(dk["top10_share_pct"], 1) if dk else "Not recorded", "hhi_district": an.fmt(s["hhi_district_pending"]),
        }
        badges = []
        if s["period_months"] and s["period_months"] != 12:
            badges.append(f"{s['period_months']}-month period")
        if not dk:
            badges.append("Docket table not validated")
        elif dk["attribution"] != "verified":
            badges.append("District attribution unverified")
        rows.append(cw.record(
            DS, f"fy:{fy}", f"JPML fiscal year {fy}: actions, districts and dockets", source_url=ed["url"],
            subtitle=f"{an.fmt(s['pending'])} actions pending at Sept 30, {fy} · {an.fmt(s['subjected'])} subjected in the period · top 10 hold {an.pct(dk['top10_share_pct'], 1) if dk else 'Not recorded'}",
            cells=cells, facts=facts, badges=badges,
            links=[{"url": ed["url"], "label": f"JPML Statistical Analysis FY{fy} (PDF)"}, {"url": STAT_PAGE, "label": "JPML statistical information"}],
            text=f"JPML statistical analysis fiscal year {fy} cumulative summary circuit district docket",
            filters={"kind": ["fiscal_year"], "decade": [f"{fy // 10 * 10}s"], "date": f"{fy}-09-30"},
            extra={"kind": "fiscal_year", "fy_stats": {k: v for k, v in s.items()}, "validation": {"district_table": ed["district_check"]["valid"], "docket_table": ed["docket_ok"], "docket_attribution": ed["docket_check"]["attribution"]["status"] if ed["docket_ok"] else None, "docket_exclusion": None if ed["docket_ok"] else exclusion_reason(ed, "docket")}},
        ))
    return rows


def district_slug(key):
    name, direction = key.split("|", 1)
    return name.replace(" ", "-") + ("-" + direction.lower() if direction else "")


def district_rows(editions, stats_by_fy, spine):
    fy_url = {e["link_year"]: e["url"] for e in editions}
    series = defaultdict(dict)
    printed = defaultdict(set)
    for ed in editions:
        if not ed["district_ok"]:
            continue
        total = ed["district"]["grand"]["values"][COL["pending"]]
        for key, (label, code, vals, circuit) in district_pending(ed).items():
            printed[key].add(label)
            series[key][ed["link_year"]] = {
                "fy": ed["link_year"], "date": f"{ed['link_year']}-09-30", "label": label, "code": code, "circuit": circuit,
                "pending": vals[COL["pending"]], "transferred": vals[COL["into"]], "transferred_out": vals[COL["out"]], "filed_in_transferee": vals[COL["filed"]], "closed": vals[COL["closed"]],
                "cum_transferred": vals[COL["cum_into"]], "cum_filed_in_transferee": vals[COL["cum_filed"]], "cum_closed": vals[COL["cum_closed"]],
                "pending_share_pct": an.share_pct(vals[COL["pending"]], total, 2), "source_edition_fy": ed["link_year"],
            }
    latest_fy = max(stats_by_fy)
    rows, courts = [], {}
    for key in sorted(series):
        pts = [series[key][fy] for fy in sorted(series[key])]
        if not any(any(p[f] for f in ("pending", "transferred", "filed_in_transferee", "closed", "cum_transferred", "cum_filed_in_transferee", "cum_closed")) for p in pts):
            continue  # a district that never appears with any activity carries no information
        # rank by pending in each fiscal year
        for p in pts:
            ranked = sorted((series[k][p["fy"]]["pending"], k) for k in series if p["fy"] in series[k])
            ranked.sort(key=lambda t: (-t[0], t[1]))
            p["rank_by_pending"] = next((i + 1 for i, (_v, k) in enumerate(ranked) if k == key), None) if p["pending"] else None
        court = an.match_court_key(key, spine)
        courts[key] = court
        last = pts[-1]
        pk = an.peak(pts)
        label = an.court_label_from_key(key) or key
        links = ([{"url": f"/courts/{court['court_id']}", "label": f"{court['label']} (court page)"}] if court["court_id"] else []) + [{"url": fy_url[last["fy"]], "label": f"JPML Statistical Analysis FY{last['fy']} (PDF)"}, {"url": STAT_PAGE, "label": "JPML statistical information"}]
        facts = [
            ["Transferee district (normalised from the printed name)", label],
            ["Printed in the reports as", "; ".join(sorted(printed[key]))],
            ["Court directory match", f"{court['court_id'] or 'none'} ({court['status']}; {court['method']})"],
            ["Fiscal years with a validated Circuit-and-District table", f"{len(pts)} (FY{pts[0]['fy']} to FY{last['fy']})"],
            [f"Actions pending at Sept 30, FY{last['fy']}", an.fmt(last["pending"])],
            ["Peak pending at a fiscal-year end", f"{an.fmt(pk['pending'])} (FY{pk['fy']})"],
            [f"Share of all pending MDL actions, FY{last['fy']} (computed)", an.pct(last["pending_share_pct"], 2)],
            [f"Cumulative since 1968, FY{last['fy']}: transferred in / filed in the district / closed", f"{an.fmt(last['cum_transferred'])} / {an.fmt(last['cum_filed_in_transferee'])} / {an.fmt(last['cum_closed'])}"],
            ["Source", "JPML Statistical Analysis of Multidistrict Litigation, Summary by Circuit and District (each fiscal-year edition)"],
        ]
        rows.append(cw.record(
            DS, "district:" + district_slug(key), f"Transferee district: {label}", source_url=fy_url[last["fy"]],
            subtitle=f"{an.fmt(last['pending'])} actions pending at Sept 30, FY{last['fy']} · peak {an.fmt(pk['pending'])} (FY{pk['fy']})",
            cells={"year": "district", "period": "—", "pending": an.fmt(last["pending"]), "mdls": "—", "transferred": an.fmt(last["transferred"]), "direct": an.fmt(last["filed_in_transferee"]), "closed": an.fmt(last["closed"]), "top10": "—", "hhi_district": "—"},
            facts=facts, links=links, text=f"transferee district {label} {' '.join(sorted(printed[key]))}",
            filters={"_listing": ["no"], "kind": ["district"], "court": [court["court_id"]] if court["court_id"] else []},
            extra={"kind": "district", "district_key": key, "court": court, "court_id": court["court_id"], "printed_labels": sorted(printed[key]), "latest_fy": latest_fy, "series": pts},
        ))
    return rows, courts


def mdl_rows(editions, points, lookups, monthly, latest_ok_fy):
    rows = []
    recs = {}
    fy_url = {e["link_year"]: e["url"] for e in editions}
    for mdl in sorted(points):
        rec = mdl_record_data(mdl, points[mdl], editions, lookups["terminated"].get(mdl, []))
        recs[mdl] = rec
        pts = rec["series"]
        last = pts[-1]
        known = mdl in lookups["known"]
        links = [{"url": f"/matters/lens/{mdl}", "label": f"MDL {mdl} case lens"}]
        if monthly and mdl in monthly:
            links.append({"url": f"/records/jpml_pending_history_mdls/{mdl}", "label": "Monthly pending-report history (Oct 2024 onward)"})
        links += [{"url": fy_url[last["fy"]], "label": f"JPML Statistical Analysis FY{last['fy']} (PDF)"}, {"url": STAT_PAGE, "label": "JPML statistical information"}]
        term = rec["termination_years_in_jpml_terminated_report"]
        status = "Listed in the latest validated edition" if rec["in_latest_validated_edition"] else f"Last listed in the FY{rec['last_fy']} edition"
        dist_hist = "; ".join(f"{d['value']} FY{d['from']}–FY{d['to']}" for d in rec["districts"])
        judge_hist = "; ".join(f"{d['value'] or 'Not printed'} FY{d['from']}–FY{d['to']}" for d in rec["judges"])
        unverified = [p["fy"] for p in pts if p["attribution"] != "verified"]
        facts = [
            ["MDL number", str(mdl)],
            [f"Caption as printed (FY{rec['last_fy']}, abbreviated by the Panel)", rec["caption"]],
            ["Status in the fiscal-year tables", status],
            ["Fiscal-year editions listing the MDL", f"{rec['fiscal_years']} (FY{rec['first_fy']} to FY{rec['last_fy']})" + (" — first edition validated is FY1992, earlier history not covered" if rec["left_censored"] else "")],
            ["Editions inside that span excluded (failed printed-total checks) or not listing it", ", ".join(f"FY{y}" for y in sorted(set(rec["edition_excluded_years_inside_span"]) | set(rec["absent_validated_years"]))) or "None"],
            [f"Actions pending at Sept 30, FY{rec['last_fy']}", an.fmt(rec["pending"])],
            ["Total transferred / total filed in the transferee court / closed / remanded (cumulative, as printed)", f"{an.fmt(last['transferred'])} / {an.fmt(last['filed_in_transferee'])} / {an.fmt(last['closed'])} / {an.fmt(last['remanded'])}"],
            ["Peak pending at a fiscal-year end", f"{an.fmt(rec['peak_pending'])} (FY{rec['peak_fy']}); {rec['fy_first_to_peak']} fiscal years after the first edition listing it"],
            ["Latest pending as share of that peak", an.pct(rec["pending_vs_peak_pct"])],
            ["Transferee district as printed, by period", dist_hist],
            ["Transferee judge as printed, by period", judge_hist],
            ["District attribution", "Verified in every edition listing it" if not unverified else "Not verified against the report's own district counts in FY" + ", FY".join(str(y) for y in unverified) + " (shown as printed)"],
            ["Termination year(s) in the JPML cumulative terminated-litigation report", ", ".join(str(y) for y in term) or "Not in that report"],
            ["Source", "JPML Statistical Analysis of Multidistrict Litigation, Summary by Docket of Multidistrict Litigation Pending or Closed (each validated fiscal-year edition); counts are actions"],
        ]
        court_ids = []
        for p in pts:
            for k in p["district_keys"]:
                c = rec.setdefault("_courts", {}).get(k)
                if c is None:
                    c = rec["_courts"][k] = an.match_court_key(k, lookups["spine"])
                if c["court_id"] and c["court_id"] not in court_ids:
                    court_ids.append(c["court_id"])
                    links.insert(1, {"url": f"/courts/{c['court_id']}", "label": f"{c['label']} (transferee court)"})
        rec.pop("_courts", None)
        cells = {"year": f"MDL {mdl}", "period": f"FY{rec['first_fy']}–FY{rec['last_fy']}", "pending": an.fmt(rec["pending"]), "mdls": "—", "transferred": an.fmt(last["transferred"]), "direct": an.fmt(last["filed_in_transferee"]), "closed": an.fmt(last["closed"]), "top10": "—", "hhi_district": "—"}
        rows.append(cw.record(
            DS, f"mdl:{mdl}", rec["caption"], source_url=fy_url[last["fy"]],
            subtitle=f"MDL {mdl} · {rec['district']} · FY{rec['first_fy']}–FY{rec['last_fy']} · peak {an.fmt(rec['peak_pending'])} pending (FY{rec['peak_fy']})",
            cells=cells, facts=facts, links=links, text=f"MDL {mdl} {rec['caption']} {rec['judge'] or ''} {rec['district']}",
            filters={"_listing": ["no"], "kind": ["mdl"], "court": court_ids},
            extra={"kind": "mdl", "fy_history": {k: v for k, v in rec.items() if k != "series"} | {"series": pts}, "lens_content_known": known},
        ))
    return rows, recs


def overview_row(editions, stats_by_fy, recs, lookups, courts, monthly, excluded, reconcile, xref):
    series = []
    for fy in sorted(stats_by_fy):
        s = stats_by_fy[fy]
        dk = s["docket"]
        series.append({
            "fy": fy, "period_months": s["period_months"], "pending": s["pending"], "transferred": s["transferred"], "filed_in_transferee": s["filed_in_transferee"], "closed": s["closed"],
            "subjected": s["subjected"], "roll_forward_residual": s["roll_forward_residual"], "hhi_district_pending": s["hhi_district_pending"], "districts_with_pending": s["districts_with_pending"],
            "entries": dk["entries"] if dk else None, "mdls_with_pending_actions": dk["mdls_with_pending_actions"] if dk else None,
            "top1_share_pct": dk["top1_share_pct"] if dk else None, "top5_share_pct": dk["top5_share_pct"] if dk else None, "top10_share_pct": dk["top10_share_pct"] if dk else None, "hhi_mdl_pending": dk["hhi_mdl_pending"] if dk else None,
        })
    first, last = series[0], series[-1]
    largest = sorted(recs.values(), key=lambda r: -r["peak_pending"])[:25]
    facts = [
        ["Fiscal-year editions read", f"{len(editions)} (FY{editions[0]['link_year']} to FY{editions[-1]['link_year']})"],
        ["Circuit-and-District tables validated", f"{sum(1 for e in editions if e['district_ok'])} of {len(editions)}"],
        ["Summary-by-Docket tables validated (numbers)", f"{sum(1 for e in editions if e['docket_ok'])} of {len(editions)}"],
        ["Editions excluded from the docket table", ", ".join(f"FY{x['fy']}" for x in excluded) or "None"],
        ["MDL numbers in the docket tables", an.fmt(len(recs))],
        ["Top 10 MDLs' share of pending actions, first → last validated docket edition", f"{an.pct(next(s['top10_share_pct'] for s in series if s['top10_share_pct'] is not None), 1)} → {an.pct(next(s['top10_share_pct'] for s in reversed(series) if s['top10_share_pct'] is not None), 1)}"],
        ["District HHI of pending actions, first → last edition", f"{an.fmt(first['hhi_district_pending'])} → {an.fmt(last['hhi_district_pending'])}"],
        ["Source", "JPML Statistical Analysis of Multidistrict Litigation, fiscal-year editions on statistics-info"],
    ]
    return cw.record(
        DS, "summary:overview", "JPML fiscal-year statistics overview", source_url=STAT_PAGE,
        subtitle=f"{len(editions)} fiscal-year editions · {len(recs)} MDL numbers · FY{editions[0]['link_year']}–FY{editions[-1]['link_year']}",
        cells={"year": "summary", "period": "—", "pending": an.fmt(last["pending"]), "mdls": "—", "transferred": "—", "direct": "—", "closed": "—", "top10": "—", "hhi_district": an.fmt(last["hhi_district_pending"])},
        facts=facts, text="summary overview JPML fiscal year statistics", links=[{"url": STAT_PAGE, "label": "JPML statistical information"}],
        filters={"_listing": ["no"], "kind": ["summary"]},
        extra={"kind": "summary", "overview": {
            "series": series, "excluded_docket_editions": excluded, "largest_peaks": [{"mdl": r["mdl"], "caption": r["caption"], "peak_pending": r["peak_pending"], "peak_fy": r["peak_fy"], "pending": r["pending"], "last_fy": r["last_fy"]} for r in largest],
            "reconciliation_with_monthly_reports": reconcile, "cross_references": xref,
            "district_court_matches": {k: v for k, v in sorted(courts.items())},
            "editions": [{"fy": e["link_year"], "url": e["url"], "sha256": e["sha256"], "bytes": e["bytes"], "district_table_valid": e["district_ok"], "docket_table_valid": e["docket_ok"], "docket_attribution": e["docket_check"]["attribution"]["status"], "docket_entries": len(e["docket"]["rows"]), "docket_checks": e["docket_check"]["checks"], "district_checks_failed": e["district_check"].get("failed", []), "duplicates_dropped": e["docket"].get("duplicates_dropped", [])} for e in editions],
        }},
    )


# ------------------------------------------------------------------ reconciliation and cross references

def reconcile(editions, monthly):
    """FY-end (Sept 30) docket pending against the monthly report of the next business day (first report of October)."""
    out = []
    if not monthly:
        return out
    for ed in editions:
        if not ed["docket_ok"]:
            continue
        month = f"{ed['link_year']}-10"
        pairs = {}
        for r in ed["docket"]["rows"]:
            pairs[r["mdl"]] = pairs.get(r["mdl"], 0) + entry_pending(r)
        in_monthly = {m: v[month] for m, v in monthly.items() if month in v}
        if not in_monthly:
            continue
        common = sorted(set(pairs) & set(in_monthly))
        same = [m for m in common if pairs[m] == in_monthly[m]]
        out.append({
            "fy": ed["link_year"], "monthly_report_month": month, "fy_end_pending_total": sum(pairs.values()), "monthly_pending_total": sum(in_monthly.values()),
            "mdls_in_both": len(common), "identical_pending": len(same), "within_1pct_or_5_actions": sum(1 for m in common if abs(pairs[m] - in_monthly[m]) <= max(5, 0.01 * max(pairs[m], in_monthly[m]))),
            "only_in_monthly_report": sorted(set(in_monthly) - set(pairs))[:20], "only_in_fy_table_with_pending": sorted(m for m in set(pairs) - set(in_monthly) if pairs[m])[:20],
            "differences": sorted(({"mdl": m, "fy_end": pairs[m], "monthly": in_monthly[m]} for m in common if pairs[m] != in_monthly[m]), key=lambda d: -abs(d["fy_end"] - d["monthly"])),
        })
    for o in out:
        o["largest_differences"] = o["differences"][:10]
    return out


def month_notes(recon):
    """month -> sentences for the monthly dataset (build_all.py)."""
    notes = {}
    for r in recon:
        s = (f"FY{r['fy']} Statistical Analysis (pending at Sept 30, {r['fy']}) prints {an.fmt(r['fy_end_pending_total'])} actions pending in total; this report prints {an.fmt(r['monthly_pending_total'])}. "
             f"Of {r['mdls_in_both']} MDLs listed in both, {r['identical_pending']} have identical pending counts and {r['within_1pct_or_5_actions']} are within 1% or 5 actions.")
        big = [d for d in r["differences"] if abs(d["fy_end"] - d["monthly"]) > max(5, 0.01 * max(d["fy_end"], d["monthly"]))]
        if big:
            s += " Larger differences: " + "; ".join(f"MDL {d['mdl']} {an.fmt(d['fy_end'])} (Sept 30) vs {an.fmt(d['monthly'])} (this report)" for d in big[:5]) + "."
        notes[r["monthly_report_month"]] = [s]
    return notes


def mdl_notes(recon):
    """mdl -> sentences for the MDL rows of the monthly dataset: where the Sept 30 count and the first October report differ materially."""
    out = defaultdict(list)
    for r in recon:
        for d in r["differences"]:
            if abs(d["fy_end"] - d["monthly"]) > max(5, 0.01 * max(d["fy_end"], d["monthly"])):
                out[d["mdl"]].append(f"FY{r['fy']} Statistical Analysis prints {an.fmt(d['fy_end'])} pending at Sept 30, {r['fy']}; the {r['monthly_report_month']} monthly report prints {an.fmt(d['monthly'])}.")
    return dict(out)


def cross_references(recs, lookups, monthly, courts):
    n = len(recs)
    known = sum(1 for m in recs if m in lookups["known"])
    in_term = [m for m in recs if m in lookups["terminated"]]
    last_ok = max(r["last_fy"] for r in recs.values())
    closed_ones = [m for m in in_term if recs[m]["last_fy"] < last_ok]
    exact = sum(1 for m in closed_ones if recs[m]["last_fy"] in lookups["terminated"][m])
    within1 = sum(1 for m in closed_ones if any(abs(recs[m]["last_fy"] - y) <= 1 for y in lookups["terminated"][m]))
    court_matched = sum(1 for c in courts.values() if c["court_id"])
    return {
        "mdl_numbers": n, "lens_link_targets_with_known_content": known,
        "in_monthly_pending_history": sum(1 for m in recs if monthly and m in monthly) if monthly else None,
        "in_terminated_history": len(in_term), "last_listed_before_latest_edition_and_in_terminated_history": len(closed_ones),
        "last_fy_equals_termination_year": exact, "last_fy_within_one_year_of_termination_year": within1,
        "districts": len(courts), "districts_matched_to_court_spine": court_matched,
        "districts_unmatched": sorted(k for k, c in courts.items() if not c["court_id"]),
    }


FORMULAS = {
    "fiscal_year": "September 30 year end; FY1992 prints a 15-month period (July 1991 to September 1992), every other edition 12 months",
    "pending": "'Total Pending in Transferee District' of the Circuit-and-District table; grand total over 12 circuits, each validated against the sum of its districts",
    "subjected": "transferred ('Into Dist.') + filed in transferee districts, in the printed period (computed)",
    "roll_forward_residual": "pending(FY) − (pending(FY−1) + subjected(FY) − closed(FY)); computed only for consecutive validated editions; the Panel revises earlier counts, so it is not forced to zero",
    "hhi": "sum over units of (100 × unit pending ÷ total pending)^2, 0–10,000 scale; units are transferee districts (hhi_district_pending) or docket entries (hhi_mdl_pending)",
    "top_n_share_pct": "100 × (sum of the n largest entry-level pending counts) ÷ (sum over all docket entries)",
    "docket_balance": "per entry: total transferred + total filed in the transferee court − closed − remanded = pending (labelled adjustment lines under an entry included); every entry of every validated edition satisfies it",
    "pending_vs_peak_pct": "pending at the last edition listing the MDL ÷ maximum pending at any validated fiscal-year end × 100",
    "fy_first_to_peak": "fiscal years from the first validated edition listing the MDL to the first with its maximum pending count",
}


def build(monthly_hist=None):
    manifest = bh.load_manifest()
    spine = json.loads((LOOKUPS / "court_spine_fd.json").read_text())["rows"]
    lookups = load_lookups()
    lookups["spine"] = spine
    monthly = monthly_from_hist(monthly_hist) if monthly_hist is not None else load_monthly()
    editions = load_editions(manifest)
    for ed in editions:
        ed["retrieved_at"] = manifest[ed["url"]]["retrieved_at"]
    stats_by_fy, prev = {}, None
    for ed in editions:
        if not ed["district_ok"]:
            continue
        stats_by_fy[ed["link_year"]] = fy_stats(ed, prev)
        prev = ed
    points = mdl_points(editions)
    latest_ok = max(e["link_year"] for e in editions if e["docket_ok"])
    d_rows, courts = district_rows(editions, stats_by_fy, spine)
    m_rows, recs = mdl_rows(editions, points, lookups, monthly, latest_ok)
    excluded = [{"fy": e["link_year"], "table": "docket", "reason": exclusion_reason(e, "docket"), "url": e["url"]} for e in editions if not e["docket_ok"]]
    excluded += [{"fy": e["link_year"], "table": "district", "reason": exclusion_reason(e, "district"), "url": e["url"]} for e in editions if not e["district_ok"]]
    rec_rows = reconcile(editions, monthly)
    xref = cross_references(recs, lookups, monthly, courts)
    f_rows = fy_rows(editions, stats_by_fy)
    ov = overview_row(editions, stats_by_fy, recs, lookups, courts, monthly, excluded, rec_rows, xref)
    return {"editions": editions, "stats": stats_by_fy, "recs": recs, "points": points, "rows": f_rows + d_rows + m_rows + [ov], "excluded": excluded, "reconcile": rec_rows, "xref": xref, "courts": courts, "manifest": manifest}


def write(res):
    OUT.mkdir(parents=True, exist_ok=True)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    eds = res["editions"]
    inputs = [{"url": e["url"], "path": f"private/acq/jpml_history/{e['path']}", "sha256": e["sha256"]} for e in eds]
    summary = {
        "editions": len(eds), "first_fy": eds[0]["link_year"], "last_fy": eds[-1]["link_year"], "mdl_numbers": len(res["recs"]),
        "docket_editions_validated": sum(1 for e in eds if e["docket_ok"]), "district_editions_validated": sum(1 for e in eds if e["district_ok"]),
        "excluded": res["excluded"], "formulas": FORMULAS, "source": STAT_PAGE,
        "not_in": "mdl_intel_jpml_stats holds the calendar-year summary of Panel activity (motions, tag-alongs, remands, pending MDLs by type); this dataset holds the fiscal-year cumulative summary, the transferee-district table and the per-MDL Summary by Docket",
        "grain": "listing: one row per fiscal-year edition (fy:<YYYY>); district:<key>, mdl:<n> and summary:overview are detail-only",
        "cross_references": res["xref"],
    }
    listing = cw.listing(
        [("year", "Fiscal year"), ("period", "Period"), ("pending", "Pending at Sept 30"), ("mdls", "Docket entries"), ("transferred", "Transferred"), ("direct", "Filed directly"), ("closed", "Closed"), ("top10", "Top-10 share"), ("hhi_district", "District HHI")],
        [("decade", "Decade", {f"{d}s": f"{d}s" for d in sorted({e["link_year"] // 10 * 10 for e in eds})}), ("kind", "Kind", {"fiscal_year": "Fiscal-year edition"})],
    )
    ids = [r["id"] for r in res["rows"]]
    assert len(ids) == len(set(ids)), "duplicate ids"
    (OUT / f"{DS}.json").write_text(json.dumps({"dataset": DS, "label": "JPML fiscal-year statistics: districts, dockets and cumulative actions (FY1992–FY2025)", "listing_block": listing, "summary": summary, "rows": res["rows"], "built_at": built, "inputs": inputs}, separators=(",", ":"), default=list))
    (OUT / "statistics_validation.json").write_text(json.dumps([{"fy": e["link_year"], "url": e["url"], "sha256": e["sha256"], "district_table": {"valid": e["district_ok"], "failed": e["district_check"].get("failed", [])}, "docket_table": {"valid": e["docket_ok"], "entries": len(e["docket"]["rows"]), "checks": e["docket_check"]["checks"], "attribution": e["docket_check"]["attribution"], "orphans": e["docket"]["orphans"], "incomplete": e["docket"]["incomplete"], "duplicates_dropped": e["docket"].get("duplicates_dropped", [])}} for e in eds], indent=1, default=list))
    print(json.dumps({"dataset": DS, "rows": len(res["rows"]), "fy_rows": sum(1 for r in res["rows"] if r["id"].startswith("fy:")), "district_rows": sum(1 for r in res["rows"] if r["id"].startswith("district:")), "mdl_rows": sum(1 for r in res["rows"] if r["id"].startswith("mdl:"))}))


if __name__ == "__main__":
    write(build())
