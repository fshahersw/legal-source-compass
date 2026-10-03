"""Reads the first pages of court PDFs and extracts what the court itself printed on them: the ECF stamp ("Case <docket> Document <n> Filed <date> Page x of y")
and the first heading lines. Deterministic; no network. Usage: pdf-peek.py <dir with <sha256>.pdf files> <out.jsonl> [<sha256> ...]
Output: one JSON line per PDF: sha256, pages, has_text, stamp {case, document_number, attachment, filed_raw, filed_iso, page, of, raw}, metadata, first_lines.
"""
import sys, os, re, json, hashlib
import fitz  # PyMuPDF

DASHES = re.compile("[‐-―−]")
CASE_LITERAL = re.compile(r"\b\d{1,2}:\d{2}-?(?:md|cv|mc|mj|cr)-?\d{1,6}(?:-[A-Za-z]{1,5})*", re.I)
DOCKET_ENTRY_NOTICE = re.compile(r"This docket entry was made by the Clerk on (?P<when>[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4})", re.I)
STAMPS = [
    # "Case 2:25-md-03163-KSM Document 2 Filed 12/23/25 Page 1 of 5" (E.D. Pa., N.D. Tex., D.N.J., E.D. Mo.) and "Case: 1:23-cv-00818 Document #: 175 Filed: 08/03/23 Page 1 of 14" (N.D. Ill.)
    re.compile(r"Case\s*:?\s*(?P<case>\d{1,2}:\d{2}-?(?:md|cv|mc|mj|cr)-?\d{1,6}(?:-[A-Za-z]{1,5})*)\s+(?:Document|Doc\.?)\s*(?:#\s*:?|:)?\s*(?P<doc>\d+)(?:-(?P<att>\d+))?\s+Filed\s*:?\s*(?P<filed>\d{1,2}/\d{1,2}/\d{2,4})\s+Page\s*:?\s*(?P<page>\d+)\s+of\s+(?P<of>\d+)", re.I),
    # JPML: "Case MDL No. 3180 Document 47 Filed 06/04/26 Page 1 of 4"
    re.compile(r"Case\s+(?P<case>MDL\s+No\.?\s*\d+)\s+Document\s+(?P<doc>\d+)(?:-(?P<att>\d+))?\s+Filed\s+(?P<filed>\d{1,2}/\d{1,2}/\d{2,4})\s+Page\s+(?P<page>\d+)\s+of\s+(?P<of>\d+)", re.I),
]

def iso(date_text):
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", date_text)
    if not m:
        return None
    mo, d, y = int(m.group(1)), int(m.group(2)), m.group(3)
    year = int(y) if len(y) == 4 else (2000 + int(y) if int(y) < 70 else 1900 + int(y))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return "%04d-%02d-%02d" % (year, mo, d)

def peek(path):
    data = open(path, "rb").read()
    doc = fitz.open(path)
    record = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "pages": doc.page_count,
              "metadata": {k: v for k, v in (doc.metadata or {}).items() if v and k in ("title", "creator", "producer", "creationDate", "modDate")}}
    text = ""
    for i in range(min(doc.page_count, 2)):
        text += "\n" + doc[i].get_text("text")
    text = DASHES.sub("-", text)  # NextGen notices print docket numbers with U+2212 minus signs
    flat = re.sub(r"\s+", " ", text).strip()
    record["has_text"] = len(flat) > 40
    record["first_lines"] = [re.sub(r"\s+", " ", x).strip() for x in text.splitlines() if x.strip()][:14]
    record["case_literals"] = sorted(set(CASE_LITERAL.findall(flat)))[:8]
    notice = DOCKET_ENTRY_NOTICE.search(flat)
    record["docket_entry_notice_date"] = notice.group("when") if notice else None
    stamp = None
    for rx in STAMPS:
        m = rx.search(flat)
        if m:
            g = m.groupdict()
            stamp = {"case": re.sub(r"\s+", " ", g["case"]), "document_number": int(g["doc"]), "attachment_number": int(g["att"]) if g.get("att") else None,
                     "filed_raw": g["filed"], "filed_iso": iso(g["filed"]), "page": int(g["page"]), "of": int(g["of"]), "raw": m.group(0)}
            break
    record["stamp"] = stamp
    return record

if __name__ == "__main__":
    folder, out = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    names = sorted(n for n in os.listdir(folder) if n.endswith(".pdf") and (not only or n[:-4] in only))
    with open(out, "a", encoding="utf-8") as fh:
        for name in names:
            try:
                rec = peek(os.path.join(folder, name))
            except Exception as e:  # unreadable PDF: recorded, not fatal
                rec = {"sha256": name[:-4], "error": type(e).__name__ + ": " + str(e)[:120]}
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps({"peeked": len(names), "out": out}))
