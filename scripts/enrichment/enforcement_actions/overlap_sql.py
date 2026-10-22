"""Write the read-only SQL that compares settlement_claims_official with the existing settlements / settlement_notices.

  python3 -I -B scripts/enrichment/enforcement_actions/overlap_sql.py > private/scratch/enrich/enforcement_actions/overlap.sql

Keys (exact, after the same normalisation in Python and SQL), compared as 12-hex-digit md5 prefixes to keep the query
small: official URL = lower-case URL without query/fragment, scheme, "www." and trailing slashes; title = lower-case,
characters other than a-z, 0-9, _ and whitespace replaced by spaces, whitespace collapsed. Run read-only through the
Supabase MCP tool; the result is recorded in REPORT.md.
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402


def url_key(url):
    u = (url or "").lower().split("?", 1)[0].split("#", 1)[0]
    u = re.sub(r"^https?://(www\.)?", "", u)
    return re.sub(r"/+$", "", u)


def title_key(title):
    t = re.sub(r"[^a-z0-9_\s]", " ", (title or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def h(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:12]


SQL_URL = r"regexp_replace(regexp_replace(lower(split_part(split_part(source_url, '?', 1), '#', 1)), '^https?://(www\.)?', ''), '/+$', '')"
SQL_TITLE = r"trim(regexp_replace(regexp_replace(lower(title), '[^a-z0-9_\s]', ' ', 'g'), '\s+', ' ', 'g'))"


def main():
    build = json.load(open(os.path.join(ec.BUILD, "settlement_claims_official.json"), encoding="utf-8"))
    idx, urls, titles = [], [], []
    for i, r in enumerate(build["rows"]):
        s = r["item"]["settlement"]
        for u in sorted({s["official_url"], r["source_url"]}):
            idx.append(str(i))
            urls.append(h(url_key(u)))
            titles.append(h(title_key(s["name"])))
    arr = lambda xs: "array[" + ",".join(f"'{x}'" for x in xs) + "]"  # noqa: E731
    print(f"""with m as (select * from unnest(array[{",".join(idx)}], {arr(urls)}, {arr(titles)}) as x(i, u, t)),
th as (select dataset, left(md5({SQL_URL}), 12) as u, left(md5({SQL_TITLE}), 12) as t
       from public.corpus_records where dataset in ('settlements', 'settlement_notices'))
select th.dataset,
       count(distinct m.i) filter (where m.u = th.u) as ours_matched_by_official_url,
       count(distinct m.i) filter (where m.t = th.t) as ours_matched_by_exact_title,
       count(distinct m.i) as ours_matched_either,
       (select count(*) from th t2 where t2.dataset = th.dataset) as their_rows,
       {len(build["rows"])} as our_rows
from th join m on m.u = th.u or m.t = th.t
group by th.dataset;""")


if __name__ == "__main__":
    main()
