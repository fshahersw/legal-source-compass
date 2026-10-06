import { describe, expect, it } from "vitest";
import { acceptsRegisteredCaseId, selectRegisteredCaseIds } from "./docketVariants";

const REGISTERED = [
  "3:21-md-3004-njr",
  "2:19-md-2921",
  "MDL 2921",
  "MDL No. 2738",
  "MDL 2323",
  "MDL 2750",
  "MDL 3055",
  "ncwb-3:2021-ap-03032",
  "njb-3:2021-ap-03032",
  "1:17-MD-2804",
  "Paraquat Products Liability Litigation",
  "Seeger Weiss",
];

describe("registered case ids for a matter document query", () => {
  it("adds the judge-suffix spelling of a docket the page already requests", () => {
    expect(
      selectRegisteredCaseIds(["ilsd-3:2021-md-03004", "3:21md3004"], "3004", REGISTERED),
    ).toEqual(["3:21-md-3004-njr"]);
  });

  it("adds zero-padding and the MDL label for that same number", () => {
    expect(
      selectRegisteredCaseIds(
        ["njd-2:2019-md-02921", "16684846", "2:19-md-02921"],
        "2921",
        REGISTERED,
      ),
    ).toEqual(["2:19-md-2921", "MDL 2921"]);
  });

  it("adds an MDL No. label only for the matter's own number", () => {
    expect(selectRegisteredCaseIds(["3:16-md-02738"], "2738", REGISTERED)).toEqual([
      "MDL No. 2738",
    ]);
    expect(selectRegisteredCaseIds(["2:12-md-02323"], "2323", REGISTERED)).toEqual(["MDL 2323"]);
    expect(acceptsRegisteredCaseId("MDL 2921", ["3:21md3004"], "3004")).toBe(false);
    expect(acceptsRegisteredCaseId("MDL No. 3005", ["3:21md3004"], "3004")).toBe(false);
  });

  it("treats hyphens, padding, year width, and letter case as the same docket", () => {
    expect(acceptsRegisteredCaseId("1:17-MD-2804", ["1:17-md-02804"], "2804")).toBe(true);
    expect(acceptsRegisteredCaseId("3:19md2885", ["3:19-md-02885"], "2885")).toBe(true);
    expect(acceptsRegisteredCaseId("3:21-md-3004-njr", ["ilsd-3:2021-md-03004"], "3004")).toBe(
      true,
    );
  });

  it("does not cross two court prefixes, nearby numbers, captions, or firms", () => {
    expect(acceptsRegisteredCaseId("njb-3:2021-ap-03032", ["ncwb-3:2021-ap-03032"], "3032")).toBe(
      false,
    );
    expect(acceptsRegisteredCaseId("2:19-md-2922", ["2:19-md-02921"], "2921")).toBe(false);
    expect(acceptsRegisteredCaseId("3:21-cv-03004", ["3:21-md-03004"], "3004")).toBe(false);
    expect(
      acceptsRegisteredCaseId("Paraquat Products Liability Litigation", ["3:21md3004"], "3004"),
    ).toBe(false);
    expect(acceptsRegisteredCaseId("Seeger Weiss", ["2:19-md-02921"], "2921")).toBe(false);
    expect(acceptsRegisteredCaseId("16684846", ["2:19-md-02921"], "2921")).toBe(false);
  });

  it("leaves ids the page already requests off the alias list", () => {
    expect(selectRegisteredCaseIds(["2:19-md-2921"], "2921", ["2:19-md-2921"])).toEqual([]);
  });
});
