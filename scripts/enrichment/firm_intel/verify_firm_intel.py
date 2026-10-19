"""Independent checks of the firm intelligence builds against the raw master-docket counsel lookup.

Recounts from sw_matter_parties.json without firm_lib's merge rules: each sampled firm's appearances, parties, MDLs and side mix are
recounted from the exact raw spellings the profile lists; totals must reconcile; per-MDL HHI is recomputed; co-counsel weights are
recounted; plaintiff party names must not appear in firm profiles. Writes private/build/firm_intel/verification.json.

    python3 -I -B scripts/enrichment/firm_intel/verify_firm_intel.py
"""
from __future__ import annotations

import json
import os
import random
import sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "firm_intel")
P_TYPES = {"plaintiff", "consol plaintiff", "consolidated plaintiff", "intervenor plaintiff", "petitioner", "claimant"}
D_TYPES = {"defendant", "respondent", "third party defendant"}


def load(name):
    with open(os.path.join(OUT, name)) as h:
        return json.load(h)


def side_of(types):
    t = {x.strip().lower() for x in types or [] if x}
    p, d = bool(t & P_TYPES), bool(t & D_TYPES)
    return "plaintiff" if p and not d else "defense" if d and not p else "other"


def main():
    raw = load("lookups/sw_matter_parties.json")
    parties = raw["rows"] if isinstance(raw, dict) else raw
    prof = {r["item"]["profile"]["key"]: r["item"]["profile"] for r in load("firm_profiles.json")["rows"]}
    net = load("firm_network.json")["rows"]
    ovw = {r["id"]: r["item"]["profile"] for r in load("firm_matter_overview.json")["rows"]}
    failures = []

    # entries by exact raw firm string (withheld parties excluded, as in the build)
    by_raw = defaultdict(list)
    total_entries = 0
    plaintiff_names = set()
    for p in parties:
        if p.get("wh") == "true":
            continue
        s = side_of(p.get("ptypes"))
        if s == "plaintiff" and p.get("pname"):
            plaintiff_names.add(p["pname"].strip())
        for c in p.get("counsel") or []:
            f = (c.get("firm") or "").strip()
            if f:
                total_entries += 1
                by_raw[f].append((int(p["mdl"]), p["id"], s, p["dk"]))

    # 1. every raw spelling belongs to at most one firm, and listed counts equal the raw counts
    owner = {}
    for k, pr in prof.items():
        for form in pr["raw_forms"]:
            if form["text"] in owner:
                failures.append(f"spelling {form['text']!r} in two firms: {owner[form['text']]} and {k}")
            owner[form["text"]] = k
            if form["n"] != len(by_raw.get(form["text"], [])):
                failures.append(f"{k}: spelling {form['text']!r} listed {form['n']} vs raw {len(by_raw.get(form['text'], []))}")

    # 2. totals reconcile: firm appearances + left-out entries = all entries with a firm string
    app_total = sum(pr["appearances"] for pr in prof.values())
    skip = {"counsel entry without a firm string", "counsel for a party whose name the source withholds"}
    left_out = sum(v for k, v in ovw["overview:all"]["excluded"].items() if k not in skip)
    if app_total + left_out != total_entries:
        failures.append(f"totals: {app_total} appearances + {left_out} left out != {total_entries} entries")

    # 3. sampled firms recounted from their raw spellings (only firms whose spellings are all listed, i.e. <= 12 forms)
    rng = random.Random(20261019)
    keys = sorted(prof)
    sample = sorted(set(sorted(keys, key=lambda k: -prof[k]["appearances"])[:12] + rng.sample(keys, 18)))
    checked = []
    for k in sample:
        pr = prof[k]
        if len(pr["raw_forms"]) >= 12:
            continue
        rows = [e for f in pr["raw_forms"] for e in by_raw.get(f["text"], [])]
        got = {"appearances": len(rows), "parties": len({e[1] for e in rows}), "mdls": len({e[0] for e in rows}),
               "side_mix": {s: sum(1 for e in rows if e[2] == s) for s in ("plaintiff", "defense", "other")}}
        want = {"appearances": pr["appearances"], "parties": pr["parties"], "mdls": pr["mdls"], "side_mix": pr["side_mix"]}
        ok = got == want
        checked.append({"firm": k, "ok": ok})
        if not ok:
            failures.append(f"{k}: recount {got} vs profile {want}")

    # 4. per-MDL HHI recomputed for every MDL row
    firm_of = {f: k for k, pr in prof.items() for f in (x["text"] for x in pr["raw_forms"])}
    hhi_checked = 0
    for rid, o in ovw.items():
        if not rid.startswith("mdl:"):
            continue
        m = o["mdl"]
        c = Counter()
        for f, es in by_raw.items():
            k = firm_of.get(f)
            if not k:
                continue
            for e in es:
                if e[0] == m and e[2] == "plaintiff":
                    c[k] += 1
        tot = sum(c.values())
        hhi = round(sum((100.0 * n / tot) ** 2 for n in c.values()), 1) if tot else None
        hhi_checked += 1
        if hhi != o["plaintiff"]["hhi"] or len(c) != o["plaintiff"]["firms"]:
            failures.append(f"MDL {m}: HHI {hhi}/{len(c)} firms vs {o['plaintiff']['hhi']}/{o['plaintiff']['firms']}")

    # 5. co-counsel weights recounted for the 25 heaviest pairs
    party_firms = defaultdict(set)
    for f, es in by_raw.items():
        k = firm_of.get(f)
        if k:
            for e in es:
                party_firms[e[1]].add(k)
    co = [r["item"]["profile"] for r in net if r["item"]["profile"]["kind"] == "co-counsel"]
    co.sort(key=lambda x: -x["weight"])
    for e in co[:25]:
        n = sum(1 for fs in party_firms.values() if e["a"] in fs and e["b"] in fs)
        if n != e["weight"]:
            failures.append(f"co-counsel {e['a']} ~ {e['b']}: {n} vs {e['weight']}")

    # 6. privacy: no plaintiff-only party name appears anywhere in a firm profile
    defense_names = {(p.get("pname") or "").strip() for p in parties if side_of(p.get("ptypes")) != "plaintiff"}
    plaintiff_only = plaintiff_names - defense_names

    def strings(v):
        if isinstance(v, str):
            yield v.strip()
        elif isinstance(v, dict):
            for x in v.values():
                yield from strings(x)
        elif isinstance(v, list):
            for x in v:
                yield from strings(x)

    leaked = sum(1 for pr in prof.values() if any(t in plaintiff_only for t in strings(pr)))
    if leaked:
        failures.append(f"{leaked} profiles carry a plaintiff party name")

    result = {"entries_with_firm_string": total_entries, "appearances": app_total, "left_out": left_out, "firms": len(prof),
              "sampled_firms": len(checked), "sample_failures": sum(1 for c in checked if not c["ok"]), "mdl_hhi_checked": hhi_checked,
              "cocounsel_checked": min(25, len(co)), "plaintiff_names_checked": len(plaintiff_only), "failures": failures}
    with open(os.path.join(OUT, "verification.json"), "w") as h:
        json.dump(result, h, indent=1)
    print(json.dumps({k: v for k, v in result.items() if k != "failures"}), "failures:", len(failures))
    for f in failures[:30]:
        print("  ", f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
