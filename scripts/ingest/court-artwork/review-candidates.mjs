#!/usr/bin/env node
// Produces an auditable review list. It never publishes, downloads, or assigns artwork automatically.
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw Error("Usage: review-candidates.mjs <candidates.json> <review.json>");
const candidates = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(candidates)) throw Error("Candidate input must be a JSON array");

const rows = candidates.map((candidate, index) => {
  const courtId = typeof candidate.court_id === "string" ? candidate.court_id.trim() : "";
  const sourcePage = typeof candidate.source_page === "string" ? candidate.source_page : "";
  const sourceImage = typeof candidate.source_image === "string" ? candidate.source_image : "";
  const reasons = [];
  if (!courtId) reasons.push("missing_exact_court_id");
  if (!sourcePage.startsWith("https://")) reasons.push("source_page_not_https");
  if (!sourceImage.startsWith("https://")) reasons.push("source_image_not_https");
  let sourceHost = "", imageHost = "";
  try { sourceHost = new URL(sourcePage).hostname; } catch { reasons.push("invalid_source_page"); }
  try { imageHost = new URL(sourceImage).hostname; } catch { reasons.push("invalid_source_image"); }
  if (sourceHost && imageHost && sourceHost !== imageHost) reasons.push("image_host_differs_from_source_page");
  if (candidate.exact_court_id_reviewed !== true) reasons.push("exact_court_id_not_reviewed");
  return {
    ordinal: index + 1,
    court_id: courtId || null,
    source_page: sourcePage || null,
    source_image: sourceImage || null,
    status: reasons.length ? "hold" : "ready_for_manual_download_and_checksum",
    reasons,
  };
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ schema: "court-artwork-review/1", created_at: new Date().toISOString(), rows }, null, 2) + "\n");
console.log(JSON.stringify({ candidates: rows.length, ready: rows.filter((r) => r.status.startsWith("ready")).length, held: rows.filter((r) => r.status === "hold").length }));