"""Gzip a stored raw file in place (bytes unchanged inside the gzip) and record it in the manifest.

Usage: python3 -I -B compress_raw.py <path relative to private/acq/state_analysis>
The manifest keeps the original entry (url, sha256 and bytes of the response body); a new entry for the .gz path records
the same url and response sha256 plus stored_sha256/stored_bytes of the compressed file.
"""
import gzip
import json
import os
import shutil
import sys

import sa_http


def main(rel: str) -> None:
    src = os.path.join(sa_http.ACQ, rel)
    relpath = os.path.relpath(src, sa_http.ROOT)
    entry = sa_http.manifest()[relpath]
    if sa_http.sha256_file(src) != entry["sha256"]:
        raise SystemExit("stored file does not match its manifest sha256")
    dst = src + ".gz"
    with open(src, "rb") as a, gzip.open(dst, "wb", compresslevel=6) as b:
        shutil.copyfileobj(a, b, 1 << 20)
    with gzip.open(dst, "rb") as h:
        import hashlib

        d = hashlib.sha256()
        for chunk in iter(lambda: h.read(1 << 20), b""):
            d.update(chunk)
    if d.hexdigest() != entry["sha256"]:
        raise SystemExit("gzip round trip changed the bytes")
    new = dict(entry)
    new.update({"path": relpath + ".gz", "method": entry["method"] + "; stored gzip-compressed (decompressed bytes match sha256)",
                "stored_sha256": sa_http.sha256_file(dst), "stored_bytes": os.path.getsize(dst)})
    sa_http._log(new)
    os.remove(src)
    print(json.dumps(new))


if __name__ == "__main__":
    main(sys.argv[1])
