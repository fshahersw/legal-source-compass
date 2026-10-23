"""Parsers for the DOJ Office of the Inspector General report listing and report pages (oig.justice.gov/reports).

The listing gives date, title, type, component(s) and location per report; each report page adds the report number,
external entity, number of recommendations, any monetary-impact fields the OIG states, and the PDF link.
All values are returned as written (whitespace collapsed only); a field the page does not show is None.
"""
import html
import re
from datetime import datetime

BASE = "https://oig.justice.gov"
_ROW = re.compile(r'<div class="views-row">(.*?)(?=<div class="views-row">|</div>\s*</div>\s*<nav|\Z)', re.S)
_WS = re.compile(r"\s+")


def clean(fragment):
    """Strip tags, unescape entities, collapse whitespace; '' when nothing is left."""
    if fragment is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", fragment)
    return _WS.sub(" ", html.unescape(text)).strip()


def iso_date(text):
    """MM/DD/YYYY or 'Month D, YYYY' -> YYYY-MM-DD, else None."""
    if not text:
        return None
    for fmt in ("%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_listing(page_html):
    """Rows of one listing page: [{path, title, date, type, components, location}]."""
    rows = []
    for block in _ROW.findall(page_html):
        link = re.search(r'views-field-title">.*?<a href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not link:
            continue
        stamp = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})', block)
        kind = re.search(r"<span>Type: </span><span>(.*?)</span>", block, re.S)
        components = []
        start = block.find("views-field-field-doj-component")
        if start >= 0:
            stop = block.find("views-field-field-location", start)
            segment = block[start: stop if stop > 0 else len(block)]
            components = [v for v in (clean(x) for x in re.findall(r'<span class="field-content">(.*?)</span>', segment, re.S)) if v]
        location = re.search(r'views-field-field-location">.*?<span class="field-content">(.*?)</span>', block, re.S)
        rows.append({
            "path": link.group(1),
            "title": clean(link.group(2)),
            "date": stamp.group(1) if stamp else None,
            "type": clean(kind.group(1)) if kind else None,
            "components": components,
            "location": clean(location.group(1)) if location else None,
        })
    return rows


_LABELS = {
    "Posted Date": "posted",
    "Report Number": "number",
    "Component": "component",
    "Components": "component",
    "External Entity": "entity",
    "Location": "location",
    "Report Type": "type",
    "Number of Recommendations": "recs",
    "Questioned Costs": "questioned_costs",
    "Funds Put to Better Use": "funds_better_use",
    "Funds for Better Use": "funds_better_use",
    "Dollar-Related Findings": "dollar_findings",
    "Monetary Impact": "monetary",
    # the Spanish-language pages of the semiannual reports
    "Fecha de publicación": "posted",
    "Número de informe": "number",
    "Componente": "component",
    "Tipo de informe": "type",
    "Número de recomendaciones": "recs",
    "Costos cuestionados": "questioned_costs",
}


_LABEL = re.compile(r'<div class="field__label[^"]*">(.*?)</div>', re.S)
_ITEM = re.compile(r'<div([^>]*)class="[^"]*field__item[^"]*"([^>]*)>(.*?)</div>', re.S)


def parse_money(text, content=None):
    """Dollars as stated: the machine value the page carries (content="4577633") when present, else '$4,577,633'."""
    if content is not None and re.fullmatch(r"\d+(?:\.\d+)?", content):
        return float(content)
    m = re.fullmatch(r"\$\s*([\d,]+(?:\.\d+)?)", (text or "").strip())
    return float(m.group(1).replace(",", "")) if m else None


def parse_report(page_html):
    """Label/value rows of the report-detail article plus the PDF link; unknown labels are kept under 'other'.

    Two page templates exist (newer pages use grid rows, older ones doj-field-container); both put a
    `field__label` before its `field__item` values. A label with several values (several components) keeps all of
    them, in page order. 'money' maps the money labels to {text, value} exactly as the page states them."""
    start = page_html.find("report-detail-full")
    if start < 0:
        return None
    end = page_html.find("</article>", start)
    block = page_html[start: end if end > 0 else start + 30000]
    labels = list(_LABEL.finditer(block))
    out = {"other": {}, "money": {}}
    for n, m in enumerate(labels):
        label = clean(m.group(1))
        stop = labels[n + 1].start() if n + 1 < len(labels) else len(block)
        values, contents = [], []
        for before, after, inner in _ITEM.findall(block[m.end(): stop]):
            value = clean(inner)
            if value:
                values.append(value)
                c = re.search(r'content="([^"]*)"', before + after)
                contents.append(c.group(1) if c else None)
        key = _LABELS.get(label)
        if key in ("questioned_costs", "funds_better_use", "dollar_findings", "monetary"):
            if values:
                out["money"][key] = {"text": values[0], "value": parse_money(values[0], contents[0])}
        elif key:
            out.setdefault(key, values or None)
        elif label:
            out["other"][label] = values or None
    pdf = re.search(r'href="(/sites/default/files/reports/[^"]+\.pdf)"', page_html)
    out["pdf"] = BASE + pdf.group(1) if pdf else None
    return out
