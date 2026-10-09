#!/usr/bin/env bun
/** Prepare a source-bound candidate. Publishing still uses the existing stage/activate commands. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, stat, realpath } from "node:fs/promises";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { addMinorityPolicies } from "../../src/lib/limitations/backfill/minorityPolicies";
import { validateLimitationsSnapshot } from "../../src/lib/limitations/validation";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (
  typeof args.bundle !== "string" ||
  typeof args.out !== "string" ||
  typeof args.release !== "string" ||
  typeof args.reviewed !== "string"
)
  throw new Error(
    "Use --bundle=EXISTING_BUNDLE --out=NEW_DIRECTORY --release=YYYY-MM-DD.N --reviewed=YYYY-MM-DD [--manifest=src/lib/private-data/manifest.server.json]",
  );
const bundle = await realpath(resolve(args.bundle)),
  out = resolve(args.out),
  release = args.release;
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) throw new Error("Use a versioned release label");
if (out === bundle || relative(bundle, out).split(/[\\/]/).at(0) !== "..")
  throw new Error("The output must not overwrite or be inside the input bundle");
try {
  await stat(out);
  throw new Error("Output directory exists; choose a fresh versioned path");
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
}
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifestPath =
  typeof args.manifest === "string" ? args.manifest : "src/lib/private-data/manifest.server.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  project_id: string;
  files: Record<string, { sha256: string; bytes: number; storage_key: string }>;
};
if (manifest.project_id !== "xosqzzsnhxcyehcnirpa") throw new Error("Unexpected source corpus");
const files = Object.entries(manifest.files).filter(([name]) => name.startsWith("limitations/"));
if (!files.length) throw new Error("No limitations files in the source manifest");
for (const [name, meta] of files) {
  const rel = name.slice("limitations/".length),
    path = await realpath(join(bundle, rel));
  if (isAbsolute(rel) || rel.split("/").includes("..") || relative(bundle, path).startsWith(".."))
    throw new Error("Evidence path escaped bundle");
  const bytes = await readFile(path);
  if (bytes.length !== meta.bytes || digest(bytes) !== meta.sha256)
    throw new Error("Input is incomplete or differs from the source manifest: " + name);
}
const read = async (name: string) =>
  JSON.parse(await readFile(join(bundle, name + ".json"), "utf8"));
const input = {
  rules: await read("rules"),
  sources: await read("sources"),
  coverage: await read("coverage"),
  cases: await read("case-references"),
};
const validated = validateLimitationsSnapshot(input);
if (validated.ruleVersion === release)
  throw new Error("The release label must differ from the live input release");
const sourceTexts = new Map<string, string>();
for (const source of validated.sources) {
  const rel = source.textPath.replace(/^\/data\/limitations\//, "");
  if (!manifest.files["limitations/" + rel])
    throw new Error("Required source is outside manifest: " + source.id);
  sourceTexts.set(source.id, await readFile(join(bundle, rel), "utf8"));
}
const { snapshot, changes } = addMinorityPolicies(validated, sourceTexts, args.reviewed);
const nextRules = { ...input.rules, ruleVersion: release, rules: snapshot.rules };
validateLimitationsSnapshot({ ...input, rules: nextRules });
await mkdir(out, { recursive: false });
for (const [name] of files) {
  const rel = name.slice("limitations/".length),
    target = join(out, rel);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(bundle, rel), target);
}
const priorRulesSha = manifest.files["limitations/rules.json"]!.sha256;
await writeFile(join(out, "rules.json"), JSON.stringify(nextRules, null, 2) + "\n", "utf8");
const report = {
  schemaVersion: "guided-policy-additions/1",
  release,
  previousRelease: validated.ruleVersion,
  previousRulesSha256: priorRulesSha,
  createdAt: new Date().toISOString(),
  sourceSnapshotDate: validated.snapshotDate,
  changes,
  allExistingFilesPreserved: true,
  existingPeriodsAndHistoricalWindowsUnchanged: true,
  comprehensiveLawReview: false,
  calculationActivationAllowed: false,
  notes: [
    "Only the three scoped ordinary personal-injury minority policies are executable. Other positive/uncertain screening issues withhold a date.",
    "Use the existing immutable stage-limitations-release.mjs and activate-limitations-release.mjs --verify; this preparation command never writes the live manifest.",
  ],
};
await writeFile(
  join(out, "guided-policy-additions.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);
console.log(
  JSON.stringify({
    state: "candidate_prepared_not_published",
    release,
    inputFiles: files.length,
    outputFiles: files.length + 1,
    policies: changes.length,
    rulesSha256: digest(await readFile(join(out, "rules.json"))),
    out,
  }),
);
