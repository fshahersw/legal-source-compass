"""Embedding client for the semantic index (HTTP only; the key never leaves this process).

The key is read with scripts/enrichment/court_rules/secrets_env.py `load("VOYAGE_API_KEY")` (private secrets file or the
environment), is sent only in the Authorization header, and is scrubbed from every error text. Requests are batched, retried with
exponential backoff on 429 and 5xx (honouring Retry-After) and on network errors, and every response's token usage is returned so
the caller can keep the budget. Inputs are embedded as "document" for the index and as "query" for searches.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from collections.abc import Callable

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "enrichment", "court_rules"))

MODEL = "voyage-law-2"
DIMENSIONS = 1024
URL = "https://api.voyageai.com/v1/embeddings"
USER_AGENT = "LegalSourceAtlas/1.0 (research)"
MAX_INPUTS = 128
MAX_REQUEST_TOKENS = 100_000  # the service allows 120,000 per request; leave headroom for the estimate's error
RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524}


class EmbeddingError(RuntimeError):
    pass


class RateLimited(EmbeddingError):
    pass


Transport = Callable[[str, dict, bytes, float], tuple[int, dict, bytes]]


def _requests_transport(url: str, headers: dict, body: bytes, timeout: float) -> tuple[int, dict, bytes]:
    import requests

    r = requests.post(url, headers=headers, data=body, timeout=timeout)
    return r.status_code, dict(r.headers), r.content


def load_key() -> str:
    import secrets_env

    return secrets_env.load("VOYAGE_API_KEY")


class VoyageClient:
    def __init__(
        self,
        key: str | None = None,
        *,
        model: str = MODEL,
        url: str = URL,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        max_attempts: int = 7,
        timeout: float = 120.0,
    ):
        self._key = key if key is not None else load_key()
        self.model = model
        self.url = url
        self._transport = transport or _requests_transport
        self._sleep = sleep
        self.max_attempts = max_attempts
        self.timeout = timeout
        self.retries = 0
        self.rate_limited = 0

    def _scrub(self, text: str) -> str:
        return text.replace(self._key, "<key>") if self._key else text

    def embed(self, texts: list[str], input_type: str) -> tuple[np.ndarray, int]:
        """Embeddings as a float16 array (len(texts), 1024) and the tokens the service billed for the request."""
        if input_type not in ("document", "query"):
            raise ValueError("input_type must be 'document' or 'query'")
        if not texts or len(texts) > MAX_INPUTS or any(not t.strip() for t in texts):
            raise ValueError("a request needs 1 to 128 non-empty texts")
        body = json.dumps(
            {"input": texts, "model": self.model, "input_type": input_type, "encoding_format": "base64"},
            ensure_ascii=False,
        ).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        delay = 1.5
        last = "no attempt"
        for attempt in range(self.max_attempts):
            try:
                status, resp_headers, raw = self._transport(self.url, headers, body, self.timeout)
            except Exception as exc:  # noqa: BLE001 - network errors are retried, then reported without the key
                last = f"network error {type(exc).__name__}"
                status, resp_headers, raw = 0, {}, b""
            else:
                if status == 200:
                    return self._parse(raw, len(texts))
                last = f"HTTP {status}: {self._scrub(raw[:200].decode('utf-8', 'replace'))}"
                if status not in RETRY_STATUS:
                    raise EmbeddingError(last)
            if status == 429:
                self.rate_limited += 1
            if attempt + 1 == self.max_attempts:
                break
            self.retries += 1
            wait = delay
            retry_after = {k.lower(): v for k, v in resp_headers.items()}.get("retry-after")
            if retry_after and retry_after.replace(".", "", 1).isdigit():
                wait = max(wait, min(float(retry_after), 120.0))
            self._sleep(wait)
            delay = min(delay * 2, 60.0)
        raise (RateLimited if "429" in last else EmbeddingError)(f"embedding request failed after retries ({last})")

    def _parse(self, raw: bytes, n: int) -> tuple[np.ndarray, int]:
        try:
            data = json.loads(raw)
            rows = sorted(data["data"], key=lambda r: r["index"])
            tokens = int(data["usage"]["total_tokens"])
            out = np.empty((n, DIMENSIONS), dtype=np.float16)
            if len(rows) != n:
                raise ValueError("wrong number of embeddings")
            for i, r in enumerate(rows):
                emb = r["embedding"]
                vec = (
                    np.frombuffer(base64.b64decode(emb), dtype="<f4")
                    if isinstance(emb, str)
                    else np.asarray(emb, dtype=np.float32)
                )
                if vec.shape != (DIMENSIONS,) or not np.isfinite(vec).all():
                    raise ValueError("bad embedding")
                out[i] = vec.astype(np.float16)
            return out, tokens
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise EmbeddingError(f"malformed embedding response ({type(exc).__name__})") from None
