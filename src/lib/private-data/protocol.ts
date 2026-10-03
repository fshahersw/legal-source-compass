export const SNAPSHOT_PAGE_BYTES = 256 * 1024;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export function snapshotName(value: string): string {
  const name = value.startsWith("/data/") ? value.slice(6) : value;
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(?:jsonl?|xlsx|txt|csv)$/.test(name)
    || name.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid snapshot name");
  }
  return name;
}

export function snapshotPage(value: string | null): number {
  if (value === null) return 0;
  if (!/^(0|[1-9][0-9]{0,4})$/.test(value)) throw new Error("Invalid snapshot page");
  return Number(value);
}

export function snapshotPageBounds(bytes: number, page: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SNAPSHOT_BYTES
    || !Number.isSafeInteger(page) || page < 0) throw new Error("Invalid snapshot bounds");
  const pages = Math.ceil(bytes / SNAPSHOT_PAGE_BYTES);
  if (page >= pages) throw new Error("Snapshot page out of range");
  return { start: page * SNAPSHOT_PAGE_BYTES, end: Math.min(bytes, (page + 1) * SNAPSHOT_PAGE_BYTES), pages };
}
