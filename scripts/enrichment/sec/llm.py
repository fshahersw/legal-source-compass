"""Small JSON-returning model calls for SEC document extraction, cached by request hash.

The key is read from ANTHROPIC_API_KEY in the environment and never logged. Every caller validates the answer against the
source text or XBRL facts before using it; an answer that cannot be validated is dropped.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request

from sec_http import ACQ

MODEL = "claude-haiku-5-5"
CACHE = ACQ / "llm"


def ask_json(system: str, user: str, *, max_tokens: int = 1200, model: str = MODEL) -> dict | list | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    digest = hashlib.sha256(json.dumps([model, system, user, max_tokens]).encode()).hexdigest()
    path = CACHE / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text())["answer"]
    body = json.dumps({"model": model, "max_tokens": max_tokens, "system": system,
                       "messages": [{"role": "user", "content": user}]}).encode()
    for attempt in range(5):
        request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST",
                                         headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read().decode())
            break
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 529) and attempt < 4:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"model request failed: HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(3 * (attempt + 1))
                continue
            raise
    text = "".join(b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text")
    match = re.search(r"\{.*\}|\[.*\]", text, re.S)
    answer = None
    if match:
        try:
            answer = json.loads(match.group(0))
        except json.JSONDecodeError:
            answer = None
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"model": model, "answer": answer, "usage": payload.get("usage")}))
    return answer


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("’", "'").replace("“", '"').replace("”", '"')).strip()


def verbatim(quote: str | None, source: str) -> bool:
    """True when the quote appears in the source text (whitespace and curly quotes normalized)."""
    return bool(quote) and len(quote) >= 40 and normalize(quote) in normalize(source)
