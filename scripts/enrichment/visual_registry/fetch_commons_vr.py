"""Read each lead's Wikimedia Commons file page metadata (the same passes as court_images/fetch_commons.py).

  python3 -I -B fetch_commons_vr.py [titles.json]

Reuses court_images/fetch_commons.py: its passes (display iiurlwidth=960 with extmetadata, thumb 330, mid 500), its
batch size (50 titles per request), its spacing and its request function. Adds maxlag=5 to every request (a maxlag
reply is waited out and repeated) and one more pass, `cats`, with each file's categories including hidden ones (the
public-domain basis, e.g. "PD US Government", is recorded as a hidden licence category). Every response is stored
unchanged (gzip) under private/acq/visual_registry/cache/commons/ with the fetch_commons manifest format, so the
court_images builder's readers (commons_inputs, load_responses) read them as they are; a continued categories query
stores each continuation response as its own part. Sequential, one request every SPACING seconds.
"""
import gzip
import hashlib
import json
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "court_images"))
import fetch_commons as fc  # noqa: E402
from vr_common import BUILD, CACHE, UA, now_utc, sha256_bytes  # noqa: E402

fc.UA = UA
PASSES = {**fc.PASSES, "cats": {"prop": "categories", "clprop": "hidden", "cllimit": "max"}}


def batch_key(name, titles):
    return f"{name}_{hashlib.sha1('|'.join(titles).encode()).hexdigest()[:12]}"


def request(params):
    url = fc.API + "?" + urllib.parse.urlencode(params)
    status, body = None, b""
    for attempt in range(6):
        status, body = fc.fetch(url)
        if status == 200:
            try:
                data = json.loads(body)
            except ValueError:
                return url, status, body
            if (data.get("error") or {}).get("code") == "maxlag":
                time.sleep(5 * (attempt + 1))
                continue
        return url, status, body
    return url, status, body


def main(titles_path=None):
    titles = json.load(open(titles_path)) if titles_path else json.load(open(BUILD / "leads.json"))["fetch"][
        "commons_titles"]
    out = CACHE / "commons"
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "_manifest.jsonl"
    complete = set()
    if manifest_path.exists():
        for line in open(manifest_path):
            entry = json.loads(line)
            if entry["status"] == 200 and entry.get("last", True):
                complete.add(entry["batch"])
    last = 0.0
    with open(manifest_path, "a") as manifest:
        for name, extra in PASSES.items():
            for start in range(0, len(titles), fc.BATCH):
                batch = titles[start:start + fc.BATCH]
                key = batch_key(name, batch)
                if key in complete:
                    continue
                params = {"action": "query", "format": "json", "formatversion": "2", "redirects": "1",
                          "maxlag": "5", "titles": "|".join(batch)}
                if name != "cats":
                    params["prop"] = "imageinfo"
                params.update(extra)
                cont, part = {}, 0
                while True:
                    wait = fc.SPACING - (time.monotonic() - last)
                    if wait > 0:
                        time.sleep(wait)
                    url, status, body = request({**params, **cont})
                    last = time.monotonic()
                    body = body or b""
                    cont = {}
                    if status == 200 and name == "cats":
                        try:
                            cont = json.loads(body).get("continue") or {}
                        except ValueError:
                            cont = {}
                    path = out / f"{key}_p{part}.json.gz"
                    with gzip.open(path, "wb") as f:
                        f.write(body)
                    manifest.write(json.dumps({
                        "url": url, "path": str(path), "sha256": sha256_bytes(body), "bytes": len(body),
                        "retrieved_at": now_utc(), "status": status, "method": "GET", "pass": name,
                        "titles": len(batch), "batch": key, "part": part, "last": not cont,
                    }) + "\n")
                    manifest.flush()
                    print(name, start, part, status, len(body), flush=True)
                    if status != 200 or not cont:
                        break
                    part += 1


if __name__ == "__main__":
    main(*sys.argv[1:2])
