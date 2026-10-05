import { describe, expect, it } from "vitest";
import {
  canonicalDatasetId,
  canonicalSearchDatasetIds,
  datasetVersionFamily,
  datasetVersionLabel,
  resolveDatasetVersion,
  visibleDatasetChoices,
} from "./datasetVersions";

describe("audited dataset snapshot families", () => {
  it("uses only canonical FDA and CourtListener snapshots in ready search scopes", () => {
    expect(
      canonicalSearchDatasetIds([
        { id: "agency_safety_openfda_device_classification", ready: true, records: 7_093 },
        { id: "agency_safety_openfda_device_classification_20261002", ready: true, records: 7_094 },
        { id: "people", ready: true, records: 16_191 },
        { id: "cl_people", ready: true, records: 16_191 },
        { id: "cpsc_injury_data", ready: true, records: 20 },
      ]),
    ).toEqual([
      "agency_safety_openfda_device_classification_20261002",
      "cl_people",
      "cpsc_injury_data",
    ]);
  });

  it("keeps the prior snapshot selectable when the canonical snapshot is absent or held", () => {
    const prior = { id: "people", ready: true, records: 16_191 };
    expect(visibleDatasetChoices([prior])).toEqual([prior]);
    expect(
      visibleDatasetChoices([prior, { id: "cl_people", ready: false, records: 16_191 }]).map(
        (dataset) => dataset.id,
      ),
    ).toEqual(["people", "cl_people"]);
    expect(canonicalSearchDatasetIds([prior])).toEqual(["people"]);
    expect(
      canonicalSearchDatasetIds([prior, { id: "cl_people", ready: true, records: 0 }]),
    ).toEqual(["people", "cl_people"]);
  });

  it("preserves direct prior-version links inside the canonical view", () => {
    const datasets = [
      { id: "people", ready: true, records: 16_191 },
      { id: "cl_people", ready: true, records: 16_191 },
    ];
    expect(resolveDatasetVersion("people", datasets)).toEqual({
      canonicalId: "cl_people",
      selectedId: "people",
      family: datasetVersionFamily("people"),
    });
    expect(resolveDatasetVersion("cl_people", datasets)).toEqual({
      canonicalId: "cl_people",
      selectedId: "cl_people",
      family: datasetVersionFamily("cl_people"),
    });
    expect(canonicalDatasetId("agency_safety_openfda_device_classification")).toBe(
      "agency_safety_openfda_device_classification_20261002",
    );
  });

  it("keeps unrelated and held datasets visible and labels both versions in the raw inventory", () => {
    const rows = [
      { id: "agency_safety_openfda_device_classification", ready: true, records: 7_093 },
      { id: "agency_safety_openfda_device_classification_20261002", ready: true, records: 7_094 },
      { id: "cpsc_injury_data", ready: false, records: 479_534 },
    ];
    expect(visibleDatasetChoices(rows).map((row) => row.id)).toEqual([
      "agency_safety_openfda_device_classification_20261002",
      "cpsc_injury_data",
    ]);
    expect(datasetVersionLabel("people", "Historical biographies")).toContain("prior snapshot");
    expect(datasetVersionLabel("cl_people", "CourtListener people")).toContain("current snapshot");
    expect(datasetVersionFamily("cpsc_injury_data")).toBeNull();
  });

  it("does not hide a prior snapshot when its canonical row has no records", () => {
    expect(
      visibleDatasetChoices([
        { id: "people", ready: true, records: 16_191 },
        { id: "cl_people", ready: true, records: 0 },
      ]).map((row) => row.id),
    ).toEqual(["people", "cl_people"]);
  });
});
