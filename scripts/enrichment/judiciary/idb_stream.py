"""Stream the rows of an FJC IDB text file straight out of its zip, without writing the uncompressed text to disk.

The appeals zip uses ordinary deflate; the criminal and bankruptcy zips use Deflate64 ("deflated (enhanced-64k)"), which
Python's zipfile cannot read, so every file is read through Info-ZIP `unzip -p` (UnZip 6.00) as a pipe. Lines are
tab-delimited, single-byte text (decoded as cp1252, as for the civil file); the first line is the header.
"""
from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path


def rows(zip_path: Path | str, member: str | None = None) -> Iterator[dict]:
    """Yield one dict per data line (header names as keys). Lines with a wrong column count are yielded with key
    '__bad__' set so callers can count and exclude them."""
    cmd = ["unzip", "-p", str(zip_path)] + ([member] if member else [])
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    assert proc.stdout is not None
    try:
        header = None
        for raw in proc.stdout:
            line = raw.decode("cp1252", errors="replace").rstrip("\r\n")
            cols = line.split("\t")
            if header is None:
                header = [c.strip() for c in cols]
                width = len(header)
                continue
            if len(cols) != width:
                yield {"__bad__": True, "__cols__": len(cols)}
                continue
            yield dict(zip(header, cols))
    finally:
        proc.stdout.close()
        code = proc.wait()
        if code not in (0, None, -13):  # -13: SIGPIPE when a caller stops early
            raise RuntimeError(f"unzip exited with {code} for {zip_path}")
