#!/usr/bin/env node
/** Retain exact public source PDFs named by a pinned open-data manifest. No database writes. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const [manifestPath, destination] = process.argv.slice(2);
if (!manifestPath || !destination)
  throw new Error("Usage: capture_source_pdfs.mjs SOURCE_JSON OUTPUT");
const manifestBytes = await readFile(manifestPath);
const sources = JSON.parse(manifestBytes);
const output = resolve(destination);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const allowed = (value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    ((url.hostname === "www.legis.ga.gov" &&
      url.pathname.startsWith(
        "/api/document/docs/default-source/joint-features-document-library/",
      )) ||
      (url.hostname === "archive.org" && url.pathname.startsWith("/download/")))
  );
};
if (
  !Array.isArray(sources) ||
  !sources.length ||
  sources.some((s) => !allowed(s.source_url) || !/^[a-f0-9]{64}$/.test(s.sha256))
)
  throw new Error("Unapproved source URL or missing pinned checksum");
if (new Set(sources.map((s) => s.source_url)).size !== sources.length)
  throw new Error("Duplicate source URLs");
await mkdir(join(output, "raw"), { recursive: true });
await mkdir(join(output, "receipts"), { recursive: true });
let nextRequest = 0;
async function capture(source) {
  const receiptPath = join(output, "receipts", hash(source.source_url) + ".json");
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const bytes = await readFile(join(output, "raw", receipt.sha256 + ".pdf"));
    if (
      receipt.source_url !== source.source_url ||
      receipt.expected_sha256 !== source.sha256 ||
      receipt.http_status !== 200 ||
      receipt.sha256 !== source.sha256 ||
      hash(bytes) !== source.sha256 ||
      bytes.length !== receipt.bytes
    )
      throw new Error("Existing capture fails pinned source validation");
    return receipt;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const slot = Math.max(Date.now(), nextRequest);
    nextRequest = slot + 1000;
    await delay(Math.max(0, slot - Date.now()));
    try {
      const started = new Date().toISOString();
      const response = await fetch(source.source_url, {
        signal: AbortSignal.timeout(180000),
        redirect: "follow",
        credentials: "omit",
        headers: { "User-Agent": "LegalSourceAtlas-SourceCapture/1.0", Accept: "application/pdf" },
      });
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        throw new Error("Transient HTTP " + response.status);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("HTTP " + response.status);
      }
      // Archive.org may redirect its own public download to an archive.org storage host.
      const finalUrl = new URL(response.url);
      if (
        finalUrl.protocol !== "https:" ||
        !(
          finalUrl.hostname === "www.legis.ga.gov" ||
          finalUrl.hostname === "archive.org" ||
          finalUrl.hostname.endsWith(".archive.org")
        )
      ) {
        await response.body?.cancel();
        throw new Error("Unexpected source redirect");
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 500_000_000) throw new Error("Source exceeds 500 MB capture limit");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        throw new Error("Response is not original PDF bytes");
      const sha256 = hash(bytes);
      const receipt = {
        schema_version: "ga-pinned-source-pdf/1",
        source_url: source.source_url,
        final_url: response.url,
        started_at: started,
        retrieved_at: new Date().toISOString(),
        http_status: response.status,
        bytes: bytes.length,
        sha256,
        expected_sha256: source.sha256,
        checksum_match: sha256 === source.sha256,
        classification: source.source_classification,
        content_type: response.headers.get("content-type"),
        last_modified: response.headers.get("last-modified"),
        publication_allowed: false,
      };
      const rawPath = join(output, "raw", sha256 + ".pdf");
      await writeFile(rawPath, bytes, { flag: "wx" }).catch(async (e) => {
        if (e.code !== "EEXIST") throw e;
        const retained = await readFile(rawPath);
        if (retained.length !== bytes.length || hash(retained) !== sha256)
          throw new Error("Retained original PDF checksum mismatch");
      });
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
      if (!receipt.checksum_match)
        throw new Error("Original PDF differs from pinned extraction source");
      return receipt;
    } catch (error) {
      if (
        attempt === 3 ||
        /HTTP (400|401|403|404)|checksum|differs|capture limit|not original|Unexpected/.test(
          error.message,
        )
      )
        throw error;
      await delay(2000 * 2 ** attempt);
    }
  }
}
let index = 0;
const receipts = [];
const errors = [];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (index < sources.length) {
      const source = sources[index++];
      try {
        receipts.push(await capture(source));
      } catch (error) {
        errors.push({
          source_url: source.source_url,
          expected_sha256: source.sha256,
          error: error.message,
        });
      }
      console.log(
        JSON.stringify({ retained: receipts.length, errors: errors.length, total: sources.length }),
      );
    }
  }),
);
const report = {
  schema_version: "ga-source-pdf-capture-report/1",
  manifest_sha256: hash(manifestBytes),
  checked_at: new Date().toISOString(),
  expected_sources: sources.length,
  verified_sources: receipts.length,
  verified_bytes: receipts.reduce((n, r) => n + r.bytes, 0),
  errors,
  publication_allowed: false,
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (errors.length) process.exitCode = 1;
