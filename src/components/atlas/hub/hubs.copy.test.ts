import { describe, expect, it } from "vitest";
import { HUBS } from "./hubs";

// Owner decisions 2026-10-23 night ("dont withhold filings") and 2026-10-27 ("dont withhold any data"):
// filings are no longer left out because their text mentions sealed or redacted material. Text is
// withheld only where the docket source flags the entry, so the hub copy must not describe the
// retired keyword rule.
describe("hub copy about withheld filings", () => {
  const links = Object.values(HUBS).flatMap((spec) => spec.links);

  it("does not describe the retired keyword rule", () => {
    for (const link of links) {
      expect(link.description ?? "").not.toMatch(/sealed or redacted material left out|open filings only/i);
    }
  });

  it("says the court filings search leaves out only source-flagged entries", () => {
    const filings = links.find((l) => l.to === "/litigation/documents");
    expect(filings?.description).toMatch(/docket source flags the entry as sealed or withheld/);
  });
});
