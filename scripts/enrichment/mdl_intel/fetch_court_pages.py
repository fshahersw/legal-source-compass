"""Fetch every official court MDL page listed in court_pages.json (discovered with Firecrawl search), follow the hub's
same-host sub-pages for orders / schedules / counsel, and extract quoted statements and order lists.

A sub-page is kept only when its own text names the MDL number (deterministic MDL-specificity rule).
Raw HTML is cached unchanged under private/acq/mdl-intel/court_pages/.
"""
import concurrent.futures as cf
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_court_pages import extract, shares_slug, sub_page_links  # noqa: E402
from fetchutil import ACQ, fetch  # noqa: E402

HERE = Path(__file__).parent


def retrieved_on(path, refresh, today):
    """Retrieval date of the bytes being extracted. A live fetch (refresh) is today's. A cached copy (--cached) carries
    the UTC date its file was written: fetchutil writes the cache file when the response arrives and never rewrites it
    on a cached read, so re-extracting from the cache on a later day does not restamp an old fetch as new."""
    if refresh or path is None or not Path(path).exists():
        return today
    return datetime.fromtimestamp(Path(path).stat().st_mtime, tz=timezone.utc).date().isoformat()


def main(refresh=True, out_path=None, only=None):
    """Fetch and extract every listed court page; write the extraction to out_path (default: the builder's input,
    private/acq/mdl-intel/court_pages_extracted.json). `only` limits the run to those MDL numbers."""
    pages = json.loads((HERE / "court_pages.json").read_text())
    today = date.today().isoformat()

    def get(mdl, url, role):
        body, path, status = fetch(url, "court_pages", refresh=refresh, timeout=45)
        if status != 200 or len(body) < 500:
            return {"url": url, "status": status, "retrieved": today, "error": "fetch_failed", "role": role}, body
        data = extract(body, url, retrieved_on(path, refresh, today), mdl)
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
    jobs = [(int(k), urls) for k, urls in pages.items() if not k.startswith("_") and (not only or int(k) in only)]
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        for mdl, items in pool.map(lambda j: run(*j), jobs):
            out[str(mdl)] = items
    target = Path(out_path) if out_path else ACQ / "court_pages_extracted.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, indent=1))
    for mdl, items in sorted(out.items(), key=lambda kv: int(kv[0])):
        for d in items:
            print(mdl, d.get("role"), d.get("status"), d.get("error", ""), len(d.get("orders", [])), "orders", len(d.get("quotes", [])), "quotes", d.get("text_chars"), d["url"][:95])


def _arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


if __name__ == "__main__":
    # python3 fetch_court_pages.py [--cached] [--out private/build/mdl_intel/court_pages_extracted.json] [--only 3026,3140]
    only = {int(x) for x in (_arg("--only") or "").split(",") if x.strip().isdigit()}
    main(refresh="--cached" not in sys.argv, out_path=_arg("--out"), only=only or None)
