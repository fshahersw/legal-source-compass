import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateLimitationsSnapshot } from "./validation";

type TestRecord = Record<string, unknown>;
const fixture = () => ({
  rules: JSON.parse(readFileSync("private/data/limitations/rules.json", "utf8")) as TestRecord,
  sources: JSON.parse(readFileSync("private/data/limitations/sources.json", "utf8")) as TestRecord,
  coverage: JSON.parse(
    readFileSync("private/data/limitations/coverage.json", "utf8"),
  ) as TestRecord,
  cases: JSON.parse(
    readFileSync("private/data/limitations/case-references.json", "utf8"),
  ) as TestRecord,
});
const clone = <T>(value: T): T => structuredClone(value);

describe("limitations snapshot validation", () => {
  it("accepts the complete private snapshot and its explicit coverage links", () => {
    const snapshot = validateLimitationsSnapshot(fixture());
    expect(snapshot.coverage).toHaveLength(51);
    expect(snapshot.rules.length).toBeGreaterThan(0);
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(snapshot.cases.length).toBeGreaterThan(0);
  });

  it("rejects an invalid civil snapshot date and impossible effective date", () => {
    const badSnapshotDate = clone(fixture());
    badSnapshotDate.rules["snapshotDate"] = "2026-02-30";
    expect(() => validateLimitationsSnapshot(badSnapshotDate)).toThrow(/real calendar date/);

    const badEffectiveDate = clone(fixture());
    const rules = badEffectiveDate.rules["rules"] as TestRecord[];
    rules[0]!["effectiveFrom"] = "2026-02-29";
    expect(() => validateLimitationsSnapshot(badEffectiveDate)).toThrow(/real calendar date/);
  });

  it("rejects duplicate baseline identity and unsupported periods or computation modes", () => {
    const duplicate = clone(fixture());
    const rules = duplicate.rules["rules"] as TestRecord[];
    rules.push({ ...rules[0], id: "second-id-same-baseline" });
    expect(() => validateLimitationsSnapshot(duplicate)).toThrow(/multiple baseline rules/);

    const unsupportedPeriod = clone(fixture());
    const periodRules = unsupportedPeriod.rules["rules"] as TestRecord[];
    (periodRules[0]!["period"] as TestRecord)["amount"] = 0;
    expect(() => validateLimitationsSnapshot(unsupportedPeriod)).toThrow(/positive integer/);

    const unsupportedMode = clone(fixture());
    const modeRules = unsupportedMode.rules["rules"] as TestRecord[];
    modeRules[0]!["computation"] = "guess_from_caption";
    expect(() => validateLimitationsSnapshot(unsupportedMode)).toThrow(
      /unsupported rule kind or computation/,
    );
  });

  it("rejects unsafe URLs, malformed evidence hashes, and paths outside the snapshot namespace", () => {
    const unsafeUrl = clone(fixture());
    const sources = unsafeUrl.sources["sources"] as TestRecord[];
    sources[0]!["url"] = "javascript:alert(1)";
    expect(() => validateLimitationsSnapshot(unsafeUrl)).toThrow(/HTTP\(S\) URL/);

    const badHash = clone(fixture());
    const badHashSources = badHash.sources["sources"] as TestRecord[];
    badHashSources[0]!["sha256"] = "not-a-hash";
    expect(() => validateLimitationsSnapshot(badHash)).toThrow(/SHA-256/);

    const escapedPath = clone(fixture());
    const pathSources = escapedPath.sources["sources"] as TestRecord[];
    pathSources[0]!["textPath"] = "/data/limitations/../../private.txt";
    expect(() => validateLimitationsSnapshot(escapedPath)).toThrow(
      /normalized limitations text path/,
    );
  });

  it("rejects missing evidence targets and inaccurate jurisdiction facets", () => {
    const missingSource = clone(fixture());
    const rules = missingSource.rules["rules"] as TestRecord[];
    rules[0]!["sourceIds"] = ["unlisted-authority"];
    expect(() => validateLimitationsSnapshot(missingSource)).toThrow(/missing source/);

    const wrongFacet = clone(fixture());
    const coverage = wrongFacet.coverage["coverage"] as TestRecord[];
    coverage.find((row) => row["state"] === "AL")!["baselineRuleIds"] = [];
    expect(() => validateLimitationsSnapshot(wrongFacet)).toThrow(/baseline links do not match/);
  });
});
