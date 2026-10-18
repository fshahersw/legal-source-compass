"""Resumable HTTP streaming of CourtListener public bulk files, decompressed on the fly.

The bulk files are public S3 objects (no account, no terms form). They are never stored whole: bytes flow
from HTTP -> `bzip2 -dc` -> a pandas chunk reader, and only aggregates are kept by the callers.

* `open_stream(url)` yields compressed bytes and resumes with a Range request when a connection drops.
* `decompressed_reader(url)` returns a binary file object of the decompressed CSV (a `bzip2 -dc` child process fed
  by a background thread), so `pandas.read_csv(..., chunksize=N)` can read it.
* `stream_stats` counts compressed bytes read so callers can report throughput.
"""
from __future__ import annotations

import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request

BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"
UA = "legal-source-compass research (notreelai@gmail.com)"
CA = "/root/.ccr/ca-bundle.crt"
CHUNK = 1 << 20
MAX_RETRIES = 12


class StreamStats:
    def __init__(self) -> None:
        self.compressed = 0
        self.retries = 0
        self.started = time.time()

    def rate_mb_s(self) -> float:
        dt = max(time.time() - self.started, 1e-6)
        return self.compressed / dt / 1e6


def _open(url: str, start: int, end: int | None):
    ctx = ssl.create_default_context(cafile=CA)
    headers = {"User-Agent": UA}
    if start or end is not None:
        headers["Range"] = f"bytes={start}-{'' if end is None else end}"
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=60, context=ctx)


def open_stream(url: str, stats: StreamStats | None = None, start: int = 0, end: int | None = None):
    """Yield compressed bytes of `url[start:end+1]`, resuming from the last byte on a dropped connection."""
    pos = start
    retries = 0
    while end is None or pos <= end:
        try:
            with _open(url, pos, end) as r:
                while True:
                    buf = r.read(CHUNK)
                    if not buf:
                        return
                    pos += len(buf)
                    if stats:
                        stats.compressed += len(buf)
                    yield buf
                    retries = 0
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as exc:
            retries += 1
            if stats:
                stats.retries += 1
            if retries > MAX_RETRIES:
                raise RuntimeError(f"giving up on {url} at byte {pos}: {exc}") from exc
            time.sleep(min(2 ** retries, 30))


class DecompressedReader:
    """File-like reader over `bzip2 -dc` fed from an HTTP stream by a background thread."""

    def __init__(self, url: str, stats: StreamStats | None = None, start: int = 0, end: int | None = None):
        self.stats = stats or StreamStats()
        self.proc = subprocess.Popen(
            ["bzip2", "-dc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=1 << 22
        )
        self.error: BaseException | None = None
        self._thread = threading.Thread(target=self._feed, args=(url, start, end), daemon=True)
        self._thread.start()

    def _feed(self, url: str, start: int, end: int | None) -> None:
        try:
            for buf in open_stream(url, self.stats, start, end):
                self.proc.stdin.write(buf)
            self.proc.stdin.close()
        except BaseException as exc:  # noqa: BLE001 - surfaced to the reader through .error
            self.error = exc
            try:
                self.proc.stdin.close()
            except Exception:
                pass

    def read(self, n: int = -1) -> bytes:
        return self.proc.stdout.read(n)

    def readable(self) -> bool:
        return True

    def close(self) -> None:
        try:
            self.proc.stdout.close()
        except Exception:
            pass
        self.proc.kill()
        self.proc.wait()


def decompressed_reader(name: str, stats: StreamStats | None = None, start: int = 0, end: int | None = None) -> DecompressedReader:
    url = name if name.startswith("http") else BASE + name
    return DecompressedReader(url, stats, start, end)
