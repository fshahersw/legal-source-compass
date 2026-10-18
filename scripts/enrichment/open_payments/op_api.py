"""Small client for the CMS Open Payments DKAN API (openpaymentsdata.cms.gov) and openFDA."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "SeegerWeiss Research firasshaher99@gmail.com"
OP_BASE = "https://openpaymentsdata.cms.gov/api/1/datastore/query/"
PAGE = 500


def _request(url, body=None, timeout=600):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt + 1)
                continue
            raise RuntimeError(f"{url} -> {e.code}: {e.read().decode()[:500]}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(2 ** attempt + 1)
                continue
            raise


def query_url(dataset_id):
    return f"{OP_BASE}{dataset_id}/0"


def datastore_post(dataset_id, body):
    return _request(query_url(dataset_id), body)


def datastore_all(dataset_id, conditions=None, properties=None):
    """Page through a DKAN datastore resource and return every row."""
    rows, offset = [], 0
    while True:
        body = {"limit": PAGE, "offset": offset, "count": offset == 0, "results": True, "schema": False, "keys": True}
        if conditions:
            body["conditions"] = conditions
        if properties:
            body["properties"] = properties
        data = datastore_post(dataset_id, body)
        if offset == 0:
            total = int(data.get("count") or 0)
        chunk = data.get("results") or []
        rows.extend(chunk)
        offset += len(chunk)
        if not chunk or offset >= total:
            break
    if len(rows) != total:
        raise RuntimeError(f"{dataset_id}: expected {total} rows, read {len(rows)}")
    return rows


def openfda_url(path, params):
    """Build an openFDA URL. '+' is openFDA's clause separator, so literal spaces become %20 and '&' becomes %26."""
    parts = [f"{k}={urllib.parse.quote(str(v), safe='+:[]\"*.,()')}" for k, v in params.items()]
    return f"https://api.fda.gov/{path}?" + "&".join(parts)


def openfda_raw(path, query):
    """GET an openFDA endpoint with an already-encoded query string."""
    return _openfda_get(f"https://api.fda.gov/{path}?{query}")


def openfda(path, params):
    """GET an openFDA endpoint; a 404 means 'no matching records' and returns (url, None)."""
    return _openfda_get(openfda_url(path, params))


def _openfda_get(url):
    time.sleep(0.3)
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return url, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return url, None
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt + 2)
                continue
            raise RuntimeError(f"{url} -> {e.code}: {e.read().decode()[:300]}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(2 ** attempt + 2)
                continue
            raise
