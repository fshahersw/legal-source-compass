"""Stream the Open States public PostgreSQL dump once and keep only the bill tables for the selected sessions.

  python3 -I -B acquire_openstates.py [--month 2026-10] [--stop-early]

Source: the monthly public data dump linked from https://open.pluralpolicy.com/data/ ("PostgreSQL Data Dump"), published
under the page's statement "Unless otherwise noted data is provided under a public domain dedication". The per-session CSV
and JSON archives on that site need an account to see their download links, so they are not used. The dump (about 10.8 GB,
pg_dump custom format) is streamed over HTTPS and never stored: its SHA-256 is computed over every byte as it passes
(unless --stop-early), the table of contents is parsed by pgdump_reader, and the COPY data of the bill tables is decoded on
the fly. Kept, gzip-compressed, under private/acq/legislation/openstates/<month>/:
  jurisdictions.jsonl.gz      the 50 states, DC and Puerto Rico
  sessions.jsonl.gz           every legislative session of those jurisdictions
  organizations.jsonl.gz      their organizations (chambers, executive), for action chamber labels
  bills.jsonl.gz              bills of the candidate sessions: every regular session starting or ending on or after 2022-06-01
                              (build_state_bills.py keeps the current and the preceding regular session)
  actions / sponsorships / sources / versions / version_links / documents / document_links (.jsonl.gz) for those bills
  dump_manifest.json          URL, ETag, Last-Modified, Content-Length, SHA-256, TOC, per-table row counts kept/read
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as cm  # noqa: E402
import pgdump_reader as pr  # noqa: E402

DATA_PAGE = "https://open.pluralpolicy.com/data/"
LICENCE = "Unless otherwise noted data is provided under a public domain dedication but attribution is greatly appreciated and very helpful."
JURISDICTION = re.compile(r"^ocd-jurisdiction/country:us/(state:[a-z]{2}|district:dc|territory:pr)/government$")
KEEP_TABLES = {
    "opencivicdata_jurisdiction", "opencivicdata_legislativesession", "opencivicdata_organization", "opencivicdata_bill",
    "opencivicdata_billaction", "opencivicdata_billdocument", "opencivicdata_billdocumentlink", "opencivicdata_billsource",
    "opencivicdata_billsponsorship", "opencivicdata_billversion", "opencivicdata_billversionlink",
}
LAST_NEEDED = "opencivicdata_billversionlink"



def dump_url(month: str) -> str:
    return f"https://data.openstates.org/postgres/monthly/{month}-public.pgdump"


class Hashing:
    """Iterator over the HTTP body in 1 MiB pieces that hashes and counts every byte it yields."""

    def __init__(self, resp):
        self.resp = resp
        self.h = hashlib.sha256()
        self.n = 0
        self.t0 = time.time()

    def __iter__(self):
        return self

    def __next__(self):
        piece = self.resp.read(1 << 20)
        if not piece:
            raise StopIteration
        self.h.update(piece)
        self.n += len(piece)
        if self.n % (512 << 20) < len(piece):
            print(json.dumps({"streamed_mb": self.n >> 20, "seconds": round(time.time() - self.t0)}), flush=True)
        return piece


SPECIAL = re.compile(r"special|extraordinary|extra session|called session", re.I)
CANDIDATE_FROM = "2022-06-01"


def is_regular(s: dict) -> bool:
    """Open States' classification is not filled consistently ('primary', 'regular', '' and some special sessions marked
    'primary'), so a session is regular unless it is classified 'special' or its published name says special,
    extraordinary, extra or called session."""
    return s.get("classification") != "special" and not SPECIAL.search(s.get("name") or "")


def select_candidates(sessions: list[dict]) -> dict[str, list[dict]]:
    """Per jurisdiction, every regular session that starts or ends on or after CANDIDATE_FROM (or has no start date).
    The builder picks the current and the immediately preceding regular session from these, using the bills' own dates."""
    by_j: dict[str, list[dict]] = {}
    for s in sessions:
        if is_regular(s) and (not s.get("start_date") or s["start_date"] >= CANDIDATE_FROM
                              or (s.get("end_date") or "") >= CANDIDATE_FROM):
            by_j.setdefault(s["jurisdiction_id"], []).append(s)
    return {j: sorted(v, key=lambda s: (s.get("start_date") or "", s.get("identifier") or ""), reverse=True)
            for j, v in by_j.items()}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default=cm.now_utc()[:7], help="dump month YYYY-MM (default: the current month)")
    ap.add_argument("--if-changed", action="store_true", help="skip when the dump's ETag equals the one already extracted")
    ap.add_argument("--stop-early", action="store_true", help="stop after the last needed table (no whole-file SHA-256)")
    a = ap.parse_args(argv)
    url = dump_url(a.month)
    out_dir = cm.ACQ / "openstates" / a.month
    if a.if_changed and (out_dir / "dump_manifest.json").exists():
        status, _, hdrs = cm.http_get(url, method="HEAD")
        old = json.loads((out_dir / "dump_manifest.json").read_text())["headers"].get("ETag")
        if status == 200 and hdrs.get("ETag") == old:
            print(json.dumps({"unchanged": url, "etag": old}))
            return
    out_dir.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": cm.UA})
    resp = urllib.request.urlopen(req, timeout=600)
    headers = {k: resp.headers.get(k) for k in ("Content-Length", "ETag", "Last-Modified", "Content-Type")}
    stream = Hashing(resp)
    head = bytearray()
    archive = None
    while archive is None:
        head.extend(next(stream))
        try:
            archive = pr.read_toc(bytes(head))
        except EOFError:
            continue
    rest = bytes(head[archive.toc_end:])

    def chained():
        if rest:
            yield rest
        yield from stream

    blocks = pr.BlockStream(chained(), archive.int_size, archive.compression)
    blocks.raw_bytes = 0
    files = {}
    counts: dict[str, dict] = {}
    keep_juris: set[str] = set()
    sessions: list[dict] = []
    candidate_ids: set[str] = set()
    bill_ids: set[str] = set()
    version_ids: set[str] = set()
    document_ids: set[str] = set()
    per_session: dict[str, int] = {}

    def writer(name: str):
        if name not in files:
            files[name] = gzip.open(out_dir / f"{name}.jsonl.gz.part", "wt", encoding="utf-8")
        return files[name]

    order = [e for e in archive.toc if e.desc == "TABLE DATA"]
    finished_needed = False
    for e in order:
        if finished_needed or e.tag not in KEEP_TABLES:
            size = blocks.skip(e.dump_id)
            counts[e.tag] = {"skipped_compressed_bytes": size}
            if finished_needed and a.stop_early:
                break
            continue
        cols = pr.copy_columns(e.copy_stmt)
        read = kept = 0
        for row in pr.rows(blocks.lines(e.dump_id), cols):
            read += 1
            t = e.tag
            if t == "opencivicdata_jurisdiction":
                if JURISDICTION.match(row["id"] or ""):
                    keep_juris.add(row["id"])
                    writer("jurisdictions").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_legislativesession":
                if row["jurisdiction_id"] in keep_juris:
                    sessions.append(row)
                    writer("sessions").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_organization":
                if row.get("jurisdiction_id") in keep_juris:
                    slim = {k: row.get(k) for k in ("id", "name", "classification", "jurisdiction_id", "parent_id")}
                    writer("organizations").write(json.dumps(slim) + "\n")
                    kept += 1
            elif t == "opencivicdata_bill":
                per_session[row["legislative_session_id"]] = per_session.get(row["legislative_session_id"], 0) + 1
                if row["legislative_session_id"] in candidate_ids:
                    bill_ids.add(row["id"])
                    writer("bills").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billaction":
                if row["bill_id"] in bill_ids:
                    writer("actions").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billdocument":
                if row["bill_id"] in bill_ids:
                    document_ids.add(row["id"])
                    writer("documents").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billdocumentlink":
                if row["document_id"] in document_ids:
                    writer("document_links").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billsource":
                if row["bill_id"] in bill_ids:
                    writer("sources").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billsponsorship":
                if row["bill_id"] in bill_ids:
                    writer("sponsorships").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billversion":
                if row["bill_id"] in bill_ids:
                    version_ids.add(row["id"])
                    writer("versions").write(json.dumps(row) + "\n")
                    kept += 1
            elif t == "opencivicdata_billversionlink":
                if row["version_id"] in version_ids:
                    writer("version_links").write(json.dumps(row) + "\n")
                    kept += 1
        counts[e.tag] = {"rows_read": read, "rows_kept": kept, "columns": cols}
        print(json.dumps({"table": e.tag, "rows_read": read, "rows_kept": kept, "streamed_mb": stream.n >> 20}), flush=True)
        if e.tag == "opencivicdata_legislativesession":
            cands = select_candidates(sessions)
            candidate_ids = {s["id"] for v in cands.values() for s in v}
            counts["candidate_sessions"] = {j: [s["identifier"] for s in v] for j, v in sorted(cands.items())}
        if e.tag == LAST_NEEDED:
            finished_needed = True
            if a.stop_early:
                break
    complete = not a.stop_early
    if complete:
        for _ in stream:  # hash the remainder of the file (no decoding)
            pass
    resp.close()
    for name, fh in files.items():
        fh.close()
        (out_dir / f"{name}.jsonl.gz.part").replace(out_dir / f"{name}.jsonl.gz")
    if complete and headers["Content-Length"] and int(headers["Content-Length"]) != stream.n:
        raise SystemExit(f"streamed {stream.n} bytes, Content-Length {headers['Content-Length']}")
    manifest = {
        "url": url, "data_page": DATA_PAGE, "licence_statement": LICENCE, "headers": headers, "retrieved_at": cm.now_utc(),
        "bytes_streamed": stream.n, "sha256": stream.h.hexdigest() if complete else None, "complete_file_hashed": complete,
        "archive": {"version": ".".join(map(str, archive.version)), "dbname": archive.dbname, "server_version": archive.server_version,
                    "dump_version": archive.dump_version, "toc_entries": len(archive.toc)},
        "bills_per_session_in_dump": {s["id"]: per_session.get(s["id"], 0) for s in sessions},
        "tables": counts, "method": "HTTPS stream of the public pg_dump custom-format archive; bill tables decoded on the fly; "
                                    "archive not stored",
    }
    (out_dir / "dump_manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    cm.record({"url": url, "path": None, "sha256": manifest["sha256"], "bytes": stream.n, "retrieved_at": manifest["retrieved_at"],
               "http_status": 200, "method": "streamed, not stored; extracts in " + str(out_dir.relative_to(cm.ROOT)),
               "etag": headers["ETag"], "last_modified": headers["Last-Modified"]})
    print(json.dumps({"sha256": manifest["sha256"], "bytes": stream.n, "seconds": round(time.time() - stream.t0)}))


if __name__ == "__main__":
    main(sys.argv[1:])
