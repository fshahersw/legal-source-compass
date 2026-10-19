#!/usr/bin/env node
/** Checks local registered bytes; --check-sources also compares the exact official source images.
 * Never replaces artwork automatically. Source-check receipts must stay under private/.
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifiedCourtArtwork } from "../../src/lib/courts/artwork.ts";

const root = path.resolve(import.meta.dirname, "../..");
const options = process.argv.slice(2);
const checkSources = options.includes("--check-sources");
const outputArgument = options.find((argument) => argument.startsWith("--output="))?.slice(9);
if (options.some((argument) => argument !== "--check-sources" && !argument.startsWith("--output=")))
  throw Error("Usage: verify_court_artwork.mjs [--check-sources --output=private/path]");
if (checkSources && !outputArgument)
  throw Error("Source checks require a private receipt output directory");
const output = outputArgument ? path.resolve(root, outputArgument) : null;
if (output) {
  const relative = path.relative(path.join(root, "private"), output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Receipt output must be a subdirectory of private/");
}
const hash = (body) => createHash("sha256").update(body).digest("hex");
const results = [];
for (const asset of verifiedCourtArtwork) {
  if (!/^\/court-marks\/[a-z0-9-]+\.(svg|png|gif|jpg)$/.test(asset.assetPath))
    throw Error("Invalid local artwork path");
  const local = await readFile(path.join(root, "public", asset.assetPath.slice(1)));
  const localMatches = hash(local) === asset.sha256;
  const result = {
    courtId: asset.courtId,
    checkedAt: new Date().toISOString(),
    localMatches,
    localBytes: local.length,
  };
  if (checkSources) {
    const source = new URL(asset.sourceImage);
    const page = new URL(asset.sourcePage);
    if (
      source.protocol !== "https:" ||
      source.host !== page.host ||
      source.username ||
      source.password
    )
      throw Error(`Artwork source differs from reviewed court host: ${asset.courtId}`);
    try {
      const response = await fetch(source, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok || !response.body) throw Error(`Source returned HTTP ${response.status}`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw Error("Artwork exceeds bounded source-check size");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const digest = hash(bytes);
      Object.assign(result, {
        sourceImage: asset.sourceImage,
        sourcePage: asset.sourcePage,
        sourceStatus: "read",
        sourceSha256: digest,
        sourceMatches: digest === asset.sha256,
        sourceBytes: size,
        contentType: response.headers.get("content-type"),
      });
      await mkdir(path.join(output, "raw"), { recursive: true });
      const evidence = path.join(output, "raw", `${digest}.raw`);
      try {
        await writeFile(evidence, bytes, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST" || hash(await readFile(evidence)) !== digest) throw error;
      }
    } catch (error) {
      Object.assign(result, { sourceStatus: "not_rechecked", error: error.message });
    }
  }
  results.push(result);
}
if (output) {
  await mkdir(output, { recursive: true });
  const receipt =
    JSON.stringify({ schema: "court-artwork-verification/1", results }, null, 2) + "\n";
  await writeFile(path.join(output, `${hash(receipt)}.json`), receipt, { flag: "wx" });
}
console.log(
  JSON.stringify({
    assets: results.length,
    localVerified: results.filter((result) => result.localMatches).length,
    ...(checkSources
      ? {
          sourceVerified: results.filter((result) => result.sourceMatches).length,
          sourceChanged: results.filter(
            (result) => result.sourceStatus === "read" && !result.sourceMatches,
          ).length,
          notRechecked: results.filter((result) => result.sourceStatus === "not_rechecked").length,
        }
      : {}),
  }),
);
if (
  results.some((result) => !result.localMatches || (checkSources && result.sourceMatches !== true))
)
  process.exitCode = 1;
