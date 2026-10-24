"""Read Wikidata entity JSON for every company lead (identity: P5531 CIK, P154 logo statement): https://www.wikidata.org/wiki/Special:EntityData/<Q>.json

  python3 -I -B fetch_wikidata.py

Allowed by wikidata.org robots.txt (Allow: /wiki/Special:EntityData/*.). Sequential, one request per second.
Responses are stored unchanged (gzip) under cache/wikidata/ with a manifest. A redirected entity (merged item) is
stored as returned; the reader takes the entity under the id the response names.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD, Pacer, Store, http_get  # noqa: E402

SPACING = 1.0


def main(ids_path=None):
    ids = json.load(open(ids_path)) if ids_path else [
        lead["wikidata"] for lead in json.load(open(BUILD / "leads.json"))["company"]["leads"] if lead["wikidata"]]
    store = Store("wikidata")
    pacer = Pacer(SPACING)
    for qid in ids:
        if not re.fullmatch(r"Q\d{1,12}", qid) or store.done(qid):
            continue
        url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
        pacer.wait()
        status, ctype, body, _ = http_get(url, accept="application/json")
        store.put(qid, url, status, body, f"{qid}.json.gz", content_type=ctype)
        print(qid, status, len(body), flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:2])
