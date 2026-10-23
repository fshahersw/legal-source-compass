"""10-K legal proceedings of the companies in company_sec_profiles (wave 1025, api-law): Item 3 "Legal Proceedings" and
the financial-statement notes it points to (or notes titled contingencies / litigation / legal proceedings), as exact
text spans with the accession number, document URL and offsets, plus every MDL number written in them (a mention, never
membership) and every held MDL caption they repeat word for word.

  python3 -I -B scripts/api_law/edgar/legal_proceedings.py acquire [--years 3] [--ciks 0000200406,...] [--out DIR]
  . private/scratch/env.sh && python3 -I -B scripts/api_law/edgar/legal_proceedings.py build [--out DIR]
  python3 -I -B scripts/api_law/edgar/legal_proceedings.py verify [--sample 4]   (re-fetch and exact span checks)

acquire  for each company: data.sec.gov submissions → its newest --years Form 10-K filings (10-K, 10-K405, 10-KT; not
         amendments) → the primary document from www.sec.gov/Archives, rendered and extracted in memory; one JSON per
         filing (<out>/filings/<cik>-<accession>.json) with the spans and the sha256 of the raw document and of the
         rendering. Raw documents are never kept (they stay re-fetchable at the recorded URL). Resumable.
build    rows of company_sec_legal_proceedings (+ header) for scripts/api_law/publish_stream.py; held MDL numbers and
         captions are read from the corpus (read-only) once.

SEC fair access: the declared User-Agent below and at most --rps requests a second (default 4; the SEC allows 10).
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))
import edgar_text as E  # noqa: E402

UA = "LegalSourceAtlas/1.0 (legal-source-compass research; contact: notreelai@gmail.com)"
DATASET = "company_sec_legal_proceedings"
FORMS = {"10-K", "10-K405", "10-KT"}
TEXT_CAP = 120_000
OUT = ROOT / "private" / "build" / "w1025_api-law" / "edgar"
COMPANIES = ROOT / "scripts" / "enrichment" / "enforcement_actions" / "lookup_company_sec_profiles.json"


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Client:
    def __init__(self, rps, ledger):
        self.interval = 1.0 / rps
        self.last = 0.0
        self.ledger = ledger

    def get(self, url):
        for attempt in range(5):
            wait = self.last + self.interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    body = res.read()
                    if res.headers.get("Content-Encoding") == "gzip":
                        body = gzip.decompress(body)
                    status = res.status
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(10 * (attempt + 1))
                    continue
                status, body = e.code, b""
            except urllib.error.URLError:
                if attempt < 4:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
            with open(self.ledger, "a") as h:
                h.write(json.dumps({"url": url, "status": status, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "retrieved_at": now()}) + "\n")
            return status, body
        raise RuntimeError(f"no response from {url}")


def ten_ks(sub, years):
    r = sub["filings"]["recent"]
    out = []
    for i, form in enumerate(r["form"]):
        if form in FORMS and r["primaryDocument"][i]:
            out.append({"form": form, "filed": r["filingDate"][i], "period": r["reportDate"][i] or None,
                        "accession": r["accessionNumber"][i], "document": r["primaryDocument"][i]})
    out.sort(key=lambda f: f["filed"], reverse=True)
    return out[:years]


def doc_url(cik, f):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{f['accession'].replace('-', '')}/{f['document']}"


def index_url(cik, f):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{f['accession'].replace('-', '')}/{f['accession']}-index.htm"


def extract(text):
    """Item 3 and the notes it points to (or titled contingency/litigation notes), as spans of `text`."""
    out = {"item3": None, "notes": [], "note_rule": None}
    i3 = E.item3(text)
    referenced = []
    if i3:
        heading, a, b = i3
        out["item3"] = {"heading": heading, "start": a, "end": b}
        referenced = E.note_numbers(text[a:b])
    for n in referenced:
        sec = E.note_section(text, n)
        if sec and sec[2] - sec[1] > 200:
            out["notes"].append({"number": n, "heading": sec[0], "start": sec[1], "end": sec[2], "found_by": "note number named in Item 3"})
    if referenced:
        out["note_rule"] = "notes named by number in Item 3"
    if not out["notes"]:
        for n, heading, a, b in E.titled_notes(text):
            out["notes"].append({"number": n, "heading": heading, "start": a, "end": b, "found_by": "note heading names contingencies, litigation or legal proceedings"})
        out["note_rule"] = "note headings naming contingencies, litigation or legal proceedings" if out["notes"] else None
    return out


def acquire(args):
    out = Path(args.out)
    (out / "filings").mkdir(parents=True, exist_ok=True)
    client = Client(args.rps, out / "requests.jsonl")
    rows = json.loads(COMPANIES.read_text())["rows"]
    ciks = [c for c, _ in rows if c.isdigit()]
    if args.ciks:
        ciks = [c for c in ciks if c in set(args.ciks.split(","))]
    stats = {"companies": len(ciks), "filings": 0, "skipped_existing": 0, "no_10k": 0, "no_item3": 0, "errors": []}
    for cik in ciks:
        status, body = client.get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
        if status != 200:
            stats["errors"].append({"cik": cik, "status": status})
            continue
        sub = json.loads(body)
        filings = ten_ks(sub, args.years)
        if not filings:
            stats["no_10k"] += 1
        for f in filings:
            path = out / "filings" / f"{cik}-{f['accession']}.json"
            if path.exists():
                stats["skipped_existing"] += 1
                continue
            url = doc_url(cik, f)
            status, raw = client.get(url)
            if status != 200:
                stats["errors"].append({"cik": cik, "url": url, "status": status})
                continue
            text = E.render(raw)
            ex = extract(text)
            if not ex["item3"]:
                stats["no_item3"] += 1
            spans = [ex["item3"]] if ex["item3"] else []
            spans += ex["notes"]
            for s in spans:
                full = text[s["start"]:s["end"]]
                s["chars"] = len(full)
                s["text"] = full[:TEXT_CAP]
                s["truncated"] = len(full) > TEXT_CAP
                s["sha256"] = hashlib.sha256(full.encode("utf-8")).hexdigest()
                s["mdl_mentions"] = E.mdl_mentions(full)
            record = {
                "cik": cik, "company": sub.get("name"), "tickers": sub.get("tickers") or [], **f,
                "document_url": url, "index_url": index_url(cik, f),
                "raw_sha256": hashlib.sha256(raw).hexdigest(), "raw_bytes": len(raw),
                "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "text_chars": len(text),
                "rendering": E.RENDERING, "retrieved_at": now(), **ex,
            }
            path.write_text(json.dumps(record, ensure_ascii=False))
            stats["filings"] += 1
            del raw, text
        print(json.dumps({"cik": cik, "filings": len(filings), "done": stats["filings"]}), file=sys.stderr)
    (out / f"manifest.acquire.{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json").write_text(json.dumps({**stats, "finished_at": now(), "years": args.years}, indent=1))
    print(json.dumps(stats))


def corpus_get(path):
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (read-only use)")
    headers = {"apikey": key, "Accept": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    with urllib.request.urlopen(urllib.request.Request(f"{url}/rest/v1/{path}", headers=headers), timeout=120) as r:
        return json.loads(r.read())


def held_mdls(out):
    cache = Path(out) / "known" / "mdls.json"
    if cache.exists():
        return json.loads(cache.read_text())
    rows = []
    start = 0
    while True:
        page = corpus_get(f"corpus_records?select=id,title&dataset=eq.mdls&order=id.asc&offset={start}&limit=1000")
        rows += page
        if len(page) < 1000:
            break
        start += 1000
    data = {"read_at": now(), "mdls": {r["id"]: r["title"] for r in rows if re.fullmatch(r"\d{2,4}", r["id"])}}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data))
    return data


def caption_core(title):
    """The MDL caption without its 'IN RE:' prefix, whitespace collapsed (compared case-insensitively)."""
    core = re.sub(r"^\s*IN\s+RE:?\s*", "", title or "", flags=re.I)
    core = re.sub(r"\s+", " ", core).strip()
    return core if len(core) >= 25 else None


def build(args):
    sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))
    import corpus_writer as cw  # record()/listing() only; nothing is written

    out = Path(args.out)
    mdls = held_mdls(out)["mdls"]
    captions = {n: caption_core(t) for n, t in mdls.items()}
    # the caption's words in order, any run of whitespace between them, any letter case: the filing's own text is kept
    caption_res = {n: re.compile(r"\s+".join(re.escape(w) for w in core.split(" ")), re.I) for n, core in captions.items() if core}
    rows, inputs = [], []
    stats = {"filings": 0, "with_item3": 0, "with_notes": 0, "mdl_number_mentions": 0, "held_mdl_mentions": 0, "caption_mentions": 0}
    for path in sorted((out / "filings").glob("*.json")):
        r = json.loads(path.read_text())
        inputs.append({"path": str(path.relative_to(ROOT)) if str(path).startswith(str(ROOT)) else str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        stats["filings"] += 1
        sections = ([("Item 3", r["item3"])] if r["item3"] else []) + [(f"Note {n['number']}", n) for n in r["notes"]]
        stats["with_item3"] += bool(r["item3"])
        stats["with_notes"] += bool(r["notes"])
        mention_rows, held = [], set()
        for name, s in sections:
            for m in s["mdl_mentions"]:
                n = str(m["mdl_number"])
                in_corpus = n in mdls
                held.add(n) if in_corpus else None
                mention_rows.append({**m, "section": name, "section_offset": m["offset"], "document_offset": s["start"] + m["offset"], "held_mdl": in_corpus})
            for n, rx in caption_res.items():
                m = rx.search(s["text"])
                if m:
                    mention_rows.append({"as_written": m.group(0), "mdl_number": int(n), "form": "MDL caption (exact text, case-insensitive)",
                                         "section": name, "section_offset": m.start(), "document_offset": s["start"] + m.start(), "held_mdl": True})
                    held.add(n)
                    stats["caption_mentions"] += 1
        stats["mdl_number_mentions"] += sum(1 for m in mention_rows if m["form"] != "MDL caption (exact text, case-insensitive)")
        stats["held_mdl_mentions"] += len(held)
        year = (r.get("period") or r["filed"])[:4]
        links = [{"url": r["index_url"], "label": "Filing index on EDGAR"}, {"url": r["document_url"], "label": "Form 10-K document (EDGAR)"},
                 {"url": f"/companies/{r['cik']}", "label": f"Company: {r['company']}"}]
        links += [{"url": f"/matters/lens/{n}", "label": f"Mentions MDL No. {n} (a mention in the filing, not membership)"} for n in sorted(held, key=int)]
        def span_fact(name, s):
            return (f"{name}: '{s['heading']}' at characters {s['start']:,}-{s['end']:,} of the rendering ({s['chars']:,} characters"
                    f"{'; first 120,000 kept' if s['truncated'] else ''})")
        facts = [
            ["Company (as filed)", f"{r['company']} (CIK {r['cik']})"],
            ["Form and accession number", f"{r['form']}, {r['accession']}"],
            ["Filed / period of report", f"{r['filed']} / {r.get('period') or 'Not recorded'}"],
            ["Item 3 (Legal Proceedings)", span_fact("Item 3", r["item3"]) if r["item3"] else "Not found as a heading in the rendered document"],
            ["Notes extracted", "; ".join(span_fact(f"Note {n['number']}", n) + f" — {n['found_by']}" for n in r["notes"]) or "None found"],
            ["MDL numbers written (a mention, never membership)", "; ".join(f"{m['as_written']} ({m['section']})" for m in mention_rows if m["form"] != "MDL caption (exact text, case-insensitive)") or "None"],
            ["Held MDL captions repeated word for word", "; ".join(f"MDL No. {m['mdl_number']} ({m['section']})" for m in mention_rows if m["form"] == "MDL caption (exact text, case-insensitive)") or "None"],
            ["Item 3 text (first 2,000 characters, verbatim)", (r["item3"]["text"][:2000] if r["item3"] else "Not recorded")],
            ["Rendering", r["rendering"]],
            ["Document sha256 (raw / rendered text)", f"{r['raw_sha256']} / {r['text_sha256']}"],
            ["Source", f"SEC EDGAR, {r['document_url']} (retrieved {r['retrieved_at']})"],
        ]
        rid = f"10k:{r['cik']}:{r['accession']}"
        rows.append(cw.record(
            DATASET, rid, f"{r['company']}: Form {r['form']} legal proceedings ({r.get('period') or r['filed']})",
            source_url=r["document_url"], subtitle=f"Filed {r['filed']} · accession {r['accession']}",
            cells={"company": r["company"], "form": r["form"], "period": r.get("period") or "Not recorded", "filed": r["filed"],
                   "item3_chars": f"{r['item3']['chars']:,}" if r["item3"] else "Not found",
                   "notes": ", ".join(str(n["number"]) for n in r["notes"]) or "None found",
                   "mdl_mentions": str(len(held)) if held else "None"},
            facts=facts, text=" ".join(filter(None, [r["company"], r["accession"], (r["item3"] or {}).get("text", "")[:4000]])),
            filters={"cik": [r["cik"]], "year": [year], "form": [r["form"]], "item3": ["yes" if r["item3"] else "no"],
                     "notes": ["yes" if r["notes"] else "no"], "mdl": sorted(held, key=int), "has_mdl_mention": ["yes" if held else "no"]},
            links=links,
            extra={"filing": {k: r[k] for k in ("cik", "company", "tickers", "form", "filed", "period", "accession", "document", "document_url", "index_url", "raw_sha256", "raw_bytes", "text_sha256", "text_chars", "rendering", "retrieved_at")},
                   "item3": r["item3"], "notes": r["notes"], "note_rule": r["note_rule"], "mentions": mention_rows},
        ))
    rows.sort(key=lambda x: (x["item"]["filing"]["filed"], x["id"]), reverse=True)
    counts = {}
    for row in rows:
        for name in ("year", "has_mdl_mention", "item3", "notes"):
            for v in row["filters"][name]:
                counts.setdefault(name, {})[v] = counts.setdefault(name, {}).get(v, 0) + 1
    years = sorted(counts.get("year", {}), reverse=True)
    listing = cw.listing([("company", "Company"), ("form", "Form"), ("period", "Period"), ("filed", "Filed"), ("item3_chars", "Item 3 length"), ("notes", "Notes"), ("mdl_mentions", "MDLs mentioned")],
                         [("year", "Period year", {y: y for y in years}), ("has_mdl_mention", "Mentions a held MDL", {"yes": "Yes", "no": "No"}),
                          ("item3", "Item 3 found", {"yes": "Yes", "no": "No"}), ("notes", "Contingency or litigation note found", {"yes": "Yes", "no": "No"})])
    header = {
        "dataset": DATASET,
        "label": "10-K legal proceedings of SEC registrants in this atlas (Item 3 and litigation notes, exact text)",
        "listing_block": listing,
        "summary": {
            "source": "SEC EDGAR: data.sec.gov submissions and the Form 10-K primary documents on www.sec.gov/Archives",
            "licence": "EDGAR filings are public records filed with the SEC; text is shown exactly as filed",
            "scope": f"The newest Form 10-K filings (10-K, 10-K405, 10-KT; amendments excluded) of the {len(json.loads(COMPANIES.read_text())['rows'])} companies in company_sec_profiles",
            "extraction": "Item 3 from its line-start heading to the next Item 4 / Item 3A / Part II heading (longest candidate); the notes Item 3 names by number, else notes whose heading names contingencies, litigation or legal proceedings, each from its heading to the next note's; offsets are character positions in the rendering named in each record",
            "mentions": "MDL numbers as written (MDL No. 2738, MDL 2846, 3:16-md-02738) and held MDL captions repeated word for word (case-insensitive): a mention in a filing, never MDL membership",
            "records": len(rows),
            "stats": stats,
            "built_at": now(),
        },
        "built_at": now(),
        "inputs": inputs,
    }
    out.mkdir(parents=True, exist_ok=True)
    with gzip.open(out / f"{DATASET}.rows.jsonl.gz", "wt", encoding="utf-8") as h:
        for row in rows:
            h.write(json.dumps(row) + "\n")
    header["output"] = {"path": str((out / f"{DATASET}.rows.jsonl.gz")), "rows": len(rows), "sha256": hashlib.sha256((out / f"{DATASET}.rows.jsonl.gz").read_bytes()).hexdigest()}
    (out / f"{DATASET}.header.json").write_text(json.dumps(header, indent=1))
    print(json.dumps({"dataset": DATASET, "rows": len(rows), **stats}))


def verify(args):
    """Re-fetch a fixed sample of acquired filings and check, exactly: the raw document's sha256, the rendering's sha256,
    and for every stored span that its text is the rendering's slice [start:end] (sha256 of the full slice, and the
    stored text equal to the slice's first TEXT_CAP characters)."""
    out = Path(args.out)
    files = sorted((out / "filings").glob("*.json"))
    step = max(1, len(files) // max(1, args.sample))
    chosen = files[::step][: args.sample]
    client = Client(args.rps, out / "requests.jsonl")
    results = []
    for path in chosen:
        rec = json.loads(path.read_text())
        status, raw = client.get(rec["document_url"])
        entry = {"filing": path.name, "url": rec["document_url"], "status": status, "checks": {}}
        if status == 200:
            text = E.render(raw)
            c = entry["checks"]
            c["raw_sha256"] = hashlib.sha256(raw).hexdigest() == rec["raw_sha256"]
            c["text_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest() == rec["text_sha256"]
            spans = ([rec["item3"]] if rec["item3"] else []) + rec["notes"]
            c["spans"] = len(spans)
            c["span_sha256"] = all(hashlib.sha256(text[s["start"]:s["end"]].encode("utf-8")).hexdigest() == s["sha256"] for s in spans)
            c["span_text"] = all(text[s["start"]:s["end"]][:TEXT_CAP] == s["text"] for s in spans)
            c["headings_at_start"] = all(text[s["start"]:s["end"]].lstrip().startswith(s["heading"].split()[0]) for s in spans)
        entry["ok"] = status == 200 and all(v for k, v in entry["checks"].items() if k != "spans")
        results.append(entry)
        print(json.dumps({"filing": path.name, "ok": entry["ok"], **entry["checks"]}), file=sys.stderr)
    report = {"verified_at": now(), "sample": len(chosen), "of": len(files), "ok": sum(r["ok"] for r in results), "results": results}
    (out / "verify.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("sample", "of", "ok")}))
    return 0 if report["ok"] == len(chosen) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["acquire", "build", "verify"])
    ap.add_argument("--sample", type=int, default=4)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--ciks")
    ap.add_argument("--rps", type=float, default=4.0)
    a = ap.parse_args()
    if a.stage == "verify":
        sys.exit(verify(a))
    acquire(a) if a.stage == "acquire" else build(a)


if __name__ == "__main__":
    main()
