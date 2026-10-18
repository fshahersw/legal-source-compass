"""Fetch every official court MDL page listed in court_pages.json (discovered with Firecrawl search), follow the hub's
same-host sub-pages for orders / schedules / counsel, and extract quoted statements and order lists.

A sub-page is kept only when its own text names the MDL number (deterministic MDL-specificity rule).
Raw HTML is cached unchanged under private/acq/mdl-intel/court_pages/.
"""
import concurrent.futures as cf
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_court_pages import extract, shares_slug, sub_page_links  # noqa: E402
from fetchutil import ACQ, fetch  # noqa: E402

HERE = Path(__file__).parent


def main(refresh=True):
    pages = json.loads((HERE / "court_pages.json").read_text())
    today = date.today().isoformat()

    def get(mdl, url, role):
        body, path, status = fetch(url, "court_pages", refresh=refresh, timeout=45)
        if status != 200 or len(body) < 500:
            return {"url": url, "status": status, "retrieved": today, "error": "fetch_failed", "role": role}, body
        data = extract(body, url, today, mdl)
        data.update({"status": status, "raw_file": str(path.relative_to(ACQ)), "role": role})
        return data, body

    def run(mdl, urls):
        items, seen = [], set()
        for i, url in enumerate(urls):
            if url in seen:
                continue
            seen.add(url)
            data, body = get(mdl, url, "primary" if i == 0 else "listed")
            items.append(data)
            if data.get("error"):
                continue
            for link in sub_page_links(body, url, mdl):
                if link["url"] in seen or len(seen) > 10:
                    continue
                # crawl only sub-pages whose URL names the MDL number or shares the hub page's distinctive slug
                if not (re.search(rf"(?<!\d)0*{mdl}(?!\d)", link["url"]) or shares_slug(link["url"], url)):
                    continue
                seen.add(link["url"])
                sub, _ = get(mdl, link["url"], "sub_page")
                if not sub.get("error") and (sub.get("mentions_mdl") or shares_slug(link["url"], url)):
                    sub["via_anchor"] = link["anchor"]
                    items.append(sub)
        return mdl, items

    out = {}
    jobs = [(int(k), urls) for k, urls in pages.items() if not k.startswith("_")]
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for mdl, items in pool.map(lambda j: run(*j), jobs):
            out[str(mdl)] = items
    (ACQ / "court_pages_extracted.json").write_text(json.dumps(out, indent=1))
    for mdl, items in sorted(out.items(), key=lambda kv: int(kv[0])):
        for d in items:
            print(mdl, d.get("role"), d.get("status"), d.get("error", ""), len(d.get("orders", [])), "orders", len(d.get("quotes", [])), "quotes", d.get("text_chars"), d["url"][:95])


if __name__ == "__main__":
    main(refresh="--cached" not in sys.argv)
