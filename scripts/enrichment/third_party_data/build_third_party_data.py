"""Build the third_party_data stream's publishable datasets (build files only; this script never writes to the corpus).

Datasets (private/build/third_party_data/<id>.json, shaped for corpus_writer.publish):
  settlement_notices                   Settlement notices compiled from public settlement notices and administrator pages (the open-data
                                       compilation recorded in private/acq/third_party_data/settlesignal/), each citing its official page
                                       (court, claims administrator, agency / attorney-general page); per-record verification status.
  enforcement_data_sources_catalog     Factual catalog of federal and state/local enforcement data sources (agency, jurisdiction, what it
                                       covers, the agency's own URL), compiled from agency enforcement-data pages (the source listing is the
                                       Violation Tracker data-source pages saved under private/acq/third_party_data/violationtracker/).

OWNER DECISION 2026-10-18: no PUBLISHED field names or points to the compilations they were derived from. The provenance lives only in private
files: this code, private/acq manifests, private/build REPORT.md and the *_provenance_private.json maps. check_no_source_names.py enforces it.

Also writes (private): notice_provenance_private.json, catalog_provenance_private.json, settlesignal_overlap.json (vs corpus dataset
`settlements`), third_party_settlesignal_excluded.json, enforcement_data_sources_catalog_excluded.json, build_stats.json.

Inputs (read-only): private/acq/third_party_data/** (raw captures + check logs + verification verdicts) and
private/build/third_party_data/lookups/** (read-only corpus SQL results).

Usage: python3 -I -B build_third_party_data.py
"""
import collections
import datetime
import hashlib
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import tp_common as tp  # noqa: E402
import vt_parse as vp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")
LOOKUPS = os.path.join(BUILD, "lookups")

SS_DATASET = "settlement_notices"
CAT_DATASET = "enforcement_data_sources_catalog"
NOTICE_PREFIX = "notice:"
SRC_PREFIX = "src:"
LEGACY_CAT_PREFIX = "vt-src:"  # ids used by the first (held) build; the hand-read catalog spot checks are keyed by them
# Private provenance (never written to a publishable build file): the compilations the two datasets were derived from.
SS_JSON_URL = "https://settlesignal.com/data/settlements.json"
VT_FED = "https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources"
VT_STATE = "https://violationtracker.goodjobsfirst.org/pages/local-state-data-sources"
# Neutral published wording (owner decision 2026-10-18).
NOTICE_METHOD = ("Compiled from public settlement notices and administrator pages; figures marked Verified were checked against the cited "
                 "official page, others are Not verified")
CATALOG_METHOD = "Compiled from agency enforcement-data pages; each entry links the agency's own page"
NOTICE_BADGE = "Compiled record"
TYPE_LABELS = {
    "other_consumer_compensation": "Other consumer compensation", "data_breach_settlement": "Data breach", "class_action_settlement": "Class action",
    "government_refund": "Government refund", "privacy_settlement": "Privacy", "financial_fee_settlement": "Financial fees",
    "consumer_product_settlement": "Consumer product", "state_ag_refund": "State AG refund", "regulatory_compensation_program": "Regulatory compensation program",
}
VERDICT_LABELS = {"verified": "Verified against official source", "partially_verified": "Partially verified against official source",
                  "identity_only": "Matter confirmed on official source; fields not found", "contradicted": "Contradicted by official source",
                  "not_verified": "Not verified"}
VERDICT_SHORT = {"verified": "Verified", "partially_verified": "Partially verified", "identity_only": "Matter only", "contradicted": "Contradicted",
                 "not_verified": "Not verified"}
FIGURES_FROM = {
    "verified": "Official source (every checked field was found on the cited page)",
    "partially_verified": "Compiled record; fields marked 'confirmed' were also found on the official page",
    "identity_only": "Compiled record; the official page confirms only which matter this is",
    "contradicted": "Compiled record; the official page prints a different value for the field marked 'contradicted'",
    "not_verified": "Compiled record (not checked against the official page)",
}
RETRIEVAL_LABELS = {"direct": "Direct fetch from the research environment (bytes saved unchanged)",
                    "firecrawl": "Firecrawl MCP page read (the environment is blocked or bot-walled by the host)",
                    "none": "Not loaded (host blocks automated access, or robots.txt disallows it)"}
SOURCE_TYPE_LABELS = {"press_releases": "Press releases / announcements", "orders_and_actions": "Orders, actions, penalties, settlements",
                      "dataset_download": "Dataset download", "open_records_request": "Open-records (FOIA) request mentioned",
                      "docket": "Docket", "reports": "Reports / bulletins / agendas", "resource": "Agency resource", "other": "Other"}
LEVEL_LABELS = {"federal": "Federal agency", "federal_self_regulatory": "Federal self-regulatory organisation", "state": "State agency",
                "local": "Local (county/city) office", "regional": "Regional agency"}
# Official federal acronyms used ONLY for whole-word matches against corpus dataset labels (documented, deterministic).
FED_ACRONYMS = {
    "Environmental Protection Agency": "EPA", "Food and Drug Administration": "FDA", "Consumer Product Safety Commission": "CPSC",
    "National Highway Traffic Safety Administration": "NHTSA", "Securities and Exchange Commission": "SEC", "Federal Trade Commission": "FTC",
    "Consumer Financial Protection Bureau": "CFPB", "Occupational Safety & Health Administration": "OSHA", "Federal Aviation Administration": "FAA",
    "Federal Communications Commission": "FCC", "Federal Deposit Insurance Corporation": "FDIC", "Federal Election Commission": "FEC",
    "Federal Energy Regulatory Commission": "FERC", "Federal Housing Finance Agency": "FHFA", "Federal Maritime Commission": "FMC",
    "Federal Motor Carrier Safety Administration": "FMCSA", "Federal Railroad Administration": "FRA", "Food Safety and Inspection Service": "FSIS",
    "Mine Safety & Health Administration": "MSHA", "National Credit Union Administration": "NCUA", "National Labor Relations Board": "NLRB",
    "Nuclear Regulatory Commission": "NRC", "Office of Federal Contract Compliance Programs": "OFCCP", "Office of Foreign Assets Control": "OFAC",
    "Office of the Comptroller of the Currency": "OCC", "Pipeline and Hazardous Materials Safety Administration": "PHMSA",
    "Public Company Accounting Oversight Board": "PCAOB", "Centers for Medicare & Medicaid Services": "CMS",
    "Commodity Futures Trading Commission": "CFTC", "Drug Enforcement Administration": "DEA", "Equal Employment Opportunity Commission": "EEOC",
    "Employee Benefits Security Administration": "EBSA", "Bureau of Safety and Environmental Enforcement": "BSEE",
    "Bureau of Industry and Security": "BIS", "Customs and Border Protection": "CBP", "Immigration and Customs Enforcement": "ICE",
    "Internal Revenue Service": "IRS", "Treasury Department Financial Crimes Enforcement Network": "FinCEN",
    "Financial Industry Regulatory Authority (securities industry self-regulator authorized by Congress)": "FINRA",
}
ENFORCEMENT_PREFIXES = ("agency_safety_", "regulatory_", "settlements")


def dataset_kind(dataset):
    """Coarse, prefix-based kind of a corpus dataset (documented rule; not a judgement about completeness)."""
    if dataset.startswith(ENFORCEMENT_PREFIXES):
        return "enforcement/safety/regulatory data"
    if dataset.startswith("company_"):
        return "company profile data"
    if dataset.startswith("state_metrics_"):
        return "derived state metrics"
    return "reference/directory"


def sha256_file(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def facts(pairs):
    return [[label, "Not recorded" if value in (None, "") else str(value)] for label, value in pairs]


def slug_of(url):
    return url.rstrip("/").rsplit("/", 1)[-1]


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        for raw in open(path, encoding="utf-8"):
            if raw.strip():
                out.append(json.loads(raw))
    return out


# ---------------------------------------------------------------- lookups

def load_existing_settlements():
    blob = json.load(open(os.path.join(LOOKUPS, "settlements_existing.json"), encoding="utf-8"))["rows"][0]["blob"]
    rows = []
    for line in blob.split("\n"):
        parts = line.split("\t") + [""] * 8
        rid, slug, source_url, title, amt, cap, fam, mdl = parts[:8]
        rows.append({"id": rid, "slug": slug.rstrip("/"), "source_url": source_url, "title": title, "amount_in_title": amt,
                     "caption": cap, "family": fam, "mdl": mdl})
    return rows


def load_companies():
    index = collections.defaultdict(list)
    names = {}
    for raw in open(os.path.join(LOOKUPS, "company_sec_profiles.tsv"), encoding="utf-8"):
        if raw.startswith("#") or not raw.strip():
            continue
        cik, name, tickers = (raw.rstrip("\n").split("\t") + ["", ""])[:3]
        index[tp.norm_company(name)].append(cik)
        names[cik] = name
    return index, names


def load_corpus_sources():
    rows = json.load(open(os.path.join(LOOKUPS, "corpus_dataset_sources.json"), encoding="utf-8"))["rows"]
    hosts = collections.defaultdict(collections.Counter)
    labels, records = {}, {}
    for row in rows:
        kind, dataset, value, n = row["kind"], row["dataset"], row["value"], row["n"]
        if kind == "host" and value:
            hosts[dataset][tp.host_of("https://" + value)] += int(n)
        elif kind == "meta_url" and value:
            hosts[dataset][tp.host_of(value)] += 0
        elif kind == "label":
            labels[dataset] = {"label": value, "ready": n == "true"}
        elif kind == "records":
            records[dataset] = int(n)
    by_host = collections.defaultdict(dict)
    for dataset, counter in hosts.items():
        for host, n in counter.items():
            by_host[host][dataset] = n
    return by_host, labels, records


# ---------------------------------------------------------------- SettleSignal

def load_checks():
    return {line["settlesignal_url"]: line for line in read_jsonl(os.path.join(ACQ, "official_pages", "_checks.jsonl"))}


def load_verdicts():
    path = os.path.join(ACQ, "verification", "verdicts.json")
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"rows": []}


RELEVANT = re.compile(r"settlement|class action|refund|claim|restitution|redress|litigation|lawsuit|distribution|fair fund|case no|\bv\.\s|\bvs?\.?\s", re.I)


def page_relevant(check):
    """A retrieved page counts only if it stays on the cited host (same registrable domain) and its bytes carry legal/settlement
    vocabulary (settlement, claim, refund, litigation, distribution, case no, 'X v. Y', ...). Catches parked or hijacked domains."""
    requested, final = tp.host_of(check.get("url")), tp.host_of(check.get("final_url") or check.get("url"))
    same_site = vp.registrable(requested) == vp.registrable(final)
    body = b""
    if check.get("path") and os.path.exists(os.path.join(ROOT, check["path"])):
        with open(os.path.join(ROOT, check["path"]), "rb") as handle:
            body = handle.read()
    return same_site and bool(RELEVANT.search(body.decode("utf-8", "replace")))


# Body hash of the identical 1301-byte 'Page Not Found' page the research sandbox receives from ftc.gov for EVERY path (/, /robots.txt and
# all refund pages). It is an environment block, not evidence that a page is gone, so it is never read as an HTTP 404 for the cited page.
SANDBOX_BLOCK_SHA = "6cb6ddd1f7eefd58b6094bfb287c9fafa16b34eb1dfbf27416431220d9e45e5e"
FIRECRAWL_FTC_BASE = "https://www.ftc.gov/enforcement/refunds/"


def load_firecrawl():
    """url -> {status, note, usable} from the Firecrawl page reads saved in verification/firecrawl_checks.json.
    Entries are [url_or_ftc_slug, status, note] or [url, status, note, usable]; usable defaults to true for a 200 and says whether the
    page read is the cited settlement/agency page (false: parked, hijacked, redirected to an unrelated page, inactive case)."""
    path = os.path.join(ACQ, "verification", "firecrawl_checks.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    out = {}
    for key, status, note, *rest in data.get("ftc", []):
        out[key if key.startswith("http") else FIRECRAWL_FTC_BASE + key] = {"status": status, "note": note, "usable": status == 200 and (rest[0] if rest else True)}
    for url, status, note, *rest in data.get("other", []):
        out[url] = {"status": status, "note": note, "usable": status == 200 and (rest[0] if rest else True)}
    return out


def retrieval_state(check, firecrawl=None):
    """(state, note, method). state: retrieved | access_restricted | not_retrieved; method: direct | firecrawl | none.
    A Firecrawl read can only upgrade a sandbox failure when the page it read is the cited page (usable); it is never used where
    robots.txt disallows automated retrieval."""
    if not check:
        return "not_retrieved", "Not checked", "none"
    status, outcome = check.get("status"), check.get("outcome")
    fc = (firecrawl or {}).get(check.get("url"))
    fc_ok = bool(fc and fc["usable"])
    fc_note = f"; independent read through Firecrawl: HTTP {fc['status']} ({fc['note']})" if fc and fc["status"] else (f"; independent read through Firecrawl: {fc['note']}" if fc else "")
    if outcome == "no_url":
        return "not_retrieved", "No URL", "none"
    if check.get("sha256") == SANDBOX_BLOCK_SHA:
        if fc is None:
            return "access_restricted", "ftc.gov returns the same generic 'Page Not Found' page to this environment for every path (including / and /robots.txt); the cited page was not loaded here", "none"
        if fc_ok:
            return "retrieved", f"HTTP 200 through Firecrawl on the check date ({fc['note']}); the research sandbox is blocked by ftc.gov", "firecrawl"
        return "not_retrieved", f"HTTP {fc['status']} on the cited page, read through Firecrawl on the check date ({fc['note']})", "firecrawl"
    if outcome == "robots_disallowed":
        return "access_restricted", "robots.txt disallows automated retrieval (host up; page not fetched)", "none"
    if outcome == "robots_unreachable":
        if fc_ok:
            return "retrieved", (f"robots.txt could not be read from the sandbox ({(check.get('error') or 'robots.txt 5xx')[:90]}); "
                                 f"the page was read once through Firecrawl ({fc['note']})"), "firecrawl"
        return "not_retrieved", f"Host unreachable ({check.get('error') or 'robots.txt 5xx'})" + fc_note, "none"
    if status and 200 <= status < 300:
        if page_relevant(check):
            return "retrieved", f"HTTP {status}", "direct"
        if fc_ok:
            return "retrieved", f"HTTP {status} to the sandbox without settlement wording in the static HTML; the page was read through Firecrawl ({fc['note']})", "firecrawl"
        return "not_retrieved", (f"HTTP {status} but the page left the cited site or carries no settlement/claim/case wording (possible parked or repurposed domain; "
                                 f"final URL {check.get('final_url')})" + fc_note), "direct"
    if status in (401, 403, 429):
        if fc_ok:
            return "retrieved", f"HTTP {status} to the sandbox (bot wall); HTTP 200 through Firecrawl on the check date", "firecrawl"
        return "access_restricted", f"HTTP {status} (host restricts automated access; page exists for browsers)", "none"
    if fc_ok:
        return "retrieved", f"{'HTTP ' + str(status) if status else (check.get('error') or 'network error')} to the sandbox; HTTP 200 through Firecrawl on the check date ({fc['note']})", "firecrawl"
    if status:
        return "not_retrieved", f"HTTP {status}" + fc_note, "none"
    return "not_retrieved", (check.get("error") or "Network error") + fc_note, "none"


def cited_url(record):
    """The record's cited official page: the settlement URL, else the claim URL; a URL on a host that may not be published is never used."""
    for key in ("official_settlement_url", "official_claim_url"):
        url = record.get(key)
        if url and not tp.forbidden_in_url(url):
            return url  # first-pass semantics: a bare host without a scheme is returned too and then classed 'no official source URL'
    return None


def citable(record, check, firecrawl=None):
    """(included?, reason). Included only when the cited source is an official class and was retrieved or access-restricted."""
    url = cited_url(record)
    if not url and any(u and tp.forbidden_in_url(u) for u in (record.get("official_settlement_url"), record.get("official_claim_url"))):
        return False, "the only usable URL is on a host that may not be published"
    klass = tp.source_class(url)
    if klass == "none":
        return False, "no official source URL in the record"
    if klass == "aggregator":
        return False, "cited source is a third-party aggregator, not a primary source"
    if record["verification_status"] == "third_party_only":
        return False, "compiled record marked third_party_only (no official source)"
    state, note, _method = retrieval_state(check, firecrawl)
    if state == "not_retrieved":
        return False, f"cited source could not be retrieved on the check date: {note}"
    return True, note


def overlap(records, existing):
    by_slug = {e["slug"]: e for e in existing if e["slug"]}
    by_url = collections.defaultdict(list)
    by_title = collections.defaultdict(list)
    by_cap_amt = collections.defaultdict(list)
    for e in existing:
        if e["source_url"].startswith("http"):
            by_url[tp.norm_url(e["source_url"])].append(e)
        by_title[tp.norm_title(e["title"])].append(e)
        cap = tp.caption(e["title"])
        amounts = tuple(sorted(set(tp.money_values(e["title"]))))
        if cap and amounts:
            by_cap_amt[(tp.norm_title(cap[0] + " v " + cap[1]), amounts)].append(e)
    pubs = [e for e in existing if e["slug"]]
    pub_tokens = {e["id"]: tp.tokens(e["title"]) for e in pubs}
    pub_hosts = collections.defaultdict(list)
    for e in pubs:
        pub_hosts[tp.host_of(e["source_url"])].append(e)
    results, near = {}, []
    matched_existing = set()
    for r in records:
        slug = slug_of(r["url"])
        url = r["official_settlement_url"] or r["official_claim_url"]
        exact = {"publisher_page": by_slug[slug]["id"] if slug in by_slug else None,
                 "official_url": [e["id"] for e in by_url.get(tp.norm_url(url), [])] if url else [],
                 "title": [e["id"] for e in by_title.get(tp.norm_title(r["title"]), [])]}
        cap = tp.caption(r["title"])
        amounts = tuple(sorted(set(tp.money_values(r["title"]))))
        exact["caption_and_amount"] = [e["id"] for e in by_cap_amt.get((tp.norm_title(cap[0] + " v " + cap[1]), amounts), [])] if cap and amounts else []
        ids = {exact["publisher_page"]} | set(exact["official_url"]) | set(exact["title"]) | set(exact["caption_and_amount"])
        ids.discard(None)
        matched_existing |= ids
        results[r["url"]] = {"exact": exact, "existing_ids": sorted(ids)}
        if ids:
            continue
        mine = tp.tokens(r["title"])
        host = tp.host_of(url)
        for e in pubs:
            score = tp.jaccard(mine, pub_tokens[e["id"]])
            same_host = bool(host) and tp.host_of(e["source_url"]) == host and host not in ("ftc.gov", "consumerfinance.gov", "sec.gov", "strategicclaims.net", "cptgroupcaseinfo.com", "cptgroup.com")
            if score >= 0.6 or same_host:
                near.append({"settlesignal_url": r["url"], "title": r["title"], "existing_id": e["id"], "existing_title": e["title"],
                             "title_jaccard": round(score, 3), "same_official_host": same_host, "action": "review only; not merged"})
    return results, near, matched_existing


def build_settlesignal(stamp):
    path = os.path.join(ACQ, "settlesignal", "settlements.json")
    data = json.load(open(path, encoding="utf-8"))
    records = data["settlements"]
    checks = load_checks()
    firecrawl = load_firecrawl()
    verdicts = {v["settlesignal_url"]: v for v in load_verdicts()["rows"]}
    existing = load_existing_settlements()
    company_index, company_names = load_companies()
    ov, near, matched_existing = overlap(records, existing)
    as_of = stamp["check_date"]
    rows, excluded = [], []
    provenance = {}
    raw_index = {r["url"]: i for i, r in enumerate(records)}
    company_stats = collections.Counter()
    for r in records:
        url = cited_url(r)
        check = checks.get(r["url"])
        ok, note = citable(r, check, firecrawl)
        if not ok:
            excluded.append({"settlesignal_url": r["url"], "title": r["title"], "official_url": url, "reason": note,
                             "publisher_verification_status": r["verification_status"], "accepted_official_evidence": r["accepted_official_evidence"]})
            continue
        slug = slug_of(r["url"])
        klass = tp.source_class(url)
        verdict = verdicts.get(r["url"])
        vkey = verdict["verdict"] if verdict and verdict.get("verdict") in VERDICT_LABELS else "not_verified"
        vtext = VERDICT_LABELS[vkey] + (f" ({verdict['source_url']})" if vkey != "not_verified" else "")
        vdetail = ""
        if verdict:
            vdetail = "; ".join(f"{k}: {v.get('result', '').replace('_', ' ')}" for k, v in verdict.get("fields", {}).items())
        cap = tp.caption(r["title"])
        cik, cstatus, cmethod = None, "no caption in title", None
        if cap:
            cik, cstatus = tp.exact_company(cap[1], company_index)
            cmethod = "defendant side of the 'X v. Y' caption"
        else:
            cik, whole = tp.exact_company(r["title"], company_index)
            if whole == "matched":
                cstatus, cmethod = "matched", "the whole title is the company name"
            else:
                cik = None
        company_stats[cstatus if cstatus != "matched" else f"matched ({cmethod})"] += 1
        states = r["applicable_states"] or []
        existing_ids = ov[r["url"]]["existing_ids"]
        dstate = tp.deadline_state(r["claim_deadline"], as_of)
        rstate, rnote, rmethod = retrieval_state(check, firecrawl)
        links = [{"label": "Official source (cited in the compiled record)", "url": url}]
        claim_url = r["official_claim_url"]
        if claim_url and claim_url != url and claim_url.startswith(("http://", "https://")) and not tp.forbidden_in_url(claim_url):
            links.append({"label": "Official claim form", "url": claim_url})
        links += [{"label": f"State: {s}", "url": f"/places/{s}"} for s in states if re.fullmatch(r"[A-Z]{2}", s)]
        links += [{"label": "Existing corpus settlement record", "url": f"/records/settlements/{i}"} for i in existing_ids]
        if cik:
            links.append({"label": f"Company: {company_names[cik]}", "url": f"/companies/{cik}"})
        payout = (r["estimated_payout"] or "").strip()
        type_label = TYPE_LABELS.get(r["settlement_type"], r["settlement_type"] or "Not recorded")
        # source_url = the cited official page; where a verification read exists, the page that was actually read (same official site)
        source_url = verdict["source_url"] if verdict else url
        rid = NOTICE_PREFIX + slug
        public_verdict = ({"verdict": verdict["verdict"], "cited_url": verdict["cited_url"], "source_url": verdict["source_url"], "fields": verdict["fields"],
                           "method": tp.public_wording(verdict["method"]), "source_sha256": verdict.get("source_sha256"),
                           "note": tp.public_wording(verdict.get("note"))}
                          if verdict else {"verdict": "not_verified", "reason": "not in the verification sample"})
        provenance[rid] = {"publisher_url": r["url"], "publisher_slug": slug, "raw_index": raw_index[r["url"]], "cited_url": url,
                           "verdict_source_url": verdict["source_url"] if verdict else None}
        row = writer.record(
            SS_DATASET, rid, r["title"],
            source_url=source_url, state=states[0] if len(states) == 1 and re.fullmatch(r"[A-Z]{2}", states[0]) else "",
            subtitle=f"{NOTICE_BADGE} · {r['status'] or 'status not recorded'} · deadline {r['claim_deadline'] or 'not recorded'} · {VERDICT_SHORT[vkey]}",
            cells={"settlement": r["title"], "type": type_label, "status": r["status"] or None, "deadline": r["claim_deadline"],
                   "proof": r["proof_required"] or None, "states": ", ".join(states) if states else "Nationwide (as published)",
                   "official_source": tp.host_of(url), "verification": VERDICT_SHORT[vkey]},
            facts=facts([
                ("Record layer", "Compiled record; not a court, agency or administrator record"),
                ("How compiled", NOTICE_METHOD),
                ("Last checked", as_of),
                ("Primary source cited", url),
                ("Primary source type", tp.SOURCE_CLASS_LABELS[klass]),
                (f"Primary source check ({as_of})", rnote),
                ("Primary source read by", RETRIEVAL_LABELS[rmethod]),
                ("Verification", vtext),
                ("Verification read by", tp.public_wording(verdict["method"]) if verdict else "Not in the verification sample"),
                ("Fields checked on the official page", vdetail if verdict else "Not in the verification sample"),
                ("Figures from", FIGURES_FROM[vkey]),
                ("Claim deadline (as compiled)", r["claim_deadline"]),
                (f"Deadline vs {as_of}", dstate.replace("_", " ")),
                ("Status (as compiled)", r["status"]),
                ("Proof required (as compiled)", r["proof_required"]),
                ("States (as compiled; [] = nationwide)", ", ".join(states) if states else "Nationwide (as published)"),
                ("Type / category (as compiled)", f"{r['settlement_type'] or 'Not recorded'} / {r['category'] or 'Not recorded'}"),
                ("Verification tier (as compiled)", r["verification_status"]),
                ("Official evidence accepted (as compiled)", "Yes" if r["accepted_official_evidence"] else "No"),
                ("Last verified (as compiled)", r["last_verified"]),
                ("Court", "Not recorded (the compiled record has no court field)"),
                ("MDL", "Not recorded (no MDL number stated in the record)"),
                ("Company link", f"/companies/{cik} (exact name match to company_sec_profiles: {cmethod})" if cik else f"None ({cstatus.replace('_', ' ')})"),
                ("Existing corpus record", ", ".join(existing_ids) if existing_ids else "None (new to the corpus)"),
            ]),
            text=" ".join([r["title"], tp.host_of(url), payout, r["category"] or "", " ".join(states)]),
            filters={"type": [r["settlement_type"] or "none"], "status": [r["status"] or "none"], "deadline_state": [dstate],
                     "verification": [vkey], "source_class": [klass], "state": states or ["nationwide"],
                     "accepted_evidence": ["yes" if r["accepted_official_evidence"] else "no"], "in_existing": ["yes" if existing_ids else "no"],
                     "date": r["claim_deadline"] or ""},
            badges=[NOTICE_BADGE, VERDICT_LABELS[vkey], tp.SOURCE_CLASS_LABELS[klass]],
            links=links,
            extra={"settlement": {k: r[k] for k in ("title", "category", "settlement_type", "status", "claim_deadline", "proof_required",
                                                      "applicable_states", "official_claim_url", "official_settlement_url", "estimated_payout",
                                                      "verification_status", "accepted_official_evidence", "last_verified")},
                   "primary_source": {"url": url, "class": klass, "retrieval": rstate, "retrieval_method": rmethod, "check_note": rnote,
                                      "checked_at": (check or {}).get("checked_at"),
                                      "http_status": (check or {}).get("status") if rmethod == "direct" else None,
                                      "sha256": (check or {}).get("sha256") if rmethod == "direct" else None},
                   "verification": public_verdict,
                   "compiled": True},
        )
        sections = [{"heading": "Payout text (as compiled, verbatim; never summed)", "text": payout or "Not recorded"}]
        if verdict:
            lines = []
            for key, label in (("identity", "Matter"), ("date", "Claim deadline"), ("payout", "Payout / amounts"), ("status", "Status")):
                field = verdict.get("fields", {}).get(key)
                if field and field.get("result") != "not_applicable":
                    lines.append(f"{label} — {field['result'].replace('_', ' ')}: {field.get('evidence') or 'no passage quoted'}")
            if verdict.get("note"):
                lines.append("Reviewer note: " + tp.public_wording(verdict["note"]))
            sections.append({"heading": f"Check against the official page ({verdict['source_url']})", "text": "\n".join(lines)})
        sections.append({"heading": "What this record is not", "text": "A compiled entry, not a court record, settlement agreement or order. Values are as compiled unless the verification fact says a field was confirmed on the official source. Deadline state is arithmetic against the check date and says nothing about eligibility."})
        row["detail"]["sections"] = sections
        rows.append(row)
    rows.sort(key=lambda row: row["id"])
    existing_pub = [e for e in existing if e["slug"]]
    current_slugs = {slug_of(r["url"]) for r in records}
    dropped = [e for e in existing_pub if e["slug"] not in current_slugs]
    stats = {
        "feed_records": len(records), "feed_generated": data.get("generated"), "feed_dateModified": data.get("dateModified"),
        "included": len(rows), "excluded": len(excluded),
        "excluded_reasons": dict(collections.Counter(re.sub(r":.*", "", e["reason"]) for e in excluded)),
        "excluded_detail": dict(collections.Counter(e["reason"] for e in excluded).most_common(12)),
        "source_class_all": dict(collections.Counter(tp.source_class(cited_url(r)) for r in records)),
        "source_class_included": dict(collections.Counter(row["filters"]["source_class"][0] for row in rows)),
        "type_included": dict(collections.Counter(row["filters"]["type"][0] for row in rows)),
        "status_included": dict(collections.Counter(row["filters"]["status"][0] for row in rows)),
        "deadline_state_included": dict(collections.Counter(row["filters"]["deadline_state"][0] for row in rows)),
        "accepted_evidence_included": dict(collections.Counter(row["filters"]["accepted_evidence"][0] for row in rows)),
        "verified_included": sum(1 for row in rows if row["filters"]["verification"][0] == "verified"),
        "verification_included": dict(collections.Counter(row["filters"]["verification"][0] for row in rows)),
        "retrieval_included": dict(collections.Counter(row["item"]["primary_source"]["retrieval"] for row in rows)),
        "retrieval_method_included": dict(collections.Counter(row["item"]["primary_source"]["retrieval_method"] for row in rows)),
        "source_hosts_included_top": dict(collections.Counter(row["item"]["cells"]["official_source"] for row in rows).most_common(12)),
        "deadline_years": dict(sorted(collections.Counter(row["filters"]["date"][:4] for row in rows if row["filters"]["date"]).items())),
        "deadline_years_all_considered": dict(sorted(collections.Counter(r["claim_deadline"][:4] for r in records if r["claim_deadline"]).items())),
        "last_verified_range": [min(r["last_verified"] for r in records), max(r["last_verified"] for r in records)],
        "deadline_range": [min(row["filters"]["date"] for row in rows if row["filters"]["date"]), max(row["filters"]["date"] for row in rows if row["filters"]["date"])],
        "deadline_range_all_considered": [min(r["claim_deadline"] for r in records if r["claim_deadline"]), max(r["claim_deadline"] for r in records if r["claim_deadline"])],
        "company_match": dict(company_stats),
        "state_links": sum(1 for row in rows for link in row["item"]["links"] if link["url"].startswith("/places/")),
        "rows_with_state_links": sum(1 for row in rows if any(link["url"].startswith("/places/") for link in row["item"]["links"])),
        "court_links": 0, "mdl_links": 0,
        "overlap": {
            "existing_rows": len(existing), "existing_publisher_refs": len(existing_pub),
            "exact_publisher_page": sum(1 for v in ov.values() if v["exact"]["publisher_page"]),
            "exact_official_url": sum(1 for v in ov.values() if v["exact"]["official_url"]),
            "exact_title": sum(1 for v in ov.values() if v["exact"]["title"]),
            "exact_caption_and_amount": sum(1 for v in ov.values() if v["exact"]["caption_and_amount"]),
            "exact_case_name_court_amount": 0,
            "court_note": "Neither the SettleSignal open-data file nor the existing settlements rows record a court, so an exact case-name + court + amount match is not possible (0); caption + amount printed in the title is reported instead.",
            "any_exact": sum(1 for v in ov.values() if v["existing_ids"]),
            "new_in_feed": sum(1 for v in ov.values() if not v["existing_ids"]),
            "existing_matched": len(matched_existing),
            "existing_publisher_refs_not_in_current_feed": len(dropped),
            "near_duplicate_pairs": len(near),
        },
    }
    return data, rows, excluded, ov, near, dropped, stats, path, provenance


# ---------------------------------------------------------------- catalog

def catalog_entries():
    fed = vp.parse_federal(open(os.path.join(ACQ, "violationtracker", "violation-tracker-data-sources.html"), encoding="utf-8").read(), VT_FED)
    st = vp.parse_state_local(open(os.path.join(ACQ, "violationtracker", "local-state-data-sources.html"), encoding="utf-8").read(), VT_STATE)
    return fed, st


def corpus_coverage(entry, by_host, labels):
    matches = {}
    for _, url in entry["links"]:
        host = tp.host_of(url)
        for dataset, n in by_host.get(host, {}).items():
            matches.setdefault(dataset, set()).add(f"same official host {host}" + (f" ({n:,} records)" if n else " (dataset metadata)"))
    agency = entry["agency"]
    acronym = FED_ACRONYMS.get(agency) if entry["jurisdiction"] == "Federal" else None
    for dataset, info in labels.items():
        label = info["label"] or ""
        if agency and agency.casefold() in label.casefold():
            matches.setdefault(dataset, set()).add("agency named in dataset label")
        elif acronym and re.search(r"(?<![A-Za-z])" + re.escape(acronym) + r"(?![A-Za-z])", label):
            matches.setdefault(dataset, set()).add(f"agency acronym {acronym} in dataset label")
    return [{"dataset": d, "label": labels.get(d, {}).get("label"), "basis": sorted(b),
             "kind": dataset_kind(d)}
            for d, b in sorted(matches.items())]


def load_catalog_checks():
    return {line["url"]: line for line in read_jsonl(os.path.join(ACQ, "catalog_pages", "_checks.jsonl"))}


def url_state(check):
    if not check:
        return "not_checked", "Not checked"
    if check.get("outcome") == "robots_disallowed":
        return "not_fetched", "robots.txt disallows automated retrieval (not fetched)"
    if check.get("outcome") == "robots_unreachable":
        return "unreachable", f"Host unreachable ({check.get('error') or 'robots.txt 5xx'})"
    status = check.get("status")
    if status and 200 <= status < 300:
        title = html.unescape(check.get("page_title") or "")
        final = check.get("final_url")
        moved = f" — redirected to {final}" if final and tp.norm_url(final) != tp.norm_url(check.get("url")) else ""
        return "ok", f"HTTP {status}" + (f" — page title: {title}" if title else "") + moved
    if status in (401, 403, 429):
        return "restricted", f"HTTP {status} (host restricts automated access)"
    if status:
        return "error", f"HTTP {status}"
    return "unreachable", check.get("error") or "Network error"


def build_catalog(stamp):
    fed, st = catalog_entries()
    by_host, labels, _records = load_corpus_sources()
    checks = load_catalog_checks()
    spot_path = os.path.join(ACQ, "verification", "catalog_spot_checks.json")
    spot_file = json.load(open(spot_path, encoding="utf-8")) if os.path.exists(spot_path) else {"rows": []}
    spot = {s["entry_id"]: s for s in spot_file["rows"]}  # keyed by the legacy first-build ids (hand-read; see LEGACY_CAT_PREFIX)
    rows, excluded, provenance, counters = [], [], {}, collections.defaultdict(int)
    seen = collections.Counter()
    for entry in fed + st:
        scope = entry["state"] or "us"
        base = re.sub(r"[^a-z0-9]+", "-", entry["agency"].casefold()).strip("-")[:60]
        seen[(scope, base)] += 1
        suffix = f":{seen[(scope, base)]}" if seen[(scope, base)] > 1 else ""
        rid = f"{SRC_PREFIX}{scope.lower()}:{base}{suffix}"  # numbering runs over every listed entry, built or not, so ids stay stable
        legacy_id = f"{LEGACY_CAT_PREFIX}{scope.lower()}:{base}{suffix}"
        list_page = VT_FED if entry["jurisdiction"] == "Federal" else VT_STATE
        urls = [u for _, u in entry["links"] if not tp.forbidden_in_url(u)]
        provenance[rid] = {"legacy_id": legacy_id, "listed_line": entry["line"], "list_page": list_page, "dropped_forbidden_links": entry.get("dropped_forbidden_links", 0)}
        if not urls:
            reason = ("the only URL listed is on a host that may not be published" if entry.get("dropped_forbidden_links") else
                      "no agency URL is listed (open-records request or agency-only line); the row would have no source_url of its own")
            excluded.append({"id": rid, "legacy_id": legacy_id, "agency": entry["agency"], "jurisdiction": entry["jurisdiction"], "coverage": entry["coverage"],
                             "reason": reason, "dropped_forbidden_links": entry.get("dropped_forbidden_links", 0)})
            continue
        level = vp.level_of(entry)
        types = vp.source_types(entry["coverage"])
        url_checks = [(u,) + url_state(checks.get(u)) for u in urls]
        coverage = corpus_coverage(entry, by_host, labels)
        official = [u for u in urls if vp.official_domain(tp.host_of(u))]
        primary = urls[0]
        ok_any = any(s == "ok" for _, s, _ in url_checks)
        check_text = "; ".join(f"{u} — {note}" for u, _, note in url_checks)
        sc = spot.get(legacy_id)
        public_spot = ({"result": sc["result"], "note": tp.public_wording(sc["note"]), "entry_text_matches_listing": bool(sc["listing_verbatim_on_page"])} if sc else None)
        links = [{"label": f"Official source: {a or entry['coverage'] or entry['agency']}", "url": u} for a, u in entry["links"] if not tp.forbidden_in_url(u)]
        if entry["state"]:
            links.append({"label": f"State: {entry['state']}", "url": f"/places/{entry['state']}"})
        row = writer.record(
            CAT_DATASET, rid, f"{entry['agency']} — {entry['coverage'] or 'agency resource'}",
            source_url=primary,
            subtitle=f"{entry['jurisdiction']} · {LEVEL_LABELS[level]} · {', '.join(SOURCE_TYPE_LABELS[t] for t in types)}",
            state=entry["state"],
            cells={"agency": entry["agency"], "jurisdiction": entry["jurisdiction"], "level": LEVEL_LABELS[level], "covers": entry["coverage"] or None,
                   "source_type": ", ".join(SOURCE_TYPE_LABELS[t] for t in types), "official_url": tp.host_of(primary),
                   "url_check": "OK" if ok_any else url_checks[0][1].replace("_", " "),
                   "corpus_datasets": str(len(coverage))},
            facts=facts([
                ("Agency (as compiled)", entry["agency"]),
                ("Jurisdiction", entry["jurisdiction"] + (f" ({entry['state']})" if entry["state"] else "")),
                ("Level", LEVEL_LABELS[level]),
                ("What it covers (as compiled)", entry["coverage"] or "Agency resource (no coverage phrase recorded)"),
                ("Source type (derived from the coverage phrase)", ", ".join(SOURCE_TYPE_LABELS[t] for t in types)),
                ("Official URL(s)", " ; ".join(urls)),
                ("Government domain (.gov/.mil/.us)", "Yes" if len(official) == len(urls) else "No — " + ", ".join(tp.host_of(u) for u in urls if u not in official)),
                (f"URL check ({stamp['catalog_check_date']})", check_text),
                ("Spot check", f"{sc['result']}: {tp.public_wording(sc['note'])}" if sc else "Not in the spot-check sample"),
                ("Corpus datasets covering this agency", "; ".join(f"{c['dataset']} ({', '.join(c['basis'])})" for c in coverage) if coverage else "None found (exact host or agency-name match)"),
                ("How compiled", CATALOG_METHOD + "; no penalty records are included"),
            ]),
            text=" ".join([entry["agency"], entry["jurisdiction"], entry["state"], entry["coverage"], " ".join(tp.host_of(u) for u in urls)]),
            filters={"level": [level], "jurisdiction": [entry["state"] or "federal"], "source_type": types, "has_url": ["yes"],
                     "url_ok": ["yes" if ok_any else "no"], "corpus_covered": ["yes" if coverage else "no"], "gov_domain": ["yes" if len(official) == len(urls) else "no"]},
            badges=[LEVEL_LABELS[level]] + (["Open-records request mentioned"] if "open_records_request" in types else []) + (["Covered in corpus"] if coverage else []),
            links=links,
            extra={"entry": {"agency": entry["agency"], "jurisdiction": entry["jurisdiction"], "state": entry["state"], "level": level,
                             "coverage": entry["coverage"], "source_types": types,
                             "urls": [{"url": u, "anchor": a} for a, u in entry["links"] if not tp.forbidden_in_url(u)]},
                   "url_checks": [{"url": u, "state": s, "note": n, "checked_at": (checks.get(u) or {}).get("checked_at"),
                                   "http_status": (checks.get(u) or {}).get("status"), "sha256": (checks.get(u) or {}).get("sha256"),
                                   "final_url": (checks.get(u) or {}).get("final_url")} for u, s, n in url_checks],
                   "corpus_coverage": coverage, "spot_check": public_spot, "compiled": True},
        )
        rows.append(row)
        counters["covered" if coverage else "uncovered"] += 1
    rows.sort(key=lambda row: row["id"])
    built_ids = {row["id"] for row in rows}
    federal = sum(1 for row in rows if row["item"]["entry"]["jurisdiction"] == "Federal")
    stats = {
        "entries": len(rows), "federal": federal, "state_local": len(rows) - federal,
        "listed_entries": len(fed) + len(st), "listed_federal": len(fed), "listed_state_local": len(st),
        "excluded": len(excluded), "excluded_no_url": sum(1 for e in excluded if not e["dropped_forbidden_links"]),
        "excluded_only_url_on_forbidden_host": sum(1 for e in excluded if e["dropped_forbidden_links"]),
        "excluded_open_records_only": sum(1 for e in excluded if re.search(r"open records request|foia", e["coverage"] or "", re.I)),
        "jurisdictions": len({row["item"]["entry"]["state"] for row in rows if row["item"]["entry"]["state"]}),
        "levels": dict(collections.Counter(row["filters"]["level"][0] for row in rows)),
        "source_types": dict(collections.Counter(t for row in rows for t in row["filters"]["source_type"])),
        "with_url": sum(1 for row in rows if row["filters"]["has_url"][0] == "yes"),
        "url_ok": sum(1 for row in rows if row["filters"]["url_ok"][0] == "yes"),
        "url_states": dict(collections.Counter(c["state"] for row in rows for c in row["item"]["url_checks"])),
        "distinct_urls": len({c["url"] for row in rows for c in row["item"]["url_checks"]}),
        "urls_redirected": len({c["url"] for row in rows for c in row["item"]["url_checks"] if "redirected to" in c["note"]}),
        "gov_domain": dict(collections.Counter(row["filters"]["gov_domain"][0] for row in rows if row["filters"]["has_url"][0] == "yes")),
        "corpus_covered": dict(counters),
        "corpus_covered_data_datasets": sum(1 for row in rows if any(c["kind"].startswith("enforcement") for c in row["item"]["corpus_coverage"])),
        "datasets_matched": dict(collections.Counter(c["dataset"] for row in rows for c in row["item"]["corpus_coverage"]).most_common()),
        "by_jurisdiction": dict(sorted(collections.Counter(row["filters"]["jurisdiction"][0] for row in rows).items())),
    }
    sampled = [s for s in spot_file["rows"] if f"{SRC_PREFIX}{s['entry_id'][len(LEGACY_CAT_PREFIX):]}" in built_ids]
    spot_summary = {"sampled": len(sampled), "sampled_total": len(spot_file["rows"]), "sampled_not_in_published_set": len(spot_file["rows"]) - len(sampled),
                    "federal": sum(1 for s in sampled if s["jurisdiction"] == "Federal"), "state_local": sum(1 for s in sampled if s["jurisdiction"] != "Federal"),
                    "seed": spot_file.get("seed"), "checked_at": spot_file.get("checked_at"),
                    "entry_text_matches_listing": sum(1 for s in sampled if s["listing_verbatim_on_page"]),
                    "result_counts": dict(collections.Counter(s["result"] for s in sampled))} if spot_file["rows"] else None
    return rows, stats, excluded, provenance, spot_summary


# ---------------------------------------------------------------- output

def write_build(dataset, label, listing_block, summary, rows, inputs):
    out = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
           "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "inputs": inputs}
    ids = [row["id"] for row in rows]
    assert len(ids) == len(set(ids)), f"{dataset}: duplicate ids"
    assert re.fullmatch(r"[a-z0-9_]{1,80}", dataset)
    hit = next(tp.find_forbidden(out), None)  # fail closed: a publishable build file never carries a compilation's name or host
    if hit:
        raise SystemExit(f"{dataset}: forbidden {hit[1]} {hit[2]!r} at {hit[0]}; nothing written")
    tp.atomic_write(os.path.join(BUILD, dataset + ".json"), json.dumps(out, ensure_ascii=False, indent=1))


def manifest_entry(url):
    for line in reversed(read_jsonl(os.path.join(ACQ, "_manifest.jsonl"))):
        if line["url"] == url and line.get("http_status") == 200:
            return line
    return None


def raw_input_entry(description, path):
    """Neutral build-file input for a raw compilation file. The path names the private acquisition manifest (which lists the file's
    url, path and sha256); the sha256 here is that raw file's, so the provenance is recoverable privately and nowhere else."""
    return {"url": description, "path": "private/acq/third_party_data/_manifest.jsonl (entry with this sha256)", "sha256": sha256_file(path)}


def public_notice_counts(stats):
    """The counts that go into the published dataset summary: neutral key names, no feed metadata, no compiler-specific wording."""
    ov = stats["overlap"]
    keep = ("included", "excluded", "excluded_reasons", "source_class_all", "source_class_included", "type_included", "status_included",
            "deadline_state_included", "accepted_evidence_included", "verified_included", "verification_included", "retrieval_included",
            "retrieval_method_included", "source_hosts_included_top", "deadline_years", "deadline_range", "company_match", "state_links",
            "rows_with_state_links", "court_links", "mdl_links")
    out = {k: stats[k] for k in keep}
    out["records_considered"] = stats["feed_records"]
    out["compiled_last_verified_range"] = stats["last_verified_range"]
    out["overlap"] = {
        "existing_rows": ov["existing_rows"], "exact_record_key": ov["exact_publisher_page"], "exact_official_url": ov["exact_official_url"],
        "exact_title": ov["exact_title"], "exact_caption_and_amount": ov["exact_caption_and_amount"], "exact_case_name_court_amount": 0,
        "court_note": "Neither the compiled records nor the existing settlements rows record a court, so an exact case-name + court + amount match is not possible (0); caption + amount printed in the title is reported instead.",
        "any_exact": ov["any_exact"], "new_to_corpus": ov["new_in_feed"], "existing_matched": ov["existing_matched"],
        "near_duplicate_pairs": ov["near_duplicate_pairs"],
    }
    return out


def main():
    ss_line = manifest_entry(SS_JSON_URL)
    checks = read_jsonl(os.path.join(ACQ, "official_pages", "_checks.jsonl"))
    cat_checks = read_jsonl(os.path.join(ACQ, "catalog_pages", "_checks.jsonl"))
    stamp = {"ss_retrieved": ss_line["retrieved_at"] if ss_line else "Not recorded",
             "check_date": max((c["checked_at"][:10] for c in checks), default="Not recorded"),
             "catalog_check_date": max((c["checked_at"][:10] for c in cat_checks), default="Not recorded")}
    os.makedirs(BUILD, exist_ok=True)
    data, ss_rows, excluded, ov, near, dropped, ss_stats, ss_path, notice_prov = build_settlesignal(stamp)
    verdicts = load_verdicts()
    ver_summary = {k: verdicts[k] for k in ("seed", "population", "sampled", "in_published_set", "not_in_published_set", "verdict_counts", "strict_rate",
                                           "at_least_partly_rate", "contradicted_rate", "field_results", "rules", "firecrawl_method") if k in verdicts}
    ss_stats["verification_sample"] = ver_summary
    ss_inputs = [raw_input_entry("compiled record file (public settlement notices; private acquisition, see the acquisition manifest)", ss_path),
                 {"url": "official source checks (one GET per cited URL, robots.txt respected)", "path": "private/acq/third_party_data/official_pages/_checks.jsonl",
                  "sha256": sha256_file(os.path.join(ACQ, "official_pages", "_checks.jsonl"))},
                 {"url": "corpus dataset settlements (read-only SQL lookup)", "path": "private/build/third_party_data/lookups/settlements_existing.json",
                  "sha256": sha256_file(os.path.join(LOOKUPS, "settlements_existing.json"))},
                 {"url": "corpus dataset company_sec_profiles (read-only SQL lookup)", "path": "private/build/third_party_data/lookups/company_sec_profiles.tsv",
                  "sha256": sha256_file(os.path.join(LOOKUPS, "company_sec_profiles.tsv"))}]
    vpath = os.path.join(ACQ, "verification", "verdicts.json")
    if os.path.exists(vpath):
        ss_inputs.append({"url": "verification verdicts (sample checked against cited official pages)", "path": os.path.relpath(vpath, ROOT), "sha256": sha256_file(vpath)})
    fpath = os.path.join(ACQ, "verification", "firecrawl_checks.json")
    if os.path.exists(fpath):
        ss_inputs.append({"url": "Firecrawl MCP page reads of cited pages the sandbox could not load (ftc.gov and other blocked hosts)", "path": os.path.relpath(fpath, ROOT), "sha256": sha256_file(fpath)})
    ss_summary = {
        "compiled": True,
        "method": NOTICE_METHOD,
        "last_checked": stamp["check_date"],
        "records_considered": ss_stats["feed_records"],
        "inclusion": ("Record cites an official source (government, court, settlement/administrator website, wire press release, class-counsel/organisation or company page; not an aggregator; compiled tier not 'third_party_only') "
                      "AND the cited URL was retrieved on the check date (HTTP 2xx with settlement/claim/case wording), or the host bot-walls the research environment (401/403/429) or robots.txt disallows automated retrieval (page not loaded; labelled), or a Firecrawl read confirmed the page. "
                      "robots.txt was honoured (RFC 9309). ftc.gov returns one identical generic 404 page to the research environment for every path (including / and /robots.txt), so its cited pages were read through the Firecrawl MCP instead of being excluded as 404s. "
                      f"Pages included on a Firecrawl read: {ss_stats['retrieval_method_included'].get('firecrawl', 0)}; included without the page being loaded (bot wall / robots): {ss_stats['retrieval_method_included'].get('none', 0)}."),
        "source_url_rule": "every row's source_url is its cited official page (the page the verification read, where one exists on the same official site)",
        "check_date": stamp["check_date"],
        "verification": {"method": "fixed-seed random sample of all records considered (seed 20261018, 36 records) checked field by field (claim deadline, dollar figures, matter named) against the official page each record cites; deterministic matching on the saved bytes, then a person read every row's evidence; pages the sandbox could not load or render were read through the Firecrawl MCP. 33 of the 36 sampled records are in the published set (3 are excluded: aggregator source, dead site, unresolvable domain); rates are over those 33. Rows outside the sample are Not verified.",
                         **ver_summary},
        "counts": public_notice_counts(ss_stats),
        "links": {"places": "applicable_states USPS codes -> /places/<USPS>", "courts": "none: no court field in the compiled records",
                  "mdl": "none: no record states an MDL number", "companies": "defendant side of an 'X v. Y' caption, or the whole title when it is a company name (SEC matters); exact match to company_sec_profiles after NFKC/casefold/strip '.' ',' /whitespace normalisation; unique match only; no abbreviation expansion",
                  "existing": "exact compiled-record key, official URL, normalised title, or caption+amount match to corpus 'settlements' -> /records/settlements/<id>"},
        "analytics": {"shares_formula": "share = count / included rows", "deadline_state_formula": f"claim_deadline vs {stamp['check_date']}: passed / within 30 days / future / unknown"},
    }
    ss_listing = writer.listing(
        [("settlement", "Settlement"), ("type", "Type"), ("status", "Status (as compiled)"), ("deadline", "Claim deadline"), ("states", "States"),
         ("official_source", "Official source"), ("verification", "Verification")],
        [("verification", "Verification", dict(VERDICT_LABELS)),
         ("source_class", "Official source type", {k: v for k, v in tp.SOURCE_CLASS_LABELS.items() if k not in ("aggregator", "none")}),
         ("type", "Type (as compiled)", {k: v for k, v in TYPE_LABELS.items()}),
         ("deadline_state", f"Claim deadline vs {stamp['check_date']}", {"within_30_days": "Within 30 days", "future": "Future", "passed": "Passed", "unknown": "No deadline published"}),
         ("in_existing", "In corpus 'settlements'", {"yes": "Yes", "no": "No (new)"})])
    write_build(SS_DATASET, "Settlement notices (compiled; official source cited)", ss_listing, ss_summary, ss_rows, ss_inputs)

    cat_rows, cat_stats, cat_excluded, cat_prov, spot_summary = build_catalog(stamp)
    cat_inputs = [raw_input_entry("compiled source list, federal (private acquisition, see the acquisition manifest)", os.path.join(ACQ, "violationtracker", "violation-tracker-data-sources.html")),
                  raw_input_entry("compiled source list, state and local (private acquisition, see the acquisition manifest)", os.path.join(ACQ, "violationtracker", "local-state-data-sources.html")),
                  {"url": "catalog URL checks (one GET per listed official URL, robots.txt respected)", "path": "private/acq/third_party_data/catalog_pages/_checks.jsonl",
                   "sha256": sha256_file(os.path.join(ACQ, "catalog_pages", "_checks.jsonl"))},
                  {"url": "corpus datasets and record source hosts (read-only SQL lookup)", "path": "private/build/third_party_data/lookups/corpus_dataset_sources.json",
                   "sha256": sha256_file(os.path.join(LOOKUPS, "corpus_dataset_sources.json"))}]
    spath = os.path.join(ACQ, "verification", "catalog_spot_checks.json")
    if os.path.exists(spath):
        cat_inputs.append({"url": "catalog spot checks", "path": os.path.relpath(spath, ROOT), "sha256": sha256_file(spath)})
    cat_summary = {
        "compiled": True,
        "method": CATALOG_METHOD,
        "no_penalty_records": True,
        "grain": "one row per compiled source entry that lists at least one agency URL; entries with no agency URL are not built",
        "check_date": stamp["catalog_check_date"],
        "coverage_rule": "corpus datasets whose record source_url host (or metadata URL host) equals the listed URL host after dropping 'www.', or whose label contains the agency's listed name or (federal only) its official acronym as a whole word; kind by dataset id prefix: enforcement/safety/regulatory data (agency_safety_*, regulatory_*, settlements), company profile data (company_*), derived state metrics (state_metrics_*), else reference/directory. Coverage means the dataset's records cite the agency's host or its label names the agency; it does not mean every enforcement action of that agency is loaded",
        "source_type_rule": "derived from the coverage phrase by fixed keyword patterns (vt_parse.SOURCE_TYPES)",
        "counts": cat_stats,
        "analytics": {"share_formula": f"share = count / entries ({cat_stats['entries']})", "coverage_rate_formula": "covered / entries, where covered = at least one corpus dataset matched by host or name (rule above)",
                      "enforcement_data_coverage_formula": "entries with an enforcement/safety/regulatory dataset / entries",
                      "url_ok_rate_formula": "entries with at least one listed URL that returned HTTP 2xx on the check date / entries with a URL"},
        "spot_checks": spot_summary,
    }
    cat_listing = writer.listing(
        [("agency", "Agency"), ("jurisdiction", "Jurisdiction"), ("level", "Level"), ("covers", "What it covers"), ("source_type", "Source type"),
         ("official_url", "Official site"), ("url_check", "URL check"), ("corpus_datasets", "Corpus datasets")],
        [("level", "Level", {k: v for k, v in LEVEL_LABELS.items()}),
         ("source_type", "Source type", SOURCE_TYPE_LABELS),
         ("corpus_covered", "Covered in corpus", {"yes": "Yes", "no": "No"}),
         ("url_ok", "URL check OK", {"yes": "Yes", "no": "No"})])
    write_build(CAT_DATASET, "Enforcement data sources catalog (federal, state and local)", cat_listing, cat_summary, cat_rows, cat_inputs)

    def dump(name, payload):
        tp.atomic_write(os.path.join(BUILD, name), json.dumps(payload, indent=1, ensure_ascii=False))

    dump("settlesignal_overlap.json", {"counts": ss_stats["overlap"], "per_record": ov, "near_duplicates": near,
                                       "existing_not_in_current_feed": [{"id": e["id"], "slug": e["slug"], "title": e["title"]} for e in dropped]})
    dump("third_party_settlesignal_excluded.json", {"count": len(excluded), "rows": excluded})
    dump("enforcement_data_sources_catalog_excluded.json", {"count": len(cat_excluded), "rows": cat_excluded})
    dump("notice_provenance_private.json", {"PRIVATE": "Maps each published notice id to the compiled record it came from. Never publish.", "dataset": SS_DATASET,
                                            "count": len(notice_prov), "rows": notice_prov})
    dump("catalog_provenance_private.json", {"PRIVATE": "Maps each published catalog id to the listing line it came from. Never publish.", "dataset": CAT_DATASET,
                                             "count": len(cat_prov), "rows": cat_prov})
    dump("build_stats.json", {"stamp": stamp, "settlesignal": ss_stats, "verification": ss_summary["verification"], "catalog": cat_stats, "catalog_spot_checks": spot_summary})
    print(json.dumps({"notice_rows": len(ss_rows), "notices_excluded": len(excluded), "catalog_rows": len(cat_rows), "catalog_excluded": len(cat_excluded),
                      "verification": ss_summary["verification"].get("verdict_counts")}))


if __name__ == "__main__":
    main()
