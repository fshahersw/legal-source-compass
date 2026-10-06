#!/usr/bin/env python3
"""Prepare staged/manifest.json derivatives[] for to_landing_packet.py."""
import argparse
import hashlib
import json
import os
import sys


def jl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def member_from_row(row, field):
    if field == "title":
        for item in row.get("citation_path") or []:
            if item.get("level") == "title":
                return str(item.get("number"))
        return None
    if field == "id-chapter":
        title = chapter = None
        for item in row.get("citation_path") or []:
            if item.get("level") == "title":
                title = item.get("number")
            elif item.get("level") == "chapter":
                chapter = item.get("number")
        if title is None or chapter is None:
            return None
        return "%s-%s" % (title, chapter)
    parts = field.split(".")
    cur = row
    for p in parts:
        cur = cur[p]
    return str(cur)


def derivative_body(rows):
    lines = []
    for row in rows:
        if row.get("citation"):
            lines.append(row["citation"])
        if row.get("heading"):
            lines.append(row["heading"])
        if row.get("status_label"):
            lines.append("[%s]" % row["status_label"])
        if row.get("text"):
            lines.append(row["text"])
        if row.get("history"):
            lines.append(row["history"])
        lines.append("")
    return ("\n".join(lines).strip() + "\n").encode("utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--from-files-role", help="copy derivatives from manifest files with this role")
    ap.add_argument("--from-files-member-field", default="member")
    ap.add_argument("--build", choices=("source.member", "title", "id-chapter"), help="build derivative files from sections")
    ap.add_argument("--subdir", default="chapters")
    a = ap.parse_args()
    root = a.root
    manifest_path = os.path.join(root, "staged/manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    staged = os.path.join(root, "staged")

    if a.build:
        sub = os.path.join(staged, a.subdir)
        os.makedirs(sub, exist_ok=True)
        groups = {}
        for row in jl(os.path.join(root, "parsed/sections.jsonl")):
            member = member_from_row(row, a.build)
            if member is None:
                continue
            groups.setdefault(member, []).append(row)
        deriv = []
        for member, rows in groups.items():
            body = derivative_body(rows)
            digest = sha_bytes(body)
            rel = "%s/%s" % (a.subdir, digest)
            path = os.path.join(staged, rel)
            if not os.path.exists(path):
                open(path, "wb").write(body)
            deriv.append({"sha256": digest, "bytes": len(body), "member": member, "path": rel})
        manifest["derivatives"] = deriv
        json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(json.dumps({"built_derivatives": len(deriv), "groups": len(groups)}))
        return 0

    if a.from_files_role:
        deriv = []
        for item in manifest.get("files", []):
            if item.get("role") != a.from_files_role:
                continue
            path = item.get("path", "")
            if path.startswith("staged/"):
                path = path[len("staged/") :]
            member = item.get(a.from_files_member_field)
            if member is None and item.get("chapter_number") is not None:
                member = item.get("chapter_number")
            if member is None:
                continue
            deriv.append(
                {
                    "sha256": item["sha256"],
                    "bytes": item["bytes"],
                    "member": str(member),
                    "path": path,
                }
            )
        manifest["derivatives"] = deriv
        json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(json.dumps({"derivatives": len(deriv)}))
        return 0

    print("need --build or --from-files-role", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
