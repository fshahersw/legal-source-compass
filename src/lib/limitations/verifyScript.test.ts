import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const verifyScript = join(repoRoot, "scripts", "limitations", "verify.mjs");

type CaptureShape = { contentType: string } | undefined;

/** A bundle directory holding exactly one source, so the verifier's PDF rule is tested alone. */
function fixture(options: { url: string; method: string; capture: CaptureShape }) {
  const root = mkdtempSync(join(tmpdir(), "lim-verify-"));
  const text = "Sample official text with a two-year period.";
  const hash = createHash("sha256").update(text).digest("hex");
  const source = {
    id: "sample-source",
    state: "FL",
    url: options.url,
    method: options.method,
    textPath: "/data/limitations/text/sample-source.txt",
    sha256: hash,
    byteLength: Buffer.byteLength(text),
    rawCapture: options.capture
      ? {
          sha256: "a".repeat(64),
          byteLength: 12,
          contentType: options.capture.contentType,
          retrievedAt: "2026-10-08T00:00:00.000Z",
          storageBucket: "corpus-originals",
          storageKey: "limitations-raw-captures/sha256/aa/aaaaaaaa.bin",
        }
      : undefined,
  };
  mkdirSync(join(root, "text"), { recursive: true });
  writeFileSync(join(root, "text", "sample-source.txt"), text);
  writeFileSync(join(root, "sources.json"), JSON.stringify({ sources: [source] }));
  writeFileSync(join(root, "case-references.json"), JSON.stringify({ cases: [] }));
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [verifyScript, `--root=${root}`], { encoding: "utf8" });
}

const direct = "Direct HTTPS GET of the official page";
const intermediary = "Text obtained through an extraction intermediary (proxied fetch via firecrawl)";

describe("verify.mjs PDF provenance rule", () => {
  it("accepts a PDF link whose text came through a declared extraction intermediary", () => {
    const result = run(
      fixture({
        url: "https://www.njcourts.gov/system/files/court-opinions/2017/a4481-12.pdf",
        method: intermediary,
        capture: { contentType: "application/json" },
      }),
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts a direct capture that really holds PDF bytes", () => {
    const result = run(
      fixture({
        url: "https://example.legis.state.us/acts/2024/hb1.pdf",
        method: direct,
        capture: { contentType: "application/pdf" },
      }),
    );
    expect(result.status).toBe(0);
  });

  it("rejects a PDF link whose bytes are not a PDF when the record claims a direct capture", () => {
    const result = run(
      fixture({
        url: "https://example.legis.state.us/acts/2024/hb1.pdf",
        method: direct,
        capture: { contentType: "application/json" },
      }),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain("sample-source");
  });

  it("rejects an intermediary claim that does not match the stored bytes", () => {
    const result = run(
      fixture({
        url: "https://example.legis.state.us/acts/2024/hb1.pdf",
        method: intermediary,
        capture: { contentType: "application/octet-stream" },
      }),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain("sample-source");
  });
});
