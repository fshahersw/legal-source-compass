"""Move the FJC Integrated Database zips to private object storage once the aggregates no longer need them.

  python3 -I -B upload_idb.py [file.zip ...]      (default: every zip in private/acq/judiciary/fjc_idb)

Each zip is uploaded to the private Storage bucket `corpus-originals` at fjc_idb/2026-10-22/<filename> with the verified
upload of scripts/enrichment/caselaw/store.py (no overwrite of different bytes; full authenticated readback with SHA-256 and
size comparison). The local file must still match the SHA-256 recorded when it was downloaded (_manifest.jsonl). Only after a
verified receipt is the receipt appended to the manifest and the local copy deleted. Credentials are read by store.py into
this process's environment only; nothing is printed.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

# store.py lives in the main checkout (case-law stream); it reads credentials from that checkout's private/scratch/env.sh
CASELAW = next(p for p in (fl.ROOT / "scripts" / "enrichment" / "caselaw", Path("/home/user/legal-source-compass/scripts/enrichment/caselaw"))
               if (p / "store.py").exists())
sys.path.insert(0, str(CASELAW))
import store  # noqa: E402

store.CONTENT_TYPE = "application/zip"
PREFIX = "fjc_idb/2026-10-22/"
IDB = fl.ACQ / "fjc_idb"


def downloaded_sha(name: str) -> tuple[str, int] | None:
    for line in fl.MANIFEST.read_text().splitlines():
        rec = json.loads(line)
        if rec.get("path") == f"private/acq/judiciary/fjc_idb/{name}" and rec.get("sha256"):
            return rec["sha256"], rec["bytes"]
    return None


def main(names: list[str]) -> None:
    st = store.Storage()
    for path in [IDB / n for n in names] if names else sorted(IDB.glob("*.zip")):
        rec = downloaded_sha(path.name)
        if rec is None:
            raise SystemExit(f"{path.name}: no download record in the manifest")
        sha, n = store.sha256_file(str(path))
        if (sha, n) != rec:
            raise SystemExit(f"{path.name}: local bytes differ from the download record")
        receipt = st.put_verified(PREFIX + path.name, str(path), sha, n)
        entry = {"event": "stored_remote", "path": f"private/acq/judiciary/fjc_idb/{path.name}", "bucket": receipt["bucket"],
                 "object": receipt["key"], "state": receipt["state"], "sha256": sha, "bytes": n,
                 "readback_sha256": receipt["readback_sha256"], "readback_bytes": receipt["readback_bytes"],
                 "verified_at": receipt["verified_at"], "local_copy": "deleted after verified readback",
                 "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        with fl.MANIFEST.open("a") as m:
            m.write(json.dumps(entry, sort_keys=True) + "\n")
        path.unlink()
        print(json.dumps({k: entry[k] for k in ("object", "state", "sha256", "readback_sha256", "bytes")}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
