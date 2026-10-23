"""Independent verification of congress_members and congress_committees (a second code path: it reads the stored API responses and
the parsed bill records directly and does not import the builders' helpers).

  python3 -I -B verify_congress.py offline          rebuild expectations from the raw files and compare with the build files
  python3 -I -B verify_congress.py live [N]         compare the published datasets with the build files and with the published
                                                    congress_bills (after the datasets are published; run it in a shell where the
                                                    lead has sourced private/scratch/env.sh, it reads the corpus variables from the environment)

Every check prints its count and the number of failures; the exit status is the total failures. `offline` needs no network.
"""
from __future__ import annotations

import gzip
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[2]
if not (ROOT / "private").exists():
    ROOT = Path("/home/user/legal-source-compass")
ACQ = ROOT / "private" / "acq" / "congress"
BUILD = ROOT / "private" / "build" / "congress"
PARSED = ROOT / "private" / "build" / "legislation" / "parsed"


def rj(p: Path):
    return json.loads(gzip.decompress(p.read_bytes())) if p.suffix == ".gz" else json.loads(p.read_text())


def newest(prefix: str, key: str):
    """Newest stored response among the first fetch and any dated refresh (by the record's updateDate)."""
    best = None
    for p in sorted(ACQ.glob(prefix + "__format=json*.json.gz")):
        d = rj(p).get(key) or {}
        if best is None or (d.get("updateDate") or "") >= (best.get("updateDate") or ""):
            best = d
    return best


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, int, int]] = []
        self.problems: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        if not ok and len(self.problems) < 60:
            self.problems.append(f"{name}: {detail}")
        return ok

    def section(self, name: str, total: int, failures: int) -> None:
        self.rows.append((name, total, failures))

    def finish(self) -> int:
        for name, total, failures in self.rows:
            print(f"{name:<60} checked {total:>8,}  failures {failures}")
        for p in self.problems:
            print("  FAIL", p)
        total = sum(f for _, _, f in self.rows)
        print(f"TOTAL FAILURES {total}")
        return total


def party_latest(ph: list[dict]) -> str | None:
    if not ph:
        return None
    best = None
    for p in ph:  # latest start year; later published entry wins a tie
        if best is None or (p.get("startYear") or 0) >= (best.get("startYear") or 0):
            best = p
    return best.get("partyName")


def expected_bill_index():
    sp: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    co: dict[str, dict[int, dict[str, set]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    wd: Counter = Counter()
    total = 0
    for f in sorted(PARSED.glob("*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                total += 1
                c, t, n = int(r["congress"]), r["type"], int(r["number"])
                s = r.get("sponsors") or []
                if s and s[0].get("bioguideId"):
                    sp[s[0]["bioguideId"]][c] += 1
                for x in r.get("cosponsors") or []:
                    b = x.get("bioguideId")
                    if not b:
                        continue
                    if x.get("sponsorshipWithdrawnDate"):
                        wd[b] += 1
                    else:
                        co[b][c][t].add(n)
    return sp, co, wd, total


def verify_members(rep: Report) -> None:
    build = json.loads((BUILD / "congress_members.json").read_text())
    rows = {r["id"]: r for r in build["rows"]}
    lst = rj(BUILD / "member_list.json")
    listed = {m["bioguideId"]: m for m in lst["members"]}
    rep.section("members: row ids equal the API list", len(listed), int(not rep.check("ids", set(rows) == set(listed), f"{len(set(rows) ^ set(listed))} differ")))
    sp, co, wd, nbills = expected_bill_index()
    bad = Counter()
    n = 0
    for bio, row in rows.items():
        n += 1
        m = row["detail"]["member"]
        cells = row["item"]["cells"]
        d = newest(f"member_{bio}", "member")
        ok = lambda name, cond, info="": bad.update([name]) if not rep.check(f"{bio} {name}", cond, info) else None  # noqa: E731
        ok("id", row["id"] == bio and row["category"] == "congress_members" and m["bioguideId"] == bio)
        ok("source_url", row["source_url"] == f"https://api.congress.gov/v3/member/{bio}")
        if d is None:
            ok("no detail -> flagged", m["source"]["detailFetched"] is False)
            continue
        ok("detail flagged", m["source"]["detailFetched"] is True and d.get("bioguideId") == bio)
        squash = lambda v: re.sub(r"\s+", " ", v).strip() if v else None  # noqa: E731  (the one normalisation: runs of white space become one space)
        inv = squash(d.get("invertedOrderName") or listed[bio].get("name"))
        ok("name", cells["name"] == inv and m["names"]["inverted"] == inv, f"{cells['name']!r} vs {inv!r}")
        ok("direct name", m["names"]["direct"] == squash(d.get("directOrderName")))
        cur = d.get("currentMember")
        ok("current", m["current"] is (cur if isinstance(cur, bool) else None) and cells["current"] == (("yes" if cur else "no") if isinstance(cur, bool) else None))
        raw_terms = d.get("terms") or []
        ok("term count", len(m["terms"]) == len(raw_terms), f"{len(m['terms'])} vs {len(raw_terms)}")
        key = lambda t: (t.get("congress"), t.get("chamber"), t.get("memberType"), t.get("stateCode"), t.get("district"), t.get("startYear"), t.get("endYear"))  # noqa: E731
        have = sorted((key(t) for t in m["terms"]), key=str)
        want = sorted(((t.get("congress"), t.get("chamber"), t.get("memberType"), t.get("stateCode"), t.get("district"), int(t["startYear"]) if t.get("startYear") else None, int(t["endYear"]) if t.get("endYear") else None) for t in raw_terms), key=str)
        ok("terms", have == want)
        rph = d.get("partyHistory") or []
        ok("party history", sorted((p["party"], p.get("startYear")) for p in m["partyHistory"]) == sorted((p["partyName"], int(p["startYear"]) if p.get("startYear") else None) for p in rph))
        ok("latest party", cells["party"] == party_latest(rph), f"{cells['party']!r} vs {party_latest(rph)!r}")
        ok("website", m["officialWebsite"] == (d.get("officialWebsiteUrl") if str(d.get("officialWebsiteUrl") or "").startswith(("http://", "https://")) else None))
        sc = (d.get("sponsoredLegislation") or {}).get("count")
        cc = (d.get("cosponsoredLegislation") or {}).get("count")
        ok("api counts", m["legislation"]["sponsored"] == sc and m["legislation"]["cosponsored"] == cc and cells["sponsored_reported"] == sc and cells["cosponsored_reported"] == cc)
        ok("birth/death", m["birthYear"] == (int(d["birthYear"]) if d.get("birthYear") else None) and m["deathYear"] == (int(d["deathYear"]) if d.get("deathYear") else None))
        dep = d.get("depiction") or {}
        ok("portrait", (m["portrait"] or {}).get("imageUrl") == (dep.get("imageUrl") if str(dep.get("imageUrl") or "").startswith("https://www.congress.gov/") else None))
        if m["portrait"] and dep.get("attribution"):
            ok("portrait credit raw", m["portrait"]["attribution"]["raw"] == re.sub(r"\s+", " ", dep["attribution"]).strip())
        ok("no address or phone stored", "addressInformation" not in json.dumps(row) and "phoneNumber" not in json.dumps(row))
        # bills: second implementation
        b = m["bills"]
        ok("sponsored by congress", {int(k): v for k, v in b["sponsoredByCongress"].items()} == dict(sp.get(bio, {})))
        ok("sponsored total", b["sponsoredTotal"] == sum(sp.get(bio, {}).values()))
        stored = row["detail"]["cosponsored"]
        want_co = {str(c): {t: sorted(s) for t, s in by.items()} for c, by in co.get(bio, {}).items()}
        ok("cosponsored lists", stored["byCongress"] == want_co and stored["bioguideId"] == bio)
        ok("cosponsored counts", b["cosponsoredTotal"] == sum(len(s) for by in co.get(bio, {}).values() for s in by.values()) == stored["total"])
        ok("withdrawn", b["cosponsorshipsWithdrawn"] == wd.get(bio, 0))
        served_in = sorted({t["congress"] for t in raw_terms if 108 <= (t.get("congress") or 0) <= 119})
        ok("served in collection", b["congressesServedInCollection"] == served_in)
        ok("filters", row["filters"].get("current", [None])[0] == cells["current"] and (row["filters"].get("represents") == [raw_terms[-1]["stateCode"]] if cur else "represents" not in row["filters"]) if raw_terms else True)
    rep.section("members: values re-derived from raw responses and bill records", n, sum(bad.values()))
    for name, cnt in bad.most_common(8):
        print(f"   members check {name}: {cnt} failures")
    # every sponsor/cosponsor id in the bill records is a member
    ids = set(sp) | set(co) | set(wd)
    rep.section("bill sponsor/cosponsor ids that are members (exact id)", len(ids), len(ids - set(rows)))
    rep.check("unknown ids", not (ids - set(rows)), str(sorted(ids - set(rows))[:5]))
    # API count vs stored count, for members who served only inside the bill range (reported, not a failure)
    full = [(bio, r) for bio, r in rows.items() if r["detail"]["member"]["bills"]["servedOnlyInCollection"] and r["detail"]["member"]["legislation"]["sponsored"] is not None]
    eq_sp = sum(1 for _, r in full if r["detail"]["member"]["legislation"]["sponsored"] == r["detail"]["member"]["bills"]["sponsoredTotal"])
    eq_co = sum(1 for _, r in full if r["detail"]["member"]["legislation"]["cosponsored"] == r["detail"]["member"]["bills"]["cosponsoredTotal"])
    print(f"RECONCILIATION (informational): members who served only in the 108th-119th: {len(full)}; API sponsored count equals stored count for {eq_sp}; cosponsored for {eq_co}; bills read {nbills:,}")
    diffs = sorted(((abs(r["detail"]["member"]["legislation"]["sponsored"] - r["detail"]["member"]["bills"]["sponsoredTotal"]), bio) for bio, r in full), reverse=True)[:5]
    print("   largest sponsored differences (API minus stored, abs):", diffs)
    json.dump({"members_fully_covered": len(full), "sponsored_equal": eq_sp, "cosponsored_equal": eq_co}, open(BUILD / "reconciliation.json", "w"))


def verify_committees(rep: Report) -> None:
    build = json.loads((BUILD / "congress_committees.json").read_text())
    rows = {r["id"]: r for r in build["rows"]}
    lst = rj(BUILD / "committee_list.json")
    cl = rj(BUILD / "committee_congress_lists.json")
    codes = {c["systemCode"] for c in lst["committees"]} | set(cl.get("items", {}))
    rep.section("committees: row ids equal list plus per-Congress lists", len(codes), int(not rep.check("committee ids", set(rows) == codes, f"{len(set(rows) ^ codes)} differ")))
    bad = Counter()
    byc = cl["by_congress"]
    for code, row in rows.items():
        c = row["detail"]["committee"]
        cells = row["item"]["cells"]
        ok = lambda name, cond, info="": bad.update([name]) if not rep.check(f"{code} {name}", cond, info) else None  # noqa: E731
        item = next((x for x in lst["committees"] if x["systemCode"] == code), None) or cl["items"][code]
        chamber = {"House": "house", "Senate": "senate", "Joint": "joint"}[item["chamber"]]
        d = newest(f"committee_{chamber}_{code}", "committee")
        sp = lambda v: re.sub(r"\s+", " ", v or "").strip()  # noqa: E731  (the one normalisation: runs of white space become one space)
        ok("name", c["name"] == sp(item["name"]) and cells["name"] == sp(item["name"]))
        ok("chamber", c["chamber"] == item["chamber"])
        want_congresses = sorted(int(k) for k, v in byc.items() if code in v)
        ok("congresses", c["congresses"] == want_congresses)
        ok("no membership", not any("member" in k.lower() for k in c))
        if d is None:
            ok("no detail -> flagged", c["source"]["detailFetched"] is False)
            continue
        ok("current", c["current"] == (d.get("isCurrent") if isinstance(d.get("isCurrent"), bool) else None))
        ok("type", c["type"] == (d.get("type") or item.get("committeeTypeCode")))
        w = d.get("committeeWebsiteUrl")
        ok("website", c["website"] == (w if isinstance(w, str) and w.startswith(("http://", "https://")) else None))
        par = d.get("parent") or item.get("parent")
        ok("parent", (c["parent"] or {}).get("systemCode") == (par or {}).get("systemCode"))
        ok("parent listed", c["parent"] is None or c["parent"]["listed"] == (c["parent"]["systemCode"] in codes))
        subs = d.get("subcommittees") or item.get("subcommittees") or []
        ok("subcommittees", [s["systemCode"] for s in c["subcommittees"]] == [s["systemCode"] for s in subs if re.match(r"^(?:[hsj][a-z0-9]{3}\d{2}|no?\d{6,10})$", s.get("systemCode") or "")])
        ok("history", len(c["history"]) == len([h for h in (d.get("history") or []) if any(h.get(k) for k in ("officialName", "libraryOfCongressName", "startDate", "endDate", "committeeTypeCode", "establishingAuthority"))]))
        for k in ("reports", "bills", "communications", "nominations"):
            raw = (d.get(k) or {}).get("count")
            ok(f"count {k}", c["counts"].get(k) == (raw if isinstance(raw, int) else None))
        ok("level", c["level"] == ("subcommittee" if par or (re.match(r"^[hsj][a-z0-9]{3}\d{2}$", code) and not code.endswith("00")) else "committee"))
    rep.section("committees: values re-derived from raw responses", len(rows), sum(bad.values()))
    for name, cnt in bad.most_common(8):
        print(f"   committees check {name}: {cnt} failures")


def main(argv: list[str]) -> int:
    rep = Report()
    if not argv or argv[0] == "offline":
        which = argv[1] if len(argv) > 1 else "all"
        if which in ("all", "members") and (BUILD / "congress_members.json").exists():
            verify_members(rep)
        if which in ("all", "committees") and (BUILD / "congress_committees.json").exists():
            verify_committees(rep)
    elif argv[0] == "live":
        import verify_live

        verify_live.run(rep, int(argv[1]) if len(argv) > 1 else 40)
    else:
        raise SystemExit(__doc__)
    return rep.finish()


if __name__ == "__main__":
    sys.exit(min(main(sys.argv[1:]), 125))
