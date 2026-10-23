"""The stored form of a Code unit's body: the record's `text` column holds the printed lines once (it also feeds the
corpus full-text index), in this encoding (mirrored by decodeBody in src/lib/external/usCode.functions.ts):

  lines are separated by "\\n"; each line starts with one TAB per indent level, then
    "\\x1e" + text                  a subdivision's number and heading printed on their own line
    "\\x1d" + cell "\\x1f" cell ...   a table row ("\\x1c" instead of "\\x1d" for a header row)
    text                           any other printed line
OLRC text never contains TAB, newline or these separator characters (rendering collapses whitespace), so the
encoding is lossless.
"""
HEAD, ROW, HROW, CELL = "\x1e", "\x1d", "\x1c", "\x1f"
RESERVED = ("\t", "\n", HEAD, ROW, HROW, CELL)


def encode(lines):
    out = []
    for line in lines:
        indent, content = line[0], line[1]
        kind = line[2] if len(line) > 2 else None
        if kind in ("tr", "th"):
            cells = [str(c) for c in content]
            for c in cells:
                _check(c)
            out.append("\t" * indent + (HROW if kind == "th" else ROW) + CELL.join(cells))
        else:
            _check(content)
            out.append("\t" * indent + (HEAD if kind == "h" else "") + content)
    return "\n".join(out)


def _check(text):
    if any(ch in text for ch in RESERVED):
        raise ValueError(f"reserved character in printed text: {text[:80]!r}")


def decode(text):
    lines = []
    if not text:
        return lines
    for raw in text.split("\n"):
        indent = len(raw) - len(raw.lstrip("\t"))
        body = raw[indent:]
        if body.startswith((ROW, HROW)):
            lines.append([indent, body[1:].split(CELL), "th" if body[0] == HROW else "tr"])
        elif body.startswith(HEAD):
            lines.append([indent, body[1:], "h"])
        else:
            lines.append([indent, body])
    return lines


def words(lines):
    """The printed words of decoded or rendered lines, in order (used by verify_uscode)."""
    out = []
    for line in lines:
        content = line[1]
        parts = content if isinstance(content, list) else [content]
        for p in parts:
            out.extend(p.split())
    return out
