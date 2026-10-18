"""Write files atomically with a short bounded retry when the shared disk reports no space (ENOSPC / EDQUOT).

The retry only rides out brief dips; after `tries` attempts the error is raised so the run stops visibly instead of looping.
"""
import errno
import json
import os
import time


def write_bytes(path, data, tries=20, delay=1.0):
    tmp = path + ".part"
    last = None
    for _ in range(tries):
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
            return
        except OSError as e:
            last = e
            if e.errno not in (errno.ENOSPC, errno.EDQUOT):
                raise
            time.sleep(delay)
    raise last


def write_text(path, text, **kw):
    write_bytes(path, text.encode("utf-8"), **kw)


def write_json(path, obj, **kw):
    write_text(path, json.dumps(obj, ensure_ascii=False), **kw)
