#!/usr/bin/env python3
"""Build the document-title projection plan and the document map from local snapshots. No network, no credentials.

Inputs (from fetch-inputs.py and extract-first-pages.py):
  --inputs DIR        court_documents.jsonl, court_documents_artifacts.json, saved_pages_untitled.jsonl, uscourts_pages_untitled.jsonl
  --first-pages FILE  first-pages.jsonl
  --pdf-registry FILE optional JSON list of registered matter-PDF SHA-256 values (corpus_admin_pdf_dedup_index_v1 'objects')
Outputs (to --out-dir): plan.jsonl, document-map.csv, stats.json, samples.json
"""
import argparse, csv, hashlib, json, os, re, sys
from collections import Counter, defaultdict
from urllib.parse import unquote, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive_titles as D

PLACEHOLDER_COURT = " (title not yet extracted)"


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_name_from_url(url):
    path = urlsplit(url or "").path
    base = unquote(path.rsplit("/", 1)[-1]).strip()
    return base or None


def fact(row, prefix):
    for k, v in row["detail"].get("facts", []):
        if k.startswith(prefix):
            return v
    return None


def page_text(row):
    return "\n".join(s.get("text", "") for s in row["detail"].get("sections", []) if "text" in s)


def url_label(url):
    p = urlsplit(url or "")
    label = (p.netloc + unquote(p.path)).strip("/")
    return label[:150] or None


def load_jsonl(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--first-pages", required=True)
    ap.add_argument("--pdf-registry")
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    docs = load_jsonl(os.path.join(a.inputs, "court_documents.jsonl"))
    arts = {x["route"].rsplit("/", 1)[-1]: x for x in json.load(open(os.path.join(a.inputs, "court_documents_artifacts.json")))}
    fps = {x["id"]: x for x in load_jsonl(a.first_pages)}
    registry = set(json.load(open(a.pdf_registry))) if a.pdf_registry else set()

    plan, dmap = [], []
    stats = {"court_documents": defaultdict(Counter), "inventory": Counter()}
    samples = defaultdict(list)

    placeholders = [r for r in docs if (r["title"] or "").endswith(PLACEHOLDER_COURT)]
    inv = stats["inventory"]
    inv["court_documents_rows_total"] = len(docs)
    inv["placeholder_rows"] = len(placeholders)
    for r in placeholders:
        art = arts.get(r["id"])
        fp = fps.get(r["id"])
        fname = file_name_from_url(r["source_url"]) or (r["title"][: -len(PLACEHOLDER_COURT)].strip() or None)
        manifest_sha = fact(r, "SHA-256")
        sha = art["sha256"] if art else manifest_sha
        label = r["item"]["cells"].get("doc_type")
        link_status = (r.get("filters") or {}).get("link_status", [None])
        link_status = link_status[0] if link_status else None
        inv["with_artifact_row"] += 1 if art else 0
        inv["artifact_sha_equals_manifest_sha"] += 1 if art and art["sha256"] == manifest_sha else 0
        inv["sha256_in_registered_matter_pdfs"] += 1 if sha in registry else 0
        inv["docket_entry_links"] += 0
        status = fp["status"] if fp else ("no_saved_file" if not art else "not_extracted")
        inv["file_status:" + status] += 1
        title = method = reason = None
        text_hash = None
        if fp and fp["status"] == "ok":
            title, method, reason = D.title_from_first_page(fp["lines"], fp.get("page_h"))
            text_hash = sha256("\n".join(l["t"] for l in fp["lines"]))
        else:
            reason = {"object_missing": "object_missing", "no_text_layer": "no_text_layer", "unreadable": "unreadable", "encrypted": "encrypted",
                      "sha256_mismatch": "sha256_mismatch", "no_pages": "unreadable", "extract_error": "unreadable", "no_saved_file": "no_saved_file",
                      "not_extracted": "not_extracted"}.get(status, status)
            if art and art["mime"] != "application/pdf" and status in ("unreadable", "object_missing"):
                reason = "not_a_pdf" if status == "unreadable" else reason
        if title and fp and D.policy_withheld(fp["lines"], title):
            title, method, reason = None, None, "policy_withheld"
        if title:
            new_title, m, why = title, method, None
        else:
            new_title = f"{fname} (title not recorded)" if fname else "Not recorded"
            m, why = "not_recorded", reason
        row = {
            "dataset": "court_documents", "id": r["id"], "old_title": r["title"], "new_title": new_title, "method": m, "reason": why,
            "source_id": f"corpus-originals:{sha}" if sha else f"court_documents:{r['id']}", "source_text_sha256": text_hash if title else None,
            "file_name": fname,
        }
        plan.append(row)
        stats["court_documents"][m][why or "-"] += 1
        samples[m].append({"id": r["id"], "title": new_title, "file": fname})
        dmap.append({"dataset": "court_documents", "id": r["id"], "file_name": fname or "Not recorded", "saved_copy": (art["filename"] if art else "Not recorded"),
                     "sha256": sha or "Not recorded", "bytes": art["bytes"] if art else "Not recorded", "title": new_title if title else "Not recorded",
                     "title_method": m, "title_reason": why or "", "date": "Not recorded", "label": label or "Not recorded",
                     "status": f"{status}; court match: {link_status or 'Not recorded'}"})

    for ds in ("saved_pages", "uscourts_pages"):
        rows = load_jsonl(os.path.join(a.inputs, f"{ds}_untitled.jsonl"))
        stats[ds] = defaultdict(Counter)
        for r in rows:
            if not D.is_placeholder_title(r["title"]):
                continue
            text = page_text(r)
            title, method, reason = D.title_from_markdown(text)
            if title and D.POLICY_WITHHELD_RE.search(title + " " + text[:3000]):
                title, method, reason = None, None, "policy_withheld"
            if title:
                new_title, m, why, th = title, method, None, sha256(text)
            else:
                lab = url_label(r["source_url"]) or (r["item"].get("cells") or {}).get("site")
                new_title = f"{lab} (title not recorded)" if lab else "Not recorded"
                m, why, th = "not_recorded", reason, None
            plan.append({"dataset": ds, "id": r["id"], "old_title": r["title"], "new_title": new_title, "method": m, "reason": why,
                         "source_id": f"{ds}:{r['id']}", "source_text_sha256": th, "file_name": None})
            stats[ds][m][why or "-"] += 1
            samples[ds + ":" + m].append({"id": r["id"], "title": new_title, "url": r["source_url"]})
            dmap.append({"dataset": ds, "id": r["id"], "file_name": file_name_from_url(r["source_url"]) or "Not recorded", "saved_copy": "Not recorded", "sha256": "Not recorded",
                         "bytes": "Not recorded", "title": title or "Not recorded", "title_method": m, "title_reason": why or "",
                         "date": (r["item"].get("cells") or {}).get("saved") or "Not recorded", "label": (r["item"].get("badges") or ["Not recorded"])[0] if r["item"].get("badges") else "Not recorded",
                         "status": "captured text only"})

    with open(os.path.join(a.out_dir, "plan.jsonl"), "w") as f:
        for p in plan:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out_dir, "document-map.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(dmap[0].keys()))
        w.writeheader()
        w.writerows(dmap)
    json.dump({k: ({m: dict(c) for m, c in v.items()} if isinstance(v, dict) and k != "inventory" else dict(v)) for k, v in stats.items()},
              open(os.path.join(a.out_dir, "stats.json"), "w"), indent=1, ensure_ascii=False)
    import random
    random.seed(20261006)
    json.dump({k: random.sample(v, min(40, len(v))) for k, v in samples.items()}, open(os.path.join(a.out_dir, "samples.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: ({m: sum(c.values()) for m, c in v.items()} if k != "inventory" else dict(v)) for k, v in stats.items()}, indent=1))


if __name__ == "__main__":
    main()
