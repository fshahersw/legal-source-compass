import { describe, expect, it } from "vitest";
import {
  courtDocumentFilename,
  courtFilenameDate,
  docketBirdCaseKey,
  matterCaseKeys,
  officialCourtCaseKey,
  parseDocketBirdDocumentId,
  parseDocketNumber,
} from "./docketKeys";

describe("master docket normalization", () => {
  it("parses short and long docket numbers exactly", () => {
    expect(parseDocketNumber("3:25-md-3140")).toEqual({
      office: "3",
      year: 2025,
      type: "md",
      number: "3140",
    });
    expect(parseDocketNumber("3:2025-md-03140")).toEqual({
      office: "3",
      year: 2025,
      type: "md",
      number: "3140",
    });
    expect(parseDocketNumber("0:22-md-3031")).toEqual({
      office: "0",
      year: 2022,
      type: "md",
      number: "3031",
    });
    expect(parseDocketNumber("1:00-md-01358")).toEqual({
      office: "1",
      year: 2000,
      type: "md",
      number: "1358",
    });
    expect(parseDocketNumber("2:21-mc-1230")?.type).toBe("mc");
  });

  it("treats two-digit years from 68 up as 19xx (the JPML began in 1968)", () => {
    expect(parseDocketNumber("1:95-md-1000")?.year).toBe(1995);
    expect(parseDocketNumber("1:67-md-1")?.year).toBe(2067);
    expect(parseDocketNumber("1:68-md-1")?.year).toBe(1968);
  });

  it("rejects anything that is not a federal docket number", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "MDL 3140",
      "3:25-md-",
      "25-md-3140",
      "3:25-3140",
      "3:25-md-3140-extra",
      "3:25-md-x",
    ]) {
      expect(parseDocketNumber(bad)).toBeNull();
    }
  });

  it("derives the DocketBird case key from exact court id and docket number", () => {
    expect(docketBirdCaseKey("flnd", "3:25-md-3140")).toBe("flnd-3:2025-md-03140");
    expect(docketBirdCaseKey("cand", "4:22-md-3047")).toBe("cand-4:2022-md-03047");
    expect(docketBirdCaseKey("mnd", "0:24-md-3108")).toBe("mnd-0:2024-md-03108");
    expect(docketBirdCaseKey("pawd", "2:21-mc-1230")).toBe("pawd-2:2021-mc-01230");
    expect(docketBirdCaseKey("", "3:25-md-3140")).toBeNull();
    expect(docketBirdCaseKey("flnd", "unknown")).toBeNull();
    expect(docketBirdCaseKey("FL ND", "3:25-md-3140")).toBeNull();
  });

  it("derives the court-site case key and the full key set", () => {
    expect(officialCourtCaseKey("3:25-md-3140")).toBe("3:25md3140");
    expect(officialCourtCaseKey("nope")).toBeNull();
    expect(matterCaseKeys("flnd", "3:25-md-3140")).toEqual({
      docketBird: "flnd-3:2025-md-03140",
      officialCourt: "3:25md3140",
      all: ["flnd-3:2025-md-03140", "3:25md3140"],
    });
    expect(matterCaseKeys(null, "3:25-md-3140").all).toEqual(["3:25md3140"]);
    expect(matterCaseKeys(null, null).all).toEqual([]);
  });
});

describe("native document ids", () => {
  it("splits a DocketBird document id into case key and docket-sheet sequence", () => {
    expect(parseDocketBirdDocumentId("flnd-3:2025-md-03140-00771")).toEqual({
      caseKey: "flnd-3:2025-md-03140",
      sequence: 771,
    });
    expect(parseDocketBirdDocumentId("flnd-3:2025-md-03140-1")).toBeNull();
    expect(parseDocketBirdDocumentId("https://example.test/a.pdf")).toBeNull();
  });

  it("reads the court-printed file name and date from a court URL", () => {
    const url =
      "https://www.flnd.uscourts.gov/sites/flnd/files/mdl/2025.02.11%20-%20325md3140%20-%20PTO%202.pdf";
    expect(courtDocumentFilename(url)).toBe("2025.02.11 - 325md3140 - PTO 2.pdf");
    expect(courtFilenameDate("2025.02.11 - 325md3140 - PTO 2.pdf")).toBe("2025-02-11");
    expect(courtFilenameDate("Depo CMO 17.pdf")).toBeNull();
    expect(courtFilenameDate("2025.13.40 - bad.pdf")).toBeNull();
    expect(courtDocumentFilename("not a url")).toBe("not a url");
  });
});
