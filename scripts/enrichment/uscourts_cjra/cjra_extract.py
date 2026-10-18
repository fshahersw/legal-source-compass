"""Read the per-judge table (CJRA Appendix A) from an official CJRA report PDF into plain lines.

Each printed table row becomes {"page", "top", "label", "nums", "markers", "bold"}:
  label   the text left of the five count columns, exactly as printed (whitespace collapsed)
  nums    the five counts as printed (thousands separators removed), in column order:
          civil cases pending > 3 years, motions pending > 6 months, bench trials submitted > 6 months,
          bankruptcy appeals pending > 6 months, Social Security appeal cases pending > 6 months
  markers endnote reference numbers printed as superscripts beside a count, as [(column index, marker)]

Rules (deterministic, no inference):
  * text drawn in white (hidden layer artifacts of the report generator) is dropped;
  * words are grouped into a printed row when their tops differ by <= 2.5 pt;
  * a superscript (endnote marker) is a numeric token of at most two digits that is set in a smaller size (< 80% of
    the row's main size) or raised >= 1.5 pt above the row's baseline, or a numeric-only row raised 2-8 pt above the
    next row; in each case it starts between 3 pt left and 6 pt right of the right edge of the preceding word (a
    count, or the judge's label when the marker follows the name; label markers are stored with column None);
  * repeated glyphs (fake bold: the same character drawn again within 0.5 pt) are reduced to one;
  * a data row has a non-empty label and exactly five trailing integer tokens.
"""
import re
from collections import Counter

NUM = re.compile(r"^\d{1,3}(?:,\d{3})*$|^\d+$")


def is_white(color, space=None):
    """True when a fill colour paints white (invisible on the page) in its colour space.

    DeviceGray 1, DeviceRGB (1,1,1) and DeviceCMYK (0,0,0,0) are white; for a Separation (spot ink) colour the
    value is a tint, so only tint 0 is white. Other spaces are judged by component count like the device spaces.
    """
    if color is None:
        return False
    if isinstance(color, (int, float)):
        color = (color,)
    try:
        values = [float(c) for c in color]
    except (TypeError, ValueError):
        return False
    space = str(space or "")
    if "Separation" in space or "DeviceN" in space:
        return all(v <= 0.01 for v in values)
    if len(values) == 1:
        return values[0] >= 0.99
    if len(values) == 3:
        return all(v >= 0.99 for v in values)
    if len(values) == 4:
        return all(v <= 0.01 for v in values)
    return False


def to_int(token):
    return int(token.replace(",", ""))


def cluster(words, tol=2.5):
    rows = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        if rows and abs(w["top"] - rows[-1]["top"]) <= tol:
            rows[-1]["words"].append(w)
        else:
            rows.append({"top": w["top"], "words": [w]})
    for r in rows:
        r["words"].sort(key=lambda w: w["x0"])
    return rows


CID = re.compile(r"\(cid:(\d+)\)")


def decode_cid(text):
    """Decode glyph ids a font printed without a Unicode map: TrueType order puts digits 0-9 at 19-28 and the space at 3.

    Only digits and spaces are decoded; any other (cid:N) stays in the text, so the row is later reported as unparsed.
    The decoding is checked by the report's own arithmetic (district-judge and district totals must add up).
    """
    def rep(m):
        n = int(m.group(1))
        if 19 <= n <= 28:
            return str(n - 19)
        if n == 3:
            return ""
        return m.group(0)

    return CID.sub(rep, text)


def has_stacked_chars(page, tol=0.5):
    """True when some glyph is drawn again within `tol` pt (fake bold)."""
    seen = {}
    for c in page.chars:
        key = (c["text"], round(c["x0"]), round(c["top"]))
        for prior in seen.get(key, ()):
            if abs(prior[0] - c["x0"]) < tol and abs(prior[1] - c["top"]) < tol:
                return True
        seen.setdefault(key, []).append((c["x0"], c["top"]))
    return False


def page_lines(page, page_no):
    # fake-bold text is drawn several times at offsets of ~0.35 pt: keep one copy of each glyph
    if has_stacked_chars(page):
        page = page.dedupe_chars(tolerance=0.5)
    visible = page.filter(lambda obj: obj.get("object_type") != "char" or not is_white(obj.get("non_stroking_color"), obj.get("ncs")))
    words = visible.extract_words(extra_attrs=["size", "fontname"], keep_blank_chars=False, x_tolerance=1.5, y_tolerance=2)
    for w in words:
        if "(cid:" in w["text"]:
            w["text"] = decode_cid(w["text"])
    words = [w for w in words if w["text"].strip()]
    rows = cluster(words)
    out = []
    pending_markers = []
    for i, row in enumerate(rows):
        ws = row["words"]
        sizes = Counter(round(w["size"], 1) for w in ws)
        main = sizes.most_common(1)[0][0]
        # raised superscript-only row (same size, separate baseline): attach to the next row
        if all(NUM.match(w["text"]) and len(w["text"]) <= 2 for w in ws) and i + 1 < len(rows):
            nxt = rows[i + 1]
            gap = nxt["top"] - row["top"]
            nums_next = [w for w in nxt["words"] if NUM.match(w["text"])]
            attached = []
            for w in ws:
                left = [n for n in nums_next if -3 <= w["x0"] - n["x1"] <= 6]
                if 2 <= gap <= 8 and left:
                    attached.append((left[0], w["text"]))
            if attached and len(attached) == len(ws):
                pending_markers.append((id(nxt), attached))
                continue
        # baseline of the row: the most common top (0.5 pt bins); a raised token sits >= 1.5 pt above it
        base_top = Counter(round(w["top"] * 2) / 2 for w in ws).most_common(1)[0][0]
        markers = []
        body = []
        for w in ws:
            raised = w["size"] < 0.8 * main or w["top"] <= base_top - 1.5
            if NUM.match(w["text"]) and len(w["text"]) <= 2 and raised and body and -3 <= w["x0"] - body[-1]["x1"] <= 6:
                markers.append((body[-1], w["text"]))
                continue
            body.append(w)
        for rid, attached in pending_markers:
            if rid == id(row):
                markers.extend(attached)
        tail = []
        for w in reversed(body):
            if NUM.match(w["text"]):
                tail.append(w)
            else:
                break
        tail.reverse()
        label_words = body[: len(body) - len(tail)]
        label = re.sub(r"\s+", " ", " ".join(w["text"] for w in label_words)).strip()
        bold = sum("Bold" in (w.get("fontname") or "") for w in body) * 2 > len(body)
        line = {"page": page_no, "top": round(row["top"], 1), "label": label, "nums": [to_int(w["text"]) for w in tail], "bold": bold, "markers": []}
        for anchor, marker in markers:
            col = next((k for k, w in enumerate(tail) if w is anchor), None)
            line["markers"].append([col, int(marker)])
        out.append(line)
    return out


def pdf_lines(path):
    import pdfplumber

    lines = []
    with pdfplumber.open(path) as pdf:
        for n, page in enumerate(pdf.pages, 1):
            lines.extend(page_lines(page, n))
    return lines


if __name__ == "__main__":
    import json
    import sys

    for line in pdf_lines(sys.argv[1]):
        if len(sys.argv) > 2 and str(line["page"]) not in sys.argv[2].split(","):
            continue
        print(json.dumps(line))
