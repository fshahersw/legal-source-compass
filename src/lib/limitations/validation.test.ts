import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateLimitationsSnapshot } from "./validation";

type TestRecord = Record<string, unknown>;
const bundleDir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const fixture = () => ({
  rules: JSON.parse(readFileSync(`${bundleDir}/rules.json`, "utf8")) as TestRecord,
  sources: JSON.parse(readFileSync(`${bundleDir}/sources.json`, "utf8")) as TestRecord,
  coverage: JSON.parse(
    readFileSync(`${bundleDir}/coverage.json`, "utf8"),
  ) as TestRecord,
  cases: JSON.parse(
    readFileSync(`${bundleDir}/case-references.json`, "utf8"),
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

  it("accepts a passage-level proxy comparison only beside a non-proxied verdict that names its retained bytes", () => {
    const sha = "1cad99be369839b9cc1f4fcca7019f03c21025e37afc10ff1ffc788bc50dae36";
    const passageRecheck = {
      checkedAt: "2026-10-08T13:20:00.000Z",
      route: "proxied",
      proxy: "tavily",
      rawSha256: sha,
      rawStorageKey: `limitations-raw-captures/sha256/1c/${sha}.bin`,
      passages: 22,
      detail: "every passage present in the proxy's extracted text; response retained",
    };
    const ok = clone(fixture());
    const sources = ok.sources["sources"] as TestRecord[];
    const direct = sources.find((s) => (s["currency"] as TestRecord | undefined)?.["route"] === "direct")!;
    (direct["currency"] as TestRecord)["passageRecheck"] = passageRecheck;
    expect(() => validateLimitationsSnapshot(ok)).not.toThrow();

    const wrongKey = clone(ok);
    const wk = (wrongKey.sources["sources"] as TestRecord[]).find((s) => s["id"] === direct["id"])!;
    ((wk["currency"] as TestRecord)["passageRecheck"] as TestRecord)["rawStorageKey"] =
      "limitations-raw-captures/sha256/1c/other.bin";
    expect(() => validateLimitationsSnapshot(wrongKey)).toThrow(/does not address its own rawSha256/);

    const onProxied = clone(fixture());
    const proxied = (onProxied.sources["sources"] as TestRecord[]).find(
      (s) => (s["currency"] as TestRecord | undefined)?.["route"] === "proxied",
    );
    if (proxied) {
      (proxied["currency"] as TestRecord)["passageRecheck"] = passageRecheck;
      expect(() => validateLimitationsSnapshot(onProxied)).toThrow(/duplicates a proxied page-level verdict/);
    }

    const noPassages = clone(ok);
    const np = (noPassages.sources["sources"] as TestRecord[]).find((s) => s["id"] === direct["id"])!;
    ((np["currency"] as TestRecord)["passageRecheck"] as TestRecord)["passages"] = 0;
    expect(() => validateLimitationsSnapshot(noPassages)).toThrow(/passages/);
  });

  it("accepts a composite verdict only as a direct evidence-intact verdict naming other existing sources", () => {
    const ok = clone(fixture());
    const sources = ok.sources["sources"] as TestRecord[];
    const [a, b] = sources;
    if (!a || !b) return;
    a["currency"] = {
      checkedAt: "2026-10-08T15:20:00.000Z",
      status: "confirmed_evidence_intact",
      route: "direct",
      componentSourceIds: [b["id"]],
      detail: "concatenation; verdict derived from the component page's text-identical re-read",
    };
    expect(() => validateLimitationsSnapshot(ok)).not.toThrow();

    const self = clone(ok);
    ((self.sources["sources"] as TestRecord[])[0]!["currency"] as TestRecord)["componentSourceIds"] = [a["id"]];
    expect(() => validateLimitationsSnapshot(self)).toThrow(/names the composite itself/);

    const missing = clone(ok);
    ((missing.sources["sources"] as TestRecord[])[0]!["currency"] as TestRecord)["componentSourceIds"] = ["no-such-source"];
    expect(() => validateLimitationsSnapshot(missing)).toThrow(/missing component source/);

    const unchanged = clone(ok);
    ((unchanged.sources["sources"] as TestRecord[])[0]!["currency"] as TestRecord)["status"] = "confirmed_unchanged";
    expect(() => validateLimitationsSnapshot(unchanged)).toThrow(/composite verdict must be a direct-route evidence-intact verdict/);

    const empty = clone(ok);
    ((empty.sources["sources"] as TestRecord[])[0]!["currency"] as TestRecord)["componentSourceIds"] = [];
    expect(() => validateLimitationsSnapshot(empty)).toThrow(/names no component/);
  });

  it("accepts a cross-reference link only for an existing note, in the rule's own state, with a term check that follows from its terms", () => {
    const ok = clone(fixture());
    const rules = ok.rules["rules"] as TestRecord[];
    const rule = rules.find((r) => ((r["provenance"] as TestRecord | undefined)?.["tolling"] as unknown[] | undefined)?.length)!;
    const note = ((rule["provenance"] as TestRecord)["tolling"] as TestRecord[])[0]!;
    const link = {
      kind: "tolling",
      index: 0,
      citation: note["citation"],
      checkedAt: "2026-10-08T16:00:00.000Z",
      sectionsNamed: 1,
      sections: [{ nativeId: `${rule["jurisdiction"]}:1-1`, textSha256: "ab".repeat(32) }],
      termCheck: "all_present",
      terms: [{ term: "1 year", found: true }],
      intakeRunId: null,
    };
    rule["crossReferenceLinks"] = [link];
    expect(() => validateLimitationsSnapshot(ok)).not.toThrow();

    const variant = (patch: (l: TestRecord) => void) => {
      const copy = clone(ok);
      const r = (copy.rules["rules"] as TestRecord[]).find((x) => x["id"] === rule["id"])!;
      patch((r["crossReferenceLinks"] as TestRecord[])[0]!);
      return copy;
    };
    expect(() => validateLimitationsSnapshot(variant((l) => (l["citation"] = "§ 0-0 (not the note's)")))).toThrow(/does not match the note/);
    expect(() => validateLimitationsSnapshot(variant((l) => (l["index"] = 99)))).toThrow(/names no tolling note/);
    expect(() => validateLimitationsSnapshot(variant((l) => (l["termCheck"] = "not_all_present")))).toThrow(/does not follow from its terms/);
    expect(() => validateLimitationsSnapshot(variant((l) => ((l["sections"] as TestRecord[])[0]!["nativeId"] = "ZZ:1-1")))).toThrow(
      /outside the rule's jurisdiction/,
    );
    expect(() => validateLimitationsSnapshot(variant((l) => (l["sections"] = [])))).toThrow(/names no section/);
    expect(() => validateLimitationsSnapshot(variant((l) => (l["sectionsNamed"] = 0)))).toThrow(/sectionsNamed/);
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

  it("requires distinct raw provenance for a downloaded judicial PDF", () => {
    const input = fixture();
    const cases = input.cases["cases"] as TestRecord[];
    const reference = cases[0]!;
    // Start from a reference without any retained PDF so the claim stands alone.
    delete reference["rawCapture"];
    delete reference["officialPdfUrl"];
    reference["pdfDownloaded"] = true;
    expect(() => validateLimitationsSnapshot(input)).toThrow(/PDF download claim/);
    reference["officialPdfUrl"] = "https://www.govinfo.gov/example-test-opinion.pdf";
    reference["rawCapture"] = {
      sha256: "a".repeat(64),
      byteLength: 123,
      contentType: "application/pdf",
      retrievedAt: "2026-10-05T11:25:51.000Z",
    };
    expect(validateLimitationsSnapshot(input).cases[0]!.pdfDownloaded).toBe(true);
    reference["officialPdfUrl"] = "http://www.govinfo.gov/example-test-opinion.pdf";
    expect(() => validateLimitationsSnapshot(input)).toThrow(/official HTTPS URL/);
    reference["officialPdfUrl"] = "https://www.govinfo.gov/example-test-opinion.pdf";
    reference["pdfDownloaded"] = false;
    expect(() => validateLimitationsSnapshot(input)).toThrow(/contradicts/);
    reference["pdfDownloaded"] = true;
    (reference["rawCapture"] as TestRecord)["sha256"] = "invalid";
    expect(() => validateLimitationsSnapshot(input)).toThrow(/SHA-256/);
  });

  it("rejects invalid raw authority metadata instead of trusting the text hash", () => {
    const input = fixture();
    const source = (input.sources["sources"] as TestRecord[])[0]!;
    source["rawCapture"] = {
      sha256: "b".repeat(64),
      byteLength: 0,
      contentType: "text/html",
      retrievedAt: "2026-10-05T11:25:51.000Z",
    };
    expect(() => validateLimitationsSnapshot(input)).toThrow(/positive integer/);
    (source["rawCapture"] as TestRecord)["byteLength"] = 456;
    (source["rawCapture"] as TestRecord)["retrievedAt"] = "2026-02-30T12:00:00Z";
    expect(() => validateLimitationsSnapshot(input)).toThrow(/UTC ISO timestamp/);
    (source["rawCapture"] as TestRecord)["retrievedAt"] = "not-a-timestamp";
    expect(() => validateLimitationsSnapshot(input)).toThrow(/retrievedAt/);
  });

  it("accepts the supported authority kinds and requires a statute on every baseline", () => {
    const unsupportedKind = clone(fixture());
    const unsupportedSources = unsupportedKind.sources["sources"] as TestRecord[];
    unsupportedSources[0]!["authorityKind"] = "case_law";
    expect(() => validateLimitationsSnapshot(unsupportedKind)).toThrow(
      /unsupported source metadata/,
    );

    const guidanceSource = (state: string, id: string): TestRecord => ({
      id,
      state,
      title: "Publisher historical table",
      publisher: "Example official publisher",
      url: "https://example.gov/history",
      method: "official-page-capture",
      schemaVersion: "1.0.0",
      capturedAt: "2026-10-05T12:00:00Z",
      verifiedAt: "2026-10-05",
      textPath: `/data/limitations/text/${id}.txt`,
      sha256: "c".repeat(64),
      byteLength: 42,
      authorityKind: "publisher_table",
      validity: "Support evidence only",
      historicalApplicability: "Does not independently state a limitations period",
    });

    const guidanceOnly = clone(fixture());
    const guidanceOnlyRules = guidanceOnly.rules["rules"] as TestRecord[];
    const guidanceOnlyBaseline = guidanceOnlyRules.find(
      (rule) => rule["computation"] === "baseline_only",
    )!;
    const guidanceOnlySource = guidanceSource(
      guidanceOnlyBaseline["jurisdiction"] as string,
      "test-publisher-table-only",
    );
    (guidanceOnly.sources["sources"] as TestRecord[]).push(guidanceOnlySource);
    guidanceOnlyBaseline["sourceIds"] = [guidanceOnlySource["id"]];
    const guidanceOnlyCoverage = (guidanceOnly.coverage["coverage"] as TestRecord[]).find(
      (row) => row["state"] === guidanceOnlyBaseline["jurisdiction"],
    )!;
    (guidanceOnlyCoverage["sourceIds"] as string[]).push(guidanceOnlySource["id"] as string);
    expect(() => validateLimitationsSnapshot(guidanceOnly)).toThrow(
      /must link to at least one statute source/,
    );

    const mixed = clone(fixture());
    const mixedRules = mixed.rules["rules"] as TestRecord[];
    const mixedBaseline = mixedRules.find((rule) => rule["computation"] === "baseline_only")!;
    const statuteId = (mixedBaseline["sourceIds"] as string[])[0]!;
    const statute = (mixed.sources["sources"] as TestRecord[]).find(
      (source) => source["id"] === statuteId,
    )!;
    const support = guidanceSource(
      mixedBaseline["jurisdiction"] as string,
      "test-publisher-table-mixed",
    );
    support["authorityKind"] = "publisher_guidance";
    (mixed.sources["sources"] as TestRecord[]).push(support);
    mixedBaseline["sourceIds"] = [statuteId, support["id"]];
    const mixedCoverage = (mixed.coverage["coverage"] as TestRecord[]).find(
      (row) => row["state"] === mixedBaseline["jurisdiction"],
    )!;
    (mixedCoverage["sourceIds"] as string[]).push(support["id"] as string);
    expect(statute["authorityKind"]).toBe("statute");
    expect(
      validateLimitationsSnapshot(mixed).sources.find((source) => source.id === support["id"]),
    ).toMatchObject({ authorityKind: "publisher_guidance" });
  });
});
