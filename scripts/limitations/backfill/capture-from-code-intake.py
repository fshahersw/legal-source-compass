#!/usr/bin/env python3
"""Record a limitations capture from the official publisher text already landed by the full-code intake.

Used only when the official host cannot be read from the review environment (certificate-chain or proxy failures):
the section text and its official URL come from the reviewed intake (corpus_publisher_code_projected_section_v2),
and capture.py stores it as an intermediary extraction (route "extraction", capped at medium confidence).

Usage: capture-from-code-intake.py ST CAPTURE_ID NATIVE_ID
Env: EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_KEY (never written), LIM_WORK.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent


def section(state, native_id):
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/corpus_publisher_code_projected_section_v2"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    request = urllib.request.Request(
        url, data=json.dumps({"p_jurisdiction": state, "p_native_id": native_id}).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main():
    state, capture_id, native_id = sys.argv[1:4]
    row = section(state, native_id)
    if not row or not row.get("text") or not row.get("source_url"):
        print(json.dumps({"ok": False, "reason": "section not found in intake", "native_id": native_id}))
        sys.exit(1)
    work = Path(os.environ.get("LIM_WORK", "/tmp/lim/backfill"))
    text_dir = work / "code-intake-text"
    text_dir.mkdir(parents=True, exist_ok=True)
    text_path = text_dir / f"{capture_id}.txt"
    heading = row.get("citation") or native_id
    text_path.write_text(f"{heading}\n{row['text']}\n{row.get('history') or ''}".strip() + "\n", encoding="utf-8")
    currency = row.get("currency") or {}
    method = (
        f"Official publisher text landed by the full-code intake (corpus native id {row['native_id']}; "
        f"edition {currency.get('edition') or 'not recorded'}; {currency.get('statement') or 'currency statement not recorded'}); "
        "used because the official host could not be read directly from the review environment"
    )
    result = subprocess.run(
        ["python3", str(HERE / "capture.py"), state, capture_id, row["source_url"], "--text-file", str(text_path), "--method", method],
        capture_output=True, text=True, env=os.environ, timeout=300)
    print((result.stdout or result.stderr).strip().splitlines()[-1])
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
