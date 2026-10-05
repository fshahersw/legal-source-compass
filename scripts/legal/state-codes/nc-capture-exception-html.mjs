#!/usr/bin/env node
import path from "node:path";
import { captureSources } from "./nc-capture-source.mjs";

const base = path.join(process.cwd(), "private/audit-2026-10-05/full-state-codes/nc");
const sourceRows = [
  [
    "105-section-html",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-151.11.html",
    "raw/GS_105-151.11-exception.html",
  ],
  [
    "143-section-html",
    "https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_143/GS_143-215.74H.html",
    "raw/GS_143-215.74H-exception.html",
  ],
];
const sources = sourceRows.map(([id, url, rawPath]) => ({
  id,
  url,
  rawPath,
  receiptPath: `receipts/${id}-exception.json`,
  maxBytes: 2 * 1024 * 1024,
}));

for (const result of await captureSources({ base, sources })) {
  console.log(JSON.stringify(result));
}
