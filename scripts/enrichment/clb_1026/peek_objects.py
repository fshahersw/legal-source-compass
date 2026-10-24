"""Read the first bytes of selected bulk objects (HTTP Range) to record their header lines, and the zip central directory of
zip objects (tail Range), without downloading the bodies. Prints a JSON report; nothing is stored except that report."""
from __future__ import annotations

import bz2
import io
import json
import os
import ssl
import struct
import sys
import time
import urllib.request

BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"
CA = "/root/.ccr/ca-bundle.crt"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def get(key: str, rng: str | None = None) -> bytes:
    headers = {"User-Agent": UA}
    if rng:
        headers["Range"] = rng
    req = urllib.request.Request(BASE + key, headers=headers)
    with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context(cafile=CA)) as r:
        return r.read()


def bz2_head(key: str, nbytes: int = 400_000, lines: int = 3) -> list[str]:
    raw = get(key, f"bytes=0-{nbytes - 1}")
    d = bz2.BZ2Decompressor()
    try:
        out = d.decompress(raw)
    except EOFError:
        out = b""
    return [ln[:400] for ln in out.decode("utf-8", "replace").splitlines()[:lines]]


def zip_names(key: str, size: int) -> list[dict]:
    tail = get(key, f"bytes={max(0, size - 65536)}-{size - 1}")
    i = tail.rfind(b"PK\x05\x06")
    if i < 0:
        return []
    _, _, _, _, n, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[i:i + 22])
    cd = get(key, f"bytes={cd_off}-{cd_off + cd_size - 1}")
    out, p = [], 0
    while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        comp, unc = struct.unpack("<II", cd[p + 20:p + 28])
        ln, le, lc = struct.unpack("<HHH", cd[p + 28:p + 34])
        name = cd[p + 46:p + 46 + ln].decode("utf-8", "replace")
        off = struct.unpack("<I", cd[p + 42:p + 46])[0]
        out.append({"name": name, "compressed": comp, "uncompressed": unc, "offset": off})
        p += 46 + ln + le + lc
    if out and out[0]["name"].endswith(".csv"):
        e = min(out, key=lambda x: x["compressed"])
        hdr = get(key, f"bytes={e['offset']}-{e['offset'] + 29}")
        nlen, xlen = struct.unpack("<HH", hdr[26:30])
        start = e["offset"] + 30 + nlen + xlen
        body = get(key, f"bytes={start}-{start + min(e['compressed'], 60000) - 1}")
        import zlib
        text = zlib.decompressobj(-15).decompress(body).decode("utf-8", "replace")
        out = [{"entries": len(out), "uncompressed_total": sum(x["uncompressed"] for x in out), "names": [x["name"] for x in out][:40],
                "sample_entry": e["name"], "sample_lines": [ln[:400] for ln in text.splitlines()[:3]]}]
    else:
        out = [{"entries": len(out), "uncompressed_total": sum(x["uncompressed"] for x in out), "names": [x["name"] for x in out][:3]}]
    return out


def main() -> None:
    inv = json.load(open(sys.argv[1]))
    sizes = {o["key"][len("bulk-data/"):]: o["size"] for o in inv["items"]}
    report = {"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "heads": {}, "zips": {}}
    for key in sys.argv[2:]:
        if key.endswith(".zip"):
            report["zips"][key] = zip_names(key, sizes[key])
        elif key.endswith(".bz2"):
            report["heads"][key] = bz2_head(key)
        else:
            report["heads"][key] = [ln[:400] for ln in get(key, "bytes=0-3999").decode("utf-8", "replace").splitlines()[:3]]
        time.sleep(1.0)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
