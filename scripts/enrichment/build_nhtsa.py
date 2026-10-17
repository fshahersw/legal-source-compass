"""Build NHTSA vehicle-safety datasets from the ODI flat files.

Inputs (private/acq/nhtsa): FLAT_RCL_POST_2010.txt, FLAT_INV.txt, COMPLAINTS_RECEIVED_2020-2024.txt,
COMPLAINTS_RECEIVED_2025-2026.txt (tab-delimited; field lists in RCL.txt, INV.txt, CMPL.txt).
Outputs: agency_safety_nhtsa_recalls (one record per campaign, 2010+), agency_safety_nhtsa_investigations
(one record per ODI action, 1972+), agency_safety_nhtsa_complaint_trends (aggregates only: no narratives,
VINs or locations) and private/acq/nhtsa/vehicle_mdl_signals.json for the mass-tort signal builder.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ACQ = ROOT / "private" / "acq" / "nhtsa"
RECALL_URL = "https://www.nhtsa.gov/recalls?nhtsaId={}"
INV_URL = "https://www.nhtsa.gov/?nhtsaId={}"
DATASETS_URL = "https://www.nhtsa.gov/nhtsa-datasets-and-apis"
TEXT_LIMIT = 3000
INV_TYPES = {"PE": "Preliminary evaluation", "EA": "Engineering analysis", "DP": "Defect petition",
             "RQ": "Recall query", "AQ": "Audit query", "RP": "Recall petition", "IR": "Investigation"}


def rows(path, width):
    with open(path, encoding="latin-1", newline="") as handle:
        for line in handle:
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) < width:
                parts += [""] * (width - len(parts))
            yield [p.strip() for p in parts]


def iso(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}" if re.fullmatch(r"\d{8}", d or "") and d[:4] != "0000" else None


def clip(text, limit=TEXT_LIMIT):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def vehicle_ranges(entries):
    """Collapse (make, model, year) into 'MAKE MODEL 2015–2019' strings."""
    grouped = defaultdict(set)
    for make, model, year in entries:
        if year and year != "9999":
            grouped[(make, model)].add(int(year))
        else:
            grouped[(make, model)]
    out = []
    for (make, model), years in sorted(grouped.items()):
        span = f" {min(years)}" + (f"–{max(years)}" if max(years) != min(years) else "") if years else ""
        out.append(f"{make} {model}{span}".strip())
    return out


def build_recalls():
    campaigns = {}
    for f in rows(ACQ / "FLAT_RCL_POST_2010.txt", 29):
        camp = f[1]
        if not camp:
            continue
        c = campaigns.setdefault(camp, {
            "campaign": camp, "mfr_campaign": f[5], "manufacturer": f[7], "type": f[10], "influenced_by": f[13],
            "report_date": iso(f[15]), "owner_notice": iso(f[12]), "begin_mfg": iso(f[8]), "end_mfg": iso(f[9]),
            "potentially_affected": 0, "components": set(), "vehicles": set(), "fmvss": f[18],
            "defect": f[19], "consequence": f[20], "remedy": f[21], "notes": f[22],
            "do_not_drive": f[27] == "Yes", "park_outside": f[28] == "Yes", "makes": set(),
        })
        if f[11].isdigit():
            c["potentially_affected"] = max(c["potentially_affected"], int(f[11]))
        if f[6]:
            c["components"].add(f[6])
        c["vehicles"].add((f[2], f[3], f[4]))
        if f[2]:
            c["makes"].add(f[2])
        for key, idx in (("defect", 19), ("consequence", 20), ("remedy", 21)):
            if len(f[idx]) > len(c[key]):
                c[key] = f[idx]
    out = []
    type_labels = {"V": "Vehicle", "E": "Equipment", "C": "Child restraint", "T": "Tire"}
    for c in campaigns.values():
        vehicles = vehicle_ranges(c["vehicles"])
        components = sorted(c["components"])
        year = (c["report_date"] or "")[:4]
        title = f"{c['manufacturer'] or 'Manufacturer not recorded'} — {components[0] if components else 'component not recorded'}"
        facts = [
            ["NHTSA campaign", c["campaign"]], ["Manufacturer campaign", c["mfr_campaign"] or "Not recorded"],
            ["Manufacturer", c["manufacturer"] or "Not recorded"], ["Recall type", type_labels.get(c["type"], c["type"] or "Not recorded")],
            ["Initiated by", c["influenced_by"] or "Not recorded"], ["Part 573 report received", c["report_date"] or "Not recorded"],
            ["Owner notification", c["owner_notice"] or "Not recorded"],
            ["Manufactured", f"{c['begin_mfg'] or '?'} to {c['end_mfg'] or '?'}"],
            ["Potentially affected units", f"{c['potentially_affected']:,}" if c["potentially_affected"] else "Not recorded"],
            ["Components", "; ".join(components) or "Not recorded"], ["FMVSS", c["fmvss"] or "None"],
            ["Do not drive advisory", "Yes" if c["do_not_drive"] else "No"], ["Park outside advisory", "Yes" if c["park_outside"] else "No"],
            ["Vehicles / equipment", "; ".join(vehicles[:60]) + (f"; and {len(vehicles) - 60} more" if len(vehicles) > 60 else "")],
            ["Defect summary", clip(c["defect"])], ["Consequence", clip(c["consequence"], 1500)], ["Remedy", clip(c["remedy"])],
            ["Source", "NHTSA Office of Defects Investigation recall flat file (post-2010)"],
        ]
        out.append(cw.record(
            "agency_safety_nhtsa_recalls", c["campaign"], title, source_url=RECALL_URL.format(c["campaign"]),
            subtitle=f"{c['campaign']} · {c['report_date'] or 'date not recorded'} · {c['potentially_affected']:,} units" if c["potentially_affected"] else f"{c['campaign']} · {c['report_date'] or 'date not recorded'}",
            cells={"campaign": c["campaign"], "manufacturer": c["manufacturer"], "component": components[0] if components else "—",
                   "date": c["report_date"] or "—", "units": f"{c['potentially_affected']:,}" if c["potentially_affected"] else "—",
                   "type": type_labels.get(c["type"], c["type"] or "—"), "initiated_by": c["influenced_by"] or "—"},
            facts=facts, badges=[b for b in ["Do not drive" if c["do_not_drive"] else None, "Park outside" if c["park_outside"] else None, f"{len(vehicles)} vehicle lines"] if b],
            links=[{"url": RECALL_URL.format(c["campaign"]), "label": "NHTSA recall"}],
            text=f"{' '.join(sorted(c['makes']))} {' '.join(components)} {clip(c['defect'], 1500)} {clip(c['consequence'], 600)}",
            filters={"type": [c["type"].lower() or "unknown"], "year": [year] if year else [], "make": sorted(m.lower() for m in c["makes"])[:20],
                     "component": [components[0].split(":")[0].lower()] if components else [], "initiated_by": [c["influenced_by"].lower() or "unknown"],
                     "advisory": (["do_not_drive"] if c["do_not_drive"] else []) + (["park_outside"] if c["park_outside"] else []),
                     "date": c["report_date"] or ""},
            extra={"kind": "recall", "recall": {k: (sorted(v) if isinstance(v, set) else v) for k, v in c.items() if k not in ("vehicles",)} | {"vehicles": vehicles[:200]}},
        ))
    return out, campaigns


def build_investigations():
    actions = {}
    for f in rows(ACQ / "FLAT_INV.txt", 11):
        num = f[0]
        if not num:
            continue
        a = actions.setdefault(num, {"action": num, "manufacturer": f[5], "opened": iso(f[6]), "closed": iso(f[7]),
                                     "campaign": f[8], "subject": f[9], "summary": f[10], "components": set(), "vehicles": set(), "makes": set()})
        if f[4]:
            a["components"].add(f[4])
        a["vehicles"].add((f[1], f[2], f[3]))
        if f[1]:
            a["makes"].add(f[1])
        if len(f[10]) > len(a["summary"]):
            a["summary"] = f[10]
        if f[8] and not a["campaign"]:
            a["campaign"] = f[8]
    out = []
    for a in actions.values():
        kind = INV_TYPES.get(a["action"][:2], "Investigation")
        vehicles = vehicle_ranges(a["vehicles"])
        components = sorted(a["components"])
        status = "Closed" if a["closed"] else "Open"
        facts = [
            ["NHTSA action number", a["action"]], ["Investigation type", kind], ["Status", status],
            ["Opened", a["opened"] or "Not recorded"], ["Closed", a["closed"] or "Open"],
            ["Manufacturer", a["manufacturer"] or "Not recorded"], ["Components", "; ".join(components) or "Not recorded"],
            ["Resulting recall", a["campaign"] or "None recorded"],
            ["Vehicles / equipment", "; ".join(vehicles[:60]) + (f"; and {len(vehicles) - 60} more" if len(vehicles) > 60 else "")],
            ["Summary", clip(a["summary"], 5000)],
            ["Source", "NHTSA Office of Defects Investigation investigations flat file"],
        ]
        links = [{"url": INV_URL.format(a["action"]), "label": "NHTSA investigation"}]
        if a["campaign"]:
            links.append({"url": f"/records/agency_safety_nhtsa_recalls/{a['campaign']}", "label": f"Recall {a['campaign']}"})
        out.append(cw.record(
            "agency_safety_nhtsa_investigations", a["action"], a["subject"] or f"NHTSA {kind} {a['action']}",
            source_url=INV_URL.format(a["action"]),
            subtitle=f"{a['action']} · {kind} · opened {a['opened'] or '—'} · {status.lower()}",
            cells={"action": a["action"], "subject": a["subject"], "type": kind, "manufacturer": a["manufacturer"],
                   "opened": a["opened"] or "—", "closed": a["closed"] or "Open", "recall": a["campaign"] or "—"},
            facts=facts, badges=[b for b in [status, kind, "Led to recall" if a["campaign"] else None] if b], links=links,
            text=f"{' '.join(sorted(a['makes']))} {' '.join(components)} {clip(a['summary'], 2500)}",
            filters={"type": [a["action"][:2].lower()], "status": [status.lower()], "year": [(a["opened"] or "")[:4]] if a["opened"] else [],
                     "make": sorted(m.lower() for m in a["makes"])[:20], "recall": ["yes" if a["campaign"] else "no"], "date": a["opened"] or ""},
            extra={"kind": "investigation", "investigation": {k: (sorted(v) if isinstance(v, set) else v) for k, v in a.items() if k != "vehicles"} | {"vehicles": vehicles[:200], "type_label": kind}},
        ))
    return out, actions


def build_complaints(mapping):
    by_make_component = defaultdict(lambda: {"total": 0, "crash": 0, "fire": 0, "injured": 0, "deaths": 0, "years": Counter(), "models": Counter()})
    seen = set()
    vehicle_mdls = [m for m in mapping if m["kind"] == "vehicle"]
    mdl_hits = {m["mdl"]: {"total": 0, "crash": 0, "fire": 0, "injured": 0, "deaths": 0, "years": Counter()} for m in vehicle_mdls}
    for name in ("COMPLAINTS_RECEIVED_2020-2024.txt", "COMPLAINTS_RECEIVED_2025-2026.txt"):
        for f in rows(ACQ / name, 49):
            odino, make, model, comp = f[1], f[3], f[4], f[11]
            if not odino or (odino, comp) in seen:
                continue
            seen.add((odino, comp))
            year = (f[16] or f[15])[:4]
            top = comp.split(":")[0] if comp else "UNKNOWN"
            injured = int(f[9]) if f[9].isdigit() else 0
            deaths = int(f[10]) if f[10].isdigit() else 0
            g = by_make_component[(make, top)]
            g["total"] += 1
            g["crash"] += f[6] == "Y"
            g["fire"] += f[8] == "Y"
            g["injured"] += injured
            g["deaths"] += deaths
            g["years"][year] += 1
            g["models"][model] += 1
            text = f[19].upper()
            for m in vehicle_mdls:
                rule = m["nhtsa"]
                if rule.get("make") and make not in rule["make"]:
                    continue
                if rule.get("model") and not any(x in model for x in rule["model"]):
                    continue
                if rule.get("component") and not any(x in comp for x in rule["component"]):
                    continue
                if rule.get("text") and not any(x in text or x in comp for x in rule["text"]):
                    continue
                h = mdl_hits[m["mdl"]]
                h["total"] += 1
                h["crash"] += f[6] == "Y"
                h["fire"] += f[8] == "Y"
                h["injured"] += injured
                h["deaths"] += deaths
                h["years"][year] += 1
    out = []
    used = Counter()
    for (make, component), g in sorted(by_make_component.items(), key=lambda kv: -kv[1]["total"]):
        if g["total"] < 100 or not make:
            continue
        rid = re.sub(r"[^a-z0-9]+", "-", f"{make} {component}".lower()).strip("-")
        used[rid] += 1
        if used[rid] > 1:
            rid = f"{rid}-{used[rid]}"
        years = dict(sorted(g["years"].items()))
        out.append(cw.record(
            "agency_safety_nhtsa_complaint_trends", rid, f"{make} — {component}", source_url=DATASETS_URL,
            subtitle=f"{g['total']:,} complaints received 2020–2026 · {g['crash']:,} crashes · {g['fire']:,} fires",
            cells={"make": make, "component": component, "complaints": f"{g['total']:,}", "crashes": f"{g['crash']:,}",
                   "fires": f"{g['fire']:,}", "injured": f"{g['injured']:,}", "deaths": f"{g['deaths']:,}"},
            facts=[["Make", make], ["Component", component], ["Complaints received 2020–2026", f"{g['total']:,}"],
                   ["Involving a crash", f"{g['crash']:,}"], ["Involving a fire", f"{g['fire']:,}"],
                   ["Persons injured (reported)", f"{g['injured']:,}"], ["Deaths (reported)", f"{g['deaths']:,}"],
                   ["By year received", ", ".join(f"{y}: {n:,}" for y, n in years.items())],
                   ["Most-cited models", "; ".join(f"{m} ({n:,})" for m, n in g["models"].most_common(8))],
                   ["Source", "NHTSA ODI complaints flat files, received 2020–2026; aggregate counts only"]],
            text=f"{make} {component} {' '.join(m for m, _ in g['models'].most_common(20))}",
            filters={"make": [make.lower()], "component": [component.lower()], "deaths": ["yes" if g["deaths"] else "no"], "fire": ["yes" if g["fire"] else "no"]},
            extra={"kind": "complaint_trend", "trend": {"make": make, "component": component, "total": g["total"], "crash": g["crash"], "fire": g["fire"],
                                                         "injured": g["injured"], "deaths": g["deaths"], "years": years, "models": g["models"].most_common(15)}},
        ))
    signals = {str(k): {**v, "years": dict(sorted(v["years"].items()))} for k, v in mdl_hits.items()}
    (ACQ / "vehicle_mdl_signals.json").write_text(json.dumps(signals, indent=1))
    return out


def main():
    mapping = json.loads((Path(__file__).parent / "mass_tort_products.json").read_text())["mdls"]
    only = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--only=")), None)
    recalls = build_recalls()[0] if only in (None, "recalls") else []
    investigations = build_investigations()[0] if only in (None, "investigations") else []
    complaints = build_complaints(mapping) if only in (None, "trends") else []
    print(json.dumps({"recalls": len(recalls), "investigations": len(investigations), "complaint_trends": len(complaints)}))
    if recalls:
        cw.publish("agency_safety_nhtsa_recalls", "NHTSA vehicle and equipment recalls (2010–present)", recalls,
                   listing_block=cw.listing([("campaign", "Campaign"), ("manufacturer", "Manufacturer"), ("component", "Component"), ("date", "Reported"), ("units", "Units"), ("initiated_by", "Initiated by")],
                                            [("type", "Recall type", {"v": "Vehicle", "e": "Equipment", "c": "Child restraint", "t": "Tire"}),
                                             ("advisory", "Advisory", {"do_not_drive": "Do not drive", "park_outside": "Park outside"})]),
                   summary={"source": DATASETS_URL, "file": "FLAT_RCL_POST_2010"})
    if investigations:
        cw.publish("agency_safety_nhtsa_investigations", "NHTSA defect investigations (1972–present)", investigations,
                   listing_block=cw.listing([("action", "Action"), ("subject", "Subject"), ("type", "Type"), ("manufacturer", "Manufacturer"), ("opened", "Opened"), ("closed", "Closed"), ("recall", "Recall")],
                                            [("type", "Type", {k.lower(): v for k, v in INV_TYPES.items()}), ("status", "Status", {"open": "Open", "closed": "Closed"}),
                                             ("recall", "Resulting recall", {"yes": "Led to recall", "no": "No recall recorded"})]),
                   summary={"source": DATASETS_URL, "file": "FLAT_INV"})
    if complaints:
        cw.publish("agency_safety_nhtsa_complaint_trends", "NHTSA complaint trends by make and component (2020–2026)", complaints,
                   listing_block=cw.listing([("make", "Make"), ("component", "Component"), ("complaints", "Complaints"), ("crashes", "Crashes"), ("fires", "Fires"), ("injured", "Injured"), ("deaths", "Deaths")],
                                            [("deaths", "Deaths reported", {"yes": "Any deaths", "no": "None"}), ("fire", "Fires reported", {"yes": "Any fires", "no": "None"})]),
                   summary={"source": DATASETS_URL, "files": ["COMPLAINTS_RECEIVED_2020-2024", "COMPLAINTS_RECEIVED_2025-2026"], "minimum": 100})


if __name__ == "__main__":
    main()
