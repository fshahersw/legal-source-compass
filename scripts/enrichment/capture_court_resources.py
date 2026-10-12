"""Capture exact, reviewed court homepages for private resource-link intake.

No database writes or app publication. Retains unchanged response bytes, readable
text and exact observed anchors with source/version hashes. Run from repo root:
  python scripts/enrichment/capture_court_resources.py --input private/court-sources.json --output private/court-resource-capture
Input: {"sources": [{"court_id": "...", "court_name": "...", "source_record": "...", "source_url": "https://...", "identity_reviewed": true}]}
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BYTES = 4 * 1024 * 1024
RESOURCE_LABEL = re.compile(r"\b(?:rules?|forms?|filing|e-filing|cm\s*/\s*ecf|pacer|fees?|standing orders?|general orders?|pro se|representing yourself|clerk|court locations)\b", re.I)


def safe_web_url(value, *, observed_anchor=False):
    try:
        if not isinstance(value, str) or (not observed_anchor and re.search(r"\s", value)):
            return None
        url = urlsplit(value)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443):
            return None
        # Private intake is still a public-source operation, not a local-network fetcher.
        host = url.hostname.lower()
        if host == "localhost" or ":" in host or re.fullmatch(r"[\d.]+", host):
            return None
        return value
    except (ValueError, TypeError):
        return None


def same_host(left, right):
    return urlsplit(left).hostname.removeprefix("www.") == urlsplit(right).hostname.removeprefix("www.")


class PageParser(HTMLParser):
    def __init__(self, source_url):
        super().__init__(convert_charrefs=True)
        self.source_url = source_url
        self.anchors = []
        self.images = []
        self.text = []
        self.anchor = None
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self.ignored += 1
        if self.ignored:
            return
        if tag == "a":
            self.anchor = {"href_as_published": attrs.get("href", ""), "parts": []}
        if tag == "img" and attrs.get("src"):
            url = safe_web_url(urljoin(self.source_url, attrs["src"]))
            if url:
                self.images.append({"url": url, "src_as_published": attrs["src"], "alt": attrs.get("alt", "")})
        if tag in ("p", "div", "li", "br", "h1", "h2", "h3", "section"):
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.ignored = max(0, self.ignored - 1)
        if self.ignored:
            return
        if tag == "a" and self.anchor:
            label = " ".join("".join(self.anchor["parts"]).split())
            # Preserve malformed published anchors in the private evidence. They
            # remain ineligible for requests or reviewed publication.
            url = safe_web_url(urljoin(self.source_url, self.anchor["href_as_published"]), observed_anchor=True)
            if url and label:
                self.anchors.append({"url": url, "label": label, "href_as_published": self.anchor["href_as_published"]})
            self.anchor = None

    def handle_data(self, data):
        if self.ignored:
            return
        self.text.append(data)
        if self.anchor:
            self.anchor["parts"].append(data)


def extract_page(raw, source_url, charset="utf-8"):
    parser = PageParser(source_url)
    parser.feed(raw.decode(charset, errors="replace"))
    unique = {}
    for anchor in parser.anchors:
        if RESOURCE_LABEL.search(anchor["label"]):
            unique.setdefault((anchor["url"], anchor["label"]), anchor)
    text = "\n".join(line for part in "".join(parser.text).splitlines() if (line := " ".join(part.split()))) + "\n"
    return {"anchors": list(unique.values()), "image_candidates": parser.images}, text


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_page(source_url):
    opener = build_opener(NoRedirect)
    url = source_url
    redirects = []
    for _ in range(5):
        try:
            response = opener.open(Request(url, headers={"User-Agent": "LegalSourceCompass-source-review/1.0", "Accept": "text/html"}), timeout=20)
        except HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            destination = safe_web_url(urljoin(url, error.headers.get("Location", "")))
            if not destination or not same_host(source_url, destination):
                raise ValueError("Redirect leaves the reviewed source host")
            redirects.append({"from": url, "to": destination, "status": error.code})
            url = destination
            continue
        with response:
            if response.headers.get_content_type() not in ("text/html", "application/xhtml+xml"):
                raise ValueError("Source did not return HTML")
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("Source exceeds bounded capture size")
            return body, url, response.headers.get_content_charset() or "utf-8", redirects
    raise ValueError("Too many redirects")


def save_immutable(path, body):
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError(f"Immutable evidence conflict: {path.name}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(body)


def capture(sources, output):
    records = []
    for source in sources:
        if not re.fullmatch(r"[a-z0-9_-]{1,80}", source.get("court_id", "")) or not source.get("court_name") or not source.get("source_record") or source.get("identity_reviewed") is not True or not safe_web_url(source.get("source_url")):
            raise ValueError("Every source needs a reviewed exact court identity, provenance record and public HTTPS URL")
    for source in sources:
        record = {**source, "retrieved_at": datetime.now(timezone.utc).isoformat(), "publication": "not_published"}
        try:
            body, final_url, charset, redirects = fetch_page(source["source_url"])
            digest = hashlib.sha256(body).hexdigest()
            extracted, text = extract_page(body, final_url, charset)
            text_bytes = text.encode("utf-8")
            text_digest = hashlib.sha256(text_bytes).hexdigest()
            save_immutable(output / "raw" / f"{digest}.raw", body)
            save_immutable(output / "text" / f"{text_digest}.txt", text_bytes)
            record.update(status="captured", final_url=final_url, response_sha256=digest, response_bytes=len(body), response_charset=charset, text_sha256=text_digest, redirects=redirects, **extracted)
        except Exception as error:
            # Source blocks remain blocked; there is no proxy, cache substitution or retry bypass.
            record.update(status="not_captured", error=str(error))
        encoded = (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        receipt_digest = hashlib.sha256(encoded).hexdigest()
        save_immutable(output / "receipts" / f"{receipt_digest}.json", encoded)
        records.append({"court_id": source["court_id"], "status": record["status"], "receipt_sha256": receipt_digest, "anchors": len(record.get("anchors", []))})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    private_root = (Path.cwd() / "private").resolve()
    output = args.output.resolve()
    if not output.is_relative_to(private_root):
        raise ValueError("Capture output must stay under the ignored private directory")
    sources = json.loads(args.input.read_text(encoding="utf-8-sig"))["sources"]
    if not isinstance(sources, list) or not 1 <= len(sources) <= 20:
        raise ValueError("A bounded list of 1–20 reviewed source pages is required")
    print(json.dumps({"schema": "court-resource-capture/1", "publication": "not_published", "results": capture(sources, output)}))


if __name__ == "__main__":
    main()
