"""Build settlement_claims_official: settlements whose official page confirms the name and at least one fact.

  python3 -I -B scripts/enrichment/enforcement_actions/build_settlements.py

Leads come from SettleSignal (https://settlesignal.com/data/settlements.json; "Free to use with attribution. Credit
'SettleSignal (settlesignal.com)' with a link to https://settlesignal.com/"). A lead is kept only when its official
settlement page (read by fetch_settlesignal.py) confirms the settlement name and at least one published fact
(deadline, dollar amount, court, case number). Only facts confirmed on that page are published, each with its
verification status and the page's own wording; SettleSignal's status, eligibility and payout text are not published.
"""
import json
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timezone
from urllib.parse import urljoin, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_common as bc  # noqa: E402
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402
import links  # noqa: E402
import retype_claims as rt  # noqa: E402
import settle_confirm as sc  # noqa: E402

DIR = os.path.join(ec.ACQ, "settlesignal")
LEADS_URL = "https://settlesignal.com/data/settlements.json"
CREDIT = "Leads discovered via SettleSignal (settlesignal.com), https://settlesignal.com/ — free to use with attribution; every published fact is confirmed on the official settlement page it cites"


def decode(body):
    for enc in ("utf-8", "cp1252"):
        try:
            return body.decode(enc)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", "replace")


def same_target(claim_url, page_url, hrefs):
    """True when the page links to the lead's claim URL (absolute, or relative resolving to the same URL)."""
    if not claim_url:
        return False
    target = claim_url.rstrip("/").lower()
    for h in hrefs:
        absolute = urljoin(page_url, h).rstrip("/").lower()
        if absolute == target:
            return True
    return False


def slug_of(url):
    path = urlsplit(url or "").path.rstrip("/")
    return re.sub(r"[^a-z0-9-]", "", path.rsplit("/", 1)[-1].lower())[:90] or None


def main():
    courts = links.Courts()
    today = datetime.now(timezone.utc).date()
    leads = json.loads(ec.read_gz(os.path.join(DIR, "settlements.json.gz")))
    status = {}
    for row in ec.load_jsonl(os.path.join(DIR, "fetch_status.jsonl")):
        status[row["url"]] = row
    reader = ec.PackReader(os.path.join(DIR, "official_pages"))
    stats = Counter()
    reasons = Counter()
    rows, ledger = [], []
    for lead in leads["settlements"]:
        stats["leads"] += 1
        url = (lead.get("official_settlement_url") or "").strip()
        st = status.get(url, {})
        outcome = st.get("outcome") or "not_attempted"
        entry = {"lead": lead.get("url"), "title": lead.get("title"), "official_url": url, "fetch": outcome}
        if outcome != "fetched" or url not in reader.index:
            reasons[f"page not read: {outcome}"] += 1
            entry["kept"] = False
            entry["reason"] = f"official page not read ({outcome})"
            ledger.append(entry)
            continue
        raw = decode(reader.get(url))
        meta = reader.index[url]
        # only content a reader sees on the page counts: <template> fragments (rendered later by scripts) are left out
        text = ex.html_to_text(re.sub(r"<template\b.*?</template>", " ", raw, flags=re.S | re.I))
        name_status, name_detail = sc.confirm_name(lead.get("title"), text)
        deadline = sc.confirm_deadline(lead.get("claim_deadline"), text)
        amounts, amount_status = sc.confirm_amounts(lead.get("estimated_payout"), text)
        court_list = sc.stated_courts(text, courts)
        cases = sc.stated_case_numbers(text)
        claim_found = same_target(lead.get("official_claim_url"), meta.get("final_url") or url, sc.page_links(raw))
        entry.update({"name": name_status or f"not confirmed ({name_detail})", "deadline": deadline["status"],
                      "amount": amount_status, "courts": len(court_list), "case_numbers": len(cases)})
        stats["pages_read"] += 1
        stats[f"deadline_{deadline['status']}"] += 1
        stats[f"amount_{amount_status}"] += 1
        published = []
        if deadline["status"] == "confirmed":
            published.append("deadline")
        if amounts:
            published.append("amount")
        if court_list:
            published.append("court")
        if cases:
            published.append("case number")
        if not name_status:
            reasons["name not confirmed on the official page"] += 1
            entry["kept"] = False
            entry["reason"] = "name not confirmed"
            ledger.append(entry)
            continue
        stats["name_confirmed"] += 1
        if not published:
            reasons["name confirmed but no deadline/amount/court/case number confirmed"] += 1
            entry["kept"] = False
            entry["reason"] = "no fact confirmed"
            ledger.append(entry)
            continue
        entry["kept"] = True
        ledger.append(entry)
        for f in published:
            stats[f"published_{f}"] += 1
        slug = slug_of(lead.get("url")) or ec.sha256(url.encode())[:16]
        rid = f"settle:{slug}"
        dl = lead.get("claim_deadline") if deadline["status"] == "confirmed" else None
        if dl:
            days = (date.fromisoformat(dl) - today).days
            deadline_state = "passed" if days < 0 else ("within_30_days" if days <= 30 else "future")
        else:
            deadline_state = "none"
        court_ids = sorted({c["court_id"] for c in court_list if c.get("court_id")})
        page_name = sc.page_title(raw)
        host = urlsplit(meta.get("final_url") or url).hostname or ""
        settlement = {
            "name": lead.get("title"), "name_check": name_status, "page_title": page_name,
            "official_url": url, "final_url": meta.get("final_url"), "official_host": host,
            "page_retrieved_at": meta.get("retrieved_at"), "page_sha256": meta.get("sha256"),
            "deadline": {"date": dl, **{k: v for k, v in deadline.items() if k in ("status", "as_written", "sentence", "page_date_as_written")}},
            "amounts": [{k: a[k] for k in ("page_as_written", "value_usd", "sentence", "status")} for a in amounts[:4]],
            "amount_check": amount_status,
            "courts": [{"as_written": c["as_written"], "court_id": c.get("court_id"), "status": "stated_on_page"} for c in court_list],
            "case_numbers": [{"as_written": d["as_written"], "status": "stated_on_page"} for d in cases],
            "claim_url": lead.get("official_claim_url") if claim_found else None,
            "claim_url_check": "linked from the official page" if claim_found else ("not linked from the official page" if lead.get("official_claim_url") else "not_in_lead"),
            "facts_confirmed": published,
            "discovery": {"source": "SettleSignal (settlesignal.com)", "url": lead.get("url"), "licence": leads.get("license")},
        }
        link_list = [{"url": meta.get("final_url") or url, "label": f"Official settlement page ({host})"}]
        if claim_found:
            link_list.append({"url": lead["official_claim_url"], "label": "Claim form (linked from the official page)"})
        link_list += [{"url": f"/courts/{cid}", "label": f"Court named on the page: {courts.name(cid)}"} for cid in court_ids]
        link_list.append({"url": lead.get("url"), "label": "Lead source: SettleSignal (settlesignal.com)"})
        verification_label = f"Name ({name_status}) and {', '.join(published)} confirmed on the official page"
        rows.append(bc.record(
            "settlement_claims_official", rid, lead.get("title"), source_url=meta.get("final_url") or url,
            subtitle=" · ".join(x for x in [host, f"claim deadline {dl}" if dl else None] if x),
            cells={"settlement": lead.get("title"), "deadline": dl or "Not confirmed on the official page",
                   "amount": amounts[0]["page_as_written"] if amounts else "Not confirmed on the official page",
                   "court": court_list[0]["as_written"] if court_list else bc.NOT_RECORDED,
                   "case_number": cases[0]["as_written"] if cases else bc.NOT_RECORDED,
                   "official_page": host, "verified": ", ".join(published)},
            facts=[("Settlement (name confirmed on the official page)", f"{lead.get('title')} ({name_status})"),
                   ("Name on the official page", page_name),
                   ("Claim deadline", f"{dl} — page says \"{deadline['as_written']}\"" if dl else f"Not published ({deadline['status'].replace('_', ' ')})"),
                   ("Dollar figures confirmed on the page", [f"{a['page_as_written']} — \"{(a['sentence'] or '')[:200]}\"" for a in amounts[:4]]),
                   ("Court stated on the page", [c["as_written"] for c in court_list]),
                   ("Case number stated on the page", [d["as_written"] for d in cases]),
                   ("Claim form", "Linked from the official page" if claim_found else None),
                   ("Official page", meta.get("final_url") or url), ("Page read (UTC)", meta.get("retrieved_at")),
                   ("Verification", verification_label),
                   ("Discovery source", "SettleSignal (settlesignal.com) lead list; facts above are from the official page only")],
            text=" ".join(filter(None, [lead.get("title"), page_name, host, " ".join(d["as_written"] for d in cases)])),
            filters={"deadline_state": [deadline_state], "court": court_ids,
                     "verified": published, "has_amount": ["yes" if amounts else "no"]},
            links=link_list, extra={"settlement": settlement},
        ))
    # amount roles, exact MDL docket links and deadline states (the same retype the published rows get)
    rows = sorted((rt.retype_row(r, today) for r in rows), key=rt.sort_key)
    seen, unique = set(), []
    for r in rows:
        if r["id"] in seen:
            stats["duplicate_ids_dropped"] += 1
            continue
        seen.add(r["id"])
        unique.append(r)
    stats["kept"] = len(unique)
    os.makedirs(ec.BUILD, exist_ok=True)
    with open(os.path.join(ec.BUILD, "settlement_claims_ledger.jsonl"), "w", encoding="utf-8") as h:
        for e in ledger:
            h.write(json.dumps(e, ensure_ascii=False) + "\n")
    summary = {
        "source": "Official settlement pages (settlement administrators, courts, agencies) named by SettleSignal leads",
        "discovery_credit": CREDIT, "discovery_source": {"name": "SettleSignal", "url": "https://settlesignal.com/", "data": LEADS_URL, "licence": leads.get("license")},
        "rule": "Kept only when the official page confirms the settlement name and at least one of: claim deadline (same calendar date written on the page), dollar figure (same value on the page), court or case number (stated on the page). Only confirmed facts are published.",
        "statuses": {"confirmed": "verbatim on the page", "confirmed (same value)": "same dollar value written differently", "stated_on_page": "court or case number as written on the official page", "not_found": "not on the page; not published", "contradicted": "the page states a different date in a deadline sentence; not published"},
        "deadline_note": "Deadlines are dates the official page states; deadline_state is computed against the build date. Confirm on the official page before relying on a date.",
        "stats": dict(stats), "excluded": dict(reasons),
    }
    summary["amount_rule"], summary["mdl_rule"] = rt.TYPE_RULE, rt.MDL_RULE
    bc.write_build("settlement_claims_official", "Settlement claims confirmed on official pages", unique, rt.listing_block(),
                   summary, bc.manifest_inputs(["private/acq/enforcement_actions/settlesignal/"]))
    print(json.dumps(dict(stats)))
    print(json.dumps(dict(reasons)))


if __name__ == "__main__":
    main()
