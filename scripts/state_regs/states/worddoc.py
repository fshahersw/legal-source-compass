"""Text of Word 97-2003 binary documents (.doc), standard library only, plus a LibreOffice rendering for checks.

doc_text(): reads the OLE compound file (FAT, mini FAT, directory), then the WordDocument stream's FIB and the piece table
(CLX) from the 0Table/1Table stream, and decodes each piece (cp1252 for compressed pieces, UTF-16LE otherwise). Field
instructions (between 0x13 and 0x14) are dropped and field results kept; paragraph marks (\\r), cell/row marks (\\x07) and
line breaks (\\x0b) become line breaks; other control characters are dropped.

libreoffice_text(): the same file converted by LibreOffice (soffice --headless --convert-to txt), an independent rendering
used only for the exact-text check.
"""
from __future__ import annotations

import os
import shutil
import struct
import subprocess
import tempfile

FREESECT, ENDOFCHAIN = 0xFFFFFFFF, 0xFFFFFFFE


class OleFile:
    def __init__(self, data: bytes):
        if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise ValueError("not an OLE compound file")
        self.data = data
        self.sec = 1 << struct.unpack_from("<H", data, 0x1E)[0]
        self.mini = 1 << struct.unpack_from("<H", data, 0x20)[0]
        n_fat = struct.unpack_from("<I", data, 0x2C)[0]
        dir_start = struct.unpack_from("<I", data, 0x30)[0]
        self.cutoff = struct.unpack_from("<I", data, 0x38)[0]
        minifat_start = struct.unpack_from("<I", data, 0x3C)[0]
        difat_start = struct.unpack_from("<I", data, 0x44)[0]
        n_difat = struct.unpack_from("<I", data, 0x48)[0]
        difat = list(struct.unpack_from("<109I", data, 0x4C))
        s = difat_start
        for _ in range(n_difat):
            if s in (FREESECT, ENDOFCHAIN):
                break
            vals = struct.unpack_from(f"<{self.sec // 4}I", self._sector(s))
            difat.extend(vals[:-1])
            s = vals[-1]
        fat_sectors = [x for x in difat if x not in (FREESECT, ENDOFCHAIN)][:n_fat]
        self.fat: list[int] = []
        for fs in fat_sectors:
            self.fat.extend(struct.unpack_from(f"<{self.sec // 4}I", self._sector(fs)))
        dir_bytes = self._chain(dir_start)
        self.entries = {}
        root = None
        for i in range(len(dir_bytes) // 128):
            e = dir_bytes[i * 128:(i + 1) * 128]
            name_len = struct.unpack_from("<H", e, 64)[0]
            name = e[:max(0, name_len - 2)].decode("utf-16-le", "replace")
            etype = e[66]
            start = struct.unpack_from("<I", e, 0x74)[0]
            size = struct.unpack_from("<Q", e, 0x78)[0]
            if etype == 5:
                root = (start, size)
            elif etype == 2:
                self.entries[name] = (start, size)
        self.minifat: list[int] = []
        if minifat_start not in (FREESECT, ENDOFCHAIN):
            mf = self._chain(minifat_start)
            self.minifat = list(struct.unpack_from(f"<{len(mf) // 4}I", mf))
        self.ministream = self._chain(root[0])[:root[1]] if root else b""

    def _sector(self, n: int) -> bytes:
        off = (n + 1) * self.sec
        return self.data[off:off + self.sec]

    def _chain(self, start: int) -> bytes:
        out = bytearray()
        s, seen = start, 0
        while s not in (FREESECT, ENDOFCHAIN) and s < len(self.fat) and seen <= len(self.fat):
            out += self._sector(s)
            s = self.fat[s]
            seen += 1
        return bytes(out)

    def stream(self, name: str) -> bytes:
        start, size = self.entries[name]
        if size < self.cutoff:
            out = bytearray()
            s, seen = start, 0
            while s not in (FREESECT, ENDOFCHAIN) and s < len(self.minifat) and seen <= len(self.minifat):
                out += self.ministream[s * self.mini:(s + 1) * self.mini]
                s = self.minifat[s]
                seen += 1
            return bytes(out[:size])
        return self._chain(start)[:size]


CP1252_SPECIAL = {0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ",
                  0x89: "‰", 0x8A: "Š", 0x8B: "‹", 0x8C: "Œ", 0x91: "‘", 0x92: "’", 0x93: "“",
                  0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9A: "š",
                  0x9B: "›", 0x9C: "œ", 0x9F: "Ÿ"}


def _compressed(b: bytes) -> str:
    return "".join(CP1252_SPECIAL.get(c, chr(c)) for c in b)


def doc_text(data: bytes) -> str:
    ole = OleFile(data)
    wd = ole.stream("WordDocument")
    if struct.unpack_from("<H", wd, 0)[0] != 0xA5EC:
        raise ValueError("not a Word 97-2003 document")
    flags = struct.unpack_from("<H", wd, 0x0A)[0]
    table = ole.stream("1Table" if flags & 0x0200 else "0Table")
    fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    i = 0
    while i < len(clx) and clx[i] == 0x01:  # Prc entries
        i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
    if i >= len(clx) or clx[i] != 0x02:
        raise ValueError("no piece table")
    lcb = struct.unpack_from("<I", clx, i + 1)[0]
    plc = clx[i + 5:i + 5 + lcb]
    n = (lcb - 4) // 12
    cps = struct.unpack_from(f"<{n + 1}I", plc, 0)
    raw = []
    for k in range(n):
        pcd = plc[(n + 1) * 4 + k * 8:(n + 1) * 4 + (k + 1) * 8]
        fc = struct.unpack_from("<I", pcd, 2)[0]
        count = cps[k + 1] - cps[k]
        if fc & 0x40000000:
            off = (fc & 0x3FFFFFFF) // 2
            raw.append(_compressed(wd[off:off + count]))
        else:
            raw.append(wd[fc:fc + 2 * count].decode("utf-16-le", "replace"))
    return clean_controls("".join(raw))


def clean_controls(s: str) -> str:
    out = []
    depth = 0
    skipping = []
    for ch in s:
        o = ord(ch)
        if o == 0x13:
            depth += 1
            skipping.append(True)
            continue
        if o == 0x14:
            if skipping:
                skipping[-1] = False
            continue
        if o == 0x15:
            if skipping:
                skipping.pop()
            depth = max(0, depth - 1)
            continue
        if any(skipping):
            continue
        if ch in "\r\x07\x0b\x0c":
            out.append("\n")
        elif ch == "\t":
            out.append(" ")
        elif o < 0x20 and ch != "\n":
            continue
        elif ch == " ":
            out.append(" ")
        else:
            out.append(ch)
    lines = [" ".join(x.split()) for x in "".join(out).split("\n")]
    return "\n".join(x for x in lines if x)


def libreoffice_text(data: bytes) -> str:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise RuntimeError("LibreOffice is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.doc")
        with open(src, "wb") as h:
            h.write(data)
        prof = os.path.join(tmp, "profile")
        subprocess.run([exe, f"-env:UserInstallation=file://{prof}", "--headless", "--convert-to", "txt:Text (encoded):UTF8",
                        "--outdir", tmp, src], capture_output=True, timeout=180, check=True)
        with open(os.path.join(tmp, "in.txt"), encoding="utf-8-sig", errors="replace") as h:
            return h.read()
