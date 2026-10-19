"""Parse the North Dakota Century Code from ndlegis.gov: the contents page and the chapter PDFs.

Contents (general-information/north-dakota-century-code/index.html): <h2>Title 12.1 - Criminal Code</h2>, then per
chapter <h3>Chapter 12.1-16 - Homicide</h3> and a table of sections (link text = section number, second cell =
section name), each linking to /cencode/t12-1c16.pdf#nameddest=...
Chapter PDF: text extracted with poppler's `pdftotext -layout` (keeps hanging-indent enumerations in reading
order); each section starts on a line "<number>. <catchline>." in contents order; "Page No. N" footers are dropped.
The section text keeps the printed line breaks of the PDF (as the Indiana code dataset does), with leading
indentation and runs of spaces collapsed; no words are added or rejoined.
Approach informed by open-us-law scripts/state_scrapers/.../nd/statutes/scrapeND.py (Apache-2.0, Vaquill AI),
which also reads section names from the contents and text from the chapter PDFs.
"""
import os
import re
import subprocess
import tempfile

import lxml.html

WS = re.compile(r"[ \t    ]+")
FOOTER = re.compile(r"^Page No\. \d+$")
STATUS = re.compile(r"^(Repealed|Expired|Superseded|Transferred|Reserved|Renumbered|Omitted)\b", re.I)
TOKEN = re.compile(r"[0-9A-Za-z]+")


def clean(text):
    return WS.sub(" ", (text or "").replace("‑", "-")).strip()


def tokens(text):
    return [t.lower() for t in TOKEN.findall((text or "").replace("‑", "-"))]


def parse_index(html):
    """[{number, caption, chapters: [{number, caption, pdf, sections: [(number, name)]}]}] in publisher order."""
    tree = lxml.html.fromstring(html)
    titles = []
    for outer in tree.xpath("//details[summary[contains(@class,'outer')]]"):
        h2 = outer.xpath("./summary//h2")
        m = re.match(r"^Title (\S+) - (.+)$", clean(h2[0].text_content())) if h2 else None
        if not m:
            continue
        title = {"number": m.group(1), "caption": m.group(2), "chapters": []}
        for inner in outer.xpath("./details[summary[contains(@class,'inner')]]"):
            h3 = inner.xpath("./summary//h3")
            cm = re.match(r"^Chapter (\S+) - (.+)$", clean(h3[0].text_content())) if h3 else None
            if not cm:
                continue
            sections, pdf = [], None
            for tr in inner.xpath(".//table//tr[td]"):
                tds = tr.findall("td")
                link = tds[0].find(".//a")
                if link is None or len(tds) < 2:
                    continue
                href = link.get("href", "")
                pdf = pdf or href.split("#", 1)[0]
                sections.append((clean(link.text_content()), clean(tds[1].text_content())))
            title["chapters"].append({"number": cm.group(1), "caption": cm.group(2), "pdf": pdf, "sections": sections})
        titles.append(title)
    return titles


def pdf_lines(pdf_bytes, scratch_dir, with_created=False):
    """Printed lines of a chapter PDF (pdftotext -layout), footers and blank lines removed; optionally also the
    PDF's own CreationDate (pdfinfo) as YYYY-MM-DD, or None when it does not record one."""
    os.makedirs(scratch_dir, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".pdf", dir=scratch_dir, delete=False) as handle:
        handle.write(pdf_bytes)
        path = handle.name
    try:
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], check=True, capture_output=True, timeout=120).stdout
        created = None
        if with_created:
            info = subprocess.run(["pdfinfo", "-isodates", path], check=True, capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
            m = re.search(r"^CreationDate:\s+(\d{4}-\d{2}-\d{2})", info, re.M)
            created = m.group(1) if m else None
    finally:
        os.unlink(path)
    lines = []
    for raw in out.decode("utf-8").replace("\f", "\n").split("\n"):
        line = clean(raw)
        if line and not FOOTER.match(line):
            lines.append(line)
    return (lines, created) if with_created else lines


def split_sections(lines, expected):
    """Cut the chapter's lines into the expected sections, in contents order.

    expected: [(number, name)] from the contents. Returns ({number_or_number@k: section}, errors). A section's
    heading is its first line plus continuation lines until the contents name is covered; the heading must
    start with "<number>." and its words must begin with the contents name's words, otherwise it is an error.
    """
    starts = []
    cursor = 0
    errors = []
    for number, name in expected:
        found = None
        for i in range(cursor, len(lines)):
            if lines[i].startswith(f"{number}.") or lines[i] == number:
                found = i
                break
        if found is None:
            errors.append({"number": number, "error": "heading not found in chapter PDF"})
            continue
        starts.append((found, number, name))
        cursor = found + 1
    out = {}
    for k, (start, number, name) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        block = lines[start:end]
        want = tokens(name)
        head = [block[0]]
        j = 1
        while len(tokens(" ".join(head))) - len(tokens(number)) < len(want) and j < len(block):
            head.append(block[j])
            j += 1
        heading_line = " ".join(head)
        while heading_line.startswith(f"{number}. {number}."):
            heading_line = heading_line[len(number) + 2:]  # a number printed twice is one heading
        got = tokens(heading_line)[len(tokens(number)):]
        if got[: len(want)] != want:
            errors.append({"number": number, "error": "heading words differ from contents name", "pdf": heading_line[:160], "contents": name})
            continue
        key = number if number not in out else f"{number}@{sum(1 for x in out if x.split('@')[0] == number) + 1}"
        heading = heading_line[len(number):].lstrip(". ").strip()
        status = STATUS.match(heading)
        out[key] = {"number": number, "heading": heading, "lines": block[j:], "contents_name": name,
                    "status": status.group(1).capitalize() if status else None}
    return out, errors
