"""Minimal service-role PostgREST helper (public schema only).

Credentials come from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY environment variables only.
They are never printed, logged or written. Error messages are scrubbed of the key.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

EXPECTED_HOST = "xosqzzsnhxcyehcnirpa.supabase.co"


def _cfg():
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "")
    if urllib.parse.urlparse(url).hostname != EXPECTED_HOST or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL (corpus project) and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY are required in the environment")
    return url, key


def scrub(text):
    key = os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "")
    return text.replace(key, "[REDACTED]") if key else text


def request(path, *, method="GET", body=None, headers=None, retries=5, timeout=180):
    url, key = _cfg()
    h = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):
        h["Authorization"] = "Bearer " + key
    h.update(headers or {})
    data = None if body is None else json.dumps(body).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(url + "/rest/v1/" + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return (json.loads(raw) if raw else None), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            if (e.code == 429 or e.code >= 500) and attempt < retries:
                time.sleep(min(60, 2 ** attempt))
                continue
            raise RuntimeError(f"HTTP {e.code}: {scrub(raw)[:400]}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < retries:
                time.sleep(min(60, 2 ** attempt))
                continue
            raise RuntimeError("network failure: " + scrub(str(e))) from None


def rpc(name, args):
    return request("rpc/" + name, method="POST", body=args)[0]


def select_all(dataset, select, *, page=1000, extra=""):
    """Keyset-paged read of public.corpus_records for one dataset, ordered by id."""
    last = None
    while True:
        q = f"corpus_records?dataset=eq.{dataset}&select={urllib.parse.quote(select, safe=',:()>-_*')}&order=id.asc&limit={page}{extra}"
        if last is not None:
            q += "&id=gt." + urllib.parse.quote(last, safe="")
        rows, _ = request(q)
        if not rows:
            return
        yield from rows
        last = rows[-1]["id"]
        if len(rows) < page:
            return
