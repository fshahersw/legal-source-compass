"""Small JSON helpers: gzip-compressed derived files (the disk shared by the enrichment streams is nearly full) and
atomic writes (a failed write never leaves a truncated file behind)."""
import errno
import gzip
import json
import os
import time
from pathlib import Path


def dump(path, obj, indent=None, retries=120, wait=3.0):
    """Write obj as JSON to path ('.gz' suffix compresses). Writes a temp file first and renames it on success."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    data = json.dumps(obj, sort_keys=True, separators=(",", ":") if indent is None else None, indent=indent, ensure_ascii=False).encode("utf-8")
    for attempt in range(retries + 1):
        try:
            if path.suffix == ".gz":
                with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as fh:
                    fh.write(data)
            else:
                tmp.write_bytes(data)
            os.replace(tmp, path)
            return len(data)
        except OSError as error:
            if error.errno != errno.ENOSPC or attempt == retries:
                raise
            time.sleep(wait)  # the disk is shared with other streams and can be momentarily full: wait, do not hoard
        finally:
            if tmp.exists():
                tmp.unlink()
    return len(data)


def load(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))
    return json.loads(path.read_text(encoding="utf-8"))
