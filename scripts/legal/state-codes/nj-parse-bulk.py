"""Parse captured NJ publisher TXT using its paired RTF heading styles.

No network, inferred citations, legal-effect decisions or publication. Original
members are retained unchanged; all derived spans use Unicode code points in the
CP1252-decoded, CRLF-to-LF text. A fresh output directory is required.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import zipfile

VERSION = "nj-publisher-txt-rtf/1"
PARAGRAPH = re.compile(r"\\pard\s+\\s([23])\s+(.*?)(?=\\par[\s}])", re.S)
CITATION = re.compile(r"^(?:C\.)?((?:[0-9][0-9A-Za-z.]*|App\.A):[0-9][0-9A-Za-z.:\-]*?(?:\([0-9A-Za-z]+\))?)(?:[.,]?(?=\s))")
TITLE = re.compile(r"^(?:TITLE\s+(\d+[A-Z]?)\b|APPENDIX\s+(A)\b)")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def decode_heading(fragment):
    """Only interpret controls observed in NJ's heading styles; fail closed."""
    fragment = re.sub(r"\{\\\*\\bkmk(?:start|end) [^}]*\}", "", fragment)
    fragment = fragment.replace("\r", "").replace("\n", "")
    tokens = re.compile(r"\\'([0-9a-fA-F]{2})|\\([A-Za-z]+)(-?\d+)? ?|\\([^A-Za-z])|([{}])")

    def replace(match):
        if match[1]:
            return bytes([int(match[1], 16)]).decode("cp1252", errors="strict")
        if match[2] in {"b", "i", "fs", "cf"}:
            return ""
        if match[2] == "tab":
            return "\t"
        if match[2] == "line":
            return "\n"
        if match[4] in {"{", "}", "\\"}:
            return match[4]
        if match[5]:
            return ""
        raise ValueError(f"Unsupported heading control: {match[0]!r}")

    return tokens.sub(replace, fragment).strip()


def bind_headings(text, rtf):
    cursor, headings, anomalies = 0, [], []
    for ordinal, match in enumerate(PARAGRAPH.finditer(rtf), 1):
        heading = decode_heading(match[2])
        raw_span = [match.start(), match.end()]
        if not heading:
            anomalies.append({"rtf_ordinal": ordinal, "kind": "empty_headnote", "rtf_span": raw_span})
            continue
        start = text.find(heading, cursor)
        # A body can quote the identical next heading. Only a new publisher
        # paragraph (optional indentation) can bind a styled heading.
        while start >= 0 and text[text.rfind("\n", 0, start) + 1:start].strip():
            start = text.find(heading, start + 1)
        if start < 0:
            raise ValueError(f"RTF heading {ordinal} not found in sequence in TXT")
        line_start = text.rfind("\n", 0, start) + 1
        cursor = start + len(heading)
        row = {"rtf_ordinal": ordinal, "rtf_span": raw_span, "heading": heading,
               "heading_span": [start, cursor], "start": line_start}
        if match[1] == "2":
            title = TITLE.match(heading)
            if not title:
                raise ValueError(f"Unrecognized publisher title heading {ordinal}")
            row.update(kind="title", native_title=title[1] or "App.A")
            headings.append(row)
            continue
        citation = CITATION.match(heading)
        if citation:
            row.update(kind="section", printed_citation=heading[:citation.end()], citation=citation[1])
            headings.append(row)
            continue
        # Publisher occasionally styles body text and a later section together.
        # Retain the entire anomaly; only an actual heading line can delimit a
        # new section, never a citation mentioned inside that body paragraph.
        nested = []
        for line in re.finditer(r"[^\n]+", heading):
            child = CITATION.match(line[0].strip())
            if not child:
                continue
            child_start = start + line.start() + len(line[0]) - len(line[0].lstrip())
            nested.append({"rtf_ordinal": ordinal, "rtf_span": raw_span,
                "kind": "section", "heading": line[0].strip(),
                "heading_span": [child_start, start + line.end()],
                "start": start + line.start(), "printed_citation": line[0].strip()[:child.end()],
                "citation": child[1], "source_anomaly": "compound_rtf_headnote"})
        anomalies.append({**row, "kind": "noncitation_headnote", "nested_section_headings": len(nested)})
        if nested:
            headings.extend(nested)
        else:
            # A malformed native identifier/notice remains its own unmapped
            # source block so it cannot be swallowed by the previous statute.
            row.update(kind="unmapped_headnote", citation=None)
            headings.append(row)
    if any(a["start"] >= b["start"] for a, b in zip(headings, headings[1:])):
        raise ValueError("Heading positions are not strictly increasing")
    return headings, anomalies


def load_archive(base, name):
    receipt_path = base / f"{name}-TEXT.zip.receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    raw = (base / receipt["raw_file"]).read_bytes()
    if receipt.get("http_status") != 200 or len(raw) != receipt["bytes"] or sha(raw) != receipt["sha256"]:
        raise ValueError(f"Archive receipt mismatch: {name}")
    inventory = json.loads((base / f"{name}-TEXT.zip.receipt.json.inventory.json").read_text())
    if inventory["archive_sha256"] != sha(raw):
        raise ValueError("Member inventory source mismatch")
    members = {}
    with zipfile.ZipFile(base / receipt["raw_file"]) as archive:
        if set(archive.namelist()) != {f"{name}.TXT", f"{name}.RTF"}:
            raise ValueError("Unexpected or duplicate archive members")
        if len(archive.infolist()) != 2:
            raise ValueError("Duplicate archive member")
        expected = {row["name"]: row for row in inventory["entries"]}
        for info in archive.infolist():
            if info.flag_bits & 1:
                raise ValueError("Encrypted source member")
            data = archive.read(info)  # CRC checked by zipfile, no extraction paths.
            row = expected[info.filename]
            if sha(data) != row["sha256"] or len(data) != row["bytes"]:
                raise ValueError("Source member hash mismatch")
            members[info.filename] = data
    return receipt, members


def run(base, output):
    if output.exists():
        raise ValueError("Output exists; use a fresh versioned directory")
    output.mkdir(parents=True)
    (output / "members").mkdir()
    (output / "titles").mkdir()
    provenance = {}
    for name in ("STATUTES", "NJCONST", "LCTOC"):
        receipt, members = load_archive(base, name)
        provenance[name] = {"archive_sha256": receipt["sha256"], "source_url": receipt["source_url"],
            "retrieved_at": receipt["finished_at"], "members": []}
        for member, data in members.items():
            path = output / "members" / member
            with path.open("xb") as stream:
                stream.write(data)
            text = data.decode("cp1252", errors="strict").replace("\r\n", "\n")
            if member.endswith(".TXT"):
                with (output / "members" / f"{member}.utf8").open("xb") as stream:
                    stream.write(text.encode("utf-8"))
            provenance[name]["members"].append({"name": member, "bytes": len(data), "sha256": sha(data),
                "encoding": "cp1252", "decoded_characters": len(text),
                "utf8_sha256": sha(text.encode("utf-8")) if member.endswith(".TXT") else None})
    text = (output / "members/STATUTES.TXT.utf8").read_text(encoding="utf-8")
    rtf = (output / "members/STATUTES.RTF").read_bytes().decode("cp1252", errors="strict")
    headings, anomalies = bind_headings(text, rtf)
    titles = [row for row in headings if row["kind"] == "title"]
    title_counts = collections.Counter(row["native_title"] for row in titles)
    if any(count != 1 for count in title_counts.values()):
        raise ValueError("Repeated native title requires version review")
    for i, title in enumerate(titles):
        title["end"] = titles[i + 1]["start"] if i + 1 < len(titles) else len(text)
        body = text[title["start"]:title["end"]]
        data = body.encode("utf-8")
        title.update(text_sha256=sha(data), text_bytes=len(data), text_characters=len(body),
                     text_file=f"titles/{title['native_title']}.txt")
        with (output / title["text_file"]).open("xb") as stream:
            stream.write(data)
    sections, blocks, current_title, counts = [], [], None, collections.Counter()
    for i, row in enumerate(headings):
        end = headings[i + 1]["start"] if i + 1 < len(headings) else len(text)
        if row["kind"] == "title":
            current_title = row
            continue
        if not current_title or end > current_title["end"]:
            raise ValueError("Section outside publisher title")
        body = text[row["start"]:end]
        counts[row.get("citation")] += 1
        record = {**row, "end": end, "native_title": current_title["native_title"],
            "title_text_file": current_title["text_file"], "title_text_sha256": current_title["text_sha256"],
            "title_span": [row["start"] - current_title["start"], end - current_title["start"]],
            "span_unit": "unicode_code_points", "text_sha256": sha(body.encode("utf-8")),
            "text_characters": len(body), "occurrence": counts[row.get("citation")],
            "identity_kind": "derived_source_member_heading_occurrence", "parser": VERSION}
        (sections if row["kind"] == "section" else blocks).append(record)
    with (output / "sections.jsonl").open("x", encoding="utf-8", newline="\n") as stream:
        for row in sections:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    save_json(output / "titles.json", titles)
    save_json(output / "source-anomalies.json", {"headnotes": anomalies, "unmapped_blocks": blocks})
    # Every publisher title and section heading retains its paired TXT/RTF spans.
    # Citations/sections outside those marked paragraphs are not silently promoted.
    keys = collections.Counter(row["citation"] for row in sections)
    report = {"parser": VERSION, "source": provenance, "titles": len(titles),
        "section_occurrences": len(sections), "citation_keys": len(keys),
        "repeated_keys": {key: n for key, n in keys.items() if n > 1},
        "source_headnote_anomalies": len(anomalies), "unmapped_source_blocks": len(blocks),
        "statutes_version_marker": text[:titles[0]["start"]].strip(),
        "toc_version_marker": (output / "members/LCTOC.TXT.utf8").read_text(encoding="utf-8").splitlines()[0],
        "sections_sha256": sha((output / "sections.jsonl").read_bytes()),
        "publication_allowed": False, "calculation_activation_allowed": False,
        "limitations": ["Publisher compilation marker is not a current-law certification.",
            "Constitution and counsel TOC retained as complete text; fine-grained structure not yet parsed.",
            "Unresolved source heading anomalies are retained, never corrected by inference."]}
    save_json(output / "parse-report.json", report)
    print(json.dumps({k: report[k] for k in ("parser", "titles", "section_occurrences", "citation_keys",
        "source_headnote_anomalies", "unmapped_source_blocks", "sections_sha256")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    run(args.base, args.output)
