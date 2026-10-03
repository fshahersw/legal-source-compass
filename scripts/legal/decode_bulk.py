"""Lossless PostgreSQL COPY CSV staging. Raw archives are retained and hashed.

No canonical types are guessed here: this is the native staging layer. The
TypeScript mapper imports the shared controlled vocabulary for canonical rows.
"""
import argparse
import bz2
import csv
import hashlib
import json
import pathlib
import re
import sqlite3


class CaptureLines:
    def __init__(self, stream):
        self.stream, self.parts = stream, []

    def __iter__(self):
        return self

    def __next__(self):
        line = next(self.stream)
        self.parts.append(line)
        return line

    def take(self):
        text = "".join(self.parts)
        self.parts = []
        return text


COPY_FIELD = re.compile(r'(?:("(?:[^"\\]|\\.|"")*")|([^,\r\n]*))(,|\r?\n|$)', re.S)
COPY_ESCAPE = re.compile(r'\\(["\\])|""')


def exact_row(text):
    row, offset = [], 0
    while offset < len(text):
        match = COPY_FIELD.match(text, offset)
        if not match:
            raise ValueError("Malformed PostgreSQL CSV")
        quoted, plain, end = match.groups()
        row.append(COPY_ESCAPE.sub(lambda m: m.group(1) or '"', quoted[1:-1]) if quoted is not None else plain or None)
        offset = match.end()
        if end != ',':
            if text[offset:].strip():
                raise ValueError("Unexpected second CSV record")
            return row
        if offset == len(text):
            row.append(None)
    return row


def decode(archive, database):
    src = pathlib.Path(archive["path"])
    if not archive.get("complete"):
        raise ValueError("Only verified complete acquisitions can be staged")
    digest = hashlib.file_digest(src.open("rb"), "sha256").hexdigest()
    if digest != archive["sha256"] or src.stat().st_size != archive["bytes"]:
        raise ValueError("Acquisition checksum or size mismatch")
    conn = sqlite3.connect(database)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS bulk_sources (
          source_url TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL,
          provenance TEXT NOT NULL, rows_read INTEGER NOT NULL, rows_staged INTEGER NOT NULL,
          status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bulk_rows (
          source_url TEXT NOT NULL, native_id TEXT NOT NULL, row_number INTEGER NOT NULL,
          source_year INTEGER, payload_sha256 TEXT NOT NULL, raw_csv_sha256 TEXT NOT NULL,
          payload TEXT NOT NULL, PRIMARY KEY(source_url,native_id));
        CREATE INDEX IF NOT EXISTS bulk_rows_year ON bulk_rows(source_url,source_year);
    """)
    old = conn.execute("SELECT sha256,status FROM bulk_sources WHERE source_url=?", (archive["url"],)).fetchone()
    if old and old[0] != digest:
        raise ValueError("Original version changed; use a new staging database")
    if old and old[1] == "staged":
        return
    conn.execute("INSERT OR REPLACE INTO bulk_sources VALUES (?,?,?,?,0,0,'running')", (archive["url"], archive["type"], digest, json.dumps(archive)))
    csv.field_size_limit(2**31 - 1)
    count, selected = 0, 0
    with bz2.open(src, "rt", encoding="utf-8", newline="") as stream:
        capture = CaptureLines(stream)
        reader = csv.reader(capture, escapechar="\\", doublequote=False)
        header = next(reader)
        capture.take()
        if len(header) != len(set(header)) or "id" not in header:
            raise ValueError("Missing or ambiguous native identity")
        for _ in reader:
            raw = capture.take()
            values = exact_row(raw)
            if len(values) != len(header):
                raise ValueError("CSV header/row length mismatch")
            count += 1
            data = dict(zip(header, values))
            if data["id"] is None:
                raise ValueError("Missing native ID")
            event = data.get("date_filed") or data.get("filing_date") or ""
            if archive["type"] in ("dockets", "opinion-clusters") and event and event < "2000-01-01":
                continue
            # Missing dates are staged for review, never backfilled with retrieval.
            year = int(event[:4]) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", event) else None
            payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            sha = hashlib.sha256(payload.encode()).hexdigest()
            previous = conn.execute("SELECT payload_sha256 FROM bulk_rows WHERE source_url=? AND native_id=?", (archive["url"], data["id"])).fetchone()
            if previous and previous[0] != sha:
                raise ValueError("Conflicting duplicate native identity within one archive")
            conn.execute("INSERT OR IGNORE INTO bulk_rows VALUES (?,?,?,?,?,?,?)", (archive["url"], data["id"], count, year, sha, hashlib.sha256(raw.encode()).hexdigest(), payload))
            selected += 1
            if count % 5000 == 0:
                conn.execute("UPDATE bulk_sources SET rows_read=?,rows_staged=? WHERE source_url=?", (count, selected, archive["url"]))
                conn.commit()
    conn.execute("UPDATE bulk_sources SET rows_read=?,rows_staged=?,status='staged' WHERE source_url=?", (count, selected, archive["url"]))
    conn.commit()
    conn.close()
    print(json.dumps({"type": archive["type"], "rows_read": count, "rows_staged": selected, "source_audit_complete": False}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("database")
    args = parser.parse_args()
    for item in json.loads(pathlib.Path(args.manifest).read_text())["captures"]:
        decode(item, args.database)
