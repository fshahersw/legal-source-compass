"""Case law v2: official federal court opinions from GovInfo (USCOURTS collection) as exact provenance for district cases.

    set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
    python3 -I -B scripts/caselaw_v2/govinfo.py crosswalk --run sample --court nysd --since 2004 --limit 60

GovInfo publishes one package per case (court + case number) and one granule per opinion (dateIssued, PDF), at
https://api.govinfo.gov (api.data.gov key DATA_GOV_API_KEY, from the environment only; never printed or stored).
Crosswalk (exact keys only, never names): a CourtListener cluster whose docket number has the federal form
"<office>:<yy>-<type>-<number>" (optionally followed by judge initials) gives the package id
USCOURTS-<court>-<office>_<yy>-<type>-<number:05d>; the package must exist and carry the same court code and case
number, and the cluster is linked to a granule only when exactly one granule of the package was issued on the cluster's
filing date. Anything else is reported (no package / no granule that day / several that day), never guessed.
Every response is kept unchanged under private/acq/w1025_caselaw/govinfo/ with its sha256 (manifest.jsonl).
Requests are paced (one per second by default, well under api.data.gov's 1,000 per hour).
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ACQ, UA, WORK, V2Error, append_jsonl, now, write_json  # noqa: E402

API = "https://api.govinfo.gov"
DOCKET = re.compile(r"^\s*(?:No\.\s*)?([0-9]):([0-9]{2})-([a-zA-Z]{2,4})-([0-9]{1,6})(?:-[A-Z]{2,4})*(?:\s*\([A-Z]{2,5}\))?\s*$")
OUT = os.path.join(ACQ, "govinfo")


def package_id(court: str, docket: str | None) -> str | None:
    """USCOURTS package id for a canonical federal docket number, else None (no guessing for other forms)."""
    if not docket:
        return None
    m = DOCKET.match(docket)
    if not m:
        return None
    office, yy, typ, num = m.groups()
    return f"USCOURTS-{court}-{office}_{yy}-{typ.lower()}-{int(num):05d}"


def case_number(pid: str) -> str:
    """USCOURTS-nysd-1_15-cv-08672 -> 1:15-cv-08672"""
    tail = pid.split("-", 2)[2]
    office, rest = tail.split("_", 1)
    return f"{office}:{rest}"


class Client:
    def __init__(self, pause: float = 1.0):
        key = os.environ.get("DATA_GOV_API_KEY")
        if not key:
            raise V2Error("DATA_GOV_API_KEY is not set in the environment")
        self._key = key
        self.pause = pause
        self.last = 0.0
        self.calls = 0
        import ssl

        ca = "/root/.ccr/ca-bundle.crt"
        self.ctx = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)

    def get(self, path: str, params: dict | None = None) -> tuple[int, bytes, str]:
        """(status, body, url without the key)."""
        q = dict(params or {})
        public = f"{API}{path}" + (f"?{urllib.parse.urlencode(q)}" if q else "")
        q["api_key"] = self._key
        url = f"{API}{path}?{urllib.parse.urlencode(q)}"
        wait = self.pause - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(4):
            self.last = time.time()
            self.calls += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
                    return r.status, r.read(), public
            except urllib.error.HTTPError as e:
                body = e.read()
                if e.code in (429, 500, 502, 503, 504) and attempt < 3 and not (e.code == 500 and b"does not exist" in body):
                    time.sleep(5 * (attempt + 1))
                    continue
                return e.code, body, public
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 3:
                    raise V2Error(f"GovInfo request failed: {type(e).__name__}") from None
                time.sleep(5 * (attempt + 1))
        raise V2Error("unreachable")


def keep(name: str, status: int, body: bytes, url: str) -> dict:
    os.makedirs(OUT, exist_ok=True)
    sha = hashlib.sha256(body).hexdigest()
    path = os.path.join(OUT, name)
    with open(path, "wb") as h:
        h.write(body)
    rec = {"file": name, "url": url, "status": status, "bytes": len(body), "sha256": sha, "acquired_at": now()}
    append_jsonl(os.path.join(OUT, "manifest.jsonl"), rec)
    return rec


def crosswalk(a) -> dict:
    import duckdb

    con = duckdb.connect(os.path.join(WORK, "runs", a.run, "meta.duckdb"), read_only=True)
    con.execute("PRAGMA disable_progress_bar")
    rows = con.execute("""SELECT cluster_id, CAST(date_filed AS VARCHAR), docket_number FROM clusters
                          WHERE court_id = ? AND year(date_filed) >= ? AND docket_number IS NOT NULL
                          ORDER BY hash(cluster_id) LIMIT ?""", [a.court, a.since, a.limit * 4]).fetchall()
    con.close()
    cands = [(cid, d, dn, package_id(a.court, dn)) for cid, d, dn in rows]
    stats = collections.Counter(no_canonical_docket=sum(1 for c in cands if not c[3]))
    cands = [c for c in cands if c[3]][: a.limit]
    cl = Client(a.pause)
    links = []
    for cid, date, dn, pid in cands:
        st, body, url = cl.get(f"/packages/{pid}/summary")
        if st != 200:
            stats["no_package"] += 1
            links.append({"cluster_id": cid, "date_filed": date, "docket_number": dn, "package_id": pid, "status": "no_package", "http": st})
            continue
        rec = keep(f"{pid}.summary.json", st, body, url)
        s = json.loads(body)
        if s.get("courtCode") != a.court or s.get("caseNumber") != case_number(pid):
            stats["package_mismatch"] += 1
            links.append({"cluster_id": cid, "package_id": pid, "status": "package_mismatch"})
            continue
        st2, body2, url2 = cl.get(f"/packages/{pid}/granules", {"pageSize": 100, "offsetMark": "*"})
        keep(f"{pid}.granules.json", st2, body2, url2)
        gr = json.loads(body2).get("granules", []) if st2 == 200 else []
        same_day = [g for g in gr if g.get("dateIssued") == date]
        status = "linked" if len(same_day) == 1 else "no_granule_that_day" if not same_day else "several_that_day"
        stats[status] += 1
        stats["packages_found"] += 1
        link = {"cluster_id": cid, "date_filed": date, "docket_number": dn, "package_id": pid, "status": status,
                "granules": len(gr), "summary_sha256": rec["sha256"], "details": s.get("detailsLink")}
        if status == "linked":
            g = same_day[0]
            st3, body3, url3 = cl.get(f"/packages/{pid}/granules/{g['granuleId']}/summary")
            grec = keep(f"{g['granuleId']}.summary.json", st3, body3, url3)
            gs = json.loads(body3) if st3 == 200 else {}
            link |= {"granule_id": g["granuleId"], "date_issued": g["dateIssued"], "granule_sha256": grec["sha256"],
                     "pdf": (gs.get("download") or {}).get("pdfLink"), "granule_details": gs.get("detailsLink")}
        links.append(link)
    rep = {"court": a.court, "since": a.since, "checked": len(cands), "stats": dict(stats), "requests": cl.calls,
           "built_at": now(), "links": links}
    write_json(os.path.join(WORK, "runs", a.run, f"govinfo_{a.court}.json"), rep)
    return rep


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crosswalk")
    c.add_argument("--run", required=True)
    c.add_argument("--court", required=True)
    c.add_argument("--since", type=int, default=2004)
    c.add_argument("--limit", type=int, default=40)
    c.add_argument("--pause", type=float, default=1.0)
    a = ap.parse_args()
    rep = crosswalk(a)
    print(json.dumps({k: v for k, v in rep.items() if k != "links"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
