"""mdl_intel_hearing_orders: JPML hearing sessions, the matters scheduled at each, and the Panel's published orders.

Records:
  session:<date>          one per hearing-session notice on the JPML hearing pages (2021-2026)
  matter:<date>:<mdl>     one per docket on a session's Schedule of Matters (Section A = motions for centralization,
                          Section B = oppositions to conditional transfer orders), with the outcome resolved ONLY from
                          explicit published evidence (in this order): JPML Panel Orders page PDF; GovInfo order
                          granule for that MDL docket signed after the session; JPML archive order deeming the motion
                          withdrawn/moot or vacating the session order; JPML pending-MDL report listing the docket as
                          transferred after the session. Otherwise outcome = "not_found".
  order:<granule>         one per Panel order published on GovInfo (USCOURTS, court jpml) - docket text verbatim.
"""
import collections
import json
import re
from datetime import date, timedelta

import parse_govinfo as pg
import parse_jpml as pj
from common import ACQ, ARCHIVE_PAGE, GOVINFO_JPML, HEARING_PAGE, ORDERS_PAGE, TODAY, cw, district_name, fmt, normalize_district, manifest, pdftotext

DATASET = "mdl_intel_hearing_orders"
OUTCOME_LABELS = {
    "granted": "Centralized (transfer order)", "denied": "Centralization denied", "withdrawn": "Motion withdrawn",
    "moot": "Motion deemed moot", "transferred": "Transferred (CTO opposition overruled)", "cto_vacated": "Conditional transfer order vacated",
    "cto_stay_lifted": "CTO stay lifted, session order vacated", "unopposed_transfer_granted": "Unopposed transfer granted",
    "cro_vacated": "Conditional remand order vacated", "scheduled": "Scheduled (session not yet held)", "not_found": "Outcome not found in published sources",
    "other": "Other order",
}


def load_notices(man):
    sessions = {}
    for f in man["files"]:
        if f["page"] not in ("hearing_archive", "hearing_current") or not f["text"].startswith("Notice of"):
            continue
        text = pdftotext(ACQ / f["file"])
        parsed = pj.parse_hearing_notice(text)
        m = re.search(r"Notice of ([A-Z][a-z]+ \d{1,2}, \d{4})", f["text"])
        label_date = pj.us_long_date(m.group(1)) if m else None
        sid = parsed["session_date"] or label_date
        if not sid:
            continue
        filed = re.search(r"Filed\s+(\d{2})/(\d{2})/(\d{2})", text)
        sessions[sid] = {
            "date": sid, "location": parsed["location"], "location_lines": parsed.get("location_lines") or [],
            "location_city": parsed.get("location_city"), "location_state": parsed.get("location_state"),
            "notice_url": f["url"], "notice_sha256": f["sha256"],
            "notice_filed": f"20{filed.group(3)}-{filed.group(1)}-{filed.group(2)}" if filed else None,
            "matters": parsed["matters"], "machine_readable": bool(parsed["matters"]),
        }
    return sessions


def load_archive_orders(man):
    out = []
    for key in ("hearing_archive", "hearing_current"):
        for item in man["pages"][key]["pdfs"]:
            p = pj.parse_archive_order_link(item["text"])
            if p:
                # links without a session date in their text name the session month in the file name ("…May-2021_Hearing")
                mm = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Dec|Sept?)[_-](20\d\d)", item["url"])
                month = None
                if mm:
                    key = mm.group(1).lower()[:3]
                    month = f"{mm.group(2)}-{pj.MONTHS[next(m for m in pj.MONTHS if m.startswith(key))]:02d}"
                out.append(p | {"url": item["url"], "label": item["text"], "session_month": month})
    return out


def load_panel_page_orders(man):
    out = []
    files = {f["url"]: f for f in man["files"]}
    for item in man["pages"]["panel_orders"]["pdfs"]:
        m = re.search(r"MDL-(\d+)-(Transfer_Order|Order_Denying_Transfer)", item["url"])
        if not m or item["url"] not in files:
            continue
        parsed = pj.parse_order_pdf_text(pdftotext(ACQ / files[item["url"]]["file"]))
        out.append({"mdl": int(m.group(1)), "kind": "transfer_order" if m.group(2) == "Transfer_Order" else "order_denying_transfer", "url": item["url"], **parsed})
    return out


def load_pending_report():
    text = (ACQ / "txt" / "by_type.txt").read_text() if (ACQ / "txt" / "by_type.txt").exists() else ""
    return {r["mdl"]: r for r in pj.parse_by_type(text)}


def build():
    man = manifest()
    sessions = load_notices(man)
    archive = load_archive_orders(man)
    page_orders = load_panel_page_orders(man)
    pending = load_pending_report()
    pkgs = pg.load_all(ACQ / "govinfo" / "mods")
    granules, seen_granules = [], set()
    for p in pkgs:
        for g in p["granules"]:
            if g["kind"] == "docket_sheet" or (p["package"], g["part"]) in seen_granules:
                continue
            seen_granules.add((p["package"], g["part"]))
            granules.append({**g, "mdl": p["mdl"] or g["pldg_mdl"], "package": p["package"], "package_title": p["title"], "nature_of_suit": p["nature_of_suit"]})
    by_mdl = collections.defaultdict(list)
    for g in granules:
        if g["mdl"]:
            by_mdl[g["mdl"]].append(g)
    order_dates = sorted(sessions)
    rows, matters_out = [], []

    for i, sid in enumerate(order_dates):
        s = sessions[sid]
        start = date.fromisoformat(sid)
        end = date.fromisoformat(order_dates[i + 1]) if i + 1 < len(order_dates) else start + timedelta(days=75)
        tallies = collections.Counter()
        seen_keys = collections.Counter()
        for mt in s["matters"]:
            seen_keys[(mt["mdl"], mt["section"])] += 1
            dup = seen_keys[(mt["mdl"], mt["section"])]
            outcome, evidence = resolve(mt, sid, start, end, by_mdl, archive, page_orders, pending)
            tallies[f"{mt['section']}:{outcome}"] += 1
            rec = {**mt, "session": sid, "outcome": outcome, "outcome_label": OUTCOME_LABELS[outcome], "evidence": evidence}
            matters_out.append(rec)
            mdl_type = (pending.get(mt["mdl"]) or {}).get("type")
            title = mt["title"].title().replace("In Re:", "In re:")
            facts = [
                ["Hearing session", sid], ["Schedule section", "A — motion for centralization (oral argument)" if mt["section"] == "A" else "B — considered without oral argument (CTO oppositions and other motions)"],
                ["MDL number", str(mt["mdl"])], ["Docket title (as printed)", mt["title"]],
                ["Motion (as printed, first 600 characters)", mt["motion"] or "Not recorded"],
                ["Requested transferee district", mt["requested_district"] or "Not recorded"], ["Actions listed on schedule", fmt(mt["actions_listed"])],
                ["Outcome", OUTCOME_LABELS[outcome]], ["Outcome evidence", evidence["text"] if evidence else "No published order located for this matter"],
                ["JPML litigation type (pending report 10/1/2026)", mdl_type or "Not listed as pending"],
            ]
            links = [{"url": s["notice_url"], "label": "Hearing session notice and schedule (PDF)"}]
            if evidence and evidence.get("url"):
                links.append({"url": evidence["url"], "label": evidence.get("label", "Order")})
            links.append({"url": f"/matters/lens/{mt['mdl']}", "label": f"MDL {mt['mdl']} lens"})
            rows.append(cw.record(
                DATASET, f"matter:{sid}:{mt['mdl']}:{mt['section']}" + (f":{dup}" if dup > 1 else ""), f"MDL {mt['mdl']} — {title}", source_url=s["notice_url"],
                subtitle=f"{sid} hearing · Section {mt['section']} · {OUTCOME_LABELS[outcome]}",
                cells={"session": sid, "mdl": str(mt["mdl"]), "litigation": title[:120], "section": mt["section"], "outcome": OUTCOME_LABELS[outcome], "district": (evidence or {}).get("district") or "—", "type": mdl_type or "—"},
                facts=facts, text=f"{mt['title']} {mt['motion']}", badges=[b for b in [f"Section {mt['section']}", OUTCOME_LABELS[outcome], mdl_type] if b],
                filters={"kind": ["matter"], "section": [mt["section"]], "outcome": [outcome], "year": [sid[:4]], "type": [(mdl_type or "not_listed").lower()], "date": sid},
                links=links, extra={"kind": "matter", "matter": rec},
            ))
        sess = {k: v for k, v in s.items() if k != "matters"} | {"matter_count": len(s["matters"]), "section_a": sum(1 for m in s["matters"] if m["section"] == "A"), "section_b": sum(1 for m in s["matters"] if m["section"] == "B"), "tallies": dict(tallies)}
        rows.append(cw.record(
            DATASET, f"session:{sid}", f"JPML hearing session, {sid}", source_url=s["notice_url"],
            subtitle=f"{s['location'] or 'Location not recorded'} · {sess['section_a']} centralization motions · {sess['section_b']} other matters" if s["machine_readable"] else "Schedule not machine-readable (PDF font encoding) — see notice",
            cells={"session": sid, "mdl": "—", "litigation": "Hearing session", "section": "—", "outcome": f"{tallies.get('A:granted', 0)} granted / {tallies.get('A:denied', 0)} denied", "district": "—", "type": "—"},
            facts=[["Session date", sid], ["Location", " · ".join(s.get("location_lines") or []) or s["location"] or "Not recorded"],
                   ["City", ", ".join(x for x in (s.get("location_city"), s.get("location_state")) if x) or "Not recorded"], ["Notice filed", s["notice_filed"] or "Not recorded"], ["Matters on schedule", fmt(sess["matter_count"])], ["Section A outcomes", ", ".join(f"{k[2:]} {v}" for k, v in sorted(tallies.items()) if k.startswith("A:")) or "Not recorded"], ["Schedule machine-readable", "Yes" if s["machine_readable"] else "No (font encoding in the published PDF)"]],
            text=f"hearing session {sid} {s['location'] or ''}", filters={"kind": ["session"], "year": [sid[:4]], "date": sid},
            links=[{"url": s["notice_url"], "label": "Notice of hearing session (PDF)"}, {"url": ARCHIVE_PAGE, "label": "JPML hearing session archive"}],
            extra={"kind": "session", "session": sess},
        ))

    for g in granules:
        gid = f"order:{g['package']}-{g['part']}"
        initial = g["kind"] in ("transfer_order", "order_denying_transfer") and bool(g["pleadings"]) and 1 in g["pleadings"]
        when = g["signed_date"] or g["issued"]
        title = (g["package_title"] or "").title().replace("In Re:", "In re:")
        rows.append(cw.record(
            DATASET, gid, f"{g['kind'].replace('_', ' ').capitalize()} — MDL {g['mdl']}", source_url=g["details"] or g["pdf"] or GOVINFO_JPML,
            subtitle=f"{when or 'Date not recorded'} · {title[:110]}",
            cells={"session": when or "—", "mdl": str(g["mdl"] or "—"), "litigation": title[:120], "section": "Order", "outcome": g["kind"].replace("_", " "), "district": normalize_district(g["transferee_court"]) or "—", "type": g["nature_of_suit"] or "—"},
            facts=[["Order type (from docket-text prefix)", g["kind"].replace("_", " ")], ["Signed", g["signed_date"] or "Not recorded"], ["GovInfo date issued", g["issued"] or "Not recorded"], ["Docket text (verbatim, GovInfo)", g["text"][:900]], ["Rules on the initial motion (pleading 1)", "Yes" if initial else "No"], ["Actions transferred", fmt(g["actions_transferred"])], ["Transferee judge", g["transferee_judge"] or "Not recorded"], ["Transferee court", g["transferee_court"] or "Not recorded"], ["GovInfo nature of suit", g["nature_of_suit"] or "Not recorded"], ["Package", g["package"]]],
            text=f"{g['package_title']} {g['text'][:400]}", filters={"kind": ["order"], "order_kind": [g["kind"]], "initial_motion": ["yes" if initial else "no"], "year": [(when or "")[:4]], "date": when or ""},
            links=[x for x in [{"url": g["pdf"], "label": "Order PDF (GovInfo)"} if g["pdf"] else None, {"url": g["details"], "label": "GovInfo details"} if g["details"] else None, {"url": f"/matters/lens/{g['mdl']}", "label": f"MDL {g['mdl']} lens"} if g["mdl"] else None] if x],
            extra={"kind": "order", "order": {k: g[k] for k in ("mdl", "package", "part", "kind", "signed_date", "issued", "pleadings", "actions_transferred", "transferee_judge", "transferee_court", "nature_of_suit", "pdf")} | {"initial_motion": initial, "title": g["package_title"]}},
        ))

    coverage = govinfo_coverage(granules)
    overview = {
        "sessions": len(sessions), "machine_readable_sessions": sum(1 for s in sessions.values() if s["machine_readable"]),
        "matters": len(matters_out), "section_a": sum(1 for m in matters_out if m["section"] == "A"),
        "outcomes_a": dict(collections.Counter(m["outcome"] for m in matters_out if m["section"] == "A")),
        "outcomes_b": dict(collections.Counter(m["outcome"] for m in matters_out if m["section"] == "B")),
        "govinfo_orders": len(granules), "govinfo_packages": len(pkgs), "govinfo_coverage_by_year": coverage,
        "govinfo_probed_packages": sum(1 for v in json.loads((ACQ / "govinfo" / "packages.json").read_text()).values() if v.get("source") == "probe"),
        "govinfo_method": "Packages listed in the GovInfo USCOURTS sitemaps plus packages recovered by probing USCOURTS-jpml-1_{yy}-F-{mdl} for every docket number on the schedules, pending reports and Panel Orders page (the sitemaps omit many JPML dockets).",
        "panel_page_orders": [{k: o[k] for k in ("mdl", "kind", "url", "filed", "caption", "operative", "transferee_district", "transferee_judge")} for o in page_orders],
        "archive_orders": archive, "retrieved": TODAY,
        "session_rows": [{k: v for k, v in s.items() if k != "matters"} | {"tallies": dict(collections.Counter(f"{m['section']}:{m['outcome']}" for m in matters_out if m["session"] == sid))} for sid, s in sorted(sessions.items())],
    }
    rows.append(cw.record(
        DATASET, "summary:overview", "JPML hearing sessions and Panel orders", source_url=ARCHIVE_PAGE,
        subtitle=f"{len(sessions)} hearing sessions · {len(matters_out)} scheduled matters · {len(granules)} GovInfo orders",
        cells={"session": "—", "mdl": "—", "litigation": "Overview", "section": "—", "outcome": "—", "district": "—", "type": "—"},
        facts=[["Hearing sessions parsed", f"{overview['machine_readable_sessions']} of {len(sessions)} notices machine-readable"], ["GovInfo JPML packages", fmt(len(pkgs))], ["GovInfo orders (excluding docket sheets)", fmt(len(granules))], ["Retrieved", TODAY]],
        text="hearing sessions overview", filters={"_listing": ["no"], "kind": ["summary"]},
        links=[{"url": ARCHIVE_PAGE, "label": "JPML hearing session archive"}, {"url": ORDERS_PAGE, "label": "JPML Panel Orders"}, {"url": GOVINFO_JPML, "label": "GovInfo JPML collection"}],
        extra={"kind": "summary", "overview": overview},
    ))
    return rows, overview, matters_out, granules


def resolve(mt, sid, start, end, by_mdl, archive, page_orders, pending):
    """Outcome from explicit published evidence only. Returns (outcome, evidence|None)."""
    if start > date.fromisoformat(TODAY):
        return "scheduled", None
    for o in page_orders:
        if o["mdl"] == mt["mdl"] and o.get("filed") and start <= date.fromisoformat(o["filed"]) <= end:
            if mt["section"] == "A" or o["kind"] == "order_denying_transfer":
                kind = ("granted" if o["kind"] == "transfer_order" else "denied") if mt["section"] == "A" else ("transferred" if o["kind"] == "transfer_order" else "denied")
                return kind, {"source": "jpml_panel_orders_page", "url": o["url"], "label": "Panel order (JPML)", "date": o["filed"], "text": o.get("operative") or o["kind"], "district": normalize_district(o.get("transferee_district"))}
    for a in archive:
        if a["mdl"] == mt["mdl"] and (a["session"] == sid or (a["session"] is None and a.get("session_month") == sid[:7])):
            return a["kind"], {"source": "jpml_archive_order", "url": a["url"], "label": a["label"][:80], "date": None, "text": a["label"]}
    cands = []
    for g in by_mdl.get(mt["mdl"], []):
        when = g["signed_date"] or g["issued"]
        if not when or not (start <= date.fromisoformat(when) <= end):
            continue
        if mt["section"] == "A" and g["kind"] in ("transfer_order", "order_denying_transfer") and g["pleadings"] and 1 in g["pleadings"]:
            cands.append(("granted" if g["kind"] == "transfer_order" else "denied", g, when))
        elif mt["section"] == "B" and g["kind"] in ("transfer_order", "order_vacating_cto", "order_denying_transfer", "order_deeming_moot", "order_deeming_withdrawn"):
            cands.append(({"transfer_order": "transferred", "order_vacating_cto": "cto_vacated", "order_denying_transfer": "denied", "order_deeming_moot": "moot", "order_deeming_withdrawn": "withdrawn"}[g["kind"]], g, when))
    if cands:
        kind, g, when = sorted(cands, key=lambda c: c[2])[0]
        return kind, {"source": "govinfo", "url": g["pdf"] or g["details"], "label": "Order (GovInfo)", "date": when, "text": g["text"][:500], "district": normalize_district(g["transferee_court"])}
    if mt["section"] == "A":
        p = pending.get(mt["mdl"])
        if p and p.get("date_transferred") and start <= date.fromisoformat(p["date_transferred"]) <= end:
            return "granted", {"source": "jpml_pending_report", "url": "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_MDL_Type-October-1-2026.pdf", "label": "JPML pending MDLs by type (10/1/2026)", "date": p["date_transferred"], "text": f"Listed as pending: transferred {p['date_transferred']} to {p['judge']} ({p['district']})", "district": district_name(p["district"])}
    return "not_found", None


def govinfo_coverage(granules):
    by_year = collections.defaultdict(collections.Counter)
    for g in granules:
        when = (g["signed_date"] or g["issued"] or "")[:4]
        if not when:
            continue
        initial = g["pleadings"] and 1 in g["pleadings"]
        if g["kind"] == "transfer_order" and initial:
            by_year[when]["initial_transfer_orders"] += 1
        elif g["kind"] == "order_denying_transfer" and initial:
            by_year[when]["initial_denials"] += 1
        by_year[when]["orders"] += 1
    return [{"year": int(y), **dict(c)} for y, c in sorted(by_year.items()) if y.isdigit() and int(y) >= 2009]


def publish():
    rows, overview, _, _ = build()
    cw.publish(
        DATASET, "MDL Intelligence · JPML hearing sessions and Panel orders", rows,
        listing_block=cw.listing([("session", "Session / date"), ("mdl", "MDL"), ("litigation", "Litigation"), ("section", "Section"), ("outcome", "Outcome"), ("district", "Transferee district"), ("type", "Type")], [("kind", "Record", {"matter": "Scheduled matter", "session": "Hearing session", "order": "Panel order (GovInfo)"}), ("outcome", "Outcome", {k: v for k, v in OUTCOME_LABELS.items()}), ("section", "Section", {"A": "A — centralization", "B": "B — CTO / other"})]),
        summary={"records": len(rows), "sessions": overview["sessions"], "matters": overview["matters"], "govinfo_orders": overview["govinfo_orders"], "source": ARCHIVE_PAGE, "retrieved": TODAY},
    )
    return rows


if __name__ == "__main__":
    publish()
