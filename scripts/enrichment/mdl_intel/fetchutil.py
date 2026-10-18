"""Small HTTP helper for the mdl-intel lane: polite fetches with retries, raw bytes cached unchanged."""
import hashlib
import time
import urllib.parse
from pathlib import Path

import requests

UA = "SeegerWeiss Research firasshaher99@gmail.com"
ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "mdl-intel"

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept": "*/*"})


def cache_path(url: str, sub: str = "pages") -> Path:
    parsed = urllib.parse.urlparse(url)
    name = Path(urllib.parse.unquote(parsed.path)).name or "index"
    stem = hashlib.sha1(url.encode()).hexdigest()[:10]
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in name)[:90]
    return ACQ / sub / f"{stem}_{safe}"


def fetch(url: str, sub: str = "pages", refresh: bool = False, timeout: int = 60) -> tuple[bytes, Path, int]:
    """Return (bytes, cached path, status). Cached copy is the unchanged response body."""
    path = cache_path(url, sub)
    if path.exists() and not refresh:
        return path.read_bytes(), path, 200
    path.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for attempt in range(4):
        try:
            resp = _session.get(url, timeout=timeout, allow_redirects=True)
            if resp.status_code in (429, 500, 502, 503, 504):
                last = resp.status_code
                time.sleep(2 ** attempt)
                continue
            if resp.status_code == 200:
                path.write_bytes(resp.content)
            return resp.content, path, resp.status_code
        except requests.RequestException as error:  # network blip
            last = str(error)
            time.sleep(2 ** attempt)
    return b"", path, int(last) if isinstance(last, int) else 0
