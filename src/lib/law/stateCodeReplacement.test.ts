import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseStateListings,
  classifyDataset,
  parseFullCode,
  type StateCodeListing,
} from "./stateCodeContract";

const mocks = vi.hoisted(() => ({
  optional: vi.fn(),
  rest: vi.fn(),
  names: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/external/rest.server", () => ({
  rpcPostOptional: mocks.optional,
  rpcPost: vi.fn(),
  restGet: mocks.rest,
  ilikeTerm: (s: string) => s,
}));
vi.mock("@/lib/private-data/snapshot.server", () => ({
  listSnapshotNames: mocks.names,
  readPrivateSnapshot: mocks.snapshot,
}));

const sdFullCode = {
  state: "SD",
  code_name: "South Dakota Codified Laws",
  edition: "SDCL as published online",
  currency: "Retrieved 2026-10-19",
  source_url: "https://sdlegislature.gov/Statutes",
  grain: "section",
  title_filter: "title",
  chapter_field: "chapter",
  replaces_projection: true,
};

const listing = (over: Partial<StateCodeListing>): StateCodeListing => ({
  state: "SD",
  name: "South Dakota",
  kind: "dataset",
  codeName: "Code",
  sectionCount: 1,
  edition: null,
  currency: null,
  sourceUrl: null,
  note: null,
  datasetId: "state_code_sd",
  hasSnapshot: false,
  titleFilter: "title",
  chapterField: "chapter",
  levels: null,
  ...over,
});

describe("full_code from the enrichment publisher and projection replacement", () => {
  it("honours replaces_projection only as an explicit true on a section-grain block", () => {
    expect(parseFullCode(sdFullCode)?.replacesProjection).toBe(true);
    expect(parseFullCode({ ...sdFullCode, replaces_projection: "true" })?.replacesProjection).toBe(
      false,
    );
    expect(parseFullCode({ ...sdFullCode, grain: "structure" })?.replacesProjection).toBe(false);
    expect(
      parseFullCode({ ...sdFullCode, replaces_projection: undefined })?.replacesProjection,
    ).toBe(false);
  });

  it("reads metadata.summary.full_code when metadata.full_code is absent", () => {
    const row = classifyDataset(
      {
        id: "state_code_sd",
        label: "South Dakota Codified Laws (South Dakota Legislature)",
        ready: true,
        importedRecords: 42000,
        fullCode: null,
        summaryFullCode: sdFullCode,
        listing: { columns: [{ key: "chapter", label: "Chapter" }] },
        qualification: null,
      },
      [],
    );
    expect(row).toMatchObject({
      state: "SD",
      codeName: "South Dakota Codified Laws",
      sectionCount: 42000,
      sourceUrl: "https://sdlegislature.gov/Statutes",
      replacesProjection: true,
    });
  });

  it("prefers metadata.full_code over the summary copy and ignores a non-ready dataset", () => {
    const base = {
      id: "state_code_sd",
      label: "x",
      importedRecords: 1,
      summaryFullCode: sdFullCode,
      listing: null,
      qualification: null,
    };
    expect(
      classifyDataset({ ...base, ready: true, fullCode: { state: "SD", grain: "section" } }, [])
        ?.replacesProjection,
    ).toBe(false);
    expect(classifyDataset({ ...base, ready: false, fullCode: null }, [])).toBeNull();
  });

  it("keeps the projection unless a dataset declares the replacement", () => {
    const projection = listing({ kind: "projection", datasetId: null });
    const plain = listing({ datasetId: "other_sd" });
    const replacing = listing({ replacesProjection: true });
    expect(chooseStateListings([projection], [plain])).toEqual([projection]);
    expect(chooseStateListings([projection], [plain, replacing])).toEqual([replacing]);
    expect(chooseStateListings([], [plain])).toEqual([plain]);
    // A snapshot can never replace a projection, even if mislabelled.
    const snapshot = listing({ kind: "snapshot", replacesProjection: true, hasSnapshot: true });
    expect(chooseStateListings([projection], [snapshot])).toEqual([projection]);
  });
});

describe("state entry with a replacing dataset", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.names.mockReturnValue(["state-codes/tx/browse-v1/codes.json"]);
    mocks.optional.mockImplementation(async (fn: string) =>
      fn === "corpus_publisher_code_projected_states_v2"
        ? [
            { jurisdiction: "SD", code_title: "South Dakota Codified Laws", sections: 27876 },
            { jurisdiction: "NE", code_title: "Nebraska Revised Statutes", sections: 100 },
          ]
        : null,
    );
    mocks.rest.mockImplementation(async (path: string) => {
      if (path.startsWith("corpus_datasets?"))
        return {
          rows: [
            {
              id: "state_code_sd",
              label: "South Dakota Codified Laws (South Dakota Legislature)",
              ready: true,
              imported_records: 42000,
              full_code: null,
              summary_full_code: sdFullCode,
              listing: { columns: [{ key: "chapter", label: "Chapter" }] },
              qualification: null,
            },
          ],
        };
      return { rows: [] };
    });
  });

  it("serves the replacing dataset for its state without reading private snapshots", async () => {
    const { stateCodeEntry } = await import("./stateCodeCatalog.server");
    const rows = await stateCodeEntry("SD");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "dataset",
      datasetId: "state_code_sd",
      sectionCount: 42000,
      replacesProjection: true,
    });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.rest.mock.calls.every(([p]) => String(p).startsWith("corpus_datasets?"))).toBe(
      true,
    );
  });

  it("leaves other states on their projection", async () => {
    const { stateCodeEntry } = await import("./stateCodeCatalog.server");
    const rows = await stateCodeEntry("NE");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("projection");
  });

  it("drops the replaced state's projection hits and subtracts its exact total", async () => {
    mocks.names.mockReturnValue([]);
    mocks.optional.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "corpus_publisher_code_projected_states_v2")
        return [{ jurisdiction: "SD", code_title: "South Dakota Codified Laws", sections: 27876 }];
      if (fn === "corpus_publisher_code_projected_search_v2")
        return args["p_jurisdiction"] === "SD"
          ? { total: 7, hits: [{ jurisdiction: "SD", native_id: "SD:T2/C2-1/2-1-3" }] }
          : {
              total: 10,
              hits: [
                { jurisdiction: "SD", native_id: "SD:T2/C2-1/2-1-3" },
                { jurisdiction: "NE", native_id: "NE:1-101" },
              ],
            };
      return null;
    });
    const { searchFullStateCodes } = await import("./stateCodeCatalog.server");
    const all = await searchFullStateCodes("petition");
    expect(all.hits.some((hit) => hit.kind === "projection" && hit.state === "SD")).toBe(false);
    expect(all.hits.some((hit) => hit.state === "NE")).toBe(true);
    expect(all.total).toBe(3);
    const sd = await searchFullStateCodes("petition", "SD");
    expect(sd.hits.every((hit) => hit.kind === "dataset")).toBe(true);
    expect(sd.total).toBe(0);
  });
});
