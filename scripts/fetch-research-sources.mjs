import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const directory = "public/data/research/raw";
const sources = [
  {
    id: "fjc-demographics",
    file: "fjc-demographics.csv",
    url: "https://www.fjc.gov/sites/default/files/history/demographics.csv",
    page: "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export",
  },
  {
    id: "fjc-service",
    file: "fjc-service.csv",
    url: "https://www.fjc.gov/sites/default/files/history/federal-judicial-service.csv",
    page: "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export",
  },
  {
    id: "census-population",
    file: "census-population-2025.csv",
    url: "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
    page: "https://www.census.gov/data/tables/time-series/demo/popest/2020s-state-total.html",
  },
  {
    id: "uscourts-duration",
    file: "uscourts-c5-2025.xlsx",
    url: "https://www.uscourts.gov/sites/default/files/document/jb_c5_0930.2025.xlsx",
    page: "https://www.uscourts.gov/data-news/data-tables/2025/09/30/judicial-business/c-5",
  },
];
await mkdir(directory, { recursive: true });
const results = [];
for (const source of sources) {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10_000_000) throw new Error(`${source.id}: split before committing`);
  if (response.headers.get("content-type")?.includes("text/html"))
    throw new Error(`${source.id}: unexpected HTML`);
  await writeFile(join(directory, source.file), bytes);
  results.push({
    ...source,
    fetchedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    finalUrl: response.url,
  });
  console.log(`${source.id}: ${bytes.length} bytes`);
}
const previous = await readFile("public/data/research/source-manifest.json", "utf8")
  .then(JSON.parse)
  .catch(() => ({ sources: [] }));
const supplemental = previous.sources.filter((s) => !sources.some((native) => native.id === s.id));
await writeFile(
  "public/data/research/source-manifest.json",
  JSON.stringify({ sources: [...results, ...supplemental] }, null, 2) + "\n",
);
