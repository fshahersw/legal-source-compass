"""Discover official transferee-court MDL pages for pending products-liability MDLs.

Step 1: fetch each transferee court's MDL index page(s) (URLs found via Firecrawl search of <court>.uscourts.gov) and
collect links whose anchor text or URL names the MDL number. Step 2: candidates from Firecrawl search results
(private/scratch/mdl-intel/firecrawl_hits.json, written by the lane from search tool output) are merged in.
Only *.uscourts.gov URLs are accepted. Output: private/acq/mdl-intel/court_candidates.json
"""
import concurrent.futures as cf
import json
import re
import sys
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from fetchutil import ACQ, ROOT, fetch  # noqa: E402

DOMAINS = {
    "NYS": "www.nysd.uscourts.gov", "PAE": "www.paed.uscourts.gov", "CAC": "www.cacd.uscourts.gov", "OHN": "www.ohnd.uscourts.gov",
    "NJ": "www.njd.uscourts.gov", "MN": "www.mnd.uscourts.gov", "INS": "www.insd.uscourts.gov", "FLS": "www.flsd.uscourts.gov",
    "CAN": "cand.uscourts.gov", "LAE": "www.laed.uscourts.gov", "NH": "www.nhd.uscourts.gov", "MA": "www.mad.uscourts.gov",
    "GAN": "www.gand.uscourts.gov", "PAM": "www.pamd.uscourts.gov", "OHS": "www.ohsd.uscourts.gov", "SC": "www.scd.uscourts.gov",
    "FLN": "www.flnd.uscourts.gov", "ILS": "www.ilsd.uscourts.gov", "FLM": "www.flmd.uscourts.gov", "PAW": "www.pawd.uscourts.gov",
    "ILN": "www.ilnd.uscourts.gov", "NCW": "www.ncwd.uscourts.gov", "MIE": "www.mied.uscourts.gov", "NYE": "www.nyed.uscourts.gov",
    "WIE": "www.wied.uscourts.gov", "AZ": "www.azd.uscourts.gov", "CAS": "www.casd.uscourts.gov", "ARE": "www.are.uscourts.gov",
}

INDEX_PAGES = {
    "NJ": ["https://www.njd.uscourts.gov/mdl-cases"],
    "ILN": ["https://www.ilnd.uscourts.gov/mdl.aspx"],
    "PAE": ["https://www.paed.uscourts.gov/mdl"],
    "FLS": ["https://www.flsd.uscourts.gov/multi-district-litigation-mdl"],
    "INS": ["https://www.insd.uscourts.gov/mdl-case-information"],
    "CAN": ["https://cand.uscourts.gov/about-court/court-programs-services/multidistrict-litigation-mdl"],
    "NYS": ["https://www.nysd.uscourts.gov/mdl"],
    "CAC": ["https://www.cacd.uscourts.gov/mdl"],
    "MN": ["https://www.mnd.uscourts.gov/multidistrict-litigation-mdl", "https://www.mnd.uscourts.gov/MDL"],
    "OHN": ["https://www.ohnd.uscourts.gov/multidistrict-litigation"],
    "LAE": ["https://www.laed.uscourts.gov/case-information/mdl-mass-class-action"],
    "GAN": ["https://www.gand.uscourts.gov/multidistrict-litigation"],
    "MA": ["https://www.mad.uscourts.gov/caseinfo/mdl.htm"],
    "FLN": ["https://www.flnd.uscourts.gov/multidistrict-litigation"],
    "SC": ["https://www.scd.uscourts.gov/mdl/index.asp"],
    "ILS": ["https://www.ilsd.uscourts.gov/mdl"],
    "OHS": ["https://www.ohsd.uscourts.gov/multidistrict-litigation"],
    "NYE": ["https://www.nyed.uscourts.gov/multidistrict-litigation"],
}


def links_for(html: bytes, base: str):
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = urllib.parse.urljoin(base, a["href"].strip())
        text = " ".join(a.get_text(" ").split())
        out.append((text, href))
    return out


def main():
    pl = json.loads((ROOT / "private/scratch/mdl-intel/pl_list.json").read_text())
    by_district = {}
    for r in pl:
        by_district.setdefault(r.get("district"), []).append(r)
    pages = [(d, u) for d, urls in INDEX_PAGES.items() for u in urls]

    def grab(item):
        d, url = item
        body, path, status = fetch(url, "court_index")
        return d, url, status, body

    found = {}
    index_status = []
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for d, url, status, body in pool.map(grab, pages):
            index_status.append({"district": d, "url": url, "status": status, "bytes": len(body)})
            if status != 200:
                continue
            for text, href in links_for(body, url):
                if "uscourts.gov" not in urllib.parse.urlparse(href).netloc:
                    continue
                for r in by_district.get(d, []):
                    n = str(r["mdl"])
                    if re.search(rf"(?<!\d){n}(?!\d)", text) or re.search(rf"(?<!\d){n}(?!\d)", urllib.parse.unquote(href)):
                        if href.lower().endswith(".pdf"):
                            continue
                        found.setdefault(r["mdl"], []).append({"url": href, "anchor": text[:200], "via": url})
    (ACQ / "court_candidates.json").write_text(json.dumps({"index_pages": index_status, "candidates": found}, indent=1))
    print(json.dumps(index_status, indent=0))
    print("mdls with candidates:", len(found), sorted(found))


if __name__ == "__main__":
    main()
