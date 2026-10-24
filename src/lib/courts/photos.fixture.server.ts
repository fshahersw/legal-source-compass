/**
 * Dev-only reader for the local court_images build file (private/build/court_images/court_images.json), used by
 * photos.functions.ts only when the dev server runs with COURT_PHOTOS_FIXTURE=1. Never imported in production: the
 * importing branch is guarded by `import.meta.env.DEV`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

let cached: Promise<{ id: string; p: unknown }[]> | null = null;

export function readCourtPhotoFixture(): Promise<{ id: string; p: unknown }[]> {
  cached ??= readFile(
    path.join(process.cwd(), "private", "build", "court_images", "court_images.json"),
    "utf8",
  )
    .then((text) => {
      const build = JSON.parse(text) as { rows?: { id?: unknown; item?: { photo?: unknown } }[] };
      return (build.rows ?? []).flatMap((r) =>
        typeof r.id === "string" ? [{ id: r.id, p: r.item?.photo }] : [],
      );
    })
    .catch(() => []);
  return cached;
}
