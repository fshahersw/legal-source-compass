"""Read the per-judge table (CJRA Appendix A) from an official CJRA report PDF into printed rows.

Each printed table row becomes
  {"page", "top", "label", "cols", "nums", "markers", "stray", "shifted", "bold"}
  label    the text left of the five count columns, exactly as printed (whitespace collapsed)
  cols     five entries, one per printed count column in column order (civil cases pending > 3 years, motions pending
           > 6 months, bench trials submitted > 6 months, bankruptcy appeals pending > 6 months, Social Security appeal
           cases pending > 6 months); an integer as printed (thousands separators removed) or None when the printed row
           has no number for that column
  nums     the integers of `cols` that are present, left to right (kept for readers that expect a list)
  markers  endnote reference numbers printed as superscripts beside a count, as [[column index, marker]]
  stray    numeric tokens of the row that are neither a count nor a marker (reported, never used)
  shifted  True when the row's five counts were read in printed order but sit away from the page's column edges

How a row is read (deterministic, no inference):
  * text drawn in white (hidden layer artifacts of the report generator) is dropped; repeated glyphs (fake bold: the same
    character drawn again within 0.5 pt) are reduced to one; glyph ids a font printed without a Unicode map are decoded
    only for digits and spaces;
  * a superscript endnote marker is a numeric token of at most two digits that starts within -3 to +6 pt of the right edge
    of another numeric token on (nearly) the same line; the real count columns are 40 pt or more apart, so no count can
    be mistaken for one. A marker is attached to the count it follows and is removed from the row;
  * words are grouped into a printed row when their tops differ by <= 2.5 pt;
  * the trailing run of numeric tokens of a row holds its counts; everything before the run is the label. A run of
    exactly five is read in printed order (this also reads the pages whose five columns are printed one column
    to the left of the headings); a shorter run is placed by the page's column edges (right edge of each column, read per
    page from the numeric tokens: x1 values clustered at 2 pt, clusters with fewer than 3 words or fewer than a quarter of
    the largest dropped, clusters within 14 pt of a larger one dropped, exactly five required, otherwise the median edges
    of the pages of that size in the same PDF); tokens that fit no column are reported as stray; a longer run keeps its
    last five as counts and the leading extras stay in the label.
"""
import re
import statistics

NUM = re.compile(r"^\d{1,3}(?:,\d{3})*$|^\d+$")
CID = re.compile(r"\(cid:(\d+)\)")
EDGE_TOL = 2.5
LINE_TOL = 2.5
MARKER_GAP = (-3.0, 6.0)  # marker x0 minus the x1 of the count it follows
MARKER_DY = 4.0


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


def page_words(page):
    """Visible words of a page (white text dropped, fake bold reduced to one copy, digit glyph ids decoded)."""
    if has_stacked_chars(page):
        page = page.dedupe_chars(tolerance=0.5)
    visible = page.filter(lambda obj: obj.get("object_type") != "char" or not is_white(obj.get("non_stroking_color"), obj.get("ncs")))
    words = visible.extract_words(extra_attrs=["size", "fontname"], keep_blank_chars=False, x_tolerance=1.5, y_tolerance=2)
    for w in words:
        if "(cid:" in w["text"]:
            w["text"] = decode_cid(w["text"])
    return [w for w in words if w["text"].strip()]


def edge_candidates(words):
    """Column right edges from the numeric tokens of one page: a list of exactly five x1 values, or None."""
    xs = sorted(w["x1"] for w in words if NUM.match(w["text"]))
    if len(xs) < 10:
        return None
    groups = [[xs[0]]]
    for x in xs[1:]:
        if x - groups[-1][-1] <= 2.0:
            groups[-1].append(x)
        else:
            groups.append([x])
    clusters = [(statistics.median(g), len(g)) for g in groups]
    top = max(n for _, n in clusters)
    kept = [(e, n) for e, n in clusters if n >= max(3, top * 0.25)]
    kept = [(e, n) for e, n in kept if not any(abs(e - e2) <= 14 and n2 > n for e2, n2 in kept)]
    if len(kept) > 5:
        kept = sorted(sorted(kept, key=lambda t: -t[1])[:5])
    edges = sorted(e for e, _ in kept)
    return edges if len(edges) == 5 else None


def split_markers(words):
    """(words without markers, {id(host word): [marker ints]}): a numeric token of at most two digits that starts within
    MARKER_GAP of the right edge of another numeric token on (nearly) the same line is that token's endnote marker."""
    nums = [w for w in words if NUM.match(w["text"])]
    marker_of = {}
    for t in nums:
        if len(t["text"]) > 2:
            continue
        hosts = [p for p in nums if p is not t and MARKER_GAP[0] <= t["x0"] - p["x1"] <= MARKER_GAP[1] and abs(t["top"] - p["top"]) <= MARKER_DY and t["x0"] > p["x0"]]
        if hosts:
            marker_of[id(t)] = min(hosts, key=lambda p: abs(t["x0"] - p["x1"]))
    # a host that is itself a marker is not a host (two markers in a row attach to the count before them)
    for tid, host in list(marker_of.items()):
        while id(host) in marker_of:
            host = marker_of[id(host)]
        marker_of[tid] = host
    hosted = {}
    for t in nums:
        if id(t) in marker_of:
            hosted.setdefault(id(marker_of[id(t)]), []).append(int(t["text"]))
    return [w for w in words if id(w) not in marker_of], hosted


def assemble(words, edges, page_no):
    """Printed rows of one page."""
    body, hosted = split_markers(words)
    bands = []
    for w in sorted(body, key=lambda w: (round(w["top"], 1), w["x0"])):
        if bands and abs(w["top"] - bands[-1]["top"]) <= LINE_TOL:
            bands[-1]["words"].append(w)
        else:
            bands.append({"top": w["top"], "words": [w]})
    out = []
    for band in bands:
        ws = sorted(band["words"], key=lambda w: w["x0"])
        k = len(ws)
        while k > 0 and NUM.match(ws[k - 1]["text"]):
            k -= 1
        label_words, run = ws[:k], ws[k:]
        cols, stray, markers, shifted = [None] * 5, [], [], False
        if len(run) >= 5:
            label_words = label_words + run[:-5]
            run = run[-5:]
            for c, w in enumerate(run):
                cols[c] = to_int(w["text"])
            shifted = any(abs(w["x1"] - edges[c]) > EDGE_TOL for c, w in enumerate(run)) if edges else False
            host_cols = {id(w): c for c, w in enumerate(run)}
        else:
            host_cols = {}
            for w in run:
                hit = [c for c, e in enumerate(edges or []) if abs(w["x1"] - e) <= EDGE_TOL and cols[c] is None]
                if hit:
                    c = min(hit, key=lambda c: abs(w["x1"] - edges[c]))
                    cols[c] = to_int(w["text"])
                    host_cols[id(w)] = c
                else:
                    stray.append(w["text"])
        for w in run:
            for m in hosted.get(id(w), []):
                if id(w) in host_cols:
                    markers.append([host_cols[id(w)], m])
        label = re.sub(r"\s+", " ", " ".join(w["text"] for w in label_words)).strip()
        bold = bool(label_words) and sum("Bold" in (w.get("fontname") or "") for w in label_words) * 2 > len(label_words)
        out.append({"page": page_no, "top": round(band["top"], 1), "label": label, "cols": cols, "nums": [v for v in cols if v is not None],
                    "markers": sorted(markers), "stray": stray, "shifted": shifted, "bold": bold})
    return out


def pdf_rows(path, progress=None):
    """All printed rows of a CJRA PDF, page by page. Returns (rows, geometry) where geometry[page] describes the edges used."""
    import pdfplumber

    pages = []
    with pdfplumber.open(path) as pdf:
        for n, page in enumerate(pdf.pages, 1):
            words = page_words(page)
            pages.append((n, (round(page.width), round(page.height)), words, edge_candidates(words)))
            if progress:
                progress(n)
    by_size = {}
    for _, size, _, edges in pages:
        if edges:
            by_size.setdefault(size, []).append(edges)
    fallback = {size: [statistics.median(e[i] for e in lst) for i in range(5)] for size, lst in by_size.items()}
    rows, geometry = [], {}
    for n, size, words, edges in pages:
        used, source = (edges, "page") if edges else (fallback.get(size), "pdf_median")
        geometry[n] = {"edges": [round(e, 1) for e in used] if used else None, "source": source if used else "none"}
        rows.extend(assemble(words, used, n))
    return rows, geometry


if __name__ == "__main__":
    import json
    import sys

    rows, geometry = pdf_rows(sys.argv[1])
    for line in rows:
        if len(sys.argv) > 2 and str(line["page"]) not in sys.argv[2].split(","):
            continue
        print(json.dumps(line))
