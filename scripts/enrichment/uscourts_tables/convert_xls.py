"""Convert acquired legacy .xls workbooks (Bankruptcy Filings 2001-2016) to .xlsx so utx_parse can read them.

The published .xls stays untouched in the raw store; the conversion (LibreOffice headless, cell values copied as they are)
is a derived file under private/build/uscourts_tables/xls_converted/<sha256>.xlsx so a file is converted once and the
conversion is tied to the raw bytes by hash. Usage: python3 -I -B convert_xls.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

OUT = F.ROOT / "private" / "build" / "uscourts_tables" / "xls_converted"


def main():
    index = json.loads((F.ACQ / "files_index.json").read_text())
    todo = [(k, e) for k, e in sorted(index.items()) if e.get("status") == 200 and e.get("format") == "xls"]
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [(k, e) for k, e in todo if not (OUT / f"{e['sha256']}.xlsx").exists()]
    print(len(todo), "files to convert", flush=True)
    for start in range(0, len(todo), 40):
        batch = todo[start:start + 40]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            names = []
            for k, e in batch:
                src = tmp / f"{e['sha256']}.xls"
                src.write_bytes(F.read_stored(F.ROOT / e["path"]))
                names.append(str(src))
            outdir = tmp / "out"
            outdir.mkdir()
            subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir", str(outdir)] + names, check=True, capture_output=True, timeout=900)
            for k, e in batch:
                produced = outdir / f"{e['sha256']}.xlsx"
                if produced.exists():
                    (OUT / produced.name).write_bytes(produced.read_bytes())
                else:
                    print("  conversion failed:", k)
        print(f"  {min(start + 40, len(todo))}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()
