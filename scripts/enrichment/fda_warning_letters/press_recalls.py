"""Pure parsing of FDA's recall-announcement table and the source_url packet for agency_safety_fda_press_recalls.

The corpus dataset agency_safety_fda_press_recalls came from the same table's XLSX export, which carries no links,
so its 1,041 rows have an empty source_url and hash ids. This module reads the table's rows (each links its FDA.gov
announcement page) and matches a corpus row to a table row only when date, company name, brand names and product
description are equal (whitespace collapsed) and that key is unique in the dataset and among the table rows read; the
packet rule says whether that read was FDA's complete table (read_scope). No similarity matching.
"""
import json
import re

import wl_parse as wp

PRESS_INDEX = "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts"
VIEW_NAME = "recall_solr_index"
PAGE_PREFIX = "/safety/recalls-market-withdrawals-safety-alerts/"
HEADERS = ["Date", "Brand Name(s)", "Product Description", "Product Type", "Recall Reason Description",
           "Company Name", "Terminated Recall", "Excerpt"]
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.~-]{0,250}$")
DATASET = "agency_safety_fda_press_recalls"


def table_settings(page_html):
    m = re.search(r'<script\b[^>]*data-drupal-selector="drupal-settings-json"[^>]*>(.*?)</script>', page_html, re.S)
    if not m:
        raise ValueError("FDA page has no Drupal settings")
    for table in (json.loads(m.group(1)).get("datatables") or {}).values():
        ajax = table.get("ajax") or {}
        if (ajax.get("data") or {}).get("view_name") == VIEW_NAME:
            headers = [(h.get("content") or "").strip() for h in table.get("aoColumnHeaders") or []]
            if headers != HEADERS or ajax.get("url") != "/datatables/views/ajax" or not table.get("serverSide"):
                raise ValueError(f"FDA recall table schema changed: {headers}")
            return ajax, int(ajax["data"].get("total_items") or table.get("deferLoading"))
    raise ValueError("FDA recall table not found on the page")


def parse_row(cells):
    if not isinstance(cells, list) or len(cells) != 8:
        raise ValueError("unexpected row shape")
    texts, anchors = zip(*(wp.cell(c) for c in cells))
    links = [href for column in anchors for href, _ in column if href and href.split("?")[0].startswith(PAGE_PREFIX)]
    paths = sorted({href.split("?")[0].split("#")[0] for href in links})
    if len(paths) != 1:
        raise ValueError(f"row has no single announcement link: {cells[1][:120]}")
    slug = paths[0][len(PAGE_PREFIX):]
    if not SLUG.match(slug):
        raise ValueError(f"unexpected announcement path: {paths[0]}")
    return {
        "path": paths[0],
        "url": wp.FDA + paths[0],
        "date": wp.us_date(texts[0]),
        "date_raw": texts[0] or None,
        "brand_names": texts[1] or None,
        "product_description": texts[2] or None,
        "product_types": texts[3] or None,
        "recall_reason_description": texts[4] or None,
        "company_name": texts[5] or None,
        "terminated_recall": texts[6] or None,
    }


def parse_rows(doc):
    data = doc.get("data")
    if not isinstance(data, list):
        raise ValueError("unexpected FDA page shape")
    return [parse_row(cells) for cells in data]


def collapse(text):
    return re.sub(r"\s+", " ", (text or "").strip())


def key(date, company, brands, description):
    return (date or "", collapse(company), collapse(brands), collapse(description))


def unique_table_rows(rows):
    """Table rows (unioned on page path) whose key occurs once in FDA's table; a repeated key is dropped, never chosen."""
    by_path = {}
    for row in rows:
        by_path.setdefault(row["path"], row)
    counts, keyed = {}, {}
    for row in by_path.values():
        k = key(row["date"], row["company_name"], row["brand_names"], row["product_description"])
        if not k[0] or not k[1]:
            continue
        counts[k] = counts.get(k, 0) + 1
        keyed[k] = row
    return [keyed[k] for k in sorted(keyed) if counts[k] == 1]


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


RULE_HEAD = ("The FDA.gov announcement page whose recall-table row has the same date, company name, brand names and "
             "product description (whitespace collapsed), with that key unique in this dataset and ")
# Wording used when no acquisition manifest is given (tests): the narrow claim, never the complete-table one.
RULE = RULE_HEAD + "among the FDA table rows read; otherwise empty."


def read_scope(manifest, rows_read):
    """What the table read covered, from the acquisition manifest and the rows actually parsed from its listed pages.

    complete is true only when the fetcher reached a consistent snapshot (one total on every page of both passes) and
    the distinct pages parsed here equal that total."""
    totals = sorted({t for t in (manifest.get("totals_reported") or []) if isinstance(t, int)})
    distinct = len({r["path"] for r in rows_read})
    complete = bool(manifest.get("consistent_snapshot")) and len(totals) == 1 and distinct == totals[0]
    files = [f for f in manifest.get("files") or [] if str(f.get("file", "")).startswith("page_")]
    read_on = min((f["retrieved_at"] for f in files if f.get("retrieved_at")), default="")[:10] or None
    return {"complete": complete, "rows_read": distinct, "totals_reported": totals, "read_on": read_on}


def rule_for(scope):
    """The matching rule, worded so it claims only what the read covered."""
    when = f" on {scope['read_on']}" if scope.get("read_on") else ""
    if scope["complete"]:
        return RULE_HEAD + f"in FDA's table (all {scope['rows_read']:,} rows it listed, read{when}); otherwise empty."
    reported = " and ".join(f"{t:,}" for t in scope["totals_reported"]) or "no total"
    return (RULE_HEAD + f"among the {scope['rows_read']:,} FDA table rows read{when} (FDA's table reported {reported} "
            "rows during the read, so rows it did not return were not checked); otherwise empty.")


def update_sql(table_rows, rule=RULE):
    """Idempotent packet: the corpus row whose key is unique in the dataset and equals a unique table key gets that page."""
    values = []
    for row in table_rows:
        if not row["url"].startswith(wp.FDA + PAGE_PREFIX) or "'" in row["url"]:
            raise ValueError(f"refusing URL {row['url']}")
        k = key(row["date"], row["company_name"], row["brand_names"], row["product_description"])
        values.append("(" + ", ".join(sql_literal(x) for x in (*k, row["url"])) + ")")
    if not values:
        return "-- no table rows\n"
    collapse_sql = "regexp_replace(btrim(coalesce(x.detail->'fields'->>'{f}', '')), '\\s+', ' ', 'g')"
    return (
        "-- agency_safety_fda_press_recalls source_url packet, generated by\n"
        "-- scripts/enrichment/fda_warning_letters/build_press_recall_urls.py from FDA's recall-announcement table.\n"
        f"-- Rule: {rule}\n"
        "-- Idempotent: only empty source_url values are set. Run by the lead only.\n"
        "update public.corpus_records r\nset source_url = m.url\nfrom (\n"
        "  with t(listed_date, company, brands, description, url) as (values\n    " + ",\n    ".join(values) + "\n  ),\n"
        "  c as (\n    select x.id, coalesce(x.source_url, '') as current_url, x.detail->'fields'->>'listed_date' as listed_date,\n"
        f"      {collapse_sql.format(f='company_name')} as company,\n"
        f"      {collapse_sql.format(f='brand_names')} as brands,\n"
        f"      {collapse_sql.format(f='product_description')} as description\n"
        f"    from public.corpus_records x where x.dataset = {sql_literal(DATASET)}\n  ),\n"
        "  c_unique as (select listed_date, company, brands, description from c\n"
        "    where listed_date is not null and company <> '' group by 1, 2, 3, 4 having count(*) = 1)\n"
        "  select c.id, t.url from c join c_unique using (listed_date, company, brands, description)\n"
        "  join t using (listed_date, company, brands, description) where c.current_url = ''\n) m\n"
        f"where r.dataset = {sql_literal(DATASET)} and r.id = m.id and coalesce(r.source_url, '') = '';\n\n"
        "update public.corpus_datasets d\n"
        f"set metadata = jsonb_set(coalesce(d.metadata, '{{}}'::jsonb), '{{source_url_rule}}', to_jsonb({sql_literal(rule)}::text), true)\n"
        f"where d.id = {sql_literal(DATASET)} and d.metadata->>'source_url_rule' is distinct from {sql_literal(rule)};\n"
    )

