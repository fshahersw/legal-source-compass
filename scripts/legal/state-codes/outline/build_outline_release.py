"""Build a state-code outline release (schema state-code-outline-release/1) from a read-only projection export.

    python3 -I -B scripts/legal/state-codes/outline/build_outline_release.py \
        --export private/scratch/enrich/law_headings/export2/TX.json.gz --out private/build/law_headings/release \
        [--tx-inventory private/acq/law_headings/tx/StatuteCodeDownloads.json] [--names names.json]

Why: the public outline read (corpus_publisher_code_projected_outline_v4) identifies a level only by (level, number,
node_id). Where a publisher prints no number (Texas, Ohio, Minnesota parts, Nevada headings) or the same number twice
under one parent, every sibling opens as one merged list, and Texas has no code level at all, so the titles of 31 codes
sit side by side. This release keeps the projection's own records and regroups them with the heading as part of each
level's identity. Nothing is invented:
  * a level is (level, number, node_id, heading) exactly as recorded; headings are compared after collapsing whitespace,
    decoding character references, folding case and curly quotes, and dropping a final period;
  * siblings that share a recorded number merge when one heading is a copy or a cut-off copy of the other (the same unit
    printed twice); the heading with the most sections is shown and the others are kept as variants;
  * Texas: the code is the citation's own prefix ("AG" in "AG:1.001") and its name is the publisher's CodeName from
    https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json, in the publisher's order;
  * District of Columbia: the recorded "chapter" is the publisher's table-of-contents path
    ("titles-1-chapters-2-subchapters-IV"); it becomes the levels it names, and the section heading the intake stored on
    it is not used as a level heading. Level names come only from a captured publisher table of contents (--names).
Every section appears exactly once; the build fails otherwise. Files are at most MAX_SHARD_BYTES (one top-level unit
may exceed it alone, up to the snapshot limit of 16 MiB).
"""
import argparse
import datetime
import gzip
import hashlib
import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCHEMA = "state-code-outline-release/1"
MAX_SHARD_BYTES = 3_000_000
MAX_FILE_BYTES = 16 * 1024 * 1024
URL_ESCAPES = {"%20": " ", "%26": "&", "%27": "'", "%28": "(", "%29": ")", "%2C": ",", "%3B": ";"}
CP1252 = {i: bytes([i]).decode("cp1252", errors="replace") for i in range(128, 160)}
DC_LEVELS = {"titles": "title", "subtitles": "subtitle", "chapters": "chapter", "subchapters": "subchapter",
             "units": "unit", "articles": "article", "parts": "part", "subparts": "subpart", "divisions": "division"}
DC_SLUG = re.compile(r"(" + "|".join(DC_LEVELS) + r")-(.+?)(?=-(?:" + "|".join(DC_LEVELS) + r")-|$)")
TX_INVENTORY_URL = "https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json"


def _reference(match):
    body = match.group(1)
    if body.startswith("#"):
        code = int(body[2:], 16) if body[1:2] in ("x", "X") else int(body[1:])
        if 128 <= code <= 159:
            return CP1252.get(code, match.group(0))
        return chr(code) if 0 < code <= 0x10FFFF else match.group(0)
    return html.unescape(match.group(0))


def clean_heading(value):
    """The same presentation cleaning as src/lib/law/stateCodeHeading.ts cleanHeading()."""
    if not isinstance(value, str):
        return None
    text = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    text = re.sub(r"&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,7});", _reference, text)
    text = re.sub(r"%(?:20|26|27|28|29|2C|3B)", lambda m: URL_ESCAPES[m.group(0).upper()], text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*\(\d+(?:\.\d+)?\s?[KM]B\)$", "", text).strip()
    return text or None


def norm_heading(value):
    """Comparison form of a heading: cleaned, curly quotes straightened, case folded, final period dropped."""
    text = clean_heading(value) or ""
    text = text.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'}))
    return re.sub(r"\s*\.$", "", text.casefold()).strip()


def sort_key(text):
    """Citation order: integers numerically; after a period, digits with a leading zero as a decimal fraction
    ("1.001" < "1.0015" < "1.002") and others numerically ("1.9" < "1.10"), fractions first ("101.09" < "101.10");
    letters case-insensitively."""
    key = []
    prev = ""
    for token in re.findall(r"\d+|[A-Za-z]+|[^\dA-Za-z]", text or ""):
        if token.isdigit():
            if prev == "." and token.startswith("0"):
                key.append((1, 0, token))
            else:
                key.append((2, int(token), ""))
        elif token.isalpha():
            key.append((3, 0, token.casefold()))
        else:
            key.append((0, 0, token))
        prev = token
    return tuple(key)


def dc_steps(slug):
    """'titles-1-chapters-2-subchapters-IV' -> [('title','1'), ('chapter','2'), ('subchapter','IV')]; None if not a path."""
    if not isinstance(slug, str) or not slug.startswith("titles-"):
        return None
    pairs = [(DC_LEVELS[m.group(1)], m.group(2)) for m in DC_SLUG.finditer(slug)]
    rebuilt = "-".join(f"{k}-{v}" for k, v in ((next(s for s, l in DC_LEVELS.items() if l == lvl), num) for lvl, num in pairs))
    return pairs if pairs and rebuilt == slug else None


def restore_steps(jurisdiction, citation, steps, extras):
    """The levels a section sits under, after the jurisdiction's documented restorations."""
    if jurisdiction == "TX":
        code = citation.split(":", 1)[0] if citation and ":" in citation else None
        names = extras["tx_codes"]
        if code not in names:
            raise ValueError(f"Texas citation prefix not in the publisher inventory: {citation!r}")
        wrapped = extras.get("tx_wrapped", {})
        out = [("code", code, names[code], None)]
        for level, number, heading, node_id in steps:
            full = wrapped.get(f"{code}\x1f{heading}") if heading else None
            # A wrapped heading's second printed line, confirmed on the publisher's page; the recorded first line is kept.
            out.append((level, number, full, node_id, heading) if full else (level, number, heading, node_id))
        return out
    if jurisdiction == "DC":
        if len(steps) == 1 and steps[0][0] == "chapter":
            pairs = dc_steps(steps[0][1])
            if pairs is None:
                raise ValueError(f"District of Columbia path not recognised: {steps[0][1]!r}")
            out, key = [], []
            for level, number in pairs:
                key.append(f"{level}:{number}")
                out.append((level, number, extras["names"].get("/".join(key)), None))
            return out
        return [tuple(s) for s in steps]
    return [tuple(s) for s in steps]


class Node:
    __slots__ = ("level", "number", "node_id", "headings", "children", "sections", "recorded")

    def __init__(self, level, number, node_id):
        self.level, self.number, self.node_id = level, number, node_id
        self.headings = defaultdict(int)  # raw heading as recorded -> sections under it
        self.recorded = set()  # headings as the intake recorded them, where a restoration completed them
        self.children = {}
        self.sections = []

    def count(self):
        return len(self.sections) + sum(c.count() for c in self.children.values())

    def heading(self):
        if not self.headings:
            return None
        # Most sections; then a heading printed without stray whitespace or markup; then the longer (uncut) text.
        return max(self.headings.items(),
                   key=lambda kv: (kv[1], kv[0] is not None, kv[0] == clean_heading(kv[0]),
                                   len(clean_heading(kv[0]) or "")))[0]


def child_key(level, number, heading, node_id):
    return (level, number, node_id, norm_heading(heading))


def add_section(root, steps, row):
    node = root
    for step in steps:
        level, number, heading, node_id = step[:4]
        key = child_key(level, number, heading, node_id)
        nxt = node.children.get(key)
        if nxt is None:
            nxt = node.children[key] = Node(level, number, node_id)
        nxt.headings[heading] += 1
        if len(step) > 4 and step[4]:
            nxt.recorded.add(step[4])
        node = nxt
    node.sections.append(row)


def merge_into(target, other):
    target.recorded |= other.recorded
    for heading, n in other.headings.items():
        target.headings[heading] += n
    target.sections.extend(other.sections)
    for key, child in other.children.items():
        if key in target.children:
            merge_into(target.children[key], child)
        else:
            target.children[key] = child


def merge_variants(node, report):
    """Siblings with the same recorded number whose headings are copies or cut-off copies of each other are one unit."""
    groups = defaultdict(list)
    for key, child in node.children.items():
        if child.number is not None:
            groups[(child.level, child.number, child.node_id)].append(key)
    for ident, keys in groups.items():
        if len(keys) < 2:
            continue
        named = sorted((k for k in keys if k[3]), key=lambda k: -len(k[3]))
        clusters = []
        for k in named:
            for cluster in clusters:
                if cluster[0][3].startswith(k[3]):
                    cluster.append(k)
                    break
            else:
                clusters.append([k])
        unnamed = [k for k in keys if not k[3]]
        if unnamed and len(clusters) == 1:
            clusters[0].extend(unnamed)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            keep = max(cluster, key=lambda k: node.children[k].count())
            for k in cluster:
                if k != keep:
                    merge_into(node.children[keep], node.children.pop(k))
                    report["merged_variants"] += 1
                    if len(report["merge_examples"]) < 12:
                        report["merge_examples"].append([ident[0], ident[1], k[3], keep[3]])
    for child in node.children.values():
        merge_variants(child, report)


def node_id_of(parent_id, node):
    raw = "\x1e".join([parent_id, node.level or "", node.number or "", node.node_id or "", norm_heading(node.heading())])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def section_key(row):
    """Sections sort by their native id without the jurisdiction prefix ("TX:AG:1.001" -> "AG:1.001")."""
    native = row[0] or ""
    return sort_key(native.split(":", 1)[1] if ":" in native else native)


def first_key(node):
    keys = [section_key(r) for r in node.sections] + [first_key(c) for c in node.children.values()]
    return min(keys) if keys else ()


def order_children(children):
    """By printed number when every sibling's number starts with a digit; otherwise in section order."""
    if children and all(c.number and c.number[:1].isdigit() for c in children):
        return sorted(children, key=lambda c: (sort_key(c.number), first_key(c), norm_heading(c.heading())))
    return sorted(children, key=lambda c: (first_key(c), norm_heading(c.heading())))


def serialize(node, parent_id):
    nid = node_id_of(parent_id, node)
    heading = node.heading()
    variants = sorted(h for h in node.headings if h != heading and h is not None)
    children = order_children(list(node.children.values()))
    out = {"id": nid, "l": node.level, "n": node.number, "h": heading, "c": node.count()}
    if node.recorded:
        out["hr"] = sorted(node.recorded)
    if node.node_id is not None:
        out["nid"] = node.node_id
    if variants:
        out["hv"] = variants
    if children:
        out["k"] = [serialize(c, nid) for c in children]
    if node.sections:
        out["s"] = sorted(node.sections, key=section_key)
    return out


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build(export, extras, built_at):
    jurisdiction = export["jurisdiction"]
    if not re.fullmatch(r"[A-Z]{2}", jurisdiction):
        raise ValueError("bad jurisdiction")
    root = Node(None, None, None)
    paths = export["paths"]
    for native_id, citation, heading, status, path_index in export["rows"]:
        steps = restore_steps(jurisdiction, citation, paths[path_index], extras)
        add_section(root, steps, [native_id, citation, heading, status])
    report = {"merged_variants": 0, "merge_examples": []}
    merge_variants(root, report)
    order = extras.get("tx_order") if jurisdiction == "TX" else None
    children = list(root.children.values())
    if order:
        children.sort(key=lambda c: order.get(c.number, len(order)))
    else:
        children = order_children(children)
    top = [serialize(c, jurisdiction) for c in children]
    direct = sorted(root.sections, key=section_key)
    seen = set()

    def walk(n):
        for row in n.get("s", []):
            if row[0] in seen:
                raise ValueError(f"section listed twice: {row[0]}")
            seen.add(row[0])
        for c in n.get("k", []):
            walk(c)

    for n in top:
        walk(n)
    for row in direct:
        if row[0] in seen:
            raise ValueError(f"section listed twice: {row[0]}")
        seen.add(row[0])
    if len(seen) != export["sections"] or len(export["rows"]) != export["sections"]:
        raise ValueError("section count mismatch")
    if len({n["id"] for n in top}) != len(top):
        raise ValueError("duplicate top-level identity")
    return top, direct, report


def shard(top, prefix):
    shards, current, size = [], [], 0
    for n in top:
        b = len(compact(n))
        if current and size + b > MAX_SHARD_BYTES:
            shards.append(current)
            current, size = [], 0
        current.append(n)
        size += b
    if current:
        shards.append(current)
    return [(f"{prefix}s{i}.json", group) for i, group in enumerate(shards)]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tx-inventory")
    ap.add_argument("--names", help="JSON {'title:1': name, 'title:1/chapter:2': name} from a captured publisher TOC")
    ap.add_argument("--names-source", default=None, help="URL and sha256 of the captured TOC, recorded on the release")
    ap.add_argument("--tx-wrapped", help="confirmed wrapped Texas headings (tx_verify_continuations.py output)")
    args = ap.parse_args(argv)
    export_path = Path(args.export)
    export_bytes = export_path.read_bytes()
    export = json.loads(gzip.decompress(export_bytes))
    jurisdiction = export["jurisdiction"]
    built_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    extras = {"names": {}}
    inputs = [{"path": str(export_path), "sha256": hashlib.sha256(export_bytes).hexdigest(),
               "what": f"read-only export of the public projection ({export['source_system']}), {export['exported_at']}"}]
    restorations = []
    if jurisdiction == "TX":
        raw = Path(args.tx_inventory).read_bytes()
        inventory = json.loads(raw)["StatuteCode"]
        extras["tx_codes"] = {row["code"]: row["CodeName"] for row in inventory}
        extras["tx_order"] = {row["code"]: i for i, row in enumerate(inventory)}
        inputs.append({"url": TX_INVENTORY_URL, "path": args.tx_inventory, "sha256": hashlib.sha256(raw).hexdigest()})
        restorations.append("Code level: the citation prefix (\"AG\" in \"AG:1.001\") is the publisher's code; its name "
                            "and order are the publisher's code inventory.")
        if args.tx_wrapped:
            raw = Path(args.tx_wrapped).read_bytes()
            extras["tx_wrapped"] = json.loads(raw)["headings"]
            inputs.append({"path": args.tx_wrapped, "sha256": hashlib.sha256(raw).hexdigest(),
                           "what": "wrapped headings: second printed line from the frozen chapter texts, each confirmed "
                                   "as an unbolded centered line on https://tcss.legis.texas.gov/resources/<code>/htm/"})
            restorations.append(f"Wrapped headings: {len(extras['tx_wrapped'])} headings the intake cut at the end of their "
                                "first printed line are completed with their second line (recorded first line kept as hr).")
    if jurisdiction == "DC":
        if args.names:
            raw = Path(args.names).read_bytes()
            extras["names"] = json.loads(raw)
            inputs.append({"path": args.names, "sha256": hashlib.sha256(raw).hexdigest(), "source": args.names_source})
        restorations.append("Levels from the publisher's table-of-contents path recorded on each section "
                            "(titles-N-chapters-N-...); level names only from the captured publisher table of contents.")
    restorations.append("Level identity includes the recorded heading; siblings with one recorded number whose headings "
                        "are copies or cut-off copies of each other are one unit (variants kept).")
    top, direct, report = build(export, extras, built_at)
    st = jurisdiction.lower()
    prefix = f"state-codes/{st}/outline-v1/"
    out = Path(args.out)
    files = {}
    for name, group in shard(top, prefix):
        body = compact({"schema_version": SCHEMA, "jurisdiction": jurisdiction, "nodes": group})
        if len(body) > MAX_FILE_BYTES:
            raise ValueError(f"{name} exceeds the snapshot size limit")
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(body)
        files[name] = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
        for n in group:
            n_ref = next(t for t in top if t["id"] == n["id"])
            n_ref["_shard"] = name
    root = {
        "schema_version": SCHEMA,
        "jurisdiction": jurisdiction,
        "source_system": export["source_system"],
        "projection_sections": export["sections"],
        "built_at": built_at,
        "builder": "scripts/legal/state-codes/outline/build_outline_release.py",
        "restorations": restorations,
        "inputs": inputs,
        "top": [{"id": n["id"], "l": n["l"], "n": n["n"], "h": n["h"], "c": n["c"], "shard": n["_shard"],
                 **({"nid": n["nid"]} if "nid" in n else {}), **({"hv": n["hv"]} if "hv" in n else {})}
                for n in top],
        "direct": direct,
        "shards": files,
        "report": report,
    }
    body = compact(root)
    (out / f"{prefix}root.json").write_bytes(body)
    summary = {"jurisdiction": jurisdiction, "sections": export["sections"], "top": len(top), "shards": len(files),
               "root_bytes": len(body), "bytes": len(body) + sum(f["bytes"] for f in files.values()),
               "merged_variants": report["merged_variants"]}
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    main(sys.argv[1:])
