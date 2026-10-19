"""Print the model ids the configured model API key can use (ids only; the key is never printed)."""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import secrets_env  # noqa: E402

key = secrets_env.load("ANTHROPIC_API_KEY")
req = urllib.request.Request("https://api.anthropic.com/v1/models?limit=100",
                             headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
print([m["id"] for m in json.loads(urllib.request.urlopen(req, timeout=60).read())["data"]])
