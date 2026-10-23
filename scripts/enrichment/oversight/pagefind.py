"""Minimal reader for a static Pagefind index (the search index osc.gov publishes under /pagefind/).

osc.gov renders its whistleblower public files (/cases/) and press releases from a Pagefind index, so the complete
list is only reachable through that index's public static files:

  /pagefind/pagefind-entry.json                    -> language -> index hash
  /pagefind/pagefind.<lang>_<hash>.pf_meta         -> page list (one [fragment hash, word count] per page), filters
  /pagefind/filter/<lang>_<hash>.pf_filter         -> filter value -> page numbers
  /pagefind/fragment/<lang>_<hash>.pf_fragment     -> one page: url, content, meta, filters

Meta, filter and fragment files are gzip, then an optional 12-byte `pagefind_dcd` marker, then CBOR (meta, filter)
or JSON (fragment). Only the CBOR major types Pagefind writes are decoded; nothing is executed.
"""
import gzip
import json
import struct

MARKER = b"pagefind_dcd"


def _unwrap(raw: bytes) -> bytes:
    data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    return data[len(MARKER):] if data.startswith(MARKER) else data


def cbor_decode(data: bytes, i: int = 0):
    """Decode one CBOR item at offset i; returns (value, next offset)."""
    initial = data[i]
    major, info = initial >> 5, initial & 31
    i += 1
    if info < 24:
        arg = info
    elif info == 24:
        arg = data[i]
        i += 1
    elif info == 25:
        arg = struct.unpack(">H", data[i:i + 2])[0]
        i += 2
    elif info == 26:
        arg = struct.unpack(">I", data[i:i + 4])[0]
        i += 4
    elif info == 27:
        arg = struct.unpack(">Q", data[i:i + 8])[0]
        i += 8
    elif info == 31:
        arg = None
    else:
        raise ValueError(f"unsupported CBOR additional info {info}")
    if major == 0:
        return arg, i
    if major == 1:
        return -1 - arg, i
    if major == 2:
        return bytes(data[i:i + arg]), i + arg
    if major == 3:
        return data[i:i + arg].decode("utf-8"), i + arg
    if major == 4:
        out = []
        if arg is None:
            while data[i] != 0xFF:
                value, i = cbor_decode(data, i)
                out.append(value)
            return out, i + 1
        for _ in range(arg):
            value, i = cbor_decode(data, i)
            out.append(value)
        return out, i
    if major == 5:
        out = {}
        for _ in range(arg):
            key, i = cbor_decode(data, i)
            value, i = cbor_decode(data, i)
            out[key if not isinstance(key, list) else tuple(key)] = value
        return out, i
    if major == 6:
        return cbor_decode(data, i)
    if major == 7:
        if info == 20:
            return False, i
        if info == 21:
            return True, i
        if info == 22:
            return None, i
        return arg, i
    raise ValueError("unreachable")


def parse_meta(raw: bytes) -> dict:
    """{version, pages: [(fragment hash, word count)], filters: {name: filter file hash}}."""
    obj, _ = cbor_decode(_unwrap(raw))
    return {
        "version": obj[0],
        "pages": [(p[0], p[1]) for p in obj[1]],
        "filters": {name: file_hash for name, file_hash in obj[3]},
    }


def parse_filter(raw: bytes) -> dict:
    """{filter name, values: {value: [page numbers]}}."""
    obj, _ = cbor_decode(_unwrap(raw))
    return {"name": obj[0], "values": {value: list(pages) for value, pages in obj[1]}}


def parse_fragment(raw: bytes) -> dict:
    return json.loads(_unwrap(raw).decode("utf-8"))


def parse_entry(raw: bytes, language: str = "en") -> str:
    """Index hash (like `en_2ea6305e43`) of one language from pagefind-entry.json."""
    entry = json.loads(raw.decode("utf-8"))
    return entry["languages"][language]["hash"]


def case_page_hashes(meta: dict, content_type: dict, value: str) -> list:
    """Fragment hashes of every page carrying one content-type filter value, in page-number order."""
    return [meta["pages"][n][0] for n in sorted(content_type["values"].get(value, []))]
