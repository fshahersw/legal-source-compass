#!/usr/bin/env node
import path from "node:path";
import { captureSources } from "./nc-capture-source.mjs";

const base = path.join(process.cwd(), "private/audit-2026-10-05/full-state-codes/nc");
const sources = [
  [
    "section-html",
    "https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_78A/GS_78A-13.html",
    "raw/GS_78A-13-exception.html",
  ],
  [
    "section-pdf",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_78A/GS_78A-13.pdf",
    "raw/GS_78A-13-exception.pdf",
  ],
  [
    "section-library-index",
    "https://library.ncleg.gov/Laws/GeneralStatuteSections/Chapter78A",
    "raw/Chapter78A-section-index-exception.html",
  ],
].map(([id, url, rawPath]) => ({
  id,
  url,
  rawPath,
  receiptPath: `receipts/GS_78A-13-exception-${id}.json`,
  includeErrorField: false,
}));

for (const result of await captureSources({ base, sources, maxBytes: 5 * 1024 * 1024 })) {
  console.log(JSON.stringify(result));
}
