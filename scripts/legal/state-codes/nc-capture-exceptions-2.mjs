#!/usr/bin/env node
import path from "node:path";
import { captureSources } from "./nc-capture-source.mjs";

const base = path.join(process.cwd(), "private/audit-2026-10-05/full-state-codes/nc");
const sourceRows = [
  [
    "105-section-pdf",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-151.11.pdf",
    "raw/GS_105-151.11-exception.pdf",
  ],
  [
    "105-section-index",
    "https://ncleg.gov/Laws/GeneralStatuteSections/Chapter105",
    "raw/Chapter105-section-index-exception.html",
  ],
  [
    "143-section-pdf",
    "https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_143/GS_143-215.74H.pdf",
    "raw/GS_143-215.74H-exception.pdf",
  ],
  [
    "143-section-index",
    "https://www.ncleg.gov/Laws/GeneralStatuteSections/Chapter143",
    "raw/Chapter143-section-index-exception.html",
  ],
  [
    "105-repealing-session-law",
    "https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2013-2014/SL2013-316.html",
    "raw/SL2013-316-exception.html",
  ],
];
const sources = sourceRows.map(([id, url, rawPath]) => ({
  id,
  url,
  rawPath,
  receiptPath: `receipts/${id}-exception.json`,
  includeErrorField: true,
  maxBytes: 5 * 1024 * 1024,
}));

for (const result of await captureSources({ base, sources })) {
  console.log(JSON.stringify(result));
}
