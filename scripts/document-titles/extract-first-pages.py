#!/usr/bin/env python3
"""Read-only: download saved court_documents files from the private corpus-originals bucket, verify the SHA-256 against
corpus_artifacts, and write the document's own first-page layout lines and PDF metadata to a local JSONL file.

Credentials come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY in the environment.
No bytes are kept; no row is written to the corpus.

  python3 extract-first-pages.py --artifacts artifacts.json --ids ids.txt --out first-pages.jsonl [--workers 6]
"""
import argparse, hashlib, json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import fitz  # PyMuPDF

URL = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
KEY = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
MAX_LINES = 120


def download(object_key):
    last = None
    for attempt in range(8):
        try:
            req = urllib.request.Request(
                f"{URL}/storage/v1/object/corpus-originals/{object_key}",
                headers={"apikey": KEY, "Authorization": "Bearer " + KEY},
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            last = e
        except Exception as e:  # transient DNS/TLS/read errors
            last = e
        time.sleep(min(2 ** attempt, 30))
    raise last


def first_page_lines(doc):
    page = doc[0]
    lines = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if s["text"].strip()]
            if not spans:
                continue
            text = "".join(s["text"] for s in spans).strip()
            size = max(s["size"] for s in spans)
            bold = any((s["flags"] & 16) or "bold" in s["font"].lower() for s in spans)
            lines.append({"t": text, "s": round(size, 1), "b": bool(bold), "y": round(line["bbox"][1], 1), "x": round(line["bbox"][0], 1), "x1": round(line["bbox"][2], 1)})
    lines.sort(key=lambda l: (l["y"], l["x"]))
    return lines[:MAX_LINES], round(page.rect.width, 1), round(page.rect.height, 1)


def process(art):
    out = {"id": art["id"], "sha256": art["sha256"], "object_key": art["object_key"]}
    data = download(art["object_key"])
    if data is None:
        out["status"] = "object_missing"
        return out
    digest = hashlib.sha256(data).hexdigest()
    out["bytes"] = len(data)
    out["sha256_verified"] = digest == art["sha256"]
    if digest != art["sha256"]:
        out["status"] = "sha256_mismatch"
        return out
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        out["status"] = "unreadable"
        out["error"] = str(e)[:120]
        return out
    try:
        if doc.needs_pass:
            out["status"] = "encrypted"
            return out
        meta = doc.metadata or {}
        out["pages"] = doc.page_count
        out["info_title"] = meta.get("title") or ""
        out["producer"] = meta.get("producer") or ""
        out["creator"] = meta.get("creator") or ""
        if doc.page_count == 0:
            out["status"] = "no_pages"
            return out
        lines, w, h = first_page_lines(doc)
        out["page_w"], out["page_h"] = w, h
        out["lines"] = lines
        out["status"] = "ok" if lines else "no_text_layer"
    except Exception as e:
        out["status"] = "extract_error"
        out["error"] = str(e)[:120]
    finally:
        doc.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    arts = {x["route"].rsplit("/", 1)[-1]: x for x in json.load(open(a.artifacts))}
    ids = [l.strip() for l in open(a.ids) if l.strip()]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            try:
                done.add(json.loads(l)["id"])
            except Exception:
                pass
    todo = [{"id": i, "sha256": arts[i]["sha256"], "object_key": arts[i]["object_key"]} for i in ids if i in arts and i not in done]
    print(f"{len(ids)} ids, {len(done)} done, {len(todo)} to do", flush=True)
    n = 0
    with open(a.out, "a") as f, ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(process, t) for t in todo]
        for fu in as_completed(futs):
            try:
                f.write(json.dumps(fu.result(), ensure_ascii=False) + "\n")
            except Exception as e:
                print("error", str(e)[:100], flush=True)
            n += 1
            if n % 250 == 0:
                f.flush()
                print(n, flush=True)


if __name__ == "__main__":
    main()
