"""Offline full-code inventory and text extraction from the DC Council bulk archive.

The original HTML and publisher search export remain evidence, not executable code.
This creates a dated browsing candidate; it does not certify legal effect or publish.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

PARSER = "dc-council-html/2"
PREFIX = "us/dc/council/code/"
HOST = "https://code.dccouncil.gov"
BLOCKS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "ul", "ol", "nav", "section", "article", "br", "hr"}
VOIDS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def clean_text(value):
    return "\n".join(line for raw in value.splitlines() if (line := re.sub(r"\s+", " ", raw).strip()))


class ArticleParser(HTMLParser):
    """Keep all article text, including notes, but exclude site navigation/scripts."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.articles = 0
        self.skipped = 0
        self.title_depth = None
        self.title = []
        self.parts = []
        self.links = []
        self.canonical = None
        self.heading_id = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and attrs.get("property") == "og:url":
            self.canonical = attrs.get("content")
        if not self.depth:
            if tag != "article" or "content" not in attrs.get("class", "").split():
                return
            self.articles += 1
            self.depth = 1
            return
        if tag not in VOIDS:
            self.depth += 1
        if tag in {"script", "style"}:
            self.skipped += 1
        if self.skipped:
            return
        if tag in BLOCKS:
            self.parts.append("\n")
        if tag == "h1" and self.heading_id is None:
            self.heading_id = attrs.get("id")
            self.title_depth = self.depth
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOIDS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.depth or tag in VOIDS:
            return
        if self.title_depth == self.depth:
            self.title_depth = None
        if tag in {"script", "style"} and self.skipped:
            self.skipped -= 1
        if tag in BLOCKS and not self.skipped:
            self.parts.append("\n")
        self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.skipped:
            self.parts.append(data)
            if self.title_depth is not None:
                self.title.append(data)

    def result(self):
        if self.articles != 1 or self.depth != 0 or not self.canonical or not self.heading_id:
            raise ValueError("Expected one complete publisher article with exact identity")
        text = clean_text("".join(self.parts))
        if not text:
            raise ValueError("Empty publisher article")
        return {"source_url": self.canonical, "native_id": self.heading_id,
                "title": clean_text("".join(self.title)), "text": text, "links": list(dict.fromkeys(self.links))}


def parse_article(raw):
    parser = ArticleParser()
    parser.feed(raw.decode("utf-8", errors="strict"))
    parser.close()
    return parser.result()


def safe_member(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or len(path.parts) < 2:
        raise ValueError("Unsafe archive member")
    return "/".join(path.parts[1:])


def native_path(member):
    if member.endswith("/index.html"):
        return "/" + member[:-len("/index.html")]
    if member.endswith(".html"):
        return "/" + member[:-len(".html")]
    raise ValueError("Not a publisher HTML document")


def validate_identity(data, member):
    identity = data["native_id"]
    filename_identity = native_path(member)
    # The 663 Title 28 colon citations have tilde filenames in this publication.
    # Canonical metadata AND the article heading must agree; retain both names.
    exact = filename_identity == identity
    colon_alias = (identity.startswith("/us/dc/council/code/sections/28:")
                   and filename_identity == identity.replace(":", "~"))
    if not (exact or colon_alias) or data["source_url"] != HOST + identity:
        raise ValueError("HTML path/heading/canonical identity mismatch")
    return identity, "title-28-colon-to-tilde" if colon_alias else "exact"


def run(archive, receipt_path, output):
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    commit = receipt.get("commit", "")
    if (receipt.get("repository") != "https://github.com/dccouncil/law-html"
            or not re.fullmatch(r"[0-9a-f]{40}", commit)
            or receipt.get("status") != 200 or receipt.get("whole_object_verified") is not True
            or receipt.get("url") != f"https://api.github.com/repos/DCCouncil/law-html/tarball/{commit}"
            or archive.stat().st_size != receipt.get("bytes")
            or file_digest(archive) != receipt.get("sha256")):
        raise ValueError("Publisher archive/receipt pin mismatch")
    if output.exists():
        raise ValueError("Refusing to overwrite a derivative")
    output.mkdir(parents=True)
    members = set()
    records = {}
    toc_docs = {}
    errors = []
    metadata = None
    totals = {"regular_files": 0, "uncompressed_bytes": 0, "code_html_files": 0, "alternate_full_html_files": 0}
    with (output / "members.jsonl").open("w", encoding="utf-8", newline="\n") as inventory, (output / "records.jsonl").open("w", encoding="utf-8", newline="\n") as rows:
        with tarfile.open(archive, "r|gz") as tar:
            for member in tar:
                if member.isdir():
                    continue
                path = safe_member(member.name)
                if not member.isfile():
                    raise ValueError("Non-regular archive member: " + path)
                if path in members:
                    raise ValueError("Duplicate archive member: " + path)
                members.add(path)
                keep_body = path == "metadata.json" or (path.startswith(PREFIX) and path.endswith((".html", ".json")))
                chunks = []
                hasher = hashlib.sha256()
                observed_bytes = 0
                with tar.extractfile(member) as stream:
                    for chunk in iter(lambda: stream.read(512 * 1024), b""):
                        observed_bytes += len(chunk)
                        hasher.update(chunk)
                        if keep_body:
                            chunks.append(chunk)
                if observed_bytes != member.size:
                    raise ValueError("Truncated archive member")
                raw = b"".join(chunks)
                sha = hasher.hexdigest()
                inventory.write(json.dumps({"member": path, "bytes": observed_bytes, "sha256": sha}, ensure_ascii=False) + "\n")
                totals["regular_files"] += 1
                totals["uncompressed_bytes"] += observed_bytes
                if path == "metadata.json":
                    metadata = json.loads(raw)
                if not path.startswith(PREFIX):
                    continue
                if path.endswith(".json"):
                    toc_docs["/" + path] = json.loads(raw)
                if not path.endswith(".html"):
                    continue
                totals["code_html_files"] += 1
                if path.endswith("/index.full.html"):
                    totals["alternate_full_html_files"] += 1
                    continue
                try:
                    data = parse_article(raw)
                    identity, filename_mapping = validate_identity(data, path)
                    if identity in records:
                        raise ValueError("Duplicate native article identity")
                    text_bytes = data["text"].encode("utf-8")
                    row = {**data, "kind": "section" if "/sections/" in identity else "outline", "source_member": path,
                           "source_member_sha256": sha, "source_member_bytes": len(raw), "filename_mapping": filename_mapping, "text_sha256": digest(text_bytes),
                           "text_bytes": len(text_bytes), "text_codepoints": len(data["text"]), "parser": PARSER,
                           "source_commit": commit, "source_archive_sha256": receipt["sha256"],
                           "retrieved_at": receipt["retrieved_at"], "source_codified_date": receipt["source_codified_date"],
                           "current_law_verified": False, "calculation_activation_allowed": False}
                    rows.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                    records[identity] = {k: row[k] for k in ("kind", "source_member", "text_sha256", "title")}
                except (ValueError, UnicodeDecodeError) as exc:
                    errors.append({"member": path, "reason": str(exc)})
    if not metadata or metadata["meta"]["build"]["codified-date"] != receipt["source_codified_date"]:
        raise ValueError("Publisher metadata/capture version mismatch")

    visited_docs = set()
    toc_nodes = {}
    missing_json = set()
    conflicts = []
    fragments = {}

    def visit(node, parent=None):
        if not isinstance(node, dict):
            raise ValueError("Unexpected publisher TOC node")
        identity = node.get("p")
        page_identity = identity.split("#", 1)[0] if identity else None
        is_code = identity and (page_identity == "/" + PREFIX.rstrip("/") or page_identity.startswith("/" + PREFIX))
        if is_code and "#" in identity:
            variants = fragments.setdefault(identity, [])
            entry = {k: node.get(k) for k in ("t", "p", "et", "sc", "sp")}
            if entry not in variants:
                variants.append(entry)
        elif is_code:
            entry = {k: node.get(k) for k in ("t", "p", "et", "sc", "sp")}
            old = toc_nodes.get(identity)
            entry["parent_id"] = old["parent_id"] if old else parent
            if old and old != entry:
                conflicts.append({"native_id": identity, "first": old, "other": entry})
            toc_nodes[identity] = entry
        for child in node.get("c", []):
            visit(child, identity if is_code and "#" not in identity else parent)
        ref = node.get("j")
        if ref and ref not in visited_docs:
            visited_docs.add(ref)
            if ref not in toc_docs:
                missing_json.add(ref)
            else:
                visit(toc_docs[ref], parent)

    root = "/" + PREFIX + "index.json"
    if root not in toc_docs:
        raise ValueError("Missing whole-code publisher table of contents")
    visited_docs.add(root)
    visit(toc_docs[root])
    toc_ids = set(toc_nodes)
    missing_html = sorted(toc_ids - records.keys())
    unlisted = sorted(records.keys() - toc_ids)
    chapter = "/us/dc/council/code/titles/12/chapters/3"
    limitations_path = "library|D.C. Code|12|3"
    limitations = sorted(k for k, v in toc_nodes.items() if (v.get("sp") or "") == limitations_path
                         or (v.get("sp") or "").startswith(limitations_path + "|") or k == chapter)
    checks = {"article_errors": errors, "missing_toc_json": sorted(missing_json), "toc_conflicts": conflicts,
              "toc_nodes_without_article": missing_html, "articles_outside_toc": unlisted,
              "limitations_chapter_native_ids": limitations,
              "fragment_identity_conflicts": [{"native_id": k, "variants": v} for k, v in fragments.items() if len(v) > 1]}
    (output / "reconciliation.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "toc.json").write_text(json.dumps(list(toc_nodes.values()), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (output / "fragment-identities.json").write_text(json.dumps(fragments, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest = {"parser": PARSER, "source": receipt, "publisher_metadata": metadata, "counts": {**totals,
                "parsed_articles": len(records), "sections": sum(r["kind"] == "section" for r in records.values()),
                "outlines": sum(r["kind"] == "outline" for r in records.values()), "toc_nodes": len(toc_nodes), "fragment_identities": len(fragments),
                "title_nodes": sum(bool(re.fullmatch(r"/us/dc/council/code/titles/[^/]+", k)) for k in toc_nodes)},
                "checks": {k: len(v) for k, v in checks.items()}, "acquired_publisher_archive": True,
                "toc_reconciled": not any([errors, missing_json, conflicts, missing_html, unlisted]),
                "current_law_verified": False, "calculation_activation_allowed": False, "published": False,
                "outputs": {p.name: {"sha256": file_digest(p), "bytes": p.stat().st_size} for p in output.iterdir() if p.is_file()}}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.archive, args.receipt, args.output)
    print(json.dumps({k: result[k] for k in ("counts", "checks", "toc_reconciled", "published")}, ensure_ascii=True))
