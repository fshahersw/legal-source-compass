"""Catalog datasets for safety/1 (corpus_datasets / corpus_records through scripts/enrichment/corpus_writer.py): one
searchable record per MDL product group, FAERS product, MAUDE device code and CFPB company, linking to the product pages.
The record-level and monthly data stay in the typed `safety` schema; these records make them findable in the catalog and
are the datasets the scheduled ingest sources report against (ingest.sources.dataset).

  python3 -I scripts/safety_v2/catalog_build.py            # stage JSONL under private/build/w1025_safety/catalog/
  python3 -I scripts/safety_v2/catalog_build.py --publish  # THE LEAD: publish with corpus_writer (needs EXTERNAL_SUPABASE_*)

Datasets: safety_mdl_products, safety_faers_products, safety_maude_products, safety_cfpb_companies.
"""
import argparse
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[0] / "enrichment"))
import common as c  # noqa: E402
import corpus_writer as cw  # noqa: E402
import mdl_map  # noqa: E402

CAVEAT = ("Reports are voluntary and unverified; a report that lists a product does not establish that the product caused "
          "the event, and counts change as FDA adds, merges and revises reports.")
LABELS = {
    "safety_mdl_products": "MDL product groups: products named in JPML titles, with adverse-event, device-report, recall and complaint series",
    "safety_faers_products": "FAERS products: monthly adverse-event reports, outcomes and MedDRA reactions by quarter (openFDA)",
    "safety_maude_products": "MAUDE device product codes: monthly device reports by event type, device and patient problems (openFDA)",
    "safety_cfpb_companies": "CFPB complaint companies: complaints by product, issue, state and month",
}


def chunk_rows(base, target):
    for f in sorted(Path(base).rglob(f"chunks/{target}-*.jsonl.gz")):
        for line in gzip.open(f):
            yield json.loads(line)


def fmt(n):
    return "Not recorded" if n is None else f"{n:,}"


def build(args):
    base = Path(args.base)
    plan = json.loads((base / "openfda" / "subjects" / "plan.json").read_text())
    subjects = {s["id"]: s for s in plan["subjects"]}
    links = defaultdict(list)
    for link in plan["links"]:
        links[link["subject_id"]].append(link)
    series = defaultdict(dict)
    for r in chunk_rows(base, "series"):
        series[r["subject_id"]][r["series"]] = r
    tops = defaultdict(dict)
    for r in chunk_rows(base, "breakdowns"):
        if r["period"] == "all":
            tops[r["subject_id"]][r["dim"]] = list(zip(r["terms"], r["vals"]))[:10]
    out = defaultdict(list)
    for sid, s in subjects.items():
        if s["subject_type"] == "national":
            continue
        ser = series.get(sid, {})
        main = ser.get("faers_reports") or ser.get("maude_reports") or ser.get("caers_reports") or ser.get("nhtsa_complaints")
        total = sum(main["vals"]) if main else None
        last12 = sum(main["vals"][-12:]) if main else None
        prev12 = sum(main["vals"][-24:-12]) if main and len(main["vals"]) >= 24 else None
        serious = ser.get("faers_serious") or ser.get("maude_death")
        page = f"/safety/products/{sid}"
        top = tops.get(sid, {}).get("meddra_pt") or tops.get(sid, {}).get("device_problem") or []
        facts = [["Subject", s["label"]], ["Kind", s["kind"]],
                 ["Reports in the window", fmt(total)], ["Window", f"{main['coverage_from']} to {main['coverage_to']}" if main else "Not recorded"],
                 ["Last 12 months / previous 12 months", f"{fmt(last12)} / {fmt(prev12)}"],
                 ["Most reported terms", "; ".join(f"{t} ({n:,})" for t, n in top[:8]) or "Not recorded"],
                 ["Search (exact source query)", json.dumps(s.get("search", {}), sort_keys=True)],
                 ["Caveat", CAVEAT]]
        mdls = [x["mdl"] for x in links.get(sid, [])]
        if s["subject_type"] == "mdl_group":
            link = links[sid][0]
            facts = [["MDL", f"{link['mdl']} — {link['title']}"], ["Link basis", f"{link['basis']}: {link['basis_note']}"]] + facts
            dataset = "safety_mdl_products"
        elif s["subject_type"] == "product":
            dataset = "safety_faers_products"
        else:
            dataset = "safety_maude_products"
        out[dataset].append(cw.record(
            dataset, sid, s["label"], source_url=s["source_url"],
            subtitle=" · ".join(x for x in [s["kind"], f"{fmt(total)} reports" if total is not None else None,
                                            f"MDL {', '.join(map(str, mdls))}" if mdls else None] if x),
            cells={"subject": s["label"], "kind": s["kind"], "reports": fmt(total), "last_12m": fmt(last12),
                   "rank": str(s.get("rank") or "—"), "mdls": ", ".join(map(str, mdls)) or "—"},
            facts=facts, badges=[b for b in [s["kind"].title(), "MDL-named" if mdls else None] if b],
            links=[{"url": page, "label": "Product page"}, {"url": s["source_url"], "label": "Source documentation"}]
            + [{"url": f"/records/mdls/{m}", "label": f"MDL {m}"} for m in mdls],
            text=" ".join([s["label"], " ".join(t for t, _ in top), json.dumps(s.get("keys", {}))]),
            filters={"kind": [s["kind"]], "mdl": [str(m) for m in mdls], "has_mdl": ["yes" if mdls else "no"]},
            extra={"kind": "safety_subject", "subject": {"id": sid, "type": s["subject_type"], "reports_total": total,
                                                          "last_12m": last12, "prev_12m": prev12, "page": page}},
        ))
    # CFPB companies from the staged aggregates
    comp = defaultdict(lambda: {"total": 0, "products": Counter(), "issues": Counter(), "months": Counter()})
    for r in chunk_rows(base / "cfpb", "cfpb_monthly"):
        g = comp[r["company"]]
        g["total"] += r["complaints"]
        g["products"][r["product"]] += r["complaints"]
        g["issues"][r["issue"]] += r["complaints"]
        g["months"][r["month"]] += r["complaints"]
    used = set()
    for name, g in sorted(comp.items(), key=lambda kv: (-kv[1]["total"], kv[0])):
        rid = "cfpb_company:" + c.slug(name, 90)
        if rid in used:
            rid = rid[:90] + "-" + c.sha256_bytes(name.encode())[:6]
        used.add(rid)
        months = sorted(g["months"])
        last = months[-1] if months else None
        last12 = sum(v for m, v in g["months"].items() if last and m > c.month_add(last, -12))
        out["safety_cfpb_companies"].append(cw.record(
            "safety_cfpb_companies", rid, name, source_url="https://www.consumerfinance.gov/data-research/consumer-complaints/",
            subtitle=f"{g['total']:,} complaints · {months[0] if months else '?'} to {last or '?'}",
            cells={"company": name, "complaints": f"{g['total']:,}", "last_12m": f"{last12:,}",
                   "top_product": g["products"].most_common(1)[0][0] if g["products"] else "—"},
            facts=[["Company (as published by the CFPB)", name], ["Complaints", f"{g['total']:,}"],
                   ["Complaints in the 12 months to " + (last or "?"), f"{last12:,}"],
                   ["Products", "; ".join(f"{p} ({n:,})" for p, n in g["products"].most_common(6))],
                   ["Issues", "; ".join(f"{p} ({n:,})" for p, n in g["issues"].most_common(6))],
                   ["Caveat", "Complaints are not verified by the CFPB; volume reflects consumer use of the system as well as company conduct."]],
            links=[{"url": f"/safety/companies?name={name}", "label": "Company safety profile"},
                   {"url": "https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=" + name.replace(" ", "%20"),
                    "label": "CFPB complaint search"}],
            text=f"{name} {' '.join(g['products'])}", filters={"product": sorted(g["products"])[:20]},
            extra={"kind": "cfpb_company", "company": {"name": name, "total": g["total"], "last_12m": last12}}))
    outdir = base / "catalog"
    outdir.mkdir(parents=True, exist_ok=True)
    for ds, rows in out.items():
        with gzip.open(outdir / f"{ds}.jsonl.gz", "wt", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps({ds: len(rows) for ds, rows in out.items()}))
    return out


def listing_for(ds):
    if ds == "safety_cfpb_companies":
        return cw.listing([("company", "Company"), ("complaints", "Complaints"), ("last_12m", "Last 12 months"), ("top_product", "Top product")])
    return cw.listing([("subject", "Product"), ("kind", "Kind"), ("reports", "Reports"), ("last_12m", "Last 12 months"),
                       ("rank", "Rank"), ("mdls", "MDLs")],
                      [("kind", "Kind", {"drug": "Drug", "device": "Device", "food": "Food", "cosmetic": "Cosmetic", "vehicle": "Vehicle"}),
                       ("has_mdl", "Named in an MDL title", {"yes": "Yes", "no": "No"})])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=str(c.BUILD))
    ap.add_argument("--publish", action="store_true")
    args = ap.parse_args()
    out = build(args)
    if args.publish:
        for ds, rows in out.items():
            cw.publish(ds, LABELS[ds], rows, listing_block=listing_for(ds),
                       summary={"caveat": CAVEAT, "schema": "safety/1", "not_mapped_mdls": {str(k): v for k, v in mdl_map.NOT_MAPPED.items()}
                                if ds == "safety_mdl_products" else None})


if __name__ == "__main__":
    main()
