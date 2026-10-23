"""Live checks for verify_congress.py: the published datasets against the build files, and the member bill lists against the
published congress_bills records (read-only; it reads EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY from the environment of the
shell that starts it and never loads or prints them itself).
"""
from __future__ import annotations

import json
import os
import random
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = (HERE.parents[2] if (HERE.parents[2] / "private").exists() else Path("/home/user/legal-source-compass")) / "private" / "build" / "congress"


def get(path: str, count: bool = False, rng: tuple[int, int] | None = None):
    base = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if count:
        headers["Prefer"] = "count=exact"
    if rng:
        headers["Range"] = f"{rng[0]}-{rng[1]}"
    with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=180) as resp:
        body = json.loads(resp.read().decode() or "null")
        cr = resp.headers.get("Content-Range")
        return body, (int(cr.split("/")[-1]) if cr and "/" in cr and not cr.endswith("*") else None)


def stored_rows(dataset: str, select: str = "id,item,detail", page: int = 500):
    out, start = [], 0
    while True:
        chunk, _ = get(f"corpus_records?select={select}&dataset=eq.{dataset}&order=ordinal.asc", rng=(start, start + page - 1))
        out.extend(chunk)
        if len(chunk) < page:
            return out
        start += page


def q(v: dict) -> str:
    return urllib.parse.quote(json.dumps(v, separators=(",", ":")))


def run(rep, n: int) -> None:
    rnd = random.Random(20261023)
    for ds, path in (("congress_members", BUILD / "congress_members.json"), ("congress_committees", BUILD / "congress_committees.json")):
        if not path.exists():
            continue
        build = json.loads(path.read_text())
        cat, _ = get(f"corpus_datasets?id=eq.{ds}&select=id,ready,imported_records,metadata")
        okc = bool(cat) and cat[0]["ready"] is True and cat[0]["imported_records"] == len(build["rows"])
        rep.check(f"{ds} catalog", okc, str(cat and {k: cat[0][k] for k in ("ready", "imported_records")}))
        rep.section(f"{ds}: catalog ready with the exact count", 1, int(not okc))
        stored = {r["id"]: r for r in stored_rows(ds)}
        diff = [r["id"] for r in build["rows"] if stored.get(r["id"], {}).get("item") != r["item"] or stored.get(r["id"], {}).get("detail") != r["detail"]]
        rep.check(f"{ds} rows", not diff and len(stored) == len(build["rows"]), f"{len(diff)} differ, {len(stored)} stored")
        rep.section(f"{ds}: every stored row equals the build row", len(build["rows"]), len(diff) + abs(len(stored) - len(build["rows"])))
    mpath = BUILD / "congress_members.json"
    if not mpath.exists():
        return
    rows = json.loads(mpath.read_text())["rows"]
    sample = rnd.sample([r for r in rows if r["detail"]["member"]["bills"]["sponsoredTotal"] or r["detail"]["member"]["bills"]["cosponsoredTotal"]], n)
    bad_sp = bad_by = bad_co = bad_neg = checked_co = checked_neg = 0
    for r in sample:
        bio = r["id"]
        b = r["detail"]["member"]["bills"]
        _, total = get(f"corpus_records?select=id&dataset=eq.congress_bills&filters=cs.{q({'sponsor': [bio]})}", count=True, rng=(0, 0))
        if total != b["sponsoredTotal"]:
            bad_sp += 1
            rep.check(f"{bio} sponsored total", False, f"live {total} vs stored {b['sponsoredTotal']}")
        for c in rnd.sample(sorted(b["sponsoredByCongress"]), min(2, len(b["sponsoredByCongress"]))):
            _, t = get(f"corpus_records?select=id&dataset=eq.congress_bills&filters=cs.{q({'sponsor': [bio], 'congress': [c]})}", count=True, rng=(0, 0))
            if t != b["sponsoredByCongress"][c]:
                bad_by += 1
                rep.check(f"{bio} sponsored {c}", False, f"live {t} vs stored {b['sponsoredByCongress'][c]}")
        by = r["detail"]["cosponsored"]["byCongress"]
        refs = [(c, t, num) for c, types in by.items() for t, nums in types.items() for num in nums]
        picks = rnd.sample(refs, min(6, len(refs)))
        if picks:
            ids = ",".join(f"{c}-{t}-{num}" for c, t, num in picks)
            live, _ = get(f"corpus_records?select=id,cos:detail->bill->cosponsors&dataset=eq.congress_bills&id=in.({ids})")
            got = {x["id"]: x["cos"] for x in live}
            for c, t, num in picks:
                checked_co += 1
                cos = got.get(f"{c}-{t}-{num}")
                present = [x for x in (cos or []) if x.get("bioguide") == bio and not x.get("withdrawn")]
                if not present:
                    bad_co += 1
                    rep.check(f"{bio} cosponsored {c}-{t}-{num}", False, "not a current cosponsor in the published bill")
        # negative: bills of a Congress the member served in that are not in their list must not list them as a current cosponsor
        served = b["congressesServedInCollection"]
        if served:
            c = rnd.choice(served)
            start = rnd.randrange(0, 3000)
            got_ids, _ = get(f"corpus_records?select=id,cos:detail->bill->cosponsors&dataset=eq.congress_bills&filters=cs.{q({'congress': [str(c)], 'type': ['hr']})}&order=ordinal.asc", rng=(start, start + 39))
            have = {(t, int(num)) for cc, types in by.items() if cc == str(c) for t, nums in types.items() for num in nums}
            for x in got_ids:
                _, typ, num = x["id"].split("-")
                checked_neg += 1
                current = any(p.get("bioguide") == bio and not p.get("withdrawn") for p in (x["cos"] or []))
                if current != ((typ, int(num)) in have):
                    bad_neg += 1
                    rep.check(f"{bio} {x['id']} membership", False, f"live current cosponsor {current}, stored {(typ, int(num)) in have}")
    rep.section(f"members: stored sponsored totals equal live congress_bills counts (sample {len(sample)})", len(sample), bad_sp)
    rep.section("members: stored sponsored-by-Congress equal live counts", len(sample) * 2, bad_by)
    rep.section("members: stored cosponsored refs are current cosponsors in the published bill", checked_co, bad_co)
    rep.section("members: published bills agree with the stored list (both directions)", checked_neg, bad_neg)
