import { readFile, writeFile, unlink } from "node:fs/promises";
const root = "public/data/limitations";
const sourceFile = `${root}/sources.json`;
const source = JSON.parse(await readFile(sourceFile, "utf8"));
try {
  const extensions = JSON.parse(await readFile(`${root}/extension-sources.json`, "utf8"));
  const existing = new Set(source.sources.map((s) => s.id));
  source.sources.push(...extensions.filter((s) => !existing.has(s.id)));
  await writeFile(sourceFile, `${JSON.stringify(source, null, 2)}\n`);
  await unlink(`${root}/extension-sources.json`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const rules = JSON.parse(await readFile(`${root}/rules.json`, "utf8"));
const inventory = JSON.parse(await readFile("public/data/research/state-resources.json", "utf8"));
const publisherOverrides = JSON.parse(await readFile(`${root}/publisher-overrides.json`, "utf8"));
const coverage = inventory.states
  .map((state) => {
    const sources = source.sources.filter((s) => s.state === state.code);
    const publication = publisherOverrides.jurisdictions.find((s) => s.state === state.code);
    const baseline = rules.rules.filter(
      (r) => r.jurisdiction === state.code && r.computation === "baseline_only",
    );
    const research = rules.rules.filter(
      (r) => r.jurisdiction === state.code && r.computation === "research_only",
    );
    return {
      state: state.code,
      name: state.name,
      sourceStatus: sources.length ? "primary_text_retrieved" : "primary_text_pending",
      sourceIds: sources.map((s) => s.id),
      baselineRuleIds: baseline.map((r) => r.id),
      researchRuleIds: research.map((r) => r.id),
      coverage: baseline.length
        ? "conditional_baselines"
        : sources.length
          ? "research_only"
          : "pending",
      publisherLinks:
        publication?.publisherLinks ??
        sources.map((s) => ({ title: s.title, url: s.url, status: "statutory_text_retrieved" })),
      metadataOnlyReferences: publication?.metadataOnlyReferences ?? [],
      discoverySource: state.sourceUrl,
      discoveryLinks: state.links
        .filter(
          (l) =>
            l.section === "Legislature and Laws" &&
            /statutes|legislat|code/i.test(l.title ?? l.label ?? "") &&
            !/\.pdf(?:$|\?)/i.test(l.url),
        )
        .slice(0, 6)
        .map((l) => ({ title: l.title ?? l.label, url: l.url })),
      gaps: [
        ...(publication?.gap ? [publication.gap] : []),
        ...(state.code === "NJ"
          ? [
              "Captured source is enacted P.L. 2019, c. 120; full current codification and intervening amendments are not independently verified.",
            ]
          : []),
        ...(sources.length
          ? []
          : ["Primary statutory text still needs retrieval and claim-level verification."]),
        ...["personal_injury", "product_liability", "wrongful_death"]
          .filter((c) => !baseline.some((r) => r.claimType === c))
          .map((c) => `${c.replaceAll("_", " ")}: no automatically computable reviewed baseline.`),
        "No comprehensive controlling-precedent, historical-version, tolling, repose or choice-of-law review completed.",
        "Official holiday / closure calendars and court-specific filing / service rules not loaded.",
      ],
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
if (coverage.length !== 51 || new Set(coverage.map((s) => s.state)).size !== 51)
  throw new Error("Expected all 50 states and DC");
await writeFile(
  `${root}/coverage.json`,
  `${JSON.stringify({ schemaVersion: "1.0.0", snapshotDate: rules.snapshotDate, coverage }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    jurisdictions: coverage.length,
    primaryTextJurisdictions: coverage.filter((s) => s.sourceStatus === "primary_text_retrieved")
      .length,
    baselineJurisdictions: coverage.filter((s) => s.coverage === "conditional_baselines").length,
    sourceRecords: source.sources.length,
    rules: rules.rules.length,
  }),
);
