import { describe, expect, it } from "vitest";
import { buildEntityView } from "@/lib/external/entityView";
import { courtResourceDestination, courtResourceKind, courtResources } from "./resources";

describe("court resources from exact stored profiles", () => {
  it("preserves source labels and URLs rather than constructing service paths", () => {
    const view = buildEntityView({
      title: "Court",
      links: [
        { label: "Local Rules", url: "https://court.example/actual-rules?edition=2026" },
        { label: "Forms", url: "https://court.example/downloads" },
        { label: "CM/ECF", url: "https://filing.example/" },
        { label: "Court homepage", url: "https://court.example/" },
        { label: "Unclassified document", url: "https://court.example/forms" },
      ],
    });
    const resources = courtResources(view);
    expect(resources.map(({ kind, label, url }) => ({ kind, label, url }))).toEqual([
      {
        kind: "rules",
        label: "Local Rules",
        url: "https://court.example/actual-rules?edition=2026",
      },
      { kind: "forms", label: "Forms", url: "https://court.example/downloads" },
      { kind: "filing", label: "CM/ECF", url: "https://filing.example/" },
      { kind: "website", label: "Court homepage", url: "https://court.example/" },
    ]);
  });
  it("does not present a federal destination as a state court resource", () => {
    expect(
      courtResourceDestination("https://www.njd.uscourts.gov/local-rules", "State"),
    ).toBeNull();
    expect(courtResourceDestination("https://www.njcourts.gov/", "State")?.host).toBe(
      "www.njcourts.gov",
    );
    expect(courtResourceDestination("https://www.njd.uscourts.gov/", "Federal")?.host).toBe(
      "www.njd.uscourts.gov",
    );
  });
  it("rejects non-web destinations and credential-bearing URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "//court.example/",
      "/api/files/forms.pdf",
      "https://user:password@court.example/",
    ])
      expect(courtResourceDestination(url)).toBeNull();
  });
  it("deduplicates exact destinations across profile sections without matching names", () => {
    const view = buildEntityView({
      title: "Court",
      links: [{ label: "Forms", url: "https://court.example/forms" }],
      sections: [
        {
          title: "Services",
          items: [
            {
              title: "Filing",
              links: [
                { label: "Court forms", url: "https://court.example/forms" },
                { label: "Filing instructions", url: "https://court.example/file" },
              ],
            },
          ],
        },
      ],
    });
    const resources = courtResources(view);
    expect(resources).toHaveLength(2);
    expect(resources[1]?.recordedIn).toBe("Services");
    expect(courtResources(buildEntityView({ title: "Court without links" }))).toEqual([]);
    expect(courtResourceKind("Reforming court administration")).toBeNull();
  });
});
