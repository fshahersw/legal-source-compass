import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { bundle, patternsSha256 } from "../../../scripts/ingest/bundle_functions.mjs";
import { PATTERNS } from "./patterns.data";

/** The deploy bundle of ingest-citations loads the pattern table from storage instead of carrying the 330 KB module. */
const out = mkdtempSync(path.join(tmpdir(), "fn-bundle-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("ingest-citations bundle", () => {
  const written = (bundle(out) as string[]).filter((f) => f.startsWith("ingest-citations"));
  const lib = path.join(out, "ingest-citations", "_lib", "citations");

  it("replaces the generated table with the digest-checked loader", () => {
    const data = readFileSync(path.join(lib, "patterns.data.ts"), "utf8");
    expect(data).toContain(`sha256: "${patternsSha256()}"`);
    expect(data).toContain('from "./patterns.remote.ts"');
    expect(written).toContain(
      path.join("ingest-citations", "_lib", "citations", "patterns.remote.ts"),
    );
    for (const f of written) expect(statSync(path.join(out, f)).size).toBeLessThan(100_000);
  });

  it("the bundled module loads exactly patterns.json from storage", async () => {
    const bytes = readFileSync(new URL("./patterns.json", import.meta.url));
    const urls: string[] = [];
    vi.stubGlobal("Deno", {
      env: {
        get: (n: string) =>
          ({
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "service-key",
          })[n],
      },
    });
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array(bytes) as BodyInit);
    });
    try {
      const mod = (await import(pathToFileURL(path.join(lib, "patterns.data.ts")).href)) as {
        PATTERNS: unknown;
      };
      expect(JSON.parse(JSON.stringify(mod.PATTERNS))).toEqual(
        JSON.parse(JSON.stringify(PATTERNS)),
      );
      expect(urls).toEqual([
        `https://example.supabase.co/storage/v1/object/corpus-exports/citations/patterns/${patternsSha256()}.json`,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
