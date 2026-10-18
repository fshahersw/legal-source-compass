"""mdl_intel_jpml_stats: JPML Calendar Year Statistics, 1973-2025, from every published edition (2006-2025).

Grain: one record per calendar year (`year:YYYY`) plus `summary:overview` with chart-ready series.
Values come from the latest edition (CY 2025) summary table; each year also records its value in every other
edition that prints it, and fields that differ are listed as revisions. Category splits / granted-denied / hearing
matters come from chart labels (editions 2012+) or text tables (editions 2006-2014), latest edition first.
"""
import re
import statistics

import charts
import parse_jpml as pj
from common import ACQ, STATS_PAGE, TODAY, cw, fmt, manifest, page_count, pct, pdftotext

DATASET = "mdl_intel_jpml_stats"


def editions():
    out = {}
    for f in manifest()["files"]:
        if f["page"] != "statistics":
            continue
        m = re.fullmatch(r"Calendar Year (\d{4})", f["text"].strip())  # link text on the JPML statistics page
        if not m:
            continue
        ed = int(m.group(1))
        path = ACQ / f["file"]
        text = pdftotext(path)
        last = pdftotext(path, layout=False, first=page_count(path), last=page_count(path))
        out[ed] = {
            "edition": ed, "url": f["url"], "sha256": f["sha256"], "file": f["file"],
            "summary": pj.parse_summary_table(text), "categories": pj.parse_category_table(text),
            "sessions": pj.parse_session_table(text), "types": pj.parse_type_distribution(last) if ed >= 2012 else {},
            "charts": charts.extract(path) if ed >= 2012 else {},
        }
    return out


def latest_with(eds, year, getter):
    for ed in sorted(eds, reverse=True):
        v = getter(eds[ed])
        if v and year in v:
            return ed, v[year]
    return None, None


def build():
    eds = editions()
    latest_ed = max(eds)
    base = eds[latest_ed]["summary"]
    rows, series = [], []
    type_vectors = {}
    for ed, e in eds.items():
        if e["types"]:
            type_vectors[ed] = tuple(sorted(e["types"].items()))
    for year in sorted(base):
        cur = base[year]
        values = {k: cur[k] for k in pj.SUMMARY_FIELDS}
        printed = cur["printed"]
        other = {ed: e["summary"][year] for ed, e in eds.items() if ed != latest_ed and year in e["summary"]}
        revisions = []
        for field in pj.SUMMARY_FIELDS:
            diffs = sorted({(ed, v[field]) for ed, v in other.items() if v[field] != values[field]})
            if diffs:
                revisions.append({"field": field, "latest": values[field], "other_editions": [{"edition": ed, "value": val} for ed, val in diffs]})
        cat_ed, cat = latest_with(eds, year, lambda e: e["charts"].get("category"))
        cat_source = "chart"
        if cat is None:
            cat_ed, cat = latest_with(eds, year, lambda e: e["categories"])
            cat_source = "table"
        if cat:
            cat = {k: cat.get(k, 0) for k in ("denied", "moot", "withdrawn", "closed", "stricken")}
        gd_ed, gd = latest_with(eds, year, lambda e: e["charts"].get("granted_denied"))
        hm_ed, hm = latest_with(eds, year, lambda e: e["charts"].get("hearing"))
        sess_ed, sessions = None, [s for s in eds.get(year, {}).get("sessions", []) if s["year"] == year]
        if sessions:
            sess_ed = year
        if hm is None and sessions:
            hm = {"matters_set": sum(s["matters_set"] for s in sessions), "matters_decided": sum(s["matters_considered"] for s in sessions)}
            hm_ed = year
        cat_total = sum(cat.values()) if cat else None
        cat_consistent = cat_total == values["motions_denied_moot_withdrawn"] if cat else None
        denied_strict = cat["denied"] if cat else None
        granted = values["motions_granted"]
        terminated = granted + values["motions_denied_moot_withdrawn"]
        rate_all = round(100 * granted / terminated, 1) if terminated else None
        rate_merits = round(100 * granted / (granted + denied_strict), 1) if denied_strict is not None and (granted + denied_strict) else None
        actions_per_grant = round(values["actions_in_granted"] / granted, 1) if granted else None
        gd_check = None
        if gd:
            gd_check = {"granted_matches_table": gd["granted"] == granted, "denied_matches_category": (cat is None) or gd["denied"] == cat["denied"]}
        types = eds.get(year, {}).get("types") or None
        types_flag = None
        if types and any(ed != year and v == type_vectors.get(year) for ed, v in type_vectors.items()):
            dup = [ed for ed, v in type_vectors.items() if ed != year and v == type_vectors.get(year)]
            types_flag = f"Identical type distribution printed in the CY {', '.join(map(str, dup))} edition"
        rec = {
            "year": year, **values, "printed": printed, "edition": latest_ed, "revisions": revisions,
            "categories": cat, "categories_edition": cat_ed, "categories_source": cat_source if cat else None, "categories_total": cat_total,
            "categories_consistent": cat_consistent, "granted_denied_chart": gd, "granted_denied_edition": gd_ed, "granted_denied_check": gd_check,
            "hearing_matters": hm, "hearing_matters_edition": hm_ed, "sessions": sessions, "sessions_edition": sess_ed,
            "pending_by_type": types, "pending_by_type_as_of": f"{year}-12-31" if types else None, "pending_by_type_flag": types_flag,
            "pending_mdls_total": sum(types.values()) if types else None,
            "grant_rate_all_pct": rate_all, "grant_rate_merits_pct": rate_merits, "actions_per_granted_motion": actions_per_grant,
        }
        series.append(rec)
        src = eds[latest_ed]["url"]
        facts = [["Calendar year", str(year)]] + [[pj.SUMMARY_LABELS[k], fmt(values[k])] for k in pj.SUMMARY_FIELDS] + [
            ["Grant share of terminated motions", pct(rate_all)],
            ["Grant share of motions decided on the merits (granted ÷ granted + denied)", pct(rate_merits)],
            ["Terminations by category", ", ".join(f"{k} {v}" for k, v in cat.items()) + f" (CY {cat_ed} edition, {cat_source})" if cat else "Not recorded"],
            ["Category total equals summary table", "Yes" if cat_consistent else ("No — source figures differ" if cat_consistent is False else "Not recorded")],
            ["Hearing matters set / decided", f"{hm['matters_set']} / {hm['matters_decided']} (CY {hm_ed} edition)" if hm else "Not recorded"],
            ["Pending MDLs by type (Dec 31)", f"{sum(types.values())} MDLs" if types else "Not recorded"],
            ["Revised in other editions", "; ".join(f"{r['field']}: " + ", ".join(f"CY{o['edition']}={o['value']}" for o in r["other_editions"]) for r in revisions) or "No differences found"],
            ["Source", f"JPML Calendar Year Statistics, CY {latest_ed} edition — Calendar Year Summary of JPML Activity (retrieved {TODAY})"],
        ]
        rows.append(cw.record(
            DATASET, f"year:{year}", f"JPML activity, calendar year {year}", source_url=src,
            subtitle=f"{fmt(values['motions_filed'])} motions filed · {fmt(granted)} granted · {fmt(values['tag_along_transfers'])} tag-along transfers",
            cells={"year": str(year), "filed": fmt(values["motions_filed"]), "granted": fmt(granted), "denied": fmt(values["motions_denied_moot_withdrawn"]), "rate": pct(rate_all), "tagalongs": fmt(values["tag_along_transfers"]), "remands": fmt(values["remands"])},
            facts=facts, text=f"JPML calendar year statistics {year} centralization motions",
            filters={"kind": ["year"], "decade": [f"{year // 10 * 10}s"], "date": f"{year}-12-31"},
            links=[{"url": src, "label": f"JPML Calendar Year Statistics CY {latest_ed} (PDF)"}, {"url": STATS_PAGE, "label": "JPML statistics page"}],
            extra={"kind": "year", "stats": rec},
        ))
    editions_meta = [{"edition": ed, "url": e["url"], "sha256": e["sha256"], "summary_years": len(e["summary"]), "has_category_chart": bool(e["charts"].get("category")), "has_types": bool(e["types"])} for ed, e in sorted(eds.items())]
    recent = [r for r in series if r["year"] >= 2016]
    overview = {
        "latest_edition": latest_ed, "first_year": series[0]["year"], "last_year": series[-1]["year"], "editions": editions_meta,
        "series": [{k: r[k] for k in ("year", "hearings", "orders_issued", "motions_filed", "motions_granted", "actions_in_granted", "motions_denied_moot_withdrawn", "actions_in_denied", "tag_along_transfers", "remands", "grant_rate_all_pct", "grant_rate_merits_pct", "actions_per_granted_motion")} | {"categories": r["categories"], "categories_consistent": r["categories_consistent"], "hearing_matters": r["hearing_matters"], "pending_mdls_total": r["pending_mdls_total"], "revised_fields": [x["field"] for x in r["revisions"]]} for r in series],
        "types_by_year": [{"year": r["year"], "types": r["pending_by_type"], "flag": r["pending_by_type_flag"]} for r in series if r["pending_by_type"]],
        "sessions": [s | {"edition": r["sessions_edition"]} for r in series for s in r["sessions"]],
        "ten_year": {
            "filed": sum(r["motions_filed"] for r in recent), "granted": sum(r["motions_granted"] for r in recent),
            "denied_moot_withdrawn": sum(r["motions_denied_moot_withdrawn"] for r in recent),
            "median_grant_rate_all_pct": round(statistics.median(r["grant_rate_all_pct"] for r in recent), 2) if recent else None,
        },
        "inconsistencies": [{"year": r["year"], "categories_total": r["categories_total"], "summary_total": r["motions_denied_moot_withdrawn"]} for r in series if r["categories_consistent"] is False]
        + [{"year": r["year"], "note": "Granted/denied chart disagrees with category chart", **(r["granted_denied_chart"] or {})} for r in series if r["granted_denied_check"] and not r["granted_denied_check"]["denied_matches_category"]],
        "retrieved": TODAY,
        "unparsed_summary_editions": [e["edition"] for e in editions_meta if e["summary_years"] < 5],
        "unparsed_note": "Editions whose summary table is not extractable as text (chart/image pages) are not used for the revision cross-check; revisions they may contain are not listed.",
    }
    rows.append(cw.record(
        DATASET, "summary:overview", "JPML centralization activity, 1973–2025", source_url=eds[latest_ed]["url"],
        subtitle=f"{len(series)} calendar years · {len(eds)} published editions cross-checked",
        cells={"year": "All", "filed": fmt(sum(r["motions_filed"] for r in series)), "granted": fmt(sum(r["motions_granted"] for r in series)), "denied": fmt(sum(r["motions_denied_moot_withdrawn"] for r in series)), "rate": "—", "tagalongs": fmt(sum(r["tag_along_transfers"] for r in series)), "remands": fmt(sum(r["remands"] for r in series))},
        facts=[["Years", f"{series[0]['year']}–{series[-1]['year']}"], ["Editions parsed", ", ".join(str(e) for e in sorted(eds))], ["Source", "JPML Calendar Year Statistics (all editions on the JPML statistics page)"], ["Retrieved", TODAY]],
        text="JPML statistics overview", filters={"_listing": ["no"], "kind": ["summary"]},
        links=[{"url": STATS_PAGE, "label": "JPML statistics page"}], extra={"kind": "summary", "overview": overview},
    ))
    return rows, overview


def publish():
    rows, overview = build()
    cw.publish(
        DATASET, "MDL Intelligence · JPML calendar-year statistics", rows,
        listing_block=cw.listing([("year", "Year"), ("filed", "Motions filed"), ("granted", "Granted"), ("denied", "Denied/moot/withdrawn"), ("rate", "Grant share"), ("tagalongs", "Tag-along transfers"), ("remands", "Remands")], [("decade", "Decade", {f"{d}s": f"{d}s" for d in range(1970, 2030, 10)})]),
        summary={"records": len(rows), "years": f"{overview['first_year']}-{overview['last_year']}", "latest_edition": overview["latest_edition"], "source": STATS_PAGE, "retrieved": TODAY},
    )
    return rows


if __name__ == "__main__":
    publish()
