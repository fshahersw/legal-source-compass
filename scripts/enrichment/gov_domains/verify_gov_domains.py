"""Independent verification of the gov_domains build (second parse of the raw files by a different path).

  python3 -I -B scripts/enrichment/gov_domains/verify_gov_domains.py [--build-file path] [--spot N]

Re-derives from the raw CSVs and the zone file, with positional csv.reader parsing (not the builder's DictReader code):
  - every acquired file still matches its manifest sha256
  - the published id set equals the union of the registries' entries (the out-of-use list adds none)
  - every CISA field of every record equals the raw row; the state is the raw state; the security contact is presence only
  - every GSA full-list row of every record equals the raw row(s), in file order
  - state names resolve to USPS through Census county names (independent of the builder's own table)
  - no e-mail address of a security contact appears anywhere in the rows
  - the build is deterministic (rebuilt in memory, rows identical)
Prints the failure count (target 0) and writes spot checks to private/build/gov_domains/spot_checks.json.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import acquire_gov_domains as acq  # noqa: E402
import build_gov_domains as bld  # noqa: E402

ROOT = acq.ROOT
BUILD_FILE = os.path.join(bld.BUILD, "gov_domains.json")
OFFICIAL_VIEWER_ROWS = 16935  # rows shown by https://data.get.gov/?file=current-full.csv on 2026-10-23


def val(text: str) -> str | None:
    """A raw cell as the build should hold it: trimmed; blank and the spreadsheet error `#N/A` are Not recorded."""
    t = text.strip()
    return None if t in ("", "#N/A") else t


def raw(repo: str, name: str) -> bytes:
    with open(acq.local_path(repo, name), "rb") as handle:
        return handle.read()


def table(body: bytes) -> tuple[list[str], list[tuple[int, list[str]]]]:
    reader = csv.reader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    header = next(reader)
    return header, [(reader.line_num, row) for row in reader]


def main(argv: list[str]) -> int:
    build_path = BUILD_FILE
    spot_n = 20
    if "--build-file" in argv:
        build_path = argv[argv.index("--build-file") + 1]
    if "--spot" in argv:
        spot_n = int(argv[argv.index("--spot") + 1])
    failures: list[str] = []

    def fail(msg: str) -> None:
        if len(failures) < 40:
            failures.append(msg)
        else:
            failures.append("...")

    if acq.verify() != 0:
        fail("manifest sha256 mismatch")

    with open(build_path, encoding="utf-8") as handle:
        build = json.load(handle)
    rows = {r["id"]: r for r in build["rows"]}
    if len(rows) != len(build["rows"]):
        fail("duplicate ids")

    # independent state-name table: Census county names are "<County>, <State name>" with the state's USPS code
    with open(os.path.join(ROOT, "private", "build", "gov_domains", "lookups", "census_counties.json"), encoding="utf-8") as handle:
        counties = json.load(handle)
    census_state = {c["name"].rsplit(", ", 1)[1].lower(): c["usps"] for c in counties}

    # ---- CISA
    hdr, cisa_full = table(raw("cisagov/dotgov-data", "current-full.csv"))
    assert hdr[:7] == ["Domain name", "Domain type", "Organization name", "Suborganization name", "City", "State", "Security contact email"], hdr
    _, cisa_fed = table(raw("cisagov/dotgov-data", "current-federal.csv"))
    zone_text = raw("cisagov/dotgov-data", "gov.txt").decode("utf-8")
    zone = {m.group(1).lower() for m in re.finditer(r"^([a-z0-9-]+\.gov)\.\t\d+\tIN\tNS\t", zone_text, re.M | re.I)}
    if len(cisa_full) != OFFICIAL_VIEWER_ROWS:
        fail(f"current-full.csv has {len(cisa_full)} rows, the official viewer showed {OFFICIAL_VIEWER_ROWS}")
    cisa_ids = set()
    cisa_line: dict[str, int] = {}
    for line, r in cisa_full:
        rid = r[0].strip().lower()
        cisa_ids.add(rid)
        cisa_line[rid] = line
        rec = rows.get(rid)
        if rec is None:
            fail(f"CISA {rid} missing from build")
            continue
        c = rec["item"]["gov"]["cisa"]
        if c is None:
            fail(f"{rid}: no cisa block")
            continue
        exp = (r[1].strip(), r[2].strip(), r[3].strip() or None, r[4].strip() or None, r[5].strip() or None)
        got = (c["type"], c["organization"], c["suborganization"], c["city"], c["state"])
        if exp != got:
            fail(f"{rid}: CISA fields {got} != raw {exp}")
        email = r[6].strip()
        if (email not in ("", "(blank)")) != (c["security_contact"] == "published"):
            fail(f"{rid}: security contact presence differs")
        if c["in_zone"] != (rid in zone):
            fail(f"{rid}: zone membership differs")
        if exp[4] and exp[4] not in census_state.values() and exp[4] not in ("AS", "GU", "MP", "VI"):
            fail(f"{rid}: state {exp[4]} is not a known USPS code")
    fed_ids = {r[0].strip().lower() for _, r in cisa_fed}
    for rid in cisa_ids:
        want = rid in fed_ids
        have = "cisa_current_federal" in rows[rid]["item"]["gov"]["lists"] if rid in rows else None
        if want != have:
            fail(f"{rid}: federal list membership differs")
    if fed_ids - cisa_ids:
        fail("current-federal.csv has domains missing from current-full.csv")
    if zone - cisa_ids:
        fail(f"zone file has {len(zone - cisa_ids)} domains missing from current-full.csv")

    # ---- GSA
    fh, gsa_full = table(raw("GSA/govt-urls", "1_govt_urls_full.csv"))
    assert fh == ["Domain name", "Agency", "Maintaining office", "Use case", "Type of government", "Federal branch", "State", "Comments", "Link", "Date Added"], fh

    def eid(text: str) -> str:
        host, sep, rest = text.strip().partition("/")
        path = rest.strip().strip("/") if sep else ""
        return host.strip().lower() + ("/" + path.lower() if path else "")

    gsa_rows: dict[str, list[tuple[int, list[str]]]] = {}
    for line, r in gsa_full:
        gsa_rows.setdefault(eid(r[0]), []).append((line, r))
    view_ids: set[str] = set()
    view_lines: dict[str, tuple[str, int]] = {}
    for name in sorted(acq.REPOS["GSA/govt-urls"]["files"]):
        if not name.endswith(".csv") or name.startswith(("1_", "9_")):
            continue
        _, vr = table(raw("GSA/govt-urls", name))
        for line, r in vr:
            rid = eid(r[0])
            if rid:
                view_ids.add(rid)
                view_lines.setdefault(rid, (name, line))
    _, nu = table(raw("GSA/govt-urls", "9_govt_urls_not_used.csv"))
    nu_ids = {eid(r[0]) for _, r in nu if r and r[0].strip()}
    expected = cisa_ids | set(gsa_rows) | view_ids
    if expected != set(rows):
        fail(f"id sets differ: {len(expected - set(rows))} missing, {len(set(rows) - expected)} extra")
    if (nu_ids - expected) & set(rows):
        fail("a domain only on the out-of-use list became a record")
    for rid, lines in gsa_rows.items():
        rec = rows.get(rid)
        if rec is None:
            continue
        g = rec["item"]["gov"]["gsa"]
        if g is None or len(g["rows"]) != len(lines):
            fail(f"{rid}: GSA row count differs")
            continue
        for (line, r), got in zip(lines, g["rows"]):
            exp = {
                "type": val(r[4]),
                "agency": val(r[1]),
                "maintaining_office": val(r[2]),
                "use_case": val(r[3]),
                "federal_branch": val(r[5]),
                "state_as_published": val(r[6]),
                "comments": val(r[7]),
                "date_added": val(r[9]),
            }
            for k, v in exp.items():
                if got[k] != v:
                    fail(f"{rid}: GSA {k} {got[k]!r} != raw {v!r} (line {line})")
            link = r[8].strip()
            exp_link = link if re.match(r"^https?://\S+$", link) else None
            if got["link"] != exp_link:
                fail(f"{rid}: GSA link differs (line {line})")
            sa = r[6].strip()
            codes = []
            for part in [p.strip() for p in sa.split(",")] if sa else []:
                code = census_state.get(part.lower()) or (part if re.fullmatch(r"[A-Z]{2}", part) else None)
                if code is None and part.lower() in ("american samoa", "guam", "northern mariana islands", "virgin islands"):
                    code = {"american samoa": "AS", "guam": "GU", "northern mariana islands": "MP", "virgin islands": "VI"}[part.lower()]
                if code is None:
                    codes = None
                    break
                codes.append(code)
            if codes is not None and got["states"] != codes:
                fail(f"{rid}: GSA states {got['states']} != independent {codes}")
            if codes is None and got["states"]:
                fail(f"{rid}: states resolved for unresolvable value {sa!r}")

    # ---- privacy: no security contact address anywhere in the rows
    emails = {r[6].strip().lower() for _, r in cisa_full if "@" in r[6]}
    blob = json.dumps(build["rows"], ensure_ascii=False).lower()
    found = set(re.findall(r"[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}", blob))
    leaked = sorted(emails & found)
    if leaked:
        fail(f"{len(leaked)} security contact addresses appear in the rows, e.g. {leaked[:2]}")

    # ---- determinism
    again, _ = bld.build()
    if json.dumps(again["rows"], sort_keys=True) != json.dumps(build["rows"], sort_keys=True):
        fail("a rebuild gives different rows")

    # ---- spot checks
    rng = random.Random(20261023)
    checks = []
    ids = sorted(cisa_ids)
    for rid in rng.sample(ids, min(spot_n // 2 + spot_n % 2, len(ids))):
        r = cisa_full[cisa_line[rid] - 2][1]  # line 1 is the header; rows start on line 2
        assert r[0].strip().lower() == rid
        c = rows[rid]["item"]["gov"]["cisa"]
        checks.append({"id": rid, "field": "Domain type / Organization / City / State", "published": [c["type"], c["organization"], c["city"], c["state"]], "raw": [r[1], r[2], r[4], r[5]], "where": f"current-full.csv line {cisa_line[rid]}", "match": [c["type"], c["organization"], c["city"], c["state"]] == [r[1].strip(), r[2].strip(), r[4].strip() or None, r[5].strip() or None]})
    gids = sorted(gsa_rows)
    for rid in rng.sample(gids, min(spot_n // 2, len(gids))):
        line, r = gsa_rows[rid][0]
        g = rows[rid]["item"]["gov"]["gsa"]["rows"][0]
        checks.append({"id": rid, "field": "Type of government / State / Agency", "published": [g["type"], g["state_as_published"], g["agency"]], "raw": [r[4], r[6], r[1]], "where": f"1_govt_urls_full.csv line {line}", "match": [g["type"], g["state_as_published"], g["agency"]] == [val(r[4]), val(r[6]), val(r[1])]})
    with open(os.path.join(bld.BUILD, "spot_checks.json"), "w", encoding="utf-8") as handle:
        json.dump(checks, handle, indent=1, ensure_ascii=False)
    bad_spots = [c for c in checks if not c["match"]]
    if bad_spots:
        fail(f"{len(bad_spots)} spot checks differ")

    print(json.dumps({"records": len(rows), "cisa": len(cisa_ids), "gsa_full_ids": len(gsa_rows), "view_ids": len(view_ids), "out_of_use_ids": len(nu_ids), "zone_domains": len(zone), "spot_checks": len(checks), "spot_mismatches": len(bad_spots), "failures": len([f for f in failures if f != '...'])}))
    for f in failures:
        print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
