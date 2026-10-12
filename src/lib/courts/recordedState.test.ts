import { describe, expect, it } from "vitest";
import { recordedCourtState } from "./recordedState";

describe("recorded court state", () => {
  it("preserves exact state identities and explicit qualified USPS facts", () => {
    expect(recordedCourtState("California")?.usps).toBe("CA");
    expect(recordedCourtState("CA")?.usps).toBe("CA");
    expect(
      recordedCourtState("CA — state name printed in the CourtListener court name")?.usps,
    ).toBe("CA");
    expect(recordedCourtState("NJ – publisher-recorded jurisdiction")?.usps).toBe("NJ");
  });

  it("does not infer a state from court names, prefixes or ambiguous text", () => {
    for (const value of [
      null,
      {},
      "California Northern District",
      "CAND",
      "CA/NY",
      "CA district",
      "ZZ — source note",
      "CA — ",
    ])
      expect(recordedCourtState(value)).toBeNull();
  });
});
