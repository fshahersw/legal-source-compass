"""Read one named key from private/scratch/secrets.env (KEY=VALUE lines, optional `export` and quotes).

Equivalent to sourcing the file for the one process that needs the key: the value goes into this process's environment
only, and is never printed or written anywhere.
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
PATH = os.path.join(ROOT, "private", "scratch", "secrets.env")


def load(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    with open(PATH, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("export "):
                line = line[7:].strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == name:
                value = value.strip().strip('"').strip("'")
                os.environ[name] = value
                return value
    raise SystemExit(f"{name} is not set in secrets.env")
