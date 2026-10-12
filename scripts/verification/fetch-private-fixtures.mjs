#!/usr/bin/env node
/** Restore only active, hash-pinned test snapshots through the application's existing API.
 * No private data enters git; removed/unlisted collections cannot be requested.
 */
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { snapshotName, snapshotPageBounds } from "../../src/lib/private-data/protocol.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function retrieveSnapshot(origin, name, entry, fetcher = fetch) {
  const file = snapshotName(name);
  const bounds = snapshotPageBounds(entry.bytes, 0);
  const parts = [];
  for (let page = 0; page < bounds.pages; page++) {
    const response = await fetcher(
      new URL(
        "/api/bundles?" +
          new URLSearchParams({
            file,
            page: String(page),
            version: entry.sha256,
          }),
        origin,
      ),
      { redirect: "error", signal: AbortSignal.timeout(45000) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("SNAPSHOT_HTTP_" + response.status);
    }
    if (
      response.headers.get("x-atlas-snapshot-sha256") !== entry.sha256 ||
      response.headers.get("x-atlas-snapshot-bytes") !== String(entry.bytes) ||
      response.headers.get("x-atlas-page") !== String(page) ||
      response.headers.get("x-atlas-page-count") !== String(bounds.pages)
    ) {
      await response.body?.cancel();
      throw new Error("SNAPSHOT_VERSION_MISMATCH");
    }
    const expected = snapshotPageBounds(entry.bytes, page);
    const body = Buffer.alloc(expected.end - expected.start);
    if (!response.body) throw new Error("SNAPSHOT_PAGE_SIZE_MISMATCH");
    const reader = response.body.getReader();
    let used = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (used + part.value.length > body.length) {
        await reader.cancel();
        throw new Error("SNAPSHOT_PAGE_SIZE_MISMATCH");
      }
      body.set(part.value, used);
      used += part.value.length;
    }
    if (used !== body.length) throw new Error("SNAPSHOT_PAGE_SIZE_MISMATCH");
    parts.push(body);
  }
  const bytes = Buffer.concat(parts);
  if (hash(bytes) !== entry.sha256) throw new Error("SNAPSHOT_HASH_MISMATCH");
  return bytes;
}
export function fixtureDestination(root, name) {
  const path = resolve(root, snapshotName(name));
  const rel = relative(resolve(root), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("UNSAFE_FIXTURE_PATH");
  return path;
}
/** Refuse existing symlink/junction ancestors, including the private root itself. */
export async function ensureFixturePath(root, name) {
  const destination = fixtureDestination(root, name);
  await assertNoSymlinkPath(destination);
  return destination;
}
export async function assertNoSymlinkPath(destination) {
  for (let item = destination; ; item = dirname(item)) {
    try {
      if ((await lstat(item)).isSymbolicLink()) throw new Error("SYMLINK_FIXTURE_PATH");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (item === dirname(item)) break;
  }
}
async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const at = arg.indexOf("=");
      if (!arg.startsWith("--") || at < 0) throw new Error("Use --name=value arguments");
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  const origin = new URL(args.origin ?? "https://firastest1.com");
  if (
    !["https://firastest1.com", "https://legal-source-compass.lovable.app"].includes(
      origin.origin,
    ) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.username ||
    origin.password
  )
    throw new Error("UNAPPROVED_SNAPSHOT_ORIGIN");
  const root = resolve("private/data");
  const prefix = args.prefix ?? "limitations/";
  if (!prefix.endsWith("/") || prefix.includes("..")) throw new Error("PREFIX_REQUIRED");
  const manifest = JSON.parse(await readFile("src/lib/private-data/manifest.server.json", "utf8"));
  const selected = Object.entries(manifest.files).filter(([name]) => name.startsWith(prefix));
  if (!selected.length) throw new Error("NO_ACTIVE_SNAPSHOTS");
  let cursor = 0;
  const report = {
    schema: "private-fixture-readback/1",
    origin: origin.origin,
    startedAt: new Date().toISOString(),
    prefix,
    selected: selected.length,
    verified: 0,
    reused: 0,
    downloaded: 0,
    errors: [],
  };
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < selected.length) {
        const [name, entry] = selected[cursor++];
        try {
          const destination = await ensureFixturePath(root, name);
          let bytes;
          for (const source of [
            destination,
            ...(args.reuse ? [fixtureDestination(args.reuse, name)] : []),
          ]) {
            try {
              const candidate = await readFile(source);
              if (candidate.length === entry.bytes && hash(candidate) === entry.sha256) {
                bytes = candidate;
                report.reused++;
                break;
              }
            } catch {
              /* Missing local bytes are obtained from the allowlisted API. */
            }
          }
          if (!bytes) {
            bytes = await retrieveSnapshot(origin, name, entry);
            report.downloaded++;
          }
          await mkdir(dirname(destination), { recursive: true });
          await ensureFixturePath(root, name);
          await writeFile(destination, bytes);
          if (hash(await readFile(destination)) !== entry.sha256)
            throw new Error("LOCAL_READBACK_MISMATCH");
          report.verified++;
        } catch (error) {
          report.errors.push({ name, error: error.code ?? error.message });
        }
      }
    }),
  );
  report.completedAt = new Date().toISOString();
  await mkdir("private/verification", { recursive: true });
  await writeFile(
    "private/verification/fixture-readback.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (report.errors.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
