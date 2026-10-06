"""Shared, resumable, provenance-keeping capture helper for state-code acquisition.

Every response body is stored content-addressed (raw/<sha256[:2]>/<sha256>) and every
request is journalled in captures.jsonl with URL, HTTP status, headers of record,
retrieval time, byte count, sha256 and fetch method. Nothing here bypasses a terms,
login, captcha or paywall gate: a gate response is journalled as a gate and the caller
stops. Credentials are read from environment variables only and never written.
"""
from __future__ import annotations

import hashlib
import json
import os
import ssl
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import requests

UA = "LegalSourceAtlas-corpus/1.0 (+state-code acquisition; contact: owner via repository)"
GATE_MARKERS = (
    b"captcha", b"cf-chl", b"attention required", b"access denied", b"terms of use and conditions",
    b"accept the terms", b"i agree to the terms", b"please enable javascript and cookies",
)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Capturer:
    """Polite, resumable fetcher. One instance per state; safe across threads."""

    def __init__(self, state: str, root: str | Path, min_interval: float = 1.0,
                 timeout: float = 60, max_retries: int = 4, ua: str = UA,
                 accept_missing_intermediate: bool = True):
        self.state = state.upper()
        self.root = Path(root)
        self.raw = self.root / "raw"
        self.raw.mkdir(parents=True, exist_ok=True)
        self.journal_path = self.root / "captures.jsonl"
        self.min_interval = min_interval
        self.timeout = timeout
        self.max_retries = max_retries
        self.ua = ua
        self.accept_missing_intermediate = accept_missing_intermediate
        self._lock = threading.Lock()
        self._host_next: dict[str, float] = {}
        self._verify: dict[str, object] = {}
        self._done: dict[str, dict] = {}
        self.session = requests.Session()
        self.session.headers["User-Agent"] = ua
        if self.journal_path.exists():
            for line in self.journal_path.read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    if r.get("http_status") == 200 and r.get("sha256"):
                        self._done[r["url"]] = r

    # -- storage ---------------------------------------------------------
    def path_for(self, sha: str) -> Path:
        return self.raw / sha[:2] / sha

    def read(self, sha: str) -> bytes:
        return self.path_for(sha).read_bytes()

    def _store(self, body: bytes) -> str:
        sha = sha256_bytes(body)
        p = self.path_for(sha)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".part")
            tmp.write_bytes(body)
            os.replace(tmp, p)
        return sha

    def _journal(self, rec: dict) -> None:
        with self._lock, open(self.journal_path, "a") as f:
            f.write(json.dumps(rec, sort_keys=True, ensure_ascii=False) + "\n")

    # -- pacing ----------------------------------------------------------
    def _wait(self, host: str) -> None:
        with self._lock:
            now = time.monotonic()
            at = max(now, self._host_next.get(host, 0.0))
            self._host_next[host] = at + self.min_interval
        if at > now:
            time.sleep(at - now)

    # -- TLS: verify against system roots, completing a missing intermediate via AIA --
    def _verify_arg(self, host: str):
        return self._verify.get(host, True)

    def _complete_chain(self, host: str) -> str | None:
        """Download the intermediate named in the leaf's AIA caIssuers and build a CA bundle
        (certifi roots + that intermediate). Verification stays on: the leaf must still chain
        to a trusted root. Returns the bundle path or None."""
        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization
            from cryptography.x509.oid import AuthorityInformationAccessOID, ExtensionOID
            import certifi
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with ctx.wrap_socket(__import__("socket").create_connection((host, 443), 20), server_hostname=host) as s:
                der = s.getpeercert(binary_form=True)
            leaf = x509.load_der_x509_certificate(der)
            aia = leaf.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_INFORMATION_ACCESS).value
            urls = [d.access_location.value for d in aia if d.access_method == AuthorityInformationAccessOID.CA_ISSUERS]
            pems = []
            for u in urls:
                data = requests.get(u, timeout=30).content
                try:
                    pems.append(x509.load_der_x509_certificate(data).public_bytes(serialization.Encoding.PEM))
                except ValueError:
                    pems.append(x509.load_pem_x509_certificate(data).public_bytes(serialization.Encoding.PEM))
            if not pems:
                return None
            out = self.root / "tls" / f"{host}.pem"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(Path(certifi.where()).read_bytes() + b"\n" + b"\n".join(pems))
            return str(out)
        except Exception:
            return None

    # -- fetch -----------------------------------------------------------
    def fetch(self, url: str, role: str = "page", force: bool = False, headers: dict | None = None,
              expect_status: tuple[int, ...] = (200,), note: str | None = None) -> dict:
        """Direct GET. Returns the journal record (with 'sha256'); body via read(sha)."""
        if not force and url in self._done:
            return self._done[url]
        host = urllib.parse.urlsplit(url).netloc
        last: dict = {}
        for attempt in range(self.max_retries + 1):
            self._wait(host)
            t0 = utcnow()
            rec = {"state": self.state, "url": url, "role": role, "fetch_method": "direct",
                   "proxied": False, "retrieved_at": t0, "attempt": attempt, "user_agent": self.ua}
            if note:
                rec["note"] = note
            try:
                r = self.session.get(url, timeout=self.timeout, headers=headers or {},
                                     verify=self._verify_arg(host), allow_redirects=True)
            except requests.exceptions.SSLError as e:
                if self.accept_missing_intermediate and host not in self._verify:
                    bundle = self._complete_chain(host)
                    if bundle:
                        self._verify[host] = bundle
                        rec["tls_note"] = "server omitted intermediate; chain completed from AIA caIssuers, verification kept on"
                        continue
                rec.update(error=f"ssl: {str(e)[:200]}", http_status=None)
                self._journal(rec)
                last = rec
                time.sleep(2 ** attempt)
                continue
            except requests.exceptions.RequestException as e:
                rec.update(error=f"{type(e).__name__}: {str(e)[:200]}", http_status=None)
                self._journal(rec)
                last = rec
                time.sleep(2 ** attempt)
                continue
            body = r.content
            rec.update(http_status=r.status_code, final_url=r.url, bytes=len(body),
                       content_type=r.headers.get("Content-Type"), etag=r.headers.get("ETag"),
                       last_modified=r.headers.get("Last-Modified"), server_date=r.headers.get("Date"),
                       redirect_chain=[h.url for h in r.history])
            if host in self._verify:
                rec["tls_chain_completed_from_aia"] = True
            low = body[:4000].lower()
            if r.status_code in expect_status:
                if r.status_code == 200 and any(m in low for m in GATE_MARKERS) and len(body) < 20000:
                    rec["possible_gate"] = True
                rec["sha256"] = self._store(body)
                self._journal(rec)
                if r.status_code == 200:
                    self._done[url] = rec
                return rec
            if r.status_code in (429, 500, 502, 503, 504):
                self._journal(rec)
                last = rec
                ra = r.headers.get("Retry-After")
                time.sleep(min(60, float(ra)) if ra and ra.isdigit() else 2 ** (attempt + 1))
                continue
            rec["sha256"] = self._store(body) if body else None
            if r.status_code in (401, 402, 403, 451):
                rec["gate_or_block"] = True
            self._journal(rec)
            return rec
        return last

    def fetch_proxied_firecrawl(self, url: str, role: str = "page", note: str | None = None) -> dict:
        """Fallback only where the direct fetch is bot-blocked. Records proxied=True so the
        evidence is graded lower. Never used for a terms/login gate."""
        key = os.environ.get("FIRECRAWL_API_KEY")
        if not key:
            raise RuntimeError("FIRECRAWL_API_KEY not set")
        self._wait("api.firecrawl.dev")
        t0 = utcnow()
        r = requests.post("https://api.firecrawl.dev/v2/scrape",
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                          json={"url": url, "formats": ["rawHtml"], "timeout": 60000}, timeout=120)
        rec = {"state": self.state, "url": url, "role": role, "fetch_method": "firecrawl-proxy",
               "proxied": True, "retrieved_at": t0, "proxy_http_status": r.status_code, "note": note}
        try:
            d = r.json().get("data", {})
            html = d.get("rawHtml") or ""
            rec["http_status"] = (d.get("metadata") or {}).get("statusCode")
            body = html.encode("utf-8")
            rec.update(bytes=len(body), sha256=self._store(body) if body else None, final_url=(d.get("metadata") or {}).get("url"))
        except Exception as e:
            rec.update(http_status=None, error=f"{type(e).__name__}")
        self._journal(rec)
        return rec

    def text(self, rec: dict, encoding: str | None = None) -> str:
        b = self.read(rec["sha256"])
        for enc in ([encoding] if encoding else []) + ["utf-8", "cp1252", "latin-1"]:
            try:
                return b.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        return b.decode("utf-8", "replace")

    def inventory(self) -> list[dict]:
        out = []
        if self.journal_path.exists():
            for line in self.journal_path.read_text().splitlines():
                if line.strip():
                    out.append(json.loads(line))
        return out
