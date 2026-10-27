import { describe, expect, it } from "vitest";
import { HUBS } from "./hubs";

// Owner decisions 2026-10-23 night ("dont withhold filings") and 2026-10-27 ("dont withhold any data"):
// filings are no longer left out because their text mentions sealed or redacted material. Text is
// withheld where the docket source flags the entry as sealed, and (until documents-v2-entry-flag is
// applied) for filings whose docket text carries contact or hearing-access details. The hub copy must
// not describe the retired keyword rule, and must name the contact-detail hold while it is live.
describe("hub copy about withheld filings", () => {
  const links = Object.values(HUBS).flatMap((spec) => spec.links);

  it("does not describe the retired keyword rule", () => {
    for (const link of links) {
      expect(link.description ?? "").not.toMatch(/sealed or redacted material left out|open filings only/i);
    }
  });

  it("names both reasons the court filings search leaves text out", () => {
    const filings = links.find((l) => l.to === "/litigation/documents");
    expect(filings?.description).toMatch(/docket source flags the entry as sealed/);
    expect(filings?.description).toMatch(/contact or hearing-access details/);
  });
});
