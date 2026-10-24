"""Wave 1026: JPML statistics as continuing, structured time series (offline builder).

  python3 -I -B scripts/enrichment/jpml_history/build_jpml_series.py

Reads only:
  private/acq/jpml_history/  (wave-1018 acquisition: archive and current monthly reports, statistics-info files;
                              rebuilt in memory by build_jpml_history / build_statistics_extra, unchanged)
  private/acq/jpml_reports/  (wave-1026 acquisition: index pages, the quarterly caseload reports, and older official
                              monthly reports found by site search and fetched directly from jpml.uscourts.gov)
  private/build/jpml_history/lookups/court_spine_fd.json (saved read-only court lookup)
Writes private/build/jpml_reports/<dataset>.json for five new datasets plus validation and inventory files.

Rules: every number is printed in a JPML report or is a formula over printed numbers (series_metrics); a report that
fails its own printed totals is held (listed in jpml_series_index with the failed checks) and contributes nothing;
MDL numbers are matched exactly (no title matching); titles, districts and judges are kept as printed per report;
judge names are never merged or linked to a person profile.
"""
import gzip
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import analytics as an  # noqa: E402
import build_jpml_history as bh  # noqa: E402
import build_statistics_extra as bse  # noqa: E402
import corpus_writer as cw  # noqa: E402
import parse_quarterly as pq  # noqa: E402
import parse_reports as pr  # noqa: E402
import series_metrics as sm  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "jpml_reports"
OUT = ROOT / "private" / "build" / "jpml_reports"
LOOKUPS = ROOT / "private" / "build" / "jpml_history" / "lookups"

DS_SNAP = "jpml_pending_snapshots"
DS_MDL = "jpml_mdl_pending_series"
DS_TRANS = "jpml_transferee_series"
DS_Q = "jpml_quarterly_caseload"
DS_IDX = "jpml_series_index"

JPML = "https://www.jpml.uscourts.gov"
PAGE_CURRENT = f"{JPML}/pending-mdls-0"
PAGE_ARCHIVE = f"{JPML}/pending-mdl-reports-archive"
PAGE_QUARTERLY = f"{JPML}/mdl-quarterly-caseload-summary"
PAGE_STATS = f"{JPML}/statistics-info"
PUBLISHER = "Judicial Panel on Multidistrict Litigation (JPML)"
STANDARD_FILTERS = ["Status: Transferred", "Limited to Active Litigations"]
PENDING_TYPES = ("actions_pending", "district", "circuit")
TYPE_LABEL = {
    "actions_pending": "Distribution of Pending MDL Dockets by Actions Pending",
    "district": "Distribution of Pending MDL Dockets by District",
    "circuit": "Distribution of Pending MDL Dockets by Circuit",
    "mdl_number": "Docket Summary Listing (pending MDLs by MDL number)",
    "mdl_type": "Docket Type Summary (pending MDLs by docket type)",
    "terminated": "Recently terminated MDLs",
}
TERMS = bh.TERMS.replace("were read on 2026-10-18", "were read on 2026-10-18 and again on 2026-10-24 (with mdl-quarterly-caseload-summary)")
FORMULAS = {
    "months_since_transfer": "completed calendar months from the JPML 'Date Transferred' (printed in a Docket Summary Listing or Docket Type Summary) to the report date; Not recorded when no held listing prints the date",
    "months_listed": "completed calendar months from the first to the last report in this series that lists the MDL (left-censored: the series starts with the earliest report held)",
    "peak": "largest 'Actions Now Pending' among the reports listing the MDL; the earliest report holding it is the peak date",
    "pending_change / total_change": "value in a report minus value in the previous report of the same series, only when the MDL is listed in both (otherwise a gap); an increase in 'Total Actions (Historical)' is the number of actions added between the two reports, a decrease means the Panel lowered its historical count",
    "actions_added": "sum of the positive total_change values over the intervals shown",
    "flows": "entered / left = MDL numbers listed only in the later / only in the earlier of two consecutive reports; continuing_total_change = sum over MDLs in both of the change in total actions",
    "hhi": "sum over groups of (100 x group pending / all pending)^2 on the 0-10,000 scale; groups are MDLs, transferee districts or circuits; hhi_counts uses MDL counts",
    "share_pct": "100 x part / whole, stored to 6 decimals and rounded once for display",
    "top_n_share_pct": "100 x (sum of the n largest pending values) / (sum over all MDLs in the report)",
    "judge_pending": "sum of 'Actions Now Pending' over the MDLs that list the judge (an MDL with several judges counts in full for each, flagged shared)",
}

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------ acquisition (wave 1026)

def my_manifest():
    out = {}
    for line in (ACQ / "_manifest.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e.get("status") == 200 and e.get("sha256"):
            out[e["url"]] = e
    return out


def my_bytes(e):
    data = (bh.ACQ / e["reused_from"]).read_bytes() if e.get("reused_from") else gzip.decompress((ACQ / e["path"]).read_bytes())
    if hashlib.sha256(data).hexdigest() != e["sha256"]:
        raise SystemExit(f"sha256 mismatch: {e['url']}")
    return data


def pdftotext_bytes(data: bytes) -> str:
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=data, capture_output=True, check=True).stdout.decode("utf-8", "replace")


def type_of(title, url, filters):
    t = (title or "").lower()
    if "by circuit" in t:
        return "circuit"
    typ = pr.report_type_from_title(title)
    if any("Closed Litigations" in f for f in filters):
        return "terminated"
    if typ:
        return typ
    u = pr.report_type_from_url(url.replace("-By-District", "_By_District"))
    if t.strip() == "distribution of pending mdl dockets" and u == "district":
        return "district"  # older edition title; rows grouped by district as in the later 'by District' report
    if (not t.strip() or t.strip() in ("pending mdl dockets", "mdl report")) and u in ("mdl_number", "mdl_type"):
        return u
    return None


def parse_my_reports(manifest):
    """Parse every wave-1026 report file (quarterly by-circuit and unlisted older monthly reports)."""
    reps = []
    for url, e in sorted(manifest.items()):
        if e.get("page") or e.get("reused_from"):
            continue  # index pages; files reused from the wave-1018 acquisition are parsed by that builder
        text = pdftotext_bytes(my_bytes(e))
        title = pr.report_title(text)
        filters = pr.report_filters(text)
        typ = type_of(title, url, filters)
        rep = {"url": url, "path": f"private/acq/jpml_reports/{e['path']}", "sha256": e["sha256"], "bytes": e["bytes"], "retrieved_at": e["retrieved_at"],
               "listed_on": e.get("listed_on"), "printed_title": title, "type": typ, "report_date": pr.report_date(text),
               "file_date": pr.date_from_filename(url), "filters_printed": filters, "acquisition": "1026"}
        if typ == "circuit":
            parsed = pq.parse_circuit_report(text)
            v = pq.validate_circuit_report(parsed)
            rep["circuits"] = parsed["circuits"]
        elif typ in ("actions_pending", "district"):
            parsed = pr.parse_pending_report(text)
            v = pr.validate_pending(parsed)
        elif typ in ("mdl_type", "mdl_number"):
            parsed = pr.parse_type_report(text, listing=typ == "mdl_number")
            v = pr.validate_type(parsed)
        else:
            parsed, v = None, {"valid": False, "checks": [{"check": "report_type_recognised", "parsed": title, "printed": None, "ok": False}]}
        if not text.strip() or (parsed is not None and not parsed["rows"]):
            v = {**v, "valid": False, "checks": v["checks"] + [{"check": "text_layer_has_rows", "parsed": 0, "printed": None, "ok": False}]}
        if rep["report_date"] is None:
            v = {**v, "valid": False, "checks": v["checks"] + [{"check": "report_date_printed", "parsed": None, "printed": None, "ok": False}]}
        rep.update({"valid": v["valid"], "checks": v["checks"], "warnings": v.get("warnings", []),
                    "printed": parsed["printed"] if parsed else None, "rows": parsed["rows"] if parsed else [],
                    "unparsed": parsed["unparsed"] if parsed else []})
        reps.append(rep)
    return reps


def wave1018_reports(monthly):
    out = []
    for r in monthly["reports"]:
        out.append({**r, "path": f"private/acq/jpml_history/{r['path']}", "acquisition": "1018"})
    return out


# ------------------------------------------------------------------ snapshots

def compact_row(r, circuit=None):
    return {"mdl": r["mdl"], "title": r["title"], "district": r["district"], "district_printed": r["district_printed"],
            "judges": [j["name"] for j in r["judges"]], "judge_titles": [j["title"] for j in r["judges"]],
            "pending": r["pending"], "total": r["total"], **({"circuit": circuit} if circuit else {})}


def cross_check(a, b):
    """Two valid reports of the same date: same MDL set and same pending, total, district and judges per MDL."""
    ra = {r["mdl"]: r for r in a["rows"]}
    rb = {r["mdl"]: r for r in b["rows"]}
    common = set(ra) & set(rb)
    out = {"other_type": b["type"], "other_url": b["url"], "same_mdl_set": set(ra) == set(rb),
           "only_in_primary": sorted(set(ra) - set(rb)), "only_in_other": sorted(set(rb) - set(ra)),
           "pending_differs": sorted(m for m in common if ra[m]["pending"] != rb[m]["pending"]),
           "total_differs": sorted(m for m in common if ra[m]["total"] != rb[m]["total"]),
           "district_differs": sorted(m for m in common if ra[m]["district"] != rb[m]["district"]),
           "judges_differ": sorted(m for m in common if [j["name"] for j in ra[m]["judges"]] != [j["name"] for j in rb[m]["judges"]]),
           "title_differs": sorted(m for m in common if ra[m]["title"] != rb[m]["title"])}
    out["agree"] = out["same_mdl_set"] and not (out["pending_differs"] or out["total_differs"] or out["district_differs"] or out["judges_differ"])
    return out


def assemble(reports):
    """Group valid pending-row reports by printed report date; choose the primary (actions pending, then district,
    then circuit) and cross-check the others of the same date."""
    by_date = defaultdict(list)
    for r in reports:
        if r["type"] in PENDING_TYPES and r["valid"]:
            by_date[r["report_date"]].append(r)
    snaps = []
    rank = {"actions_pending": 0, "district": 1, "circuit": 2}
    for d in sorted(by_date):
        reps = sorted(by_date[d], key=lambda r: (rank[r["type"]], r["url"]))
        primary = reps[0]
        cadence = "quarter_end" if primary["type"] == "circuit" else "monthly"
        circuit_of = {}
        for r in reps:
            if r["type"] == "circuit":
                circuit_of = {row["mdl"]: row["circuit"] for row in r["rows"]}
        snaps.append({"date": d, "cadence": cadence, "primary": primary, "others": reps[1:],
                      "cross_checks": [cross_check(primary, o) for o in reps[1:]],
                      "rows": [compact_row(row, circuit_of.get(row["mdl"])) for row in primary["rows"]]})
    return snaps


def monthly_family(snaps):
    fam = [s for s in snaps if s["cadence"] == "monthly"]
    months = [s["date"][:7] for s in fam]
    dup = sorted({m for m in months if months.count(m) > 1})
    if dup:
        raise SystemExit(f"more than one monthly snapshot in {dup}")
    return fam


# ------------------------------------------------------------------ helpers

def fmt_int(v):
    return "Not recorded" if v is None else f"{v:,}"


def fmt_pct(v, digits=1):
    return "Not recorded" if v is None else f"{v:.{digits}f}%"


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def judge_id(name):
    """Record id for a judge name exactly as printed: readable slug plus the first 8 hex digits of the sha256 of the
    exact printed string, so spellings that differ only in punctuation or case stay separate rows."""
    return f"{slug(name)}-{hashlib.sha256(name.encode('utf-8')).hexdigest()[:8]}"


def split_points(points, keep):
    """Chart points with only the `keep` fields (item.series) and the rest per date (item.detail_by_date), so a chart
    can read the series without the MDL lists."""
    series = [{k: p[k] for k in keep} for p in points]
    detail = {p["date"]: {k: v for k, v in p.items() if k not in keep} for p in points}
    return {"series": series, "detail_by_date": detail}


def letters_key(name):
    """Letters only, lower case: used solely to point a row at other spellings, never to merge rows."""
    return re.sub(r"[^a-z]", "", name.lower())


def report_links(s):
    out = [{"url": s["primary"]["url"], "label": f"{TYPE_LABEL[s['primary']['type']]}, report of {s['date']} (PDF)"}]
    for o in s["others"]:
        out.append({"url": o["url"], "label": f"{TYPE_LABEL[o['type']]}, report of {s['date']} (PDF)"})
    return out


def source_page(rep):
    lo = rep.get("listed_on") or ""
    if lo.startswith("quarterly"):
        return PAGE_QUARTERLY
    if lo == "current" or lo == "pending_current":
        return PAGE_CURRENT
    if lo == "site_search_discovery":
        return PAGE_ARCHIVE
    return PAGE_ARCHIVE


def provenance(rep):
    return {"publisher": PUBLISHER, "document": TYPE_LABEL.get(rep["type"], rep.get("printed_title")), "printed_title": rep.get("printed_title"),
            "period": f"report date {rep['report_date']}", "source_page": source_page(rep), "file_url": rep["url"], "sha256": rep["sha256"],
            "retrieved_at": rep["retrieved_at"], "filters_printed": rep.get("filters_printed"),
            "listed": "linked from the JPML page" if rep.get("listed_on") != "site_search_discovery" else "official file no longer linked from the archive page (the page removes reports after the first year); fetched directly from jpml.uscourts.gov"}


# ------------------------------------------------------------------ dataset 1: snapshots

def snapshot_stats(s, prev):
    rows = s["rows"]
    p = s["primary"]["printed"]
    pend = [r["pending"] for r in rows]
    dist = sm.concentration(rows, "district")
    circ = sm.concentration(rows, "circuit") if s["cadence"] == "quarter_end" else None
    judges = {j for r in rows for j in r["judges"]}
    top = sorted(rows, key=lambda r: (-r["pending"], r["mdl"]))[:10]
    return {
        "date": s["date"], "cadence": s["cadence"], "source_type": s["primary"]["type"], "source_url": s["primary"]["url"],
        "filters_printed": s["primary"]["filters_printed"], "filters_standard": s["primary"]["filters_printed"] == STANDARD_FILTERS,
        "printed": {k: p.get(k) for k in ("dockets", "pending", "total", "districts", "judges")},
        "judge_titles_printed": p.get("judge_titles") or {}, "buckets_pending_printed": p.get("buckets_pending") or [], "buckets_total_printed": p.get("buckets_total") or [],
        "pending_mdls": len(rows), "pending_actions": sum(pend), "total_actions": sum(r["total"] for r in rows),
        "districts_computed": len({r["district"] for r in rows}), "judges_computed": len(judges),
        "top1_share_pct": an.top_n_share(pend, 1), "top5_share_pct": an.top_n_share(pend, 5), "top10_share_pct": an.top_n_share(pend, 10),
        "hhi_mdl": an.hhi(pend), "median_pending": sorted(pend)[len(pend) // 2] if len(pend) % 2 else (sorted(pend)[len(pend) // 2 - 1] + sorted(pend)[len(pend) // 2]) / 2,
        "district": dist, "circuit": circ,
        "top10": [{"mdl": r["mdl"], "title": r["title"], "district": r["district"], "pending": r["pending"]} for r in top],
        "previous": prev["date"] if prev else None,
        "months_since_previous": an.month_diff(prev["date"][:7], s["date"][:7]) if prev else None,
        "flows": sm.flows(prev["rows"] if prev else None, rows),
        "cross_checks": s["cross_checks"],
    }


def snapshot_rows(snaps):
    rows, stats_all = [], []
    fam = monthly_family(snaps)
    prev_of = {s["date"]: (fam[i - 1] if i else None) for i, s in enumerate(fam)}
    qfam = [s for s in snaps if s["cadence"] == "quarter_end"]
    for i, s in enumerate(qfam):
        prev_of[s["date"]] = qfam[i - 1] if i else None
    for s in snaps:
        st = snapshot_stats(s, prev_of[s["date"]])
        stats_all.append(st)
        f = st["flows"]
        d = st["district"]
        adjacent = st["months_since_previous"] == (1 if s["cadence"] == "monthly" else 3)
        badges = ["Quarter-end report" if s["cadence"] == "quarter_end" else "Monthly report"]
        if not st["filters_standard"]:
            badges.append("Report filters differ")
        if any(not c["agree"] for c in st["cross_checks"]):
            badges.append("Same-date reports differ")
        facts = [
            ["Report date (printed)", s["date"]],
            ["Report", TYPE_LABEL[s["primary"]["type"]]],
            ["Report filters (printed)", "; ".join(st["filters_printed"]) or "None printed"],
            ["Pending MDL dockets (printed)", fmt_int(st["printed"]["dockets"])],
            ["Actions now pending (printed)", fmt_int(st["printed"]["pending"])],
            ["Total actions, historical (printed)", fmt_int(st["printed"]["total"])],
            ["Transferee districts / judges (printed)", f"{fmt_int(st['printed']['districts'])} / {fmt_int(st['printed']['judges'])}"],
            ["Top 10 MDLs' share of pending actions (computed)", fmt_pct(st["top10_share_pct"], 2)],
            ["HHI of pending actions across MDLs (computed)", fmt_int(None) if st["hhi_mdl"] is None else f"{st['hhi_mdl']:,.1f}"],
            ["HHI of pending actions across transferee districts (computed)", f"{d['hhi']:,.1f}" if d else "Not recorded"],
            ["Largest transferee district by pending actions (computed)", f"{d['lead']} · {fmt_int(d['lead_value'])} actions in {d['lead_rows']} MDLs ({fmt_pct(d['lead_share_pct'], 2)})" if d else "Not recorded"],
            ["Previous report in this series", f"{st['previous']} ({st['months_since_previous']} calendar month(s) earlier)" if st["previous"] else "None (first report held)"],
            ["MDLs first listed / no longer listed since the previous report", f"{len(f['entered'])} / {len(f['left'])}" if f else "Not recorded"],
            ["Actions added to continuing MDLs since the previous report (change in total actions)", (fmt_int(f["continuing_total_change"]) + ("" if adjacent else f" (over {st['months_since_previous']} months; reports in between are not held)")) if f else "Not recorded"],
            ["Same-date reports cross-checked", "; ".join(f"{TYPE_LABEL[c['other_type']]}: {'agree' if c['agree'] else 'differ'}" for c in st["cross_checks"]) or "None held"],
            ["Source", f"{PUBLISHER}, {TYPE_LABEL[s['primary']['type']]}, report date {s['date']} (sha256 {s['primary']['sha256'][:12]}…, retrieved {s['primary']['retrieved_at']})"],
        ]
        rid = f"report:{s['date']}"
        rows.append(cw.record(
            DS_SNAP, rid, f"Pending MDLs, JPML report of {s['date']}", source_url=s["primary"]["url"],
            cells={"date": s["date"], "cadence": "Quarter end" if s["cadence"] == "quarter_end" else "Monthly", "mdls": fmt_int(st["pending_mdls"]),
                   "pending": fmt_int(st["pending_actions"]), "total": fmt_int(st["total_actions"]), "top10": fmt_pct(st["top10_share_pct"]),
                   "lead_district": f"{d['lead']} ({fmt_pct(d['lead_share_pct'])})" if d else "Not recorded",
                   "added": fmt_int(f["continuing_total_change"]) if f and adjacent else "Not recorded"},
            facts=facts, text=" ".join(r["title"] for r in st["top10"]),
            filters={"cadence": [s["cadence"]], "year": [s["date"][:4]]},
            subtitle=f"{st['pending_mdls']} MDLs · {st['pending_actions']:,} actions pending · {st['total_actions']:,} total actions",
            badges=badges, links=report_links(s) + [{"url": source_page(s["primary"]), "label": "JPML page"}, {"url": "/records/jpml_series_index/series:national.pending_actions.monthly", "label": "Series index"}],
            extra={"kind": "snapshot", "snapshot": st, "provenance": provenance(s["primary"]),
                   "rows": [[r["mdl"], r["pending"], r["total"], r["district"]] for r in sorted(s["rows"], key=lambda r: r["mdl"])],
                   "rows_columns": ["mdl", "pending", "total", "district"]},
        ))
    return rows, stats_all


def overview_snapshots(stats_all, held):
    def point(st):
        d = st["district"] or {}
        f = st["flows"] or {}
        return {"date": st["date"], "mdls": st["pending_mdls"], "pending": st["pending_actions"], "total": st["total_actions"],
                "districts": st["districts_computed"], "judges": st["judges_computed"], "top10_share_pct": st["top10_share_pct"],
                "hhi_mdl": st["hhi_mdl"], "hhi_district": d.get("hhi"), "lead_district": d.get("lead"), "lead_district_share_pct": d.get("lead_share_pct"),
                "top5_district_share_pct": d.get("top5_share_pct"), "previous": st["previous"], "months_since_previous": st["months_since_previous"],
                "entered": len(f.get("entered") or []) if f else None, "left": len(f.get("left") or []) if f else None,
                # flows are shown per month only between reports of consecutive calendar months (or consecutive quarter ends)
                "continuing_total_change": f.get("continuing_total_change") if f and st["months_since_previous"] in ((1,) if st["cadence"] == "monthly" else (3,)) else None,
                "continuing_total_change_any_interval": f.get("continuing_total_change") if f else None,
                "filters_standard": st["filters_standard"], "source_url": st["source_url"]}
    monthly = [point(st) for st in stats_all if st["cadence"] == "monthly"]
    quarterly = [point(st) | {"hhi_circuit": (st["circuit"] or {}).get("hhi")} for st in stats_all if st["cadence"] == "quarter_end"]
    gaps = []
    for a, b in zip(monthly, monthly[1:]):
        k = an.month_diff(a["date"][:7], b["date"][:7])
        if k > 1:
            gaps.append({"after": a["date"], "before": b["date"], "months_missing": k - 1})
    return {"monthly": monthly, "quarter_end": quarterly, "monthly_gaps": gaps, "held_reports": held}


# ------------------------------------------------------------------ dataset 2: per-MDL series

def mdl_rows(snaps, transfer_dates, existing):
    fam = monthly_family(snaps)
    seq = [s["date"] for s in fam]
    latest = seq[-1]
    pts = defaultdict(list)
    qpts = defaultdict(list)
    for s in snaps:
        for r in s["rows"]:
            (pts if s["cadence"] == "monthly" else qpts)[r["mdl"]].append({"date": s["date"], **r, "source_url": s["primary"]["url"]})
    out = []
    for mdl in sorted(set(pts) | set(qpts)):
        p = sorted(pts.get(mdl, []), key=lambda x: x["date"])
        q = sorted(qpts.get(mdl, []), key=lambda x: x["date"])
        allp = p or q
        titles = sm.runs([(x["date"], x["title"]) for x in allp])
        districts = sm.runs([(x["date"], x["district"]) for x in allp])
        judges = sm.runs([(x["date"], " / ".join(x["judges"])) for x in allp])
        title_ix = {t["value"]: i for i, t in enumerate({t["value"]: t for t in titles}.values())}
        title_list = list(title_ix)
        changes = sm.consecutive_changes(p, seq)
        first, last = (p[0]["date"], p[-1]["date"]) if p else (None, None)
        span = [d for d in seq if first and first <= d <= last]
        listed = {x["date"] for x in p}
        absent = [d for d in span if d not in listed]
        pk = sm.peak(p)
        td = transfer_dates.get(mdl)
        latest_pt = allp[-1]
        months_since = sm.whole_months_between(td["date_transferred"], latest_pt["date"]) if td else None
        added = sm.actions_added_sum(changes, adjacent_only=True)
        status = "in_latest_monthly_report" if last == latest else ("listed_in_quarter_end_only" if not p else "not_in_latest_monthly_report")
        series = {
            "mdl": mdl, "status": status, "latest_monthly_report": latest,
            "points": [{"date": x["date"], "pending": x["pending"], "total": x["total"], "district": x["district"], "judges": x["judges"],
                        "t": title_ix[x["title"]]} for x in p],
            "quarter_end_points": [{"date": x["date"], "pending": x["pending"], "total": x["total"], "district": x["district"],
                                    "circuit": x.get("circuit"), "judges": x["judges"], "t": title_ix[x["title"]]} for x in q],
            "titles": title_list, "title_runs": titles, "district_runs": districts, "judge_runs": judges,
            "first_listed": first, "last_listed": last, "reports_listed": len(p), "reports_in_span": len(span), "absent_reports_in_span": absent,
            "peak": pk, "changes": changes, "actions_added": added,
            "months_listed": sm.whole_months_between(first, last),
            "date_transferred": td["date_transferred"] if td else None, "date_transferred_source": td["source_url"] if td else None,
            "months_since_transfer_at_latest_point": months_since,
            "latest": {"date": latest_pt["date"], "pending": latest_pt["pending"], "total": latest_pt["total"], "district": latest_pt["district"], "judges": latest_pt["judges"]},
        }
        title = latest_pt["title"]
        links = [{"url": f"/matters/lens/{mdl}", "label": f"MDL {mdl} case lens"}]
        if str(mdl) in existing["jpml_pending_history_mdls"]:
            links.append({"url": f"/records/jpml_pending_history_mdls/{mdl}", "label": "Monthly-report history 2024-2026 (wave 2026-10-18 build)"})
        if f"mdl:{mdl}" in existing["jpml_statistics_extra"]:
            links.append({"url": f"/records/jpml_statistics_extra/mdl:{mdl}", "label": "Fiscal-year (Sept 30) history"})
        links.append({"url": latest_pt["source_url"], "label": f"JPML report of {latest_pt['date']} (PDF)"})
        facts = [
            ["MDL number", str(mdl)],
            ["Litigation (as printed in the latest report listing it)", title],
            ["Titles printed", " | ".join(f"{t['value']} ({t['from']} to {t['to']}, {t['reports']} reports)" for t in titles)],
            ["Transferee district(s) as printed", "; ".join(f"{t['value']} ({t['from']} to {t['to']})" for t in districts)],
            ["Transferee judge(s) as printed", "; ".join(f"{t['value'] or 'none printed'} ({t['from']} to {t['to']})" for t in judges)],
            ["Reports listing the MDL (monthly series)", f"{len(p)} of {len(span)} held reports between {first} and {last}" if p else "None (quarter-end reports only)"],
            ["Actions now pending, latest report", f"{fmt_int(latest_pt['pending'])} ({latest_pt['date']})"],
            ["Total actions (historical), latest report", f"{fmt_int(latest_pt['total'])} ({latest_pt['date']})"],
            ["Peak pending among held reports", f"{fmt_int(pk['value'])} ({pk['date']})" if pk else "Not recorded"],
            ["Actions added between held reports of consecutive months (sum of increases in total actions)", f"{fmt_int(added['added'])} over {added['intervals']} one-month intervals" + (f"; total lowered in {added['decreases']} intervals ({added['decrease_sum']:,})" if added and added["decreases"] else "") if added else "Not recorded"],
            ["Date transferred (printed in a JPML listing)", td["date_transferred"] if td else "Not recorded"],
            ["Months since transfer at the latest report", fmt_int(months_since)],
            ["Source", f"{PUBLISHER}, pending MDL reports ({len(p) + len(q)} reports)"],
        ]
        out.append(cw.record(
            DS_MDL, f"mdl:{mdl}", title, source_url=latest_pt["source_url"],
            cells={"mdl": str(mdl), "litigation": title, "district": latest_pt["district"], "pending": fmt_int(latest_pt["pending"]),
                   "latest": latest_pt["date"], "peak": fmt_int(pk["value"]) if pk else "Not recorded", "peak_date": pk["date"] if pk else "Not recorded",
                   "first": first or "Not recorded", "reports": str(len(p))},
            facts=facts, text=" ".join(t["value"] for t in titles),
            filters={"status": [status], "district": sorted({x["district"] for x in allp if x["district"]}), "first_year": [first[:4]] if first else []},
            subtitle=f"MDL {mdl} · {latest_pt['district']} · {latest_pt['pending']:,} pending ({latest_pt['date']}) · {len(p)} monthly reports",
            badges=[{"in_latest_monthly_report": "In latest report", "not_in_latest_monthly_report": "Not in latest report", "listed_in_quarter_end_only": "Quarter-end only"}[status]] + (["Title changed"] if len(titles) > 1 and len({t['value'] for t in titles}) > 1 else []),
            links=links, extra={"kind": "mdl", "series": series},
        ))
    return out


# ------------------------------------------------------------------ dataset 3: transferee districts and judges

def transferee_rows(snaps, spine):
    fam = monthly_family(snaps)
    seq = [s["date"] for s in fam]
    dist_pts, judge_pts = defaultdict(list), defaultdict(list)
    for s in fam:
        tot = sum(r["pending"] for r in s["rows"])
        g = defaultdict(list)
        jg = defaultdict(list)
        for r in s["rows"]:
            g[r["district"]].append(r)
            for name, title in zip(r["judges"], r["judge_titles"]):
                jg[name].append((r, title))
        ranked = sorted(g.items(), key=lambda kv: (-sum(x["pending"] for x in kv[1]), kv[0]))
        for rank, (code, rs) in enumerate(ranked, 1):
            pend = sum(x["pending"] for x in rs)
            dist_pts[code].append({"date": s["date"], "mdls": len(rs), "pending": pend, "total": sum(x["total"] for x in rs),
                                   "share_pct": an.share_pct(pend, tot), "rank": rank, "mdl_numbers": sorted(x["mdl"] for x in rs), "source_url": s["primary"]["url"]})
        for name, items in jg.items():
            pend = sum(r["pending"] for r, _ in items)
            judge_pts[name].append({"date": s["date"], "mdls": len(items), "pending": pend, "total": sum(r["total"] for r, _ in items),
                                    "shared_mdls": sorted(r["mdl"] for r, _ in items if len(r["judges"]) > 1),
                                    "mdl_numbers": sorted(r["mdl"] for r, _ in items), "titles": sorted({t for _, t in items}),
                                    "districts": sorted({r["district"] for r, _ in items}), "source_url": s["primary"]["url"]})
    rows = []
    for code in sorted(dist_pts):
        p = dist_pts[code]
        court = an.match_court(code, spine)
        label = court.get("label") or code
        links = ([{"url": f"/courts/{court['court_id']}", "label": court["label"]}] if court.get("court_id") else []) + [{"url": p[-1]["source_url"], "label": f"JPML report of {p[-1]['date']} (PDF)"}]
        pk = sm.peak(p)
        last = p[-1]
        rows.append(cw.record(
            DS_TRANS, f"district:{code}", f"Transferee district {code} ({label})", source_url=last["source_url"],
            cells={"kind": "District", "name": f"{code} ({label})", "mdls": str(last["mdls"]), "pending": fmt_int(last["pending"]),
                   "share": fmt_pct(last["share_pct"]), "latest": last["date"], "reports": str(len(p))},
            facts=[["District code (as printed)", code], ["Court", label], ["Court match", court.get("method") or court.get("status")],
                   ["Reports listing an MDL here", f"{len(p)} of {len(seq)} held monthly reports ({p[0]['date']} to {last['date']})"],
                   ["Latest: MDLs / pending actions / share of all pending", f"{last['mdls']} / {last['pending']:,} / {fmt_pct(last['share_pct'], 2)} ({last['date']})"],
                   ["Peak pending among held reports", f"{fmt_int(pk['value'])} ({pk['date']})"],
                   ["Source", f"{PUBLISHER}, pending MDL reports (MDL rows summed by printed transferee district)"]],
            text=f"{code} {label}", filters={"kind": ["district"]}, subtitle=f"{last['mdls']} MDLs · {last['pending']:,} pending ({last['date']})",
            links=links, extra={"kind": "district", "district": code, "court": court, "peak": pk, **split_points(p, ("date", "mdls", "pending", "total", "share_pct", "rank"))},
        ))
    seen_slugs = {}
    for name in sorted(judge_pts):
        s = judge_id(name)
        if s in seen_slugs:
            raise SystemExit(f"judge id collision: {name!r} and {seen_slugs[s]!r}")
        seen_slugs[s] = name
        p = judge_pts[name]
        last = p[-1]
        pk = sm.peak(p)
        same_letters = sorted(o for o in judge_pts if o != name and letters_key(o) == letters_key(name))
        rows.append(cw.record(
            DS_TRANS, f"judge:{s}", f"Transferee judge {name} (as printed)", source_url=last["source_url"],
            cells={"kind": "Judge", "name": name, "mdls": str(last["mdls"]), "pending": fmt_int(last["pending"]), "share": "—",
                   "latest": last["date"], "reports": str(len(p))},
            facts=[["Name (exactly as printed in the reports)", name], ["Printed titles", ", ".join(sorted({t for x in p for t in x["titles"]}))],
                   ["Districts", ", ".join(sorted({d for x in p for d in x["districts"]}))],
                   ["Reports listing the name", f"{len(p)} of {len(seq)} held monthly reports ({p[0]['date']} to {last['date']})"],
                   ["Latest: MDLs / pending actions in those MDLs", f"{last['mdls']} / {last['pending']:,} ({last['date']})"],
                   ["MDLs shared with another judge (latest)", ", ".join(map(str, last["shared_mdls"])) or "None"],
                   ["Name matching", "None: the printed string is the key; spellings that differ between reports are separate rows and no person profile is linked"],
                   ["Other printed spellings with the same letters (separate rows, not merged)", "; ".join(same_letters) or "None"],
                   ["Source", f"{PUBLISHER}, pending MDL reports (judge cell as printed)"]],
            text=name, filters={"kind": ["judge"]}, subtitle=f"{last['mdls']} MDLs · {last['pending']:,} pending in those MDLs ({last['date']})",
            links=[{"url": last["source_url"], "label": f"JPML report of {last['date']} (PDF)"}],
            extra={"kind": "judge", "judge": name, "same_letters_rows": [f"judge:{judge_id(o)}" for o in same_letters], "peak": pk,
                   **split_points(p, ("date", "mdls", "pending", "total"))},
        ))
    return rows


# ------------------------------------------------------------------ dataset 4: quarterly caseload

def quarterly_rows(reports, snaps):
    qreps = sorted((r for r in reports if r["type"] == "circuit"), key=lambda r: r["report_date"] or "")
    valid = [r for r in qreps if r["valid"]]
    monthly = {s["date"]: s for s in snaps if s["cadence"] == "monthly"}
    rows, circ_pts = [], defaultdict(list)
    for r in valid:
        p = r["printed"]
        tot = p["pending"]
        circuits = []
        for c in r["circuits"]:
            cp = c["printed"]
            item = {"slug": c["slug"], "name": c["label"], **cp, "pending_share_pct": an.share_pct(cp["pending"], tot), "mdl_share_pct": an.share_pct(cp["mdls"], p["dockets"])}
            circuits.append(item)
            circ_pts[(c["slug"], c["label"])].append({"date": r["report_date"], **cp, "pending_share_pct": item["pending_share_pct"], "source_url": r["url"]})
        nearest = min(monthly, key=lambda d: abs((datetime.fromisoformat(d) - datetime.fromisoformat(r["report_date"])).days)) if monthly else None
        near = monthly.get(nearest)
        near_cmp = None
        if near:
            np_ = near["primary"]["printed"]
            near_cmp = {"date": nearest, "days_apart": (datetime.fromisoformat(nearest) - datetime.fromisoformat(r["report_date"])).days,
                        "dockets": np_["dockets"], "pending": np_["pending"], "total": np_["total"],
                        "pending_difference": p["pending"] - np_["pending"], "total_difference": p["total"] - np_["total"], "url": near["primary"]["url"]}
        hhi_c = an.hhi([c["pending"] for c in circuits])
        lead = max(circuits, key=lambda c: (c["pending"], -CIRCUIT_ORDER.index(c["slug"])))
        q = {"date": r["report_date"], "printed": {k: p.get(k) for k in ("dockets", "pending", "total", "districts", "judges")},
             "judge_titles_printed": p.get("judge_titles") or {}, "buckets_pending_printed": p.get("buckets_pending"), "buckets_total_printed": p.get("buckets_total"),
             "circuits": circuits, "hhi_circuit": hhi_c, "lead_circuit": lead["name"], "lead_circuit_share_pct": lead["pending_share_pct"],
             "nearest_monthly_report": near_cmp, "checks": r["checks"], "filters_printed": r["filters_printed"]}
        facts = [["Report date (printed)", r["report_date"]], ["Report", TYPE_LABEL["circuit"]],
                 ["Pending MDL dockets / actions now pending / total actions (printed)", f"{p['dockets']:,} / {p['pending']:,} / {p['total']:,}"],
                 ["Transferee districts / judges (printed)", f"{p['districts']} / {p['judges']}"]]
        facts += [[f"{c['name']}: districts / MDLs / pending / total (printed)", f"{c['districts']} / {c['mdls']} / {c['pending']:,} / {c['total']:,} ({fmt_pct(c['pending_share_pct'], 2)} of pending)"] for c in circuits]
        facts += [["HHI of pending actions across circuits (computed)", f"{hhi_c:,.1f}"],
                  ["Nearest monthly report", f"{near_cmp['date']} ({near_cmp['days_apart']:+d} days): {near_cmp['pending']:,} pending, {near_cmp['total']:,} total; difference {near_cmp['pending_difference']:+,} / {near_cmp['total_difference']:+,} (different snapshot dates, both as printed)" if near_cmp else "None held"],
                  ["Validation", f"{sum(1 for c in r['checks'] if c['ok'])} of {len(r['checks'])} printed-total checks pass"],
                  ["Source", f"{PUBLISHER}, {TYPE_LABEL['circuit']}, report date {r['report_date']} (sha256 {r['sha256'][:12]}…, retrieved {r['retrieved_at']})"]]
        rows.append(cw.record(
            DS_Q, f"quarter:{r['report_date']}", f"MDL quarterly caseload by circuit, {r['report_date']}", source_url=r["url"],
            cells={"date": r["report_date"], "mdls": f"{p['dockets']:,}", "pending": f"{p['pending']:,}", "total": f"{p['total']:,}",
                   "districts": str(p["districts"]), "lead": f"{lead['name']} ({fmt_pct(lead['pending_share_pct'])})"},
            facts=facts, text="quarterly caseload circuit", filters={"kind": ["quarter"], "year": [r["report_date"][:4]]},
            subtitle=f"{p['dockets']} MDLs · {p['pending']:,} pending · {len(circuits)} circuits",
            links=[{"url": r["url"], "label": f"{TYPE_LABEL['circuit']}, {r['report_date']} (PDF)"}, {"url": PAGE_QUARTERLY, "label": "JPML MDL Quarterly Caseload Summary"}],
            extra={"kind": "quarter", "quarter": q, "provenance": provenance(r)},
        ))
    for (cslug, name), p in sorted(circ_pts.items(), key=lambda kv: CIRCUIT_ORDER.index(kv[0][0])):
        last = p[-1]
        rows.append(cw.record(
            DS_Q, f"circuit:{cslug}", f"{name}: pending MDLs at quarter end", source_url=last["source_url"],
            cells={"date": "circuit", "mdls": str(last["mdls"]), "pending": f"{last['pending']:,}", "total": f"{last['total']:,}", "districts": str(last["districts"]), "lead": name},
            facts=[["Circuit", name]] + [[f"{x['date']}: districts / MDLs / pending / total (printed)", f"{x['districts']} / {x['mdls']} / {x['pending']:,} / {x['total']:,} ({fmt_pct(x['pending_share_pct'], 2)} of pending)"] for x in p]
                  + [["Source", f"{PUBLISHER}, {TYPE_LABEL['circuit']} (Circuit Summary lines)"]],
            text=name, filters={"kind": ["circuit"]}, subtitle=f"{last['mdls']} MDLs · {last['pending']:,} pending ({last['date']})",
            links=[{"url": PAGE_QUARTERLY, "label": "JPML MDL Quarterly Caseload Summary"}],
            extra={"kind": "circuit", "circuit": {"slug": cslug, "name": name}, "series": p},
        ))
    held = [{"url": r["url"], "date": r["report_date"], "failed": [c for c in r["checks"] if not c["ok"]]} for r in qreps if not r["valid"]]
    return rows, held


CIRCUIT_ORDER = ["dc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "fed"]


# ------------------------------------------------------------------ dataset 5: series index and report inventory

def transfer_dates(monthly_1018, reports):
    """mdl -> {date_transferred, source_url} from valid Docket Summary Listings / Docket Type Summaries (the latest
    listing printing a transfer date wins; a conflicting earlier date is recorded)."""
    out = {}
    listings = [r for r in reports if r["type"] in ("mdl_number", "mdl_type") and r["valid"]]
    for r in sorted(listings, key=lambda r: r["report_date"]):
        for row in r["rows"]:
            if row.get("date_transferred"):
                prev = out.get(row["mdl"])
                out[row["mdl"]] = {"date_transferred": row["date_transferred"], "source_url": r["url"], "listing_date": r["report_date"],
                                   "conflicts": (prev["conflicts"] + ([prev["date_transferred"]] if prev["date_transferred"] != row["date_transferred"] else [])) if prev else []}
    return out


def inventory_rows(all_reports, statistics_files, primary_urls, cross_urls):
    rows = []
    for r in sorted(all_reports, key=lambda r: (r["report_date"] or "", r["type"] or "", r["url"])):
        if r["type"] in PENDING_TYPES:
            status = "parsed_primary" if r["url"] in primary_urls else ("parsed_cross_check" if r["url"] in cross_urls else "held")
            ds = DS_Q if r["type"] == "circuit" else DS_SNAP
        elif r["type"] in ("mdl_number", "mdl_type"):
            status = "parsed_listing" if r["valid"] else "held"
            ds = "jpml_pending_history_mdls" if r["acquisition"] == "1018" else DS_MDL
        elif r["type"] == "terminated":
            status = "parsed_listing" if r["valid"] else "held"
            ds = "jpml_pending_history_mdls"
        else:
            status, ds = "held", None
        failed = [c for c in r["checks"] if not c.get("ok")]
        rows.append({"url": r["url"], "type": r["type"], "printed_title": r.get("printed_title"), "report_date": r["report_date"], "sha256": r["sha256"],
                     "retrieved_at": r["retrieved_at"], "path": r["path"], "listed_on": r.get("listed_on"), "status": status, "dataset": ds,
                     "checks_passed": sum(1 for c in r["checks"] if c.get("ok")), "checks": len(r["checks"]),
                     "failed_checks": failed[:6], "unparsed_lines": len(r.get("unparsed") or []), "filters_printed": r.get("filters_printed")})
    for f in statistics_files:
        rows.append(f)
    return rows


def index_rows(snap_over, quarterly, fy, inv, mdl_count, trans_counts, held):
    m = snap_over["monthly"]
    qe = snap_over["quarter_end"]
    fy_points = [{"date": f"{yr}-09-30", "value": fy["stats"][yr]["pending"]} for yr in sorted(fy["stats"])]
    series = [
        ("national.pending_actions.monthly", "Actions now pending in all pending MDLs, national, per monthly report", "actions", "monthly report (mid-month to 2023, first business day from 2024)",
         DS_SNAP, "summary:overview", "item.overview.monthly[].pending", [{"date": x["date"], "value": x["pending"]} for x in m]),
        ("national.pending_mdls.monthly", "Pending MDL dockets, national, per monthly report", "MDL dockets", "monthly report",
         DS_SNAP, "summary:overview", "item.overview.monthly[].mdls", [{"date": x["date"], "value": x["mdls"]} for x in m]),
        ("national.total_actions.monthly", "Total actions (historical) in pending MDLs, national, per monthly report", "actions", "monthly report",
         DS_SNAP, "summary:overview", "item.overview.monthly[].total", [{"date": x["date"], "value": x["total"]} for x in m]),
        ("national.district_hhi.monthly", "Concentration of pending actions across transferee districts (HHI), per monthly report", "HHI (0-10,000)", "monthly report",
         DS_SNAP, "summary:overview", "item.overview.monthly[].hhi_district", [{"date": x["date"], "value": x["hhi_district"]} for x in m]),
        ("national.actions_added.monthly", "Actions added to continuing MDLs between consecutive monthly reports (change in total actions)", "actions", "interval between held monthly reports",
         DS_SNAP, "summary:overview", "item.overview.monthly[].continuing_total_change", [{"date": x["date"], "value": x["continuing_total_change"]} for x in m]),
        ("national.pending_actions.quarter_end", "Actions now pending, national, at quarter end (MDL Quarterly Caseload Summary)", "actions", "quarter end",
         DS_SNAP, "summary:overview", "item.overview.quarter_end[].pending", [{"date": x["date"], "value": x["pending"]} for x in qe]),
        ("circuit.pending_actions.quarter_end", "Actions now pending by circuit at quarter end", "actions", "quarter end", DS_Q, "circuit:<slug>", "item.series[].pending", None),
        ("mdl.pending_actions.monthly", "Actions now pending per MDL, per monthly report", "actions", "monthly report", DS_MDL, "mdl:<number>", "item.series.points[].pending", None),
        ("district.pending_actions.monthly", "Actions now pending per transferee district, per monthly report", "actions", "monthly report", DS_TRANS, "district:<code>", "item.series[].pending", None),
        ("judge.pending_actions.monthly", "Actions now pending in the MDLs listing a transferee judge (name as printed), per monthly report", "actions", "monthly report", DS_TRANS, "judge:<printed-name-slug>", "item.series[].pending", None),
        ("national.pending_actions.fiscal_year", "Actions pending at fiscal-year end (Sept 30), national, FY1992-FY2025", "actions", "fiscal year (Sept 30)",
         "jpml_statistics_extra", "fy:<YYYY>", "item.fy_stats.pending", fy_points),
        ("district.pending_actions.fiscal_year", "Actions pending per transferee district at fiscal-year end, FY1992-FY2025", "actions", "fiscal year", "jpml_statistics_extra", "district:<slug>", "item.series", None),
        ("mdl.pending_actions.fiscal_year", "Actions pending per MDL at fiscal-year end (Summary by Docket)", "actions", "fiscal year", "jpml_statistics_extra", "mdl:<number>", "item.fy_history.series", None),
        ("national.activity.calendar_year", "Panel activity per calendar year (motions, hearings, tag-alongs, remands), 1973-2025", "counts", "calendar year", "mdl_intel_jpml_stats", "year:<YYYY>", "item.stats", None),
        ("mdl.terminated", "Terminated MDLs 1968-2025 (cumulative terminated litigations report)", "MDLs", "termination year", "mdl_terminated_history", "<mdl>:<district code>", "item.history", None),
        ("national.pending_actions.monthly_archive_2024", "Monthly archive 2024-10 to 2026-10 with docket types and concentration (earlier build)", "actions", "monthly report", "jpml_pending_history_months", "YYYY-MM", "item.month_stats", None),
    ]
    rows = []
    for sid, label, unit, period, ds, rid, path, points in series:
        pts = [p for p in (points or []) if p["value"] is not None]
        cover = f"{pts[0]['date']} to {pts[-1]['date']}, {len(pts)} points" if pts else "see the dataset"
        rows.append(cw.record(
            DS_IDX, f"series:{sid}", label, source_url=PAGE_ARCHIVE if "monthly" in sid else (PAGE_QUARTERLY if "quarter" in sid else PAGE_STATS),
            cells={"kind": "Series", "name": label, "unit": unit, "period": period, "dataset": ds, "coverage": cover},
            facts=[["Series id", sid], ["What is counted", label], ["Unit", unit], ["Period", period], ["Dataset", ds], ["Record id", rid], ["Field", path], ["Coverage", cover],
                   ["Gaps", "; ".join(f"{g['months_missing']} month(s) between {g['after']} and {g['before']}" for g in snap_over["monthly_gaps"]) if "monthly" in sid and ds == DS_SNAP else "see the dataset"],
                   ["Publisher", PUBLISHER]],
            text=f"{sid} {label}", filters={"kind": ["series"], "dataset": [ds]}, subtitle=f"{unit} · {period} · {ds}",
            links=[{"url": f"/records/{ds}/{rid}" if "<" not in rid else f"/sources/catalog?dataset={ds}", "label": f"{ds} · {rid}"}],
            extra={"kind": "series", "series_id": sid, "dataset": ds, "record": rid, "field": path, "unit": unit, "period": period, "points": pts},
        ))
    for f in inv:
        rid = f"report:{f['sha256'][:16]}"
        st = {"parsed_primary": "Parsed (primary for its date)", "parsed_cross_check": "Parsed (cross-check)", "parsed_listing": "Parsed (listing)",
              "parsed_elsewhere": "Parsed in another dataset", "held": "Held (fails its printed totals or unreadable)", "not_parsed": "Not parsed"}[f["status"]]
        rows.append(cw.record(
            DS_IDX, rid, f"{f.get('printed_title') or f.get('link_text') or f['url'].rsplit('/', 1)[-1]} ({f.get('report_date') or f.get('period') or 'undated'})", source_url=f["url"],
            cells={"kind": "Report", "name": f["url"].rsplit("/", 1)[-1], "unit": f.get("type") or "", "period": f.get("report_date") or f.get("period") or "", "dataset": f.get("dataset") or "—", "coverage": st},
            facts=[["File", f["url"]], ["Type", f.get("type") or "Not recognised"], ["Report date / period (printed)", f.get("report_date") or f.get("period") or "Not printed"],
                   ["Status", st], ["Dataset", f.get("dataset") or "None"], ["Checks passed", f"{f.get('checks_passed', 0)} of {f.get('checks', 0)}"],
                   ["Failed checks", "; ".join(f"{c.get('check')} (parsed {c.get('parsed')}, printed {c.get('printed')})" for c in f.get("failed_checks") or []) or "None"],
                   ["Reason", f.get("reason") or ""], ["sha256", f["sha256"]], ["Retrieved", f["retrieved_at"]],
                   ["Listed on", f.get("listed_on") or ""], ["Publisher", PUBLISHER]],
            text=f["url"], filters={"kind": ["report"], "status": [f["status"]], "type": [f.get("type") or "unknown"]},
            subtitle=f"{f.get('type') or 'file'} · {st}", links=[{"url": f["url"], "label": "Official file"}],
            extra={"kind": "report", "report": f},
        ))
    return rows


def statistics_inventory(monthly, fy):
    """Inventory entries for the statistics-info files (wave-1018 acquisition), with where each is parsed."""
    man = monthly["manifest"]
    eds = {e["url"]: e for e in fy["editions"]}
    out = []
    for url, e in sorted(man.items()):
        if not e["path"].startswith("statistics/"):
            continue
        st_type = e.get("stat_type") or ""
        if url in eds:
            ed = eds[url]
            ok = ed["district_ok"] and ed["docket_ok"]
            status, ds = ("parsed_elsewhere", "jpml_statistics_extra")
            reason = "Circuit-and-District table and Summary by Docket validated" if ok else ("District table validated; Summary by Docket held: " + bse.exclusion_reason(ed, "docket") if ed["district_ok"] else "held")
            period = f"FY{ed['link_year']}"
        elif st_type == "Calendar Year":
            status, ds, reason = "parsed_elsewhere", "mdl_intel_jpml_stats", "Calendar Year Summary of JPML Activity; values from the latest edition, earlier editions as revisions"
            period = e.get("link_text") or ""
        elif st_type == "Cumulative Terminated":
            latest = "2025" in (e.get("link_text") or "")
            status, ds = ("parsed_elsewhere", "mdl_terminated_history") if latest else ("not_parsed", None)
            reason = "Latest edition (cumulative: it lists every MDL terminated since 1968)" if latest else "Superseded cumulative edition: every MDL it lists is in the FY2025 edition parsed into mdl_terminated_history"
            period = e.get("link_text") or ""
        elif st_type == "Legacy":
            status, ds = "not_parsed", None
            reason = "Scanned annual reports (1968-1991) with an OCR text layer that misreads characters (e.g. 'trapsfer'); mostly narrative; tables cannot be checked against printed totals from that layer, so no figure is taken"
            period = e.get("link_text") or ""
        else:
            status, ds, reason, period = "not_parsed", None, "type not recognised", e.get("link_text") or ""
        out.append({"url": url, "type": f"statistics:{st_type or 'unknown'}", "printed_title": e.get("link_text"), "report_date": None, "period": period,
                    "sha256": e["sha256"], "retrieved_at": e["retrieved_at"], "path": f"private/acq/jpml_history/{e['path']}", "listed_on": PAGE_STATS,
                    "status": status, "dataset": ds, "reason": reason, "checks_passed": 0, "checks": 0, "failed_checks": []})
    return out


# ------------------------------------------------------------------ main

def existing_ids(monthly, fy):
    return {"jpml_pending_history_mdls": {r["id"] for r in monthly["mdl_rows"]}, "jpml_statistics_extra": {r["id"] for r in fy["rows"]}}


def build():
    monthly = bh.build()
    fy = bse.build(monthly_hist=monthly["hist"])
    spine = json.loads((LOOKUPS / "court_spine_fd.json").read_text())["rows"]
    man = my_manifest()
    mine = parse_my_reports(man)
    reports = wave1018_reports(monthly) + mine
    snaps = assemble(reports)
    primary_urls = {s["primary"]["url"] for s in snaps}
    cross_urls = {o["url"] for s in snaps for o in s["others"]}
    held = [{"url": r["url"], "type": r["type"], "date": r["report_date"], "failed": [c for c in r["checks"] if not c.get("ok")][:6], "unparsed": len(r["unparsed"])}
            for r in reports if not r["valid"]]
    snap_rows, stats_all = snapshot_rows(snaps)
    over = overview_snapshots(stats_all, held)
    td = transfer_dates(monthly, reports)
    m_rows = mdl_rows(snaps, td, existing_ids(monthly, fy))
    t_rows = transferee_rows(snaps, spine)
    q_rows, q_held = quarterly_rows(reports, snaps)
    inv = inventory_rows(reports, statistics_inventory(monthly, fy), primary_urls, cross_urls)
    snap_rows.append(overview_row(over, snaps, stats_all))
    idx_rows = index_rows(over, q_rows, fy, inv, len(m_rows), None, held)
    return {"monthly": monthly, "fy": fy, "reports": reports, "snaps": snaps, "over": over, "held": held, "inventory": inv,
            "datasets": {DS_SNAP: snap_rows, DS_MDL: m_rows, DS_TRANS: t_rows, DS_Q: q_rows, DS_IDX: idx_rows}, "transfer_dates": td}


def overview_row(over, snaps, stats_all):
    m = over["monthly"]
    first, last = m[0], m[-1]
    return cw.record(
        DS_SNAP, "summary:overview", "JPML pending MDLs: national series across every held report", source_url=PAGE_ARCHIVE,
        cells={"date": "summary", "cadence": "—", "mdls": fmt_int(last["mdls"]), "pending": fmt_int(last["pending"]), "total": fmt_int(last["total"]),
               "top10": fmt_pct(last["top10_share_pct"]), "lead_district": last["lead_district"] or "—", "added": "—"},
        facts=[["Monthly reports held and validated", f"{len(m)} ({first['date']} to {last['date']})"],
               ["Quarter-end reports held and validated", str(len(over["quarter_end"]))],
               ["Gaps in the monthly series", f"{len(over['monthly_gaps'])} (months with no held report; shown as gaps)"],
               ["Reports held back (fail printed totals or unreadable text layer)", str(len(over["held_reports"]))],
               ["Pending actions, first → latest monthly report", f"{first['pending']:,} ({first['date']}) → {last['pending']:,} ({last['date']})"],
               ["Pending MDLs, first → latest monthly report", f"{first['mdls']} → {last['mdls']}"],
               ["Source", f"{PUBLISHER}: pending MDL reports archive, current-month page, MDL Quarterly Caseload Summary, and older official monthly reports still served by jpml.uscourts.gov"]],
        text="overview", filters={"cadence": ["summary"]}, subtitle=f"{len(m)} monthly reports · {first['date']} to {last['date']}",
        links=[{"url": PAGE_ARCHIVE, "label": "JPML pending MDL reports archive"}, {"url": PAGE_CURRENT, "label": "JPML pending MDLs"}, {"url": PAGE_QUARTERLY, "label": "JPML MDL Quarterly Caseload Summary"},
               {"url": "/records/jpml_series_index/series:national.pending_actions.monthly", "label": "Series index"}],
        extra={"kind": "summary", "overview": over, "formulas": FORMULAS},
    )


LISTINGS = {
    DS_SNAP: ("JPML pending MDLs: national snapshot per report (2012–2026)",
              [("date", "Report date"), ("cadence", "Cadence"), ("mdls", "MDLs"), ("pending", "Pending actions"), ("total", "Total actions"), ("top10", "Top-10 share"), ("lead_district", "Largest district"), ("added", "Actions added")],
              [("cadence", "Cadence", {"monthly": "Monthly report", "quarter_end": "Quarter-end report"})]),
    DS_MDL: ("JPML pending MDLs: per-MDL series across every held report",
             [("mdl", "MDL"), ("litigation", "Litigation"), ("district", "District"), ("pending", "Pending"), ("latest", "Latest report"), ("peak", "Peak"), ("peak_date", "Peak date"), ("first", "First listed"), ("reports", "Reports")],
             [("status", "Status", {"in_latest_monthly_report": "In latest report", "not_in_latest_monthly_report": "Not in latest report", "listed_in_quarter_end_only": "Quarter-end only"})]),
    DS_TRANS: ("JPML transferee districts and judges over time",
               [("kind", "Kind"), ("name", "Name"), ("mdls", "MDLs"), ("pending", "Pending"), ("share", "Share"), ("latest", "Latest report"), ("reports", "Reports")],
               [("kind", "Kind", {"district": "District", "judge": "Judge"})]),
    DS_Q: ("JPML MDL quarterly caseload summary by circuit (2026)",
           [("date", "Quarter end"), ("mdls", "MDLs"), ("pending", "Pending actions"), ("total", "Total actions"), ("districts", "Districts"), ("lead", "Largest circuit")],
           [("kind", "Kind", {"quarter": "Quarter", "circuit": "Circuit"})]),
    DS_IDX: ("JPML statistics: series index and report inventory",
             [("kind", "Kind"), ("name", "Name"), ("unit", "Unit / type"), ("period", "Period"), ("dataset", "Dataset"), ("coverage", "Coverage / status")],
             [("kind", "Kind", {"series": "Series", "report": "Report file"}), ("status", "Status", {"parsed_primary": "Parsed (primary)", "parsed_cross_check": "Parsed (cross-check)", "parsed_listing": "Parsed (listing)", "parsed_elsewhere": "Parsed in another dataset", "held": "Held", "not_parsed": "Not parsed"})]),
}


def write(res):
    OUT.mkdir(parents=True, exist_ok=True)
    inputs = sorted({(r["url"], r["path"], r["sha256"]) for r in res["reports"]})
    inputs = [{"url": u, "path": p, "sha256": s} for u, p, s in inputs]
    for ds, rows in res["datasets"].items():
        label, cols, filters = LISTINGS[ds]
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), f"duplicate ids in {ds}"
        summary = {"publisher": PUBLISHER, "terms": TERMS, "formulas": FORMULAS, "rows": len(rows), "source_pages": [PAGE_CURRENT, PAGE_ARCHIVE, PAGE_QUARTERLY, PAGE_STATS],
                   "built_by": "scripts/enrichment/jpml_history/build_jpml_series.py", "held_reports": len(res["held"]),
                   "monthly_reports": len(res["over"]["monthly"]), "first_report": res["over"]["monthly"][0]["date"], "latest_report": res["over"]["monthly"][-1]["date"]}
        body = {"dataset": ds, "label": label, "listing_block": cw.listing(cols, filters), "summary": summary, "rows": rows, "built_at": NOW, "inputs": inputs}
        (OUT / f"{ds}.json").write_text(json.dumps(body, separators=(",", ":"), default=list))
        print(json.dumps({"dataset": ds, "rows": len(rows), "bytes": (OUT / f"{ds}.json").stat().st_size}))
    (OUT / "validation.json").write_text(json.dumps([{k: r.get(k) for k in ("url", "type", "report_date", "valid", "checks", "warnings", "unparsed", "filters_printed")} for r in res["reports"]], indent=1, default=list))
    (OUT / "report_inventory.json").write_text(json.dumps(res["inventory"], indent=1, default=list))
    (OUT / "cross_checks.json").write_text(json.dumps([{"date": s["date"], "primary": s["primary"]["url"], "checks": s["cross_checks"]} for s in res["snaps"]], indent=1))


if __name__ == "__main__":
    write(build())
