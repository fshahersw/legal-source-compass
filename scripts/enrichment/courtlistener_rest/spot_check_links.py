"""Spot check of outbound links in the courtlistener_rest datasets: HEAD requests (2 per second at most) to a fixed sample of
CourtListener report PDFs and opinion pages, recording the HTTP status. Writes private/build/courtlistener_rest/spot_checks_links.json.
"""
import json
import os
import ssl
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rest_common as rc  # noqa: E402

UA = "legal-source-compass research (contact: notreelai@gmail.com)"
CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")


def head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # noqa: BLE001
        return f"error: {type(e).__name__}"


def main():
    fd = rc.read_build("clb_judge_disclosures")["rows"]
    pdfs = [x["pdf"] for r in fd[::400] for x in r["item"]["profile"]["report_list"][:1] if x["pdf"]][:8]
    pr = rc.read_build("clb_top_cited_parentheticals")["rows"]
    ops = [e["describing_url"] for r in pr[::250] for e in r["item"]["profile"]["examples"][:1] if e["describing_url"]][:4]
    out = []
    for url in pdfs + ops:
        out.append({"url": url, "status": head(url)})
        time.sleep(0.6)
    bad = [o for o in out if o["status"] != 200]
    json.dump({"checked": len(out), "not_200": len(bad), "results": out}, open(os.path.join(rc.OUT, "spot_checks_links.json"), "w"), indent=1)
    print(len(out), "links checked;", len(bad), "not 200")
    for o in bad:
        print(o)


if __name__ == "__main__":
    main()
