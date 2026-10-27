"""Retype the `settlements` dataset: no keyword "MDL / mass tort" family, no third-party aggregator fields, facts only.

The dataset (869 rows, published 2026-10-03) mixes three layers: 848 references from a third-party consumer settlement
aggregator, 13 saved official pages and 8 CourtListener docket-entry searches of MDL master dockets. Its own
qualification records that the aggregator's general terms restrict commercial use and bulk republication. Under the
licence rule (2026-10-22: no non-commercial licences), this retype keeps only facts that do not depend on the
aggregator's assertions:

  kept      the settlement's name and official site link, saved official pages, the bounded manual review of official
            sources, CourtListener docket-entry evidence, title-derived caption facts
  removed   the aggregator's status, claim deadline, payout text, proof requirement, states, category, verification
            status, check dates and its page link; the "MDL / mass tort (keyword)" family and the mass-tort keyword
            facts, badges and filter; the deadline filters computed against 2026-09-19
  family    mdl_docket (verified MDL master docket search), mdl_case_number (a case number in MDL docket form on the
            official page, the saved page title or the bounded review), official_page (saved page without a catalog
            record) or reference (name and official site only). Nothing is classified by keyword.
  linked    the confirmed record in settlement_claims_official when both rows come from the same source URL (exact
            slug), so a deadline or amount confirmed on the official page is one click away

  python3 -I -B scripts/enrichment/enforcement_actions/retype_settlements.py --export     # lead, read-only
  python3 -I -B scripts/enrichment/enforcement_actions/retype_settlements.py --build      # dry run, no network
  python3 -I -B scripts/enrichment/enforcement_actions/retype_settlements.py --publish    # lead only

--build reads private/acq/de-settlements-sec/settlements.export.json and settlement_claims_official.export.json (or the
retyped claims packet) and writes private/build/de-settlements-sec/settlements.json plus settlements.report.json.
"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import settle_types as stypes  # noqa: E402

DATASET = "settlements"
CLAIMS = "settlement_claims_official"
NOT_RECORDED = "Not recorded"
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PRIVATE = os.environ.get("CORPUS_PRIVATE_ROOT") or os.path.join(ROOT, "private")
EXPORT = os.path.join(PRIVATE, "acq", "de-settlements-sec", f"{DATASET}.export.json")
CLAIMS_EXPORT = os.path.join(PRIVATE, "acq", "de-settlements-sec", f"{CLAIMS}.export.json")
CLAIMS_PACKET = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{CLAIMS}.json")
PACKET = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.json")
REPORT = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.report.json")
SELECT = "id,category,state,title,source_url,item,detail,text,filters,ordinal"
VERSION = "settlements-licence-retype/2026-10-27"

FAMILY = {
    "mdl_docket": "MDL master docket search (court docket entries)",
    "mdl_case_number": "MDL case number (docket form)",
    "official_page": "Saved official page",
    "reference": "Settlement reference (official site)",
}
OLD_FAMILY_LABELS = {"MDL / mass tort (keyword)", "MDL / mass tort (court docket evidence)", "Class / consumer",
                     "Data breach", "AG / government", "Other"}
DROP_BADGES = {"Publisher reference (unverified)", "Mass-tort keyword"} | OLD_FAMILY_LABELS
DROP_FACTS = {"States (as published)", "Mass-tort keyword"}
AGGREGATOR_HOST = "settlesignal.com"
QUALIFICATION = (
    "Settlement references kept as facts only: each row's name and official site, saved official pages, a bounded manual "
    "review of official sources where one was made, and CourtListener docket-entry searches of verified MDL master "
    "dockets. Fields asserted by the third-party list the references came from (status, claim deadline, payout text, "
    "states, category, verification) are not published, because its terms restrict commercial use and bulk "
    "republication. Where the official page itself confirmed a deadline, amount, court or case number, the confirmed "
    "record is linked. A family names the evidence behind the row; nothing is classified by keyword, and an MDL is "
    "named only from a verified master docket or a case number in MDL docket form."
)
NOT_THIS = {
    "reference": "Not a court record and not a verified settlement: only the settlement's name and its official site are kept here. Where the official page confirmed a deadline, amount, court or case number, the confirmed record is linked.",
    "official_page": "Not a court record and not a verified settlement. A saved page is a snapshot of an administrator or government site, not the settlement agreement or an order.",
    "mdl_case_number": "Not a court record and not a verified settlement. The MDL is named only because a case number in MDL docket form appears on the official page, the saved page title or the bounded review.",
}


def is_aggregator(row):
    layer = next((v for k, v in row["detail"].get("facts") or [] if k == "Record layer"), "")
    return layer.startswith("Publisher reference")


def aggregator_slug(row):
    """The aggregator page's slug as build_settlements.slug_of reads it (the confirmed records use the same slug)."""
    for link in (row["detail"].get("links") or []):
        url = link.get("url") or ""
        if (urlsplit(url).hostname or "").endswith(AGGREGATOR_HOST):
            path = urlsplit(url).path.rstrip("/")
            return re.sub(r"[^a-z0-9-]", "", path.rsplit("/", 1)[-1].lower())[:90] or None
    return None


def claims_index(claim_rows):
    """settle:<slug> -> {'id', 'mdls': [(case number, MDL)]} from settlement_claims_official rows (published or retyped)."""
    out = {}
    for r in claim_rows:
        s = (r.get("item") or {}).get("settlement") or {}
        mdls = [(c.get("as_written"), stypes.mdl_from_case_number(c.get("as_written"))) for c in s.get("case_numbers") or []]
        out[r["id"]] = {"id": r["id"], "mdls": [(c, n) for c, n in mdls if n is not None]}
    return out


def review_case_numbers(row):
    for s in row["detail"].get("sections") or []:
        for cells in s.get("rows") or []:
            if cells and cells[0] == "Case number":
                yield str(cells[1])


def family_of(row, confirmed):
    """(family, [(case number, MDL, basis)])."""
    if row["id"].startswith("mdl-docket-"):
        n = int(row["id"].rsplit("-", 1)[-1])
        docket = next((v for k, v in row["detail"]["facts"] if k == "Master docket"), None)
        return "mdl_docket", [(docket.split(" ")[0] if docket else None, n, "verified MDL master docket (CourtListener)")]
    found = []
    if confirmed:
        found += [(c, n, "case number on the official page (confirmed record)") for c, n in confirmed["mdls"]]
    for text in review_case_numbers(row):
        found += [(c, n, "case number in the bounded review of official sources") for c, n in stypes.mdl_docket_tokens(text)]
    found += [(c, n, "case number in the saved official page title") for c, n in stypes.mdl_docket_tokens(row["title"])]
    seen, mdls = set(), []
    for c, n, basis in found:
        if n not in seen:
            seen.add(n)
            mdls.append((c, n, basis))
    if mdls:
        return "mdl_case_number", mdls
    return ("reference" if is_aggregator(row) else "official_page"), []


def retype_row(row, claims):
    out = copy.deepcopy(row)
    out.pop("ordinal", None)
    item, detail, filters = out["item"], out["detail"], out["filters"]
    aggregator = is_aggregator(row)
    slug = aggregator_slug(row) if aggregator else None
    confirmed = claims.get(f"settle:{slug}") if slug else None
    family, mdls = family_of(row, confirmed)
    label = FAMILY[family]
    host = urlsplit(row.get("source_url") or "").hostname or None
    if row["id"].startswith("mdl-docket-"):
        host = None

    facts = []
    for k, v in detail.get("facts") or []:
        if k in DROP_FACTS or "publisher" in k.lower():
            continue
        if k == "Family":
            v = label + ("" if not mdls else " - " + "; ".join(f"MDL {n}: {basis} ({c})" if c else f"MDL {n}: {basis}" for c, n, basis in mdls))
        elif aggregator and k == "Record layer":
            v = "Settlement reference (name and official site only)"
        elif aggregator and k == "Source":
            v = "Settlement reference list (third party); none of its fields are published here. The official site is the source."
        elif aggregator and k == "Verification":
            v = ("The official page confirmed facts are in the linked confirmed record" if confirmed
                 else "Not verified here; check the official site")
        facts.append([k, v])
    if confirmed:
        facts.append(["Confirmed on the official page", "Yes: see the linked record in Settlement claims confirmed on official pages"])
    detail["facts"] = facts

    sections = []
    for s in detail.get("sections") or []:
        heading = s.get("heading") or ""
        if heading.lower().startswith("payout text"):
            continue
        if heading == "What this record is not" and family in NOT_THIS and not row["id"].startswith("mdl-docket-"):
            s = {**s, "text": NOT_THIS[family]}
        sections.append(s)
    detail["sections"] = sections
    detail["qualification"] = QUALIFICATION

    extra_links = []
    if confirmed:
        extra_links.append({"url": f"/records/{CLAIMS}/{quote(confirmed['id'], safe='')}", "label": "Confirmed on the official page (deadline, amount, court or case number)"})
    for c, n, _basis in mdls:
        if family == "mdl_case_number":
            extra_links.append({"url": f"/matters/lens/{n}", "label": f"MDL {n}" + (f" (case number {c})" if c else "")})
    for key in ("links",):
        for holder in (item, detail):
            kept = [l for l in holder.get(key) or [] if AGGREGATOR_HOST not in (urlsplit(l.get("url") or "").hostname or "")]
            urls = {l.get("url") for l in kept}
            holder[key] = kept + [l for l in extra_links if l["url"] not in urls]

    badges = [b for b in item.get("badges") or [] if b not in DROP_BADGES]
    item["badges"] = [label] + badges + (["Confirmed on the official page"] if confirmed else []) + [f"MDL {n}" for _c, n, _b in mdls]
    if aggregator:
        sub = f"Official site: {host}" if host else "Official site not recorded"
        item["subtitle"] = detail["subtitle"] = sub + (" · confirmed record linked" if confirmed else "")

    cells = item["cells"]
    cells.pop("deadline", None)
    cells["family"] = label
    cells["mdl"] = ", ".join(f"MDL {n}" for _c, n, _b in mdls) or NOT_RECORDED
    cells["official_site"] = host or NOT_RECORDED
    cells["confirmed"] = "Yes" if confirmed else "No"

    for k in ("deadline_state", "mass_tort", "date", "state"):
        filters.pop(k, None)
    filters["family"] = [family]
    filters["mdl"] = [str(n) for _c, n, _b in mdls]
    filters["has_confirmed_record"] = ["yes" if confirmed else "no"]
    out["state"] = ""
    out["text"] = " ".join(str(p) for p in [row["id"], row["title"], item.get("subtitle"), label, host,
                                             " ".join(f"MDL {n}" for _c, n, _b in mdls)] if p)
    return out


def counted_options(rows, key, labels):
    counts = Counter(v for r in rows for v in r["filters"].get(key) or [])
    return [{"count": counts[k], "label": labels.get(k, k), "value": k} for k in labels if counts[k]] + \
           [{"count": c, "label": labels.get(k, k), "value": k} for k, c in sorted(counts.items()) if k not in labels]


def metadata_for(old, rows):
    meta = copy.deepcopy(old or {})
    doc_labels = {}
    for f in (meta.get("listing") or {}).get("filters") or []:
        if f.get("name") == "doc_type":
            doc_labels = {o["value"]: o["label"] for o in f.get("options") or []}
    mdl_values = sorted({v for r in rows for v in r["filters"].get("mdl") or []}, key=int)
    listing = {
        "page": 1, "limit": 25, "total": len(rows),
        "columns": [{"key": "settlement", "label": "Settlement"}, {"key": "family", "label": "Evidence"},
                    {"key": "mdl", "label": "MDL"}, {"key": "official_site", "label": "Official site"},
                    {"key": "documents", "label": "Documents"}, {"key": "confirmed", "label": "Confirmed on official page"}],
        "filters": [
            {"name": "q", "type": "search", "label": "Search title, caption or official host"},
            {"name": "family", "type": "select", "label": "Evidence", "options": counted_options(rows, "family", FAMILY)},
            {"name": "mdl", "type": "select", "label": "MDL", "options": counted_options(rows, "mdl", {v: f"MDL {v}" for v in mdl_values})},
            {"name": "has_confirmed_record", "type": "select", "label": "Confirmed on the official page",
             "options": counted_options(rows, "has_confirmed_record", {"yes": "Confirmed record linked", "no": "No confirmed record"})},
            {"name": "has_documents", "type": "select", "label": "Saved documents",
             "options": counted_options(rows, "has_documents", {"yes": "Has a saved official page or file", "no": "Nothing saved"})},
            {"name": "has_court_documents", "type": "select", "label": "Court docket entries",
             "options": counted_options(rows, "has_court_documents", {"yes": "Has court docket entries (MDL master docket, CourtListener)", "no": "No court docket entries"})},
            {"name": "doc_type", "type": "select", "label": "Document type", "options": counted_options(rows, "doc_type", doc_labels)},
        ],
        "available": True,
        "qualification": QUALIFICATION,
    }
    meta["listing"] = listing
    if "listing_modes" in meta:
        meta["listing_modes"] = {**meta["listing_modes"], "default": copy.deepcopy(listing)}
    meta["licence_retype"] = {
        "version": VERSION, "applied_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rule": "Owner decision 2026-10-22 (2): sources that require a paid or non-commercial licence are not used. The reference list's terms restrict commercial use and bulk republication, so its fields are removed and only facts are kept.",
        "removed": ["aggregator status, claim deadline, payout text, proof requirement, states, category, verification status, check and feed dates, aggregator page links",
                    "family 'MDL / mass tort (keyword)' and the mass-tort keyword facts, badges and filter",
                    "deadline filters computed against 2026-09-19 (deadline_state, dfrom, dto) and the state filter (states as listed by the aggregator)"],
    }
    summary = dict(meta.get("summary") or {})
    summary.update({"records": len(rows), "listing_records": len(rows), "families": dict(Counter(r["filters"]["family"][0] for r in rows))})
    meta["summary"] = summary
    meta["ready"] = True
    return meta


def retype_all(rows, claim_rows):
    claims = claims_index(claim_rows)
    out = [retype_row(r, claims) for r in sorted(rows, key=lambda r: r.get("ordinal", 0))]
    before = Counter((r["filters"].get("family") or ["?"])[0] for r in rows)
    after = Counter(r["filters"]["family"][0] for r in out)
    moved = [{"id": o["id"], "title": o["title"], "was": (r["filters"].get("family") or ["?"])[0], "now": o["filters"]["family"][0],
              "mdl": o["filters"]["mdl"]} for r, o in zip(sorted(rows, key=lambda r: r.get("ordinal", 0)), out)
             if (r["filters"].get("family") or ["?"])[0] in ("mdl_mass_tort", "mdl_court_docket") or o["filters"]["mdl"]]
    leaks = [o["id"] for o in out if AGGREGATOR_HOST in json.dumps(o, ensure_ascii=False).lower()]
    report = {"rows": len(out), "families_before": dict(before), "families_after": dict(after),
              "confirmed_records_linked": sum(1 for o in out if o["filters"]["has_confirmed_record"] == ["yes"]),
              "mdl_rows": moved, "aggregator_mentions_left": leaks}
    return out, report


def load_claims():
    if os.path.exists(CLAIMS_PACKET):
        return json.load(open(CLAIMS_PACKET, encoding="utf-8"))["rows"]
    return json.load(open(CLAIMS_EXPORT, encoding="utf-8"))["rows"]


def export():
    import corpus_writer as writer  # noqa: E402

    rows = writer.fetch_all(DATASET, select=SELECT)
    meta = writer._call("GET", f"corpus_datasets?select=id,label,metadata,imported_records&id=eq.{DATASET}", prefer="return=representation")
    os.makedirs(os.path.dirname(EXPORT), exist_ok=True)
    with open(EXPORT, "w", encoding="utf-8") as h:
        json.dump({"dataset": DATASET, "exported_at": datetime.now(timezone.utc).isoformat(), "meta": meta[0] if meta else None, "rows": rows}, h, ensure_ascii=False)
    print(json.dumps({"exported": len(rows), "file": EXPORT}))


def build():
    blob = json.load(open(EXPORT, encoding="utf-8"))
    meta = blob.get("meta") or {}
    if meta.get("imported_records") is not None and meta["imported_records"] != len(blob["rows"]):
        raise SystemExit(f"export holds {len(blob['rows'])} rows but the dataset says {meta['imported_records']}; export again")
    rows, report = retype_all(blob["rows"], load_claims())
    if report["aggregator_mentions_left"]:
        raise SystemExit(f"aggregator still named on {len(report['aggregator_mentions_left'])} rows")
    metadata = metadata_for(meta.get("metadata"), rows)
    if AGGREGATOR_HOST.split(".")[0] in json.dumps(metadata).lower():
        raise SystemExit("aggregator still named in the dataset metadata")
    packet = {"dataset": DATASET, "label": meta.get("label") or "Settlements", "metadata": metadata,
              "rows": rows, "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    os.makedirs(os.path.dirname(PACKET), exist_ok=True)
    with open(PACKET, "w", encoding="utf-8") as h:
        json.dump(packet, h, ensure_ascii=False, separators=(",", ":"))
    with open(REPORT, "w", encoding="utf-8") as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("rows", "families_before", "families_after", "confirmed_records_linked")}))
    print(json.dumps({"mdl_rows": len(report["mdl_rows"]), "packet": PACKET}))


def publish():
    """corpus_writer.publish, but keeping the dataset's own metadata (aliases, listing modes, review history)."""
    import corpus_writer as writer  # noqa: E402

    packet = json.load(open(PACKET, encoding="utf-8"))
    rows, meta = packet["rows"], packet["metadata"]
    ids = [r["id"] for r in rows]
    if packet["dataset"] != DATASET or len(ids) != len(set(ids)):
        raise SystemExit("bad packet")
    digest = hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()
    pending = {**meta, "ready": False}
    writer._call("POST", "corpus_datasets", [{"id": DATASET, "label": packet["label"], "ready": False, "expected_records": len(rows),
                                             "imported_records": 0, "manifest_sha256": digest, "metadata": pending}],
                 prefer="return=minimal,resolution=merge-duplicates")
    writer._call("DELETE", f"corpus_records?dataset=eq.{DATASET}")
    for start in range(0, len(rows), writer.BATCH):
        for ordinal, row in enumerate(rows[start:start + writer.BATCH], start):
            row["dataset"] = DATASET
            row["ordinal"] = ordinal
        writer._call("POST", "corpus_records", rows[start:start + writer.BATCH], prefer="return=minimal,resolution=merge-duplicates")
    count = writer._count(DATASET)
    if count != len(rows):
        raise RuntimeError(f"{DATASET}: wrote {len(rows)} rows but {count} are stored")
    writer._call("PATCH", f"corpus_datasets?id=eq.{DATASET}", {"ready": True, "imported_records": count, "metadata": {**meta, "ready": True}})
    print(json.dumps({"dataset": DATASET, "records": count, "sha256": digest}))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", action="store_true")
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--publish", action="store_true")
    args = ap.parse_args(argv)
    if args.export:
        export()
    elif args.build:
        build()
    else:
        publish()


if __name__ == "__main__":
    main()
