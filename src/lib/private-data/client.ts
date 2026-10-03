import { supabase } from "@/integrations/supabase/client";
import { MAX_SNAPSHOT_BYTES, snapshotName, snapshotPageBounds } from "./protocol";

/**
 * Fetch a snapshot in bounded pages, preserving its exact bytes. A session token is attached when one exists;
 * whether an account is required is decided by the server (CORPUS_REQUIRE_AUTH), which answers 401 when it is.
 */
export async function fetchBundleSnapshot(url: string, _options?: RequestInit): Promise<Response> {
  const file = snapshotName(url);
  const session = await supabase.auth
    .getSession()
    .then(({ data }) => data.session)
    .catch(() => null);
  const token = session?.access_token;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const request = (page: number, version?: string) => fetch(
    `/api/bundles?${new URLSearchParams({ file, page: String(page), ...(version ? { version } : {}) })}`,
    { headers, cache: "no-store", credentials: "same-origin", ...(_options?.signal ? { signal: _options.signal } : {}) },
  );
  const first = await request(0);
  if (!first.ok) return first;
  const sha = first.headers.get("X-Atlas-Snapshot-Sha256") ?? "";
  const total = Number(first.headers.get("X-Atlas-Snapshot-Bytes"));
  if (!/^[a-f0-9]{64}$/.test(sha) || !Number.isSafeInteger(total) || total < 1 || total > MAX_SNAPSHOT_BYTES) {
    throw new Error("Invalid private snapshot manifest");
  }
  const bounds = snapshotPageBounds(total, 0);
  const bytes = new Uint8Array(total);
  const read = async (response: Response, page: number) => {
    if (!response.ok) throw new Error(`Private snapshot page failed (${response.status}).`);
    if (response.headers.get("X-Atlas-Snapshot-Sha256") !== sha
      || response.headers.get("X-Atlas-Snapshot-Bytes") !== String(total)
      || response.headers.get("X-Atlas-Page") !== String(page)
      || response.headers.get("X-Atlas-Page-Count") !== String(bounds.pages)) throw new Error("Snapshot version changed");
    const part = new Uint8Array(await response.arrayBuffer());
    const expected = snapshotPageBounds(total, page);
    if (part.length !== expected.end - expected.start) throw new Error("Incomplete snapshot page");
    bytes.set(part, expected.start);
  };
  await read(first, 0);
  let next = 1;
  await Promise.all(Array.from({ length: Math.min(4, bounds.pages - 1) }, async () => {
    while (next < bounds.pages) { const page = next++; await read(await request(page, sha), page); }
  }));
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== sha) throw new Error("Private snapshot checksum mismatch");
  return new Response(bytes, { headers: { "Content-Type": file.endsWith(".json") ? "application/json" : "application/octet-stream", "Cache-Control": "no-store" } });
}

export async function downloadBundleSnapshot(file: string) {
  const response = await fetchBundleSnapshot(file);
  if (!response.ok) throw new Error(`Snapshot download failed (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = snapshotName(file).split("/").at(-1) ?? "atlas-data.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
