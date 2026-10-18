"""List (and optionally extract one member of) a remote zip via HTTP Range requests, without downloading it whole.

Usage:
  python3 -I -B scripts/enrichment/osha/remote_zip.py list <url>
  python3 -I -B scripts/enrichment/osha/remote_zip.py member <url> <member name> <relative output path under private/acq/osha>

`member` copies the member's *compressed bytes plus local header* is not attempted; instead it writes the
decompressed member bytes exactly as stored in the archive (zipfile CRC-checked) and records in the manifest the
archive URL, the member name, the member CRC32 and the archive's Last-Modified / Content-Length, so the
file is traceable to the official archive.
"""
import hashlib
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "osha")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"


class RangeFile(io.RawIOBase):
    def __init__(self, url, block=8 << 20):
        self.url = url
        self.pos = 0
        self.block = block
        self.cache_start = -1
        self.cache = b""
        self.requests = 0
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=60) as response:
            self.size = int(response.headers["Content-Length"])
            self.last_modified = response.headers.get("Last-Modified")
            self.accept_ranges = response.headers.get("Accept-Ranges")

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def _fetch(self, start, end):
        for attempt in range(5):
            time.sleep(0.5)
            headers = {"User-Agent": UA, "Range": f"bytes={start}-{end}"}
            if self.last_modified:
                headers["If-Range"] = self.last_modified  # a replaced archive answers 200 (full body) and is rejected below
            request = urllib.request.Request(self.url, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=300) as response:
                    self.requests += 1
                    if response.status != 206:
                        raise RuntimeError(f"server ignored Range (status {response.status})")
                    return response.read()
            except Exception:  # noqa: BLE001 - IncompleteRead, URLError, timeouts: retry with backoff, then raise
                if attempt == 4:
                    raise
                time.sleep(2 ** (attempt + 1))

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        if self.cache_start <= self.pos and self.pos + n <= self.cache_start + len(self.cache):
            off = self.pos - self.cache_start
            data = self.cache[off:off + n]
        else:
            length = max(n, self.block)
            end = min(self.size - 1, self.pos + length - 1)
            self.cache = self._fetch(self.pos, end)
            self.cache_start = self.pos
            data = self.cache[:n]
        self.pos += len(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


def main(argv):
    command, url = argv[0], argv[1]
    remote = RangeFile(url)
    archive = zipfile.ZipFile(remote)
    if command == "list":
        print(json.dumps({"url": url, "size": remote.size, "last_modified": remote.last_modified, "accept_ranges": remote.accept_ranges}))
        for info in archive.infolist():
            print(json.dumps({"name": info.filename, "compressed": info.compress_size, "size": info.file_size,
                              "date": "%04d-%02d-%02d %02d:%02d" % info.date_time[:5], "method": info.compress_type, "crc": "%08x" % info.CRC}))
    elif command == "member":
        name, rel = argv[2], argv[3]
        info = archive.getinfo(name)
        path = os.path.join(ACQ, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        remote.block = 32 << 20
        with archive.open(info) as member, open(path + ".part", "wb") as out:
            while True:
                chunk = member.read(1 << 20)
                if not chunk:
                    break
                digest.update(chunk)
                out.write(chunk)
                size += len(chunk)
        os.replace(path + ".part", path)
        entry = {"url": url, "member": name, "member_crc32": "%08x" % info.CRC, "member_compressed_bytes": info.compress_size,
                 "archive_bytes": remote.size, "archive_last_modified": remote.last_modified,
                 "path": os.path.relpath(path, ROOT), "sha256": digest.hexdigest(), "bytes": size,
                 "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "status": 206,
                 "method": "HTTP Range read of one member of the official bulk zip (member bytes as stored, CRC-verified)",
                 "range_requests": remote.requests}
        with open(MANIFEST, "a") as manifest:
            manifest.write(json.dumps(entry) + "\n")
        print(json.dumps(entry))


if __name__ == "__main__":
    main(sys.argv[1:])
