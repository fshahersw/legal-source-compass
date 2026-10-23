import { describe, expect, it } from "vitest";
import {
  markHeld,
  parseCapFile,
  parseCaseRow,
  parseReadingRecord,
  readRanges,
  unheldCitedClusters,
  MAX_RANGE_BYTES,
} from "./caselaw";
import { parseCourtOption } from "./caselaw.functions";

const KEY_A = "caselaw/read/2026-09-30/t4/v2/u05/t4-u05-0000-0123456789ab.jsonl.gz";
const KEY_B = "caselaw/read/2026-09-30/t4/v2/u09/t4-u09-0002-ba9876543210.jsonl.gz";

describe("case law v2 parsing", () => {
  it("reads tiers 4-7 with court facts and the CAP crosswalk", () => {
    const r = parseCaseRow(
      {
        cluster_id: 101,
        tier: 5,
        court_id: "nysd",
        case_name: "Morgan v. Schipa",
        jurisdiction: "NY",
        court_level: "FD",
        court_system: "federal",
        cap_file: "law.free.cap.f-supp.585/245.7857950.json",
        source: "LU",
        opinions: [{ id: 1, type: "010combined", key: KEY_A, s: 0, n: 10 }],
      },
      101,
    );
    expect(r?.tier).toBe(5);
    expect([r?.jurisdiction, r?.courtLevel, r?.courtSystem, r?.sourceCode]).toEqual([
      "NY",
      "FD",
      "federal",
      "LU",
    ]);
    expect(r?.capFile).toEqual({
      reporter: "f-supp",
      volume: "585",
      page: "245",
      capId: "7857950",
    });
    expect(r?.opinions[0]?.pointer?.key).toBe(KEY_A);
    expect(parseCaseRow({ cluster_id: 1, tier: 8, court_id: "x", case_name: "y" }, 1)).toBeNull();
    expect(parseCapFile("https://evil.example/x.json")).toBeNull();
  });

  it("plans one read per object and splits ranges that are too wide", () => {
    const r = readRanges([
      { key: KEY_A, offset: 100, length: 50 },
      { key: KEY_B, offset: 0, length: 20 },
      { key: KEY_A, offset: 0, length: 40 },
    ]);
    expect(r).toEqual([
      { key: KEY_A, start: 0, end: 150, members: [0, 2] },
      { key: KEY_B, start: 0, end: 20, members: [1] },
    ]);
    const wide = readRanges([
      { key: KEY_A, offset: 0, length: 10 },
      { key: KEY_A, offset: MAX_RANGE_BYTES, length: 10 },
    ]);
    expect(wide.map((x) => x.members)).toEqual([[0], [1]]);
  });

  it("keeps a v2 record's exact provenance and re-checks unheld links", () => {
    const rec = {
      format: "caselaw-read/1",
      opinion_id: 5,
      cluster_id: 101,
      text: "See 1 F.3d 2 and 3 F.3d 4.",
      type: "010combined",
      citations: [
        [4, 12, 77, 70, 0],
        [17, 25, 88, 80, 1],
        [0, 3, 99, 90, 2],
      ],
      source: {
        file: "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2026-09-30.csv.bz2",
        segment: 300,
        offset: 7486,
        record_sha256: "a".repeat(64),
        field: "html_with_citations",
        raw_sha256: "b".repeat(64),
        raw_bytes: 123,
        sha1: "c".repeat(40),
        date_modified: "2021-02-03",
      },
    };
    const o = parseReadingRecord(rec, 5)!;
    expect(o.provenance).toMatchObject({
      segment: 300,
      offset: 7486,
      field: "html_with_citations",
      rawBytes: 123,
    });
    expect(
      parseReadingRecord({ ...rec, source: { file: "javascript:alert(1)" } }, 5)?.provenance,
    ).toBeNull();
    expect(unheldCitedClusters([o])).toEqual([77]); // 88 held already; 99 blocked (no cluster id kept)
    const marked = markHeld([o], new Set([77]));
    // anchors are ordered by start: the blocked one (no cluster id kept), 77 (now held), 88
    expect(marked[0]!.citations.map((c) => [c.clusterId, c.held])).toEqual([
      [null, false],
      [77, true],
      [88, true],
    ]);
    expect(o.citations[1]!.held).toBe(false); // the input is not mutated
  });

  it("parses court options of every tier with their state", () => {
    expect(
      parseCourtOption({
        court_id: "texapp",
        tier: 4,
        full_name: "Court of Appeals of Texas",
        cases: 3,
        cases_with_text: 2,
        level: "SA",
        system: "state",
        jurisdiction: "TX",
        url: "javascript:x",
      }),
    ).toMatchObject({
      courtId: "texapp",
      tier: 4,
      casesWithText: 2,
      jurisdiction: "TX",
      url: null,
    });
    expect(parseCourtOption({ court_id: "TX", tier: 4, full_name: "x", cases: 1 })).toBeNull();
    expect(
      parseCourtOption({ court_id: "tx", tier: 4, full_name: "x", cases: 1 })?.casesWithText,
    ).toBeNull();
  });
});
