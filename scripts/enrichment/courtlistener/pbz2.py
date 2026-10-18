"""Parallel decompression of one huge single-stream .bz2 over HTTP, without storing it.

A bzip2 file is a header ("BZh" + level digit) followed by independent blocks that each start with the 48-bit magic
0x314159265359 at an arbitrary *bit* offset. We split the compressed byte range into segments, find the first block
magic at/after each segment boundary, re-pack each segment's bits behind a fresh header, and let one `bzip2 -dc` per
segment decode it. Segment outputs are concatenated in order, so the consumer sees the original CSV bytes.

Integrity: every bzip2 block carries its own CRC, which the decoder verifies. A segment is fed to Python's incremental
`bz2.BZ2Decompressor` *without* an end-of-stream marker (the stream-level combined CRC could not match a partial stream),
so the decoder emits every complete block and then simply waits for more input. A corrupt block raises. A segment that
decodes to nothing, or whose block offsets cannot be found, raises.
(The `bzip2` CLI is not used: it reads in 5000-byte pieces and drops the last partial piece when it hits an error.)
"""
from __future__ import annotations

import bz2
import queue
import threading
from typing import Iterator

import numpy as np

from cl_stream import BASE, StreamStats, open_stream

MAGIC = 0x314159265359  # block header, 48 bits
EOS = 0x177245385090  # end-of-stream marker, 48 bits
WINDOW = 6 * 1024 * 1024  # bytes scanned past a boundary to find the next block start; blocks are < 1.1 MB
_M = [(MAGIC >> (8 * (5 - i))) & 0xFF for i in range(6)]


def _pattern(s: int) -> tuple[bytes, int, int, int, int]:
    """Bytes w+1..w+5 of a magic that starts at bit s of byte w, plus the edge-byte values and masks."""
    if s == 0:
        return bytes(_M), 0, 0, 0, 0
    mid = bytes(((_M[i - 1] << (8 - s)) & 0xFF) | (_M[i] >> s) for i in range(1, 6))
    return mid, _M[0] >> s, (1 << (8 - s)) - 1, (_M[5] << (8 - s)) & 0xFF, (0xFF << (8 - s)) & 0xFF


_PATTERNS = [(s, *_pattern(s)) for s in range(8)]


def find_block_start(data: bytes, from_bit: int) -> int | None:
    """Smallest bit offset >= from_bit (relative to data[0]) at which a bzip2 block magic starts, or None."""
    best: int | None = None
    for s, pat, b0, m0, b6, m6 in _PATTERNS:
        if s == 0:
            j = data.find(pat, -(-from_bit // 8))
            if j >= 0:
                best = j * 8 if best is None or j * 8 < best else best
            continue
        j = data.find(pat, max(-(-(from_bit - s) // 8), 0) + 1)
        while j >= 0:
            w = j - 1
            if w >= 0 and w + 6 < len(data) and (data[w] & m0) == b0 and (data[w + 6] & m6) == b6:
                bit = w * 8 + s
                if bit >= from_bit:
                    best = bit if best is None or bit < best else best
                    break
            j = data.find(pat, j + 1)
    return best


def find_eos_start(data: bytes) -> int:
    """Bit offset where the end-of-stream marker (48 bits) + CRC (32 bits) + 0..7 pad bits begin at the end of data."""
    tail = data[-12:]
    val = int.from_bytes(tail, "big")
    total = len(data) * 8
    for pad in range(8):
        if (val >> (32 + pad)) & ((1 << 48) - 1) == EOS:
            return total - 80 - pad
    raise RuntimeError("bzip2 end-of-stream marker not found at the end of the file")


def slice_bits(data: bytes, start_bit: int, end_bit: int) -> bytes:
    """Bits [start_bit, end_bit) of data, packed from bit 0; the last partial byte keeps its high bits, low bits zero."""
    nbits = end_bit - start_bit
    nbytes = (nbits + 7) // 8
    q, s = divmod(start_bit, 8)
    arr = np.zeros(nbytes + 1, dtype=np.uint16)
    chunk = np.frombuffer(data, dtype=np.uint8, count=min(nbytes + 1, len(data) - q), offset=q)
    arr[: len(chunk)] = chunk
    out = (((arr[:-1] << s) | (arr[1:] >> (8 - s))) & 0xFF).astype(np.uint8) if s else arr[:nbytes].astype(np.uint8)
    rem = nbits % 8
    if rem:
        out[-1] &= (0xFF << (8 - rem)) & 0xFF
    return out.tobytes()


class _Segment:
    def __init__(self, idx: int, t_start: int, t_end: int, last: bool):
        self.idx, self.t_start, self.t_end, self.last = idx, t_start, t_end, last
        self.q: queue.Queue = queue.Queue(maxsize=12)
        self.error: BaseException | None = None


class ParallelBz2Reader:
    """Sequential binary reader over the concatenated decompressed segments of one bz2 object."""

    def __init__(self, name: str, size: int, workers: int = 4, segment_mb: int = 48, limit: int | None = None, stats: StreamStats | None = None):
        self.url = name if name.startswith("http") else BASE + name
        self.full_size = size
        self.size = min(size, limit) if limit else size
        self.stats = stats or StreamStats()
        self.header = self._download(0, 4)
        if self.header[:3] != b"BZh":
            raise RuntimeError(f"{name} is not a bzip2 stream: {self.header!r}")
        seg = segment_mb * 1_000_000
        cuts = list(range(0, self.size, seg)) + [self.size]
        self.segments = [_Segment(i, cuts[i], cuts[i + 1], i == len(cuts) - 2) for i in range(len(cuts) - 1)]
        self.workers = workers
        self._next_launch = 0
        self._lock = threading.Lock()
        self._current = 0
        self._buf = bytearray()
        self.closed = False
        self._launch_more()

    # --- scheduling -----------------------------------------------------------------------------------------
    def _launch_more(self) -> None:
        with self._lock:
            while self._next_launch < len(self.segments) and self._next_launch < self._current + self.workers:
                threading.Thread(target=self._run, args=(self.segments[self._next_launch],), daemon=True).start()
                self._next_launch += 1

    def _download(self, start: int, end: int) -> bytes:
        return b"".join(open_stream(self.url, self.stats if hasattr(self, "stats") else None, start, end - 1))

    def _payload(self, seg: _Segment) -> bytes:
        tail = 0 if seg.last else WINDOW
        data = self._download(seg.t_start, min(seg.t_end + tail, self.size))
        if seg.idx == 0:
            start_bit = 0  # the original header and first block, unshifted
        else:
            start_bit = find_block_start(data, 0)
            if start_bit is None:
                raise RuntimeError(f"no bzip2 block start near byte {seg.t_start}")
        if seg.last:
            # the real file ends with a 48-bit end marker + 32-bit CRC (+ <8 pad bits): cut exactly where the marker starts
            end_bit = find_eos_start(data) if self.size == self.full_size else len(data) * 8
        else:
            end_bit = find_block_start(data, (seg.t_end - seg.t_start) * 8)
            if end_bit is None:
                raise RuntimeError(f"no bzip2 block start near byte {seg.t_end}")
        body = slice_bits(data, start_bit, end_bit)
        return body if seg.idx == 0 else self.header + body

    def _run(self, seg: _Segment) -> None:
        try:
            payload = memoryview(self._payload(seg))
            dec = bz2.BZ2Decompressor()
            total = 0
            for i in range(0, len(payload), 1 << 20):
                out = dec.decompress(payload[i : i + (1 << 20)])
                if out:
                    total += len(out)
                    seg.q.put(out)
            # The decoder can still hold the last block's output when its input runs out: flush with empty input.
            while not dec.eof:
                out = dec.decompress(b"")
                if not out:
                    break
                total += len(out)
                seg.q.put(out)
            if total == 0:
                raise RuntimeError(f"segment {seg.idx} decoded to nothing (bytes {seg.t_start}-{seg.t_end})")
        except BaseException as exc:  # noqa: BLE001 - surfaced to the reader
            seg.error = exc
        finally:
            seg.q.put(None)

    # --- file-like interface --------------------------------------------------------------------------------
    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def writable(self) -> bool:
        return False

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            return b"".join(self.chunks())
        while len(self._buf) < n and self._current < len(self.segments):
            seg = self.segments[self._current]
            item = seg.q.get()
            if item is None:
                if seg.error:
                    raise RuntimeError(f"parallel bz2 segment {seg.idx} failed: {seg.error!r}") from seg.error
                self._current += 1
                self._launch_more()
                continue
            self._buf += item
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out

    def chunks(self, n: int = 1 << 24) -> Iterator[bytes]:
        while True:
            b = self.read(n)
            if not b:
                return
            yield b

    def close(self) -> None:
        self.closed = True
        self._current = len(self.segments)
