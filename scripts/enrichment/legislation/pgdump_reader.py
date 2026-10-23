"""Read a PostgreSQL custom-format archive (pg_dump -Fc, archive versions 1.12-1.16) without restoring it.

Used for the Open States public data dump, which is too large to keep on disk (about 10.8 GB): the table of contents is
read from the first bytes of the file, and each needed table's COPY data block is then streamed with an HTTP Range request
from its recorded offset, decompressed chunk by chunk (zlib, as written by pg_dump's gzip compressor) and split into rows.
Nothing is restored into a database and the archive is never stored whole.

Format reference: PostgreSQL src/bin/pg_dump/pg_backup_archiver.c (ReadHead, ReadToc, ReadInt, ReadStr, ReadOffset) and
pg_backup_custom.c (data blocks: type byte, dump id, then length-prefixed compressed chunks ending with a zero length).
"""
from __future__ import annotations

import io
import zlib
from dataclasses import dataclass, field

K_OFFSET_POS_NOT_SET, K_OFFSET_POS_SET, K_OFFSET_NO_DATA = 1, 2, 3
BLK_DATA = 1


@dataclass
class TocEntry:
    dump_id: int
    tag: str | None
    desc: str | None
    namespace: str | None
    copy_stmt: str | None
    offset_flag: int
    offset: int
    deps: list[str] = field(default_factory=list)


@dataclass
class Archive:
    version: tuple[int, int, int]
    int_size: int
    off_size: int
    compression: int
    dbname: str | None
    server_version: str | None
    dump_version: str | None
    toc: list[TocEntry]
    toc_end: int


class _Reader:
    def __init__(self, data: bytes):
        self.f = io.BytesIO(data)
        self.int_size = 4
        self.off_size = 8
        self.version = (1, 0, 0)

    def byte(self) -> int:
        b = self.f.read(1)
        if not b:
            raise EOFError("archive header truncated")
        return b[0]

    def read(self, n: int) -> bytes:
        b = self.f.read(n)
        if len(b) != n:
            raise EOFError("archive header truncated")
        return b

    def int_(self) -> int:
        sign = self.byte() if self.version > (1, 0, 0) else 0
        val = 0
        for i in range(self.int_size):
            val |= self.byte() << (8 * i)
        return -val if sign else val

    def str_(self) -> str | None:
        n = self.int_()
        if n < 0:
            return None
        return self.read(n).decode("utf-8", "replace")

    def offset(self) -> tuple[int, int]:
        flag = self.byte()
        val = 0
        for i in range(self.off_size):
            val |= self.byte() << (8 * i)
        return flag, val


def read_toc(head: bytes) -> Archive:
    """Parse the archive header and table of contents from the first bytes of the file."""
    r = _Reader(head)
    if r.read(5) != b"PGDMP":
        raise ValueError("not a PostgreSQL custom-format archive")
    vmaj, vmin = r.byte(), r.byte()
    vrev = r.byte() if (vmaj > 1 or vmin > 0) else 0
    r.version = (vmaj, vmin, vrev)
    if r.version < (1, 12, 0) or r.version > (1, 16, 99):
        raise ValueError(f"unsupported archive version {vmaj}.{vmin}")
    r.int_size, r.off_size = r.byte(), r.byte()
    fmt = r.byte()
    if fmt != 1:
        raise ValueError("only the custom format is supported")
    if r.version >= (1, 15, 0):
        compression = r.byte()
    else:
        compression = 1 if r.int_() != 0 else 0
    for _ in range(7):  # creation time (tm_sec ... tm_isdst)
        r.int_()
    dbname = r.str_()
    server_version = r.str_()
    dump_version = r.str_()
    count = r.int_()
    toc = []
    for _ in range(count):
        dump_id = r.int_()
        r.int_()  # hadDumper
        r.str_()  # tableoid
        r.str_()  # oid
        tag = r.str_()
        desc = r.str_()
        r.int_()  # section
        r.str_()  # defn
        r.str_()  # dropStmt
        copy_stmt = r.str_()
        namespace = r.str_()
        r.str_()  # tablespace
        if r.version >= (1, 14, 0):
            r.str_()  # tableam
        if r.version >= (1, 16, 0):
            r.int_()  # relkind
        r.str_()  # owner
        r.str_()  # withOids ("false")
        deps = []
        while True:
            d = r.str_()
            if d is None:
                break
            deps.append(d)
        flag, off = r.offset()
        toc.append(TocEntry(dump_id, tag, desc, namespace, copy_stmt, flag, off, deps))
    return Archive(r.version, r.int_size, r.off_size, compression, dbname, server_version, dump_version, toc, r.f.tell())


def copy_columns(copy_stmt: str | None) -> list[str]:
    """Column names from 'COPY schema.table (a, b, c) FROM stdin;'."""
    if not copy_stmt or "(" not in copy_stmt:
        return []
    inner = copy_stmt[copy_stmt.index("(") + 1: copy_stmt.rindex(")")]
    return [c.strip().strip('"') for c in inner.split(",")]


_ESC = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}


def unescape_copy(field_: str) -> str | None:
    """One COPY text-format field: \\N is NULL; backslash escapes as documented for COPY."""
    if field_ == "\\N":
        return None
    if "\\" not in field_:
        return field_
    out = []
    i = 0
    n = len(field_)
    while i < n:
        c = field_[i]
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        nxt = field_[i + 1]
        if nxt in _ESC:
            out.append(_ESC[nxt])
            i += 2
        elif nxt in "01234567":
            j = i + 1
            while j < n and j < i + 4 and field_[j] in "01234567":
                j += 1
            out.append(chr(int(field_[i + 1:j], 8)))
            i = j
        elif nxt == "x" and i + 2 < n and field_[i + 2] in "0123456789abcdefABCDEF":
            j = i + 2
            while j < n and j < i + 4 and field_[j] in "0123456789abcdefABCDEF":
                j += 1
            out.append(chr(int(field_[i + 2:j], 16)))
            i = j
        else:
            out.append(nxt)
            i += 2
    return "".join(out)


class BlockStream:
    """Incrementally decode one table's data block from a byte iterator positioned at the block start."""

    def __init__(self, chunks, int_size: int = 4, compression: int = 1):
        self.it = iter(chunks)
        self.buf = bytearray()
        self.int_size = int_size
        self.compression = compression
        self.raw_bytes = 0

    def _need(self, n: int) -> bytes:
        while len(self.buf) < n:
            try:
                piece = next(self.it)
            except StopIteration:
                raise EOFError("data block truncated") from None
            self.raw_bytes += len(piece)
            self.buf.extend(piece)
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def _int(self) -> int:
        b = self._need(1 + self.int_size)
        val = int.from_bytes(b[1:], "little")
        return -val if b[0] else val

    def skip(self, expect_id: int) -> int:
        """Read past the block for dump id `expect_id` without decompressing it; returns its compressed size."""
        btype = self._need(1)[0]
        if btype != BLK_DATA:
            raise ValueError(f"unexpected block type {btype}")
        bid = self._int()
        if bid != expect_id:
            raise ValueError(f"block for dump id {bid}, expected {expect_id}")
        total = 0
        while True:
            n = self._int()
            if n == 0:
                return total
            total += n
            while n > 0:
                if not self.buf:
                    try:
                        piece = next(self.it)
                    except StopIteration:
                        raise EOFError("data block truncated") from None
                    self.raw_bytes += len(piece)
                    self.buf.extend(piece)
                take = min(n, len(self.buf))
                del self.buf[:take]
                n -= take

    def lines(self, expect_id: int):
        """Yield decoded COPY lines (str, without the trailing newline) of the block for dump id `expect_id`."""
        btype = self._need(1)[0]
        if btype != BLK_DATA:
            raise ValueError(f"unexpected block type {btype}")
        bid = self._int()
        if bid != expect_id:
            raise ValueError(f"block for dump id {bid}, expected {expect_id}")
        dec = zlib.decompressobj() if self.compression == 1 else None
        if self.compression not in (0, 1):
            raise ValueError(f"unsupported compression algorithm {self.compression}")
        pending = b""
        while True:
            n = self._int()
            if n == 0:
                break
            chunk = self._need(n)
            data = dec.decompress(chunk) if dec else chunk
            pending += data
            *full, pending = pending.split(b"\n")
            for line in full:
                if line == b"\\.":
                    continue
                yield line.decode("utf-8", "replace")
        if dec:
            tail = dec.flush()
            pending += tail
        for line in pending.split(b"\n"):
            if line and line != b"\\.":
                yield line.decode("utf-8", "replace")


def rows(lines, columns: list[str]):
    """COPY text lines -> dicts keyed by column name (values unescaped; NULL is None)."""
    for line in lines:
        if line == "" and len(columns) > 1:  # the blank line pg_dump writes after the end-of-data marker
            continue
        parts = line.split("\t")
        if len(parts) != len(columns):
            raise ValueError(f"row has {len(parts)} fields, expected {len(columns)}")
        yield {c: unescape_copy(p) for c, p in zip(columns, parts)}
