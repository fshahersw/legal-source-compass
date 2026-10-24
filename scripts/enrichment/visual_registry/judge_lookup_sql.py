"""Print the read-only SELECTs that produce the judge lookups (run them with the read-only SQL tool, save the
`rows` text to lookups/<name>.txt and check it with save_lookups.py <name> <md5>).

  python3 -I -B judge_lookup_sql.py fjc        # judge_profiles_fjc rows for the node ids read from the FJC pages
  python3 -I -B judge_lookup_sql.py photos     # judges rows (photo_url present or not) for those judge profiles
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import origin as og  # noqa: E402
from vr_common import BUILD, Store  # noqa: E402


def nids():
    store = Store("fjc")
    out = set()
    for key in store.entries:
        if key == "robots":
            continue
        body = store.read(key)
        nid = og.fjc_nid(body) if body else None
        if nid:
            out.add(nid)
    return sorted(out)


def main(kind):
    if kind == "fjc":
        values = ",".join(f"'{n}'" for n in nids())
        expr = ("(filters->'fjc_nid'->>0) || '=' || title || '=' || coalesce((select string_agg(x, ',' order by x) "
                "from jsonb_array_elements_text(filters->'judge_profile') x), '')")
        print(f"select count(*) n, md5(string_agg({expr}, '|' order by (filters->'fjc_nid'->>0) collate \"C\")) md5, "
              f"string_agg({expr}, '|' order by (filters->'fjc_nid'->>0) collate \"C\") as rows "
              f"from public.corpus_records where dataset='judge_profiles_fjc' and filters->'fjc_nid'->>0 in ({values})")
    elif kind == "photos":
        data = json.load(open(BUILD / "lookups" / "judge_fjc.json"))["data"]
        ids = sorted({p for v in data.values() for p in v["judge_profile"] if re.fullmatch(r"[0-9a-f]{32}", p)})
        values = ",".join(f"'{i}'" for i in ids)
        expr = "id || '=' || (case when coalesce(item->>'photo_url','') <> '' then '1' else '0' end)"
        print(f"select count(*) n, md5(string_agg({expr}, '|' order by id collate \"C\")) md5, "
              f"string_agg({expr}, '|' order by id collate \"C\") as rows from public.corpus_records "
              f"where dataset='judges' and id in ({values})")
    else:
        raise SystemExit("usage: judge_lookup_sql.py fjc | photos")


if __name__ == "__main__":
    main(sys.argv[1])
