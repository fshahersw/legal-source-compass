"""Build `judicial_vacancies` from the parsed uscourts.gov vacancy reports (parse_vacancies.py).

Sources: https://www.uscourts.gov/data-news/judicial-vacancies (current vacancies, future vacancies, judicial emergencies,
confirmation listing; as of 2026-10-22) and the monthly archive
https://www.uscourts.gov/data-news/judicial-vacancies/archive-judicial-vacancies (January 1981 - October 2026).

Records:
  * vacancy - one per vacancy as listed: court + incumbent ("Vacancy Created By") + vacancy date. Months listed, nominees
    listed for it (as published, with nomination dates), months on the judicial-emergency list (with the published days
    pending and weighted/adjusted filings), the confirmation listed for it, and its status: open (on the current vacancy
    list), announced (on the current future-vacancy list), confirmation listed, or no longer listed (last month shown);
  * future - announced future vacancies not (yet) matched to a vacancy;
  * court - per court: current open, announced and emergency vacancies and the history of vacancies opened per year;
  * national - monthly counts and the coverage of the archive (which months were parsed and which are scanned images).
Keys are exact: court id + incumbent name tokens (lower case, punctuation and generational suffixes removed, order ignored)
+ vacancy date. Links to FJC judge profiles only on exact keys: the incumbent's surname + the court + an FJC senior-status or
termination date equal to the vacancy date; the nominee's surname + the court + an FJC confirmation date equal to the
listed confirmation date; unique matches only. Days vacant are computed as 2026-10-22 minus the vacancy date.
"""
from __future__ import annotations

import collections
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
DATASET = "judicial_vacancies"
AS_OF = date(2026, 10, 22)
CURRENT_URL = "https://www.uscourts.gov/data-news/judicial-vacancies/current-judicial-vacancies"
ARCHIVE_URL = "https://www.uscourts.gov/data-news/judicial-vacancies/archive-judicial-vacancies"
SUFFIX = {"jr", "sr", "ii", "iii", "iv"}


def tokens(name: str | None) -> tuple:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return tuple(sorted(t for t in re.findall(r"[a-z]+", s) if t not in SUFFIX))


def surname(name: str | None) -> str:
    """Surname as printed before the first comma ('Kayatta Jr.,William J.' -> 'kayatta'); suffixes dropped."""
    head = (name or "").split(",")[0]
    s = unicodedata.normalize("NFKD", head).encode("ascii", "ignore").decode().lower()
    parts = [t for t in re.findall(r"[a-z]+", s) if t not in SUFFIX]
    return " ".join(parts)


def vkey(r: dict):
    return (r.get("court_id") or f"raw:{r.get('court_circuit')}:{r.get('court_code')}", tokens(r.get("incumbent")), r.get("vacancy_date"))


def fjc_index():
    build = json.loads((BUILD / "judge_profiles_fjc.json").read_text())
    leaving, confirmed = collections.defaultdict(list), collections.defaultdict(list)
    for row in build["rows"]:
        p = row["item"]["profile"]
        last = surname(row["title"].split(",")[0].split()[-1] if row["title"] else "")
        # FJC names are 'First Middle Last[, Suffix]'; the surname is the last token of the name before any suffix
        name_main = row["title"].split(",")[0]
        last = surname(name_main.split()[-1]) if name_main.split() else ""
        for s in p["services"]:
            if not s.get("court_id"):
                continue
            for d in (s.get("senior_status"), s.get("termination_date")):
                if d:
                    leaving[(s["court_id"], last, d[:10])].append((p["nid"], p.get("judge_profile_id")))
            if s.get("confirmation"):
                confirmed[(s["court_id"], last, s["confirmation"][:10])].append((p["nid"], p.get("judge_profile_id")))
    return leaving, confirmed


def link(index, court, name, day):
    if not (court and day):
        return None, "missing_key"
    hits = list(dict.fromkeys(index.get((court, surname(name), day), [])))
    if len(hits) == 1:
        return {"fjc_nid": hits[0][0], "judge_profile_id": hits[0][1]}, "exact"
    return None, "ambiguous" if hits else "no_match"


def main() -> None:
    data = json.loads((BUILD / "vacancies_parsed.json").read_text())
    rows, coverage = data["rows"], data["coverage"]
    spine = {r["id"]: r for r in map(json.loads, (BUILD / "lookups" / "court_spine_xwalk_lookup.jsonl").open())}
    leaving, confirmed_idx = fjc_index()
    vac = {}
    stats = collections.Counter()

    def episode(k, r):
        if k not in vac:
            vac[k] = {"court_id": r.get("court_id"), "court_as_published": r.get("court") or " - ".join(x for x in (r.get("court_circuit"), r.get("court_code")) if x),
                      "incumbent": r.get("incumbent"), "reason": r.get("reason"), "vacancy_date": r.get("vacancy_date"),
                      "months": set(), "nominees": {}, "emergency_months": set(), "emergency_latest": None, "confirmations": {},
                      "future_months": set(), "notification_date": None, "on_current_list": False, "on_current_future": False,
                      "on_current_emergencies": False, "sources": set()}
        return vac[k]

    # Some reports print a row without the incumbent's name (e.g. the September 2023 list). Such a row joins the vacancy with
    # the same court and vacancy date only when exactly one named vacancy has that court and date; otherwise it stays separate.
    named = collections.defaultdict(set)
    for r in rows:
        if r["kind"] != "summary" and tokens(r.get("incumbent")):
            k = vkey(r)
            named[(k[0], k[2])].add(k[1])
    for r in rows:
        kind, month = r["kind"], r["month"]
        if kind == "summary":
            continue
        k = vkey(r)
        if not k[1] and len(named[(k[0], k[2])]) == 1:
            k = (k[0], next(iter(named[(k[0], k[2])])), k[2])
            stats["unnamed_rows_joined_by_court_and_date"] += 1
        elif not k[1]:
            stats["unnamed_rows_kept_separate"] += 1
        if kind == "vacancies":
            e = episode(k, r)
            e["incumbent"], e["reason"] = r.get("incumbent") or e["incumbent"], r.get("reason") or e["reason"]
            if month == "current":
                e["on_current_list"] = True
            else:
                e["months"].add(month)
            e["sources"].add(r["url"])
            if r.get("nominee"):
                nk = (tokens(r["nominee"]), r.get("nomination_date"))
                n = e["nominees"].setdefault(nk, {"nominee": r["nominee"], "nomination_date": r.get("nomination_date"), "months": set()})
                n["months"].add(month)
        elif kind == "future":
            e = episode(k, r) if r.get("vacancy_date") else None
            if e is None:  # 'TBD' vacancy date: keyed by court + incumbent only
                e = episode((k[0], k[1], None), r)
            if month == "current":
                e["on_current_future"] = True
            else:
                e["future_months"].add(month)
            e["notification_date"] = r.get("notification_date") or e["notification_date"]
            e["sources"].add(r["url"])
            if r.get("nominee"):
                nk = (tokens(r["nominee"]), r.get("nomination_date"))
                n = e["nominees"].setdefault(nk, {"nominee": r["nominee"], "nomination_date": r.get("nomination_date"), "months": set()})
                n["months"].add(month)
        elif kind == "emergencies":
            e = episode(k, r)
            if month == "current":
                e["on_current_emergencies"] = True
            else:
                e["emergency_months"].add(month)
            latest = e["emergency_latest"]
            if latest is None or month == "current" or (latest["month"] != "current" and month > latest["month"]):
                e["emergency_latest"] = {"month": month, "days_pending": r.get("days_pending"), "weighted": r.get("weighted"),
                                         "adjusted": r.get("adjusted"), "url": r["url"]}
            e["sources"].add(r["url"])
        elif kind == "confirmations":
            e = episode(k, r)
            ck = (tokens(r.get("nominee")), r.get("confirmation_date"))
            c = e["confirmations"].setdefault(ck, {"nominee": r.get("nominee"), "nomination_date": r.get("nomination_date"),
                                                   "confirmation_date": r.get("confirmation_date"), "listed": set(), "url": r["url"]})
            c["listed"].add(month)
            e["sources"].add(r["url"])

    out_rows = []
    by_court = collections.defaultdict(list)
    for k, e in vac.items():
        months = sorted(e["months"])
        status = ("open" if e["on_current_list"] else "announced" if e["on_current_future"] else
                  "confirmation_listed" if e["confirmations"] else "no_longer_listed")
        if not months and not e["on_current_list"] and not e["on_current_future"] and not e["confirmations"] and not e["future_months"] and not e["emergency_months"] and not e["on_current_emergencies"]:
            continue
        inc_link, inc_basis = link(leaving, e["court_id"], e["incumbent"], e["vacancy_date"])
        stats[f"incumbent_link_{inc_basis}"] += 1
        confs = []
        for c in sorted(e["confirmations"].values(), key=lambda c: c["confirmation_date"] or ""):
            nl, nb = link(confirmed_idx, e["court_id"], c["nominee"], c["confirmation_date"])
            stats[f"nominee_link_{nb}"] += 1
            confs.append({**{x: c[x] for x in ("nominee", "nomination_date", "confirmation_date", "url")}, "listed_months": sorted(c["listed"]),
                          "fjc_link": nl, "link_basis": nb})
        nominees = []
        for n in sorted(e["nominees"].values(), key=lambda n: (n["nomination_date"] or "", n["nominee"])):
            dated = sorted(m for m in n["months"] if m != "current")
            nominees.append({"nominee": n["nominee"], "nomination_date": n["nomination_date"], "first_listed": dated[0] if dated else None,
                             "last_listed": dated[-1] if dated else None, "on_current_list": "current" in n["months"]})
        # the nominee printed on the current (Oct 22, 2026) list; an earlier nominee no longer printed is history, not pending
        pending = [n for n in nominees if n["on_current_list"]] if status in ("open", "announced") else []
        vdate = e["vacancy_date"]
        days_open = (AS_OF - date.fromisoformat(vdate)).days if (status == "open" and vdate) else None
        days_to_conf = None
        if confs and vdate and confs[-1]["confirmation_date"]:
            days_to_conf = (date.fromisoformat(confs[-1]["confirmation_date"]) - date.fromisoformat(vdate)).days
        court = e["court_id"]
        court_name = spine.get(court, {}).get("title") if court else None
        digest = hashlib.sha256(json.dumps([k[0], list(k[1]), k[2]]).encode()).hexdigest()[:10]  # the full exact key
        rid = "vac:" + ":".join([court or "unmapped", vdate or "tbd", ("-".join(k[1])[:48] or "unnamed"), digest])
        item = {
            "kind": "vacancy" if (months or e["on_current_list"] or e["confirmations"] or e["emergency_months"] or e["on_current_emergencies"]) else "future",
            "court_id": court, "court_name": court_name, "court_as_published": e["court_as_published"], "incumbent": e["incumbent"],
            "reason": e["reason"], "vacancy_date": vdate, "notification_date": e["notification_date"], "status": status,
            "first_listed": months[0] if months else None, "last_listed": months[-1] if months else None, "months_listed": len(months),
            "future_first_listed": min(e["future_months"]) if e["future_months"] else None,
            "on_current_list": e["on_current_list"], "on_current_future": e["on_current_future"],
            "emergency": {"months": len(e["emergency_months"]), "first": min(e["emergency_months"]) if e["emergency_months"] else None,
                          "last": max(e["emergency_months"]) if e["emergency_months"] else None, "current": e["on_current_emergencies"],
                          "latest": e["emergency_latest"]},
            "nominees": nominees, "pending_nominee": pending[-1] if pending else None,
            "confirmations": confs, "days_open_as_of_2026_10_22": days_open, "days_vacancy_to_confirmation": days_to_conf,
            "incumbent_fjc_link": inc_link, "incumbent_link_basis": inc_basis,
            "source_urls": sorted(e["sources"])[-6:], "source_count": len(e["sources"]),
        }
        stats[f"status_{status}"] += 1
        out_rows.append(record(rid, item))
        if court:
            by_court[court].append(item)

    # court summaries
    for court, items in sorted(by_court.items()):
        opened = collections.Counter((i["vacancy_date"] or "")[:4] for i in items if i["vacancy_date"])
        conf_days = sorted(i["days_vacancy_to_confirmation"] for i in items if i["days_vacancy_to_confirmation"] is not None and i["days_vacancy_to_confirmation"] >= 0)
        cur = [slim(i) for i in items if i["status"] == "open"]
        fut = [slim(i) for i in items if i["status"] == "announced"]
        emer = [slim(i) for i in items if i["emergency"]["current"]]
        recent = sorted((slim(i) for i in items if i["status"] in ("confirmation_listed", "no_longer_listed")), key=lambda x: x["vacancy_date"] or "", reverse=True)[:25]
        item = {"kind": "court", "court_id": court, "court_name": spine.get(court, {}).get("title"), "open": cur, "announced": fut, "emergencies": emer,
                "recent_history": recent, "vacancies_by_year_opened": dict(sorted(opened.items())), "vacancies_listed_total": len(items),
                "median_days_vacancy_to_confirmation": conf_days[len(conf_days) // 2] if conf_days else None,
                "confirmations_with_dates": len(conf_days)}
        out_rows.append(record(f"court:{court}", item))

    # national monthly series and coverage
    per_month = collections.defaultdict(collections.Counter)
    for r in rows:
        if r["month"] != "current" and r["kind"] in ("vacancies", "future", "emergencies", "confirmations"):
            per_month[r["month"]][r["kind"]] += 1
    cov_by_month = collections.defaultdict(dict)
    for c in coverage:
        cov_by_month[c["month"]][c["kind"]] = {"status": c["status"], "format": c["format"], "url": c["url"], "published_totals": c.get("published_totals")}
    series = []
    for m in sorted(k for k in cov_by_month if k != "current"):
        tot = (cov_by_month[m].get("vacancies") or {}).get("published_totals") or {}
        series.append({"month": m, "vacancies_listed": per_month[m]["vacancies"] or None, "future_listed": per_month[m]["future"] or None,
                       "emergencies_listed": per_month[m]["emergencies"] or None, "published_total_vacancies": tot.get("Vacancies"),
                       "published_nominees_pending": tot.get("Nominees Pending"),
                       "reports": {k: v["status"] for k, v in cov_by_month[m].items()}})
    current = {k: v for k, v in cov_by_month.get("current", {}).items()}
    confirmed = [i for items in by_court.values() for i in items if i["confirmations"] and i["confirmations"][-1]["confirmation_date"]]
    recent_conf = sorted(confirmed, key=lambda i: i["confirmations"][-1]["confirmation_date"], reverse=True)[:60]
    nat = {"kind": "national", "series": series, "current_reports": current,
           "recent_confirmations": [slim(i) for i in recent_conf],
           "current_counts": {"open": stats["status_open"], "announced": stats["status_announced"],
                              "emergencies": sum(1 for r in out_rows if r["item"].get("kind") in ("vacancy", "future") and r["item"]["emergency"]["current"])},
           "coverage": dict(collections.Counter(c["status"] for c in coverage)),
           "not_parsed": [{"month": c["month"], "kind": c["kind"], "status": c["status"], "url": c["url"]} for c in coverage if c["status"].startswith("not parsed")]}
    out_rows.append(record("national", nat))

    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary = {
        "source": "Administrative Office of the U.S. Courts, judicial vacancies (uscourts.gov): current lists as of 2026-10-22 and the monthly archive 1981-2026",
        "source_pages": [CURRENT_URL, ARCHIVE_URL], "terms": "U.S. federal judiciary publication (17 U.S.C. 105); no reuse restriction found.",
        "definitions": __doc__.split("Records:", 1)[1].strip(), "as_of": AS_OF.isoformat(),
        "coverage": nat["coverage"],
        "coverage_note": "Most monthly reports from 1988 to 2001 are scanned PDFs without a text layer and are not parsed; 2002-2009 emergency, confirmation and summary PDFs are kept raw but not parsed. Months not parsed are listed in the national record.",
        "names": "Incumbents and nominees are shown exactly as published by the AO ('Last, First').",
        "stats": dict(stats), "built_at": built,
    }
    build = {"dataset": DATASET, "label": "Federal judicial vacancies, future vacancies, emergencies and confirmations (uscourts.gov, 1981-2026)",
             "listing_block": {"page": 1, "limit": 50,
                               "columns": [{"key": "court", "label": "Court"}, {"key": "incumbent", "label": "Vacancy created by"},
                                           {"key": "reason", "label": "Reason"}, {"key": "vacancy_date", "label": "Vacancy date"},
                                           {"key": "status", "label": "Status"}, {"key": "nominee", "label": "Nominee (pending if open)"}],
                               "filters": [{"name": "q", "type": "search", "label": "Search"},
                                           {"name": "status", "type": "select", "label": "Status", "options": [{"label": "Open", "value": "open"}, {"label": "Announced (future)", "value": "announced"}, {"label": "Confirmation listed", "value": "confirmation_listed"}, {"label": "No longer listed", "value": "no_longer_listed"}]},
                                           {"name": "kind", "type": "select", "label": "Record", "options": [{"label": "Vacancy", "value": "vacancy"}, {"label": "Future vacancy", "value": "future"}, {"label": "Court summary", "value": "court"}]}]},
             "summary": summary, "rows": out_rows, "built_at": built,
             "inputs": [{"url": CURRENT_URL, "path": "private/acq/judiciary/vacancies (see private/acq/judiciary/_manifest.jsonl)"}]}
    (BUILD / f"{DATASET}.json").write_text(json.dumps(build))
    print(json.dumps({"records": len(out_rows), "kinds": dict(collections.Counter(r["item"]["kind"] for r in out_rows)), **stats}))


def slim(i: dict) -> dict:
    return {k: i[k] for k in ("court_id", "incumbent", "reason", "vacancy_date", "notification_date", "status", "days_open_as_of_2026_10_22",
                              "first_listed", "last_listed")} | {
        "nominee": (i["nominees"][-1]["nominee"] if i["nominees"] else None), "nomination_date": (i["nominees"][-1]["nomination_date"] if i["nominees"] else None),
        "pending_nominee": (i["pending_nominee"] or {}).get("nominee"), "pending_nomination_date": (i["pending_nominee"] or {}).get("nomination_date"),
        "court_name": i["court_name"], "court_as_published": i["court_as_published"],
        "emergency_days_pending": ((i["emergency"]["latest"] or {}).get("days_pending")), "weighted": ((i["emergency"]["latest"] or {}).get("weighted")),
        "confirmation": (i["confirmations"][-1] if i["confirmations"] else None), "incumbent_fjc_link": i["incumbent_fjc_link"]}


def record(rid: str, item: dict) -> dict:
    kind = item["kind"]
    if kind in ("vacancy", "future"):
        title = f"{item['court_name'] or item['court_as_published']}: vacancy created by {item['incumbent'] or 'Not recorded'}"
        latest_nom = item["nominees"][-1] if item["nominees"] else None
        facts = [["Court (as published)", item["court_as_published"] or "Not recorded"], ["Vacancy created by", item["incumbent"] or "Not recorded"],
                 ["Reason", item["reason"] or "Not recorded"], ["Vacancy date", item["vacancy_date"] or "Not recorded (TBD)"],
                 ["Status", item["status"].replace("_", " ")],
                 ["Months on the vacancy list", f"{item['months_listed']} ({item['first_listed']} to {item['last_listed']})" if item["months_listed"] else "None in the parsed archive"],
                 ["Nominee on the current list", ((item["pending_nominee"] or {}).get("nominee") or "None") if item["status"] in ("open", "announced") else "Not applicable (no longer open)"],
                 ["Nominees listed", "; ".join(f"{n['nominee']} (nominated {n['nomination_date'] or 'date not recorded'})" for n in item["nominees"]) or "None listed"],
                 ["Confirmation listed", "; ".join(f"{c['nominee']} confirmed {c['confirmation_date']}" for c in item["confirmations"]) or "None listed"],
                 ["Judicial emergency", f"{item['emergency']['months']} months listed" + (" (on the current list)" if item["emergency"]["current"] else "") if (item["emergency"]["months"] or item["emergency"]["current"]) else "Not listed"],
                 ["Source", "Administrative Office of the U.S. Courts, judicial vacancy reports (uscourts.gov)"]]
        cells = {"court": item["court_as_published"], "incumbent": item["incumbent"], "reason": item["reason"], "vacancy_date": item["vacancy_date"] or "TBD",
                 "status": item["status"].replace("_", " "),
                 "nominee": ((item["pending_nominee"] or {}).get("nominee") or "None pending") if item["status"] in ("open", "announced")
                 else (latest_nom["nominee"] if latest_nom else "—")}
        src = item["source_urls"][-1] if item["source_urls"] else CURRENT_URL
        links = [{"url": f"/courts/{item['court_id']}", "label": "Court profile"}] if item["court_id"] else []
        if item["incumbent_fjc_link"] and item["incumbent_fjc_link"].get("judge_profile_id"):
            links.append({"url": f"/judges/{item['incumbent_fjc_link']['judge_profile_id']}", "label": "Judge profile (vacancy created by)"})
        for c in item["confirmations"]:
            if c["fjc_link"] and c["fjc_link"].get("judge_profile_id"):
                links.append({"url": f"/judges/{c['fjc_link']['judge_profile_id']}", "label": "Judge profile (confirmed nominee)"})
        links.append({"url": src, "label": "Latest uscourts.gov report listing this vacancy"})
        filters = {"_listing": ["yes"], "kind": [kind], "court": [item["court_id"]] if item["court_id"] else [], "status": [item["status"]],
                   "year": [item["vacancy_date"][:4]] if item["vacancy_date"] else [], "emergency": ["yes" if item["emergency"]["current"] else "no"]}
    elif kind == "court":
        title = f"{item['court_name'] or item['court_id']}: judicial vacancies"
        facts = [["Open vacancies (Oct 22, 2026)", str(len(item["open"]))], ["Announced future vacancies", str(len(item["announced"]))],
                 ["Current judicial emergencies", str(len(item["emergencies"]))], ["Vacancies listed since 1981 (parsed reports)", str(item["vacancies_listed_total"])],
                 ["Median days from vacancy to listed confirmation", str(item["median_days_vacancy_to_confirmation"]) if item["median_days_vacancy_to_confirmation"] is not None else "Not recorded"]]
        cells = {"court": item["court_name"] or item["court_id"], "incumbent": "—", "reason": "—", "vacancy_date": "—",
                 "status": f"{len(item['open'])} open", "nominee": "—"}
        src = CURRENT_URL
        links = [{"url": f"/courts/{item['court_id']}", "label": "Court profile"}, {"url": CURRENT_URL, "label": "Current judicial vacancies (uscourts.gov)"}]
        filters = {"_listing": ["yes"], "kind": ["court"], "court": [item["court_id"]], "status": []}
    else:
        title = "Federal judicial vacancies: monthly series and archive coverage, 1981-2026"
        facts = [["Open vacancies (Oct 22, 2026)", str(item["current_counts"]["open"])], ["Announced future vacancies", str(item["current_counts"]["announced"])],
                 ["Current judicial emergencies", str(item["current_counts"]["emergencies"])],
                 ["Archive reports parsed", str(item["coverage"].get("parsed", 0))],
                 ["Archive reports not parsed (scanned images or unsupported PDF layouts)", str(sum(v for k, v in item["coverage"].items() if k.startswith("not parsed")))]]
        cells = {"court": "All federal courts", "incumbent": "—", "reason": "—", "vacancy_date": "—", "status": f"{item['current_counts']['open']} open", "nominee": "—"}
        src = ARCHIVE_URL
        links = [{"url": CURRENT_URL, "label": "Current judicial vacancies (uscourts.gov)"}, {"url": ARCHIVE_URL, "label": "Archive of judicial vacancies (uscourts.gov)"}]
        filters = {"_listing": ["yes"], "kind": ["national"], "court": [], "status": []}
    return {"dataset": DATASET, "id": rid, "category": DATASET, "state": "", "title": title, "source_url": src,
            "item": {"id": rid, "title": title, "subtitle": "uscourts.gov judicial vacancies", "cells": cells, "badges": [], "links": links, **item},
            "detail": {"id": rid, "title": title, "subtitle": "uscourts.gov judicial vacancies", "facts": facts, "links": links},
            "text": f"{title} {item.get('reason') or ''}", "filters": filters}


if __name__ == "__main__":
    main()
