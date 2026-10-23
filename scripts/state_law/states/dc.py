"""District of Columbia — Council of the District of Columbia, Code of the District of Columbia, state-law/1.

The Council's code site (code.dccouncil.gov) asks readers not to scrape it and to bulk download instead; its
metadata.json names the exact build it serves: the build/codified dates and the commit of the Council's codified XML
repository (github.com/dccouncil/law-xml-codified) the site was built from. This module fetches metadata.json, then a
shallow, blob-less git fetch of that revision (trees only) per title with only that title checked out (sparse
checkout), so the full code never sits on disk at once. Each section file is read with `git cat-file` (exact repository bytes) and
recorded as its own source (url = the file at that commit on the Council's repository).

Structure: us/dc/council/code/index.xml (Division subheadings + XInclude of titles; <meta><recency through=…> is the
publisher's currency date) -> titles/N/index.xml (nested <container> prefix/num/heading + XInclude of sections) ->
titles/N/sections/<num>.xml: <num>, <heading>, optional <reason> (publisher status: Repealed, Expired, Transferred, Not
Funded, Applicable on <date> …), <text>/<para> body, <annotations> (history kept; editor's notes, cross references
and section references dropped). Elements in the codify namespace are amendment instructions the publisher has not
applied to the text; they are left out of the text and named in effective.note.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import etree  # noqa: E402

from state_law import lib  # noqa: E402

SITE = "code.dccouncil.gov"
METADATA = f"https://{SITE}/metadata.json"
REPO = "https://github.com/dccouncil/law-xml-codified"
REPO_NAME = "DCCouncil/law-xml-codified"
CODE_DIR = "us/dc/council/code"
NS = "https://code.dccouncil.us/schemas/dc-library"
XI = "http://www.w3.org/2001/XInclude"

META = lib.StateMeta(
    state="DC",
    code_name="Code of the District of Columbia",
    publisher="Council of the District of Columbia (code.dccouncil.gov)",
    publisher_url=f"https://{SITE}/us/dc/council/code/",
    official_source=True,
    access="bulk",
    hosts=(SITE, "github.com"),
    parser="dc-council-codified-xml/1",
    min_interval_s=1.0,
    codes=(lib.Code("DCC", "Code of the District of Columbia", "D.C. Code § {n}",
                    lib.alias_patterns(["D.C. Code", "D.C. Code Ann.", "D.C. Official Code", "DC Code",
                                        "D.C. Code Annotated"])),),
    terms_note=("Code text from the Council's codified XML at the commit its code site names in metadata.json; the "
                "site states the codes and laws are in the public domain and asks for bulk download instead of "
                "scraping. robots.txt: content signals search=yes, ai-train=no. History notes are kept; editor's "
                "notes, cross references and amendment instructions not yet applied are not."),
    update_cadence="Rebuilt as laws take effect (metadata.json build-date); re-check weekly.",
)

STATUS_REASON = {"repealed": "repealed", "expired": "expired", "transferred": "transferred", "renumbered": "renumbered",
                 "recodified": "renumbered", "reserved": "reserved"}
APPLICABLE_RE = re.compile(r"^Applicable (?:on |as of )?([A-Z][a-z]+ \d{1,2}, \d{4})\.?$")
NOT_IN_FORCE = {"not applicable", "omitted", "abolished", "not effective", "suspended"}
OMITTED_RE = re.compile(r"^\[?Omitted\]?\.?$", re.I)
PREFIX_LEVEL = {"title": "title", "subtitle": "subtitle", "division": "division", "subdivision": "subdivision",
                "part": "part", "subpart": "subpart", "chapter": "chapter", "subchapter": "subchapter",
                "article": "article", "subarticle": "subarticle"}
DIVISION_RE = re.compile(r"^Division\s+([IVXLC]+)\.\s*(.*)$")


def _q(name: str) -> str:
    return f"{{{NS}}}{name}"


def _text(el) -> str:
    return lib.norm_ws("".join(el.itertext())) if el is not None else ""


class Repo:
    """A shallow, blob-less clone of one commit; titles are checked out one at a time."""

    def __init__(self, workdir: pathlib.Path, commit: str):
        self.dir = workdir
        self.revision = commit
        self._cat = None

    def _git(self, *args: str, timeout: int = 900) -> str:
        result = subprocess.run(["git", "-C", str(self.dir), *args], capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(f"git {' '.join(args[:3])}: {result.stderr.strip()[:400]}")
        return result.stdout

    def open(self, paths: list[str]) -> None:
        """A fresh shallow, blob-less repository at the pinned revision with only `paths` checked out (blobs fetched
        in one batch); called once per title so blobs of earlier titles do not accumulate on disk."""
        self.close()
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)
        rev = self.revision
        self._git("init", "-q")
        self._git("remote", "add", "origin", REPO + ".git")
        self._git("config", "extensions.partialClone", "origin")
        self._git("config", "remote.origin.promisor", "true")
        self._git("config", "remote.origin.partialclonefilter", "blob:none")
        self._git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", rev)
        self._git("sparse-checkout", "set", "--no-cone", *paths)
        self._git("checkout", "-q", rev)
        self._cat = subprocess.Popen(["git", "-C", str(self.dir), "cat-file", "--batch"], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE)

    def files(self, prefix: str) -> list[str]:
        return [p for p in self._git("ls-tree", "-r", "--name-only", self.revision, prefix).splitlines() if p]

    def blob(self, path: str) -> bytes:
        """Exact repository bytes of `path` at the commit (the blob is local once its title is checked out)."""
        assert self._cat is not None and self._cat.stdin and self._cat.stdout
        self._cat.stdin.write(f"{self.revision}:{path}\n".encode())
        self._cat.stdin.flush()
        header = self._cat.stdout.readline().decode().split()
        if len(header) != 3 or header[1] != "blob":
            raise RuntimeError(f"{path}: not a blob at {self.revision} ({' '.join(header)})")
        body = self._cat.stdout.read(int(header[2]))
        self._cat.stdout.read(1)
        return body

    def close(self) -> None:
        if self._cat is not None:
            self._cat.stdin.close()  # type: ignore[union-attr]
            self._cat.wait(timeout=60)
            self._cat = None


def inline(el) -> str:
    """Text of a block element with its inline children (cite, em …); codify instructions left out, <br/> breaks."""
    parts: list[str] = [el.text or ""]
    for child in el:
        ns, name = lib.xml_local(child)
        if ns in lib.XML_SKIP_NS:
            pass
        elif name == "br":
            parts.append("\n")
        else:
            parts.append(inline(child))
        parts.append(child.tail or "")
    return "".join(parts)


def body_lines(children, out: list[str]) -> None:
    """Lines of a section body in document order: a para is "<num> <text>", nested paras follow on their own lines,
    a table row is its cells separated by a space."""
    for child in children:
        ns, name = lib.xml_local(child)
        if ns in lib.XML_SKIP_NS or ns != NS:
            continue
        if name in ("num", "prefix", "heading", "reason", "annotations"):
            continue
        if name == "para":
            # a para prints [prefix] num [heading] text ("Article I Purposes." then its text; "(1) for the …")
            prefix, num, head, first = (child.find(_q(n)) for n in ("prefix", "num", "heading", "text"))
            lead = " ".join(lib.norm_ws(inline(e)) for e in (prefix, num) if e is not None and lib.norm_ws(inline(e)))
            body = lib.norm_ws(inline(first)) if first is not None else ""
            if head is not None and lib.norm_ws(inline(head)):
                out.append(" ".join(x for x in (lead, lib.norm_ws(inline(head))) if x))
                lead = ""
            line = " ".join(x for x in (lead, body) if x)
            if line:
                out.append(line)
            body_lines([c for c in child if c not in (prefix, num, head, first)], out)
        elif name == "table":
            for row in child.iter(_q("tr")):
                cells = [lib.norm_ws(inline(c)) for c in row if lib.xml_local(c)[1] in ("td", "th")]
                line = " ".join(c for c in cells if c)
                if line:
                    out.append(line)
        elif name == "include":
            body_lines(list(child), out)
        else:  # text, aftertext, center and any other block: its inline text
            for piece in inline(child).split("\n"):
                if lib.norm_ws(piece):
                    out.append(lib.norm_ws(piece))


def parse_section(body: bytes, today: dt.date) -> dict:
    root = etree.fromstring(body)
    if lib.xml_local(root) != (NS, "section"):
        raise RuntimeError(f"not a dc-library section: {root.tag}")
    number = _text(root.find(_q("num")))
    heading = _text(root.find(_q("heading"))) or None
    reason_el = root.find(_q("reason"))
    reason = _text(reason_el) or (root.get("placeholder") or None)
    lines: list[str] = []
    body_lines(list(root), lines)
    history = [lib.norm_ws(inline(a)) for a in root.iterfind(f"{_q('annotations')}/{_q('annotation')}")
               if a.get("type") == "History"]
    pending = sorted({c.get("doc") for c in root.iter() if lib.xml_local(c)[0] in lib.XML_SKIP_NS
                      and lib.xml_local(c)[1] != "annotation" and c.get("doc")
                      and not any(lib.xml_local(a)[1] == "annotations" for a in c.iterancestors())})
    status = marker = None
    effective = None
    text = "\n".join(lines)
    placeholder = bool(root.get("placeholder")) or lib.norm_ws(text).rstrip(".") == (reason or "").strip().rstrip(".")
    if reason:
        key = reason.strip().rstrip(".").lower()
        applicable = APPLICABLE_RE.match(reason.strip())
        if key in STATUS_REASON:
            status, marker = STATUS_REASON[key], reason
        elif applicable:
            when = dt.datetime.strptime(applicable.group(1), "%B %d, %Y").date()
            effective = {"start": when.isoformat(), "end": None, "note": reason}
            status, marker = ("future_effective" if when > today else "not_recorded"), reason
        elif key.startswith("not fund") or key in NOT_IN_FORCE or placeholder:
            status, marker = "not_recorded", reason  # Not Funded, Not Applicable, Omitted …: no in-force claim
        # any other <reason> annotates an editorial substitution in an in-force text ("Commissioner", "Family Court")
    if status is None and OMITTED_RE.match(heading or ""):
        status, marker = "not_recorded", heading
    if status is None:
        status, marker = lib.classify_status(heading, text)
    if status is None and not text:  # a heading-only entry (e.g. a reorganization plan printed elsewhere)
        status = "not_recorded"
    if pending:
        note = "The publisher's file carries amendment instructions not applied to this text (" + ", ".join(pending) + ")."
        effective = {"start": (effective or {}).get("start"), "end": None,
                     "note": "; ".join(x for x in ((effective or {}).get("note"), note) if x)}
    return {"number": number, "heading": heading, "text": text,
            "history": "\n".join(h for h in history if h) or None, "status": status, "marker": marker, "effective": effective}


def container_step(el) -> dict:
    prefix = _text(el.find(_q("prefix")))
    number = _text(el.find(_q("num"))) or None
    heading = _text(el.find(_q("heading"))) or None
    level = PREFIX_LEVEL.get(prefix.lower(), "other") if prefix else "other"
    label = prefix[:1].upper() + prefix[1:].lower() if prefix and prefix.isupper() and len(prefix) > 1 else (prefix or "Group")
    return {"level": level, "label": label, "number": number, "heading": heading}


def walk_title(index: bytes) -> tuple[dict, list[tuple[list[dict], str]]]:
    """(title step, [(container path below the title, section file relative to the title dir)]) in printed order."""
    root = etree.fromstring(index)
    title = container_step(root)
    out: list[tuple[list[dict], str]] = []

    def walk(el, path: list[dict]) -> None:
        for child in el:
            ns, name = lib.xml_local(child)
            if ns == XI and name == "include":
                out.append((path, child.get("href", "").removeprefix("./")))
            elif ns == NS and name == "container":
                walk(child, path + [container_step(child)])

    walk(root, [])
    return title, out


def walk_code(index: bytes) -> tuple[list[tuple[dict | None, str]], dict]:
    """[(division step or None, title index path)] in printed order, and the <recency> element's attributes."""
    root = etree.fromstring(index)
    division = None
    titles: list[tuple[dict | None, str]] = []
    for child in root:
        ns, name = lib.xml_local(child)
        if ns == NS and name == "subheading":
            m = DIVISION_RE.match(_text(child))
            division = ({"level": "division", "label": "Division", "number": m.group(1), "heading": m.group(2) or None}
                        if m else {"level": "other", "label": "Group", "number": None, "heading": _text(child)})
        elif ns == XI and name == "include":
            titles.append((division, child.get("href", "").removeprefix("./")))
    recency = root.find(f"{_q('meta')}/{_q('recency')}")
    info = {"through": recency.get("through") if recency is not None else None}
    if recency is not None:
        for item in recency:
            info[lib.xml_local(item)[1]] = item.get("doc")
    return titles, info


# "Title 99. Reserved sections." holds "<number>(Perm)" copies of sections currently amended by emergency or temporary
# legislation; each prints "*NOTE: This codification is not the most current, due to recent law changes." The section
# without the suffix is the current text (it carries the emergency/temporary amendments), so the copy is not emitted.
PERM_NOTE = "permanent-version copy (publisher: not the most current codification); the current text is the unsuffixed section"

SAMPLE_47 = {"47-1390", "47-2890.01", "47-4801", "47-1806.03", "47-1005.03", "47-441", "47-1353.01", "47-1801.05",
             "47-1221"}


def acquire(ctx: lib.RunContext) -> None:
    meta_page = ctx.fetch(METADATA)
    build = json.loads(meta_page.body)["meta"]["build"]
    commit = next((r["commit"] for r in build.get("repositories", []) if r.get("name") == REPO_NAME), None)
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RuntimeError(f"metadata.json names no {REPO_NAME} commit")
    temp = None
    if ctx.raw_root is not None:
        workdir = ctx.raw_root / "dc" / "_git"
    else:
        temp = tempfile.mkdtemp(prefix="dc-git-")
        workdir = pathlib.Path(temp)
    if workdir.exists():
        shutil.rmtree(workdir)
    repo = Repo(workdir, commit)
    retrieved = lib.utcnow()
    try:
        repo.open([f"{CODE_DIR}/index.xml"])

        def source(path: str, body: bytes) -> lib.Fetched:
            return ctx.member({"url": f"{REPO}/blob/{commit}/{path}", "retrieved_at": retrieved}, path, body)

        code_path = f"{CODE_DIR}/index.xml"
        code_index = source(code_path, repo.blob(code_path))
        titles, recency = walk_code(code_index.body)
        ctx.log(f"commit {commit}: {len(titles)} titles; recency {recency}")
        extra = [f"recency law {recency['law']}" if recency.get("law") else "",
                 f"emergency act {recency['emergency']}" if recency.get("emergency") else ""]
        ctx.edition(edition_label=None, currency_statement=None,
                    currency_source_url=f"{REPO}/blob/{commit}/{code_path}", currency_through=recency.get("through"),
                    source_last_modified="; ".join(x for x in (f"build-date {build.get('build-date')}",
                                                               f"codified-date {build.get('codified-date')}", *extra) if x))
        if ctx.sample is not None:
            titles = [t for t in titles if t[1] in ("titles/12/index.xml", "titles/47/index.xml")]
        listed = unlisted = 0
        for division, title_rel in titles:
            if not ctx.want_more():
                break
            title_dir = f"{CODE_DIR}/{title_rel.rsplit('/', 1)[0]}"
            repo.open([f"{title_dir}/"])
            index = source(f"{CODE_DIR}/{title_rel}", repo.blob(f"{CODE_DIR}/{title_rel}"))
            title_step, entries = walk_title(index.body)
            base = ([division] if division else []) + [title_step]
            included = {f"{title_dir}/{rel}" for _p, rel in entries}
            unlisted += sum(1 for p in repo.files(f"{title_dir}/sections/") if p not in included)
            for path, rel in entries:
                if not ctx.want_more():
                    break
                file_path = f"{title_dir}/{rel}"
                if ctx.sample is not None and title_rel.startswith("titles/47/") and \
                        pathlib.PurePosixPath(rel).stem not in SAMPLE_47:
                    continue
                page = source(file_path, repo.blob(file_path))
                parsed = parse_section(page.body, ctx.today)
                listed += 1
                if parsed["number"].endswith("(Perm)"):  # see PERM_NOTE
                    ctx._rejects.write({"state": "DC", "code": "DCC", "number": parsed["number"], "reason": PERM_NOTE,
                                        "source_url": page.url, "source_sha256": page.sha256})
                    continue
                ctx.section(code="DCC", number=parsed["number"].strip("[]"), heading=parsed["heading"], text=parsed["text"],
                            history=parsed["history"], source=page, path=base + path, status=parsed["status"],
                            status_marker=parsed["marker"], effective=parsed["effective"])
        ctx.log(f"{listed} sections read; {unlisted} section files not listed by a title index (not emitted)")
    finally:
        repo.close()
        shutil.rmtree(workdir, ignore_errors=True)
        if temp:
            shutil.rmtree(temp, ignore_errors=True)
