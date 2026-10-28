import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  cellValue,
  columnIndex,
  columnLetters,
  rowCells,
  stringTable,
  xlsxRecords,
  xlsxSharedStrings,
  xlsxSheets,
} from "../xlsx";
import {
  areaLabel,
  censusGovUnits,
  count,
  groupUnits,
  govUnitsRow,
  PARTS,
  titleCase,
  unitOf,
  website,
} from "./censusGovUnits";
import { areaSeries, btosRow, estimate, readPeriods, serialDate } from "./censusBtos";
import type { HeldRecord } from "../types";

/** A ZIP of deflated entries built in memory. */
function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const comp = deflateRawSync(data);
    const nameB = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameB, comp);
    centrals.push(central, nameB);
    offset += local.length + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A minimal .xlsx: every string cell goes through the shared-string table except those marked inline. */
function workbook(
  sheets: Record<string, (string | number | null)[][]>,
  inline = false,
): Uint8Array {
  const strings: string[] = [];
  const idx = new Map<string, number>();
  const si = (s: string) => {
    let i = idx.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      idx.set(s, i);
    }
    return i;
  };
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships>${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}<Relationship Id="rIdS" Type="ss" Target="sharedStrings.xml"/></Relationships>`,
  };
  names.forEach((n, k) => {
    const rows = sheets[n]!.map(
      (cells, r) =>
        `<row r="${r + 1}" spans="1:${cells.length}">${cells
          .map((v, c) => {
            const ref = `${columnLetters(c)}${r + 1}`;
            if (v === null) return `<c r="${ref}" s="1"/>`;
            if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
            if (inline) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
            return `<c r="${ref}" s="2" t="s"><v>${si(v)}</v></c>`;
          })
          .join("")}</row>`,
    );
    files[`xl/worksheets/sheet${k + 1}.xml`] =
      `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
  });
  files["xl/sharedStrings.xml"] =
    `<?xml version="1.0"?><sst count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join("")}</sst>`;
  return zipOf(files);
}

const GP_HEAD = [
  "CENSUS_ID_PID6",
  "UNIT_NAME",
  "UNIT_TYPE",
  "TITLE",
  "ADDRESS1",
  "ADDRESS2",
  "CITY",
  "STATE",
  "ZIP",
  "ZIP4",
  "WEB_ADDRESS",
  "POLITICAL_CODE_DESCRIPTION",
  "POPULATION",
  "POPULATION_SOURCE_YEAR",
  "FIPS_STATE",
  "FIPS_COUNTY",
  "FIPS_PLACE",
  "COUNTY_AREA_NAME",
  "ACTIVE",
];
const SD_HEAD = [
  "CENSUS_ID_PID6",
  "UNIT_NAME",
  "UNIT_TYPE",
  "FUNCTION_NAME",
  "TITLE",
  "ADDRESS1",
  "ADDRESS2",
  "CITY",
  "STATE",
  "ZIP",
  "ZIP4",
  "WEB_ADDRESS",
  "FIPS_STATE",
  "FIPS_COUNTY",
  "COUNTY_AREA_NAME",
  "ACTIVE",
];

describe("xlsx reader", () => {
  it("converts between column letters and indexes", () => {
    for (const n of [0, 1, 25, 26, 27, 51, 52, 701, 702, 16383])
      expect(columnIndex(columnLetters(n))).toBe(n);
    expect(columnLetters(0)).toBe("A");
    expect(columnLetters(26)).toBe("AA");
    expect(columnIndex("AB12")).toBe(27);
  });

  it("reads sheets, shared strings, inline strings, numbers, entities and empty cells", async () => {
    const book = workbook({
      First: [
        ["Name", "Count", "Note"],
        ["A & B <Co>", 12, null],
        ["Second", 3.5, "x"],
      ],
      Other: [["H"], ["only"]],
    });
    const sheets = await xlsxSheets(book);
    expect(sheets).toEqual([
      { name: "First", path: "xl/worksheets/sheet1.xml" },
      { name: "Other", path: "xl/worksheets/sheet2.xml" },
    ]);
    const strings = await xlsxSharedStrings(book);
    expect(strings.get(0)).toBe("Name");
    const recs = await xlsxRecords(book, sheets[0]!.path, strings);
    expect(recs).toEqual([
      { Name: "A & B <Co>", Count: "12", Note: null },
      { Name: "Second", Count: "3.5", Note: "x" },
    ]);
    const inlineBook = workbook({ S: [["K"], ["inline &amp; text"]] }, true);
    const s2 = await xlsxSheets(inlineBook);
    expect(await xlsxRecords(inlineBook, s2[0]!.path, await xlsxSharedStrings(inlineBook))).toEqual(
      [{ K: "inline &amp; text" }],
    );
  });

  it("filters rows on one column before parsing them", async () => {
    const book = workbook({
      S: [
        ["ID", "FIPS_STATE", "NAME"],
        ["1", "01", "Alpha"],
        ["2", "17", "Beta"],
        ["3", "48", "Gamma"],
      ],
    });
    const [s] = await xlsxSheets(book);
    const strings = await xlsxSharedStrings(book);
    const recs = await xlsxRecords(book, s!.path, strings, {
      column: "FIPS_STATE",
      keep: (v) => (v ?? "") >= "10" && (v ?? "") <= "20",
    });
    expect(recs.map((r) => r["NAME"])).toEqual(["Beta"]);
    await expect(
      xlsxRecords(book, s!.path, strings, { column: "MISSING", keep: () => true }),
    ).rejects.toThrow(/no "MISSING" column/);
  });

  it("reads one cell without parsing the row, and positions cells by their reference", () => {
    const table = stringTable(["zero", "one"]);
    const row = `<row r="5"><c r="A5" t="s"><v>1</v></c><c r="C5"><v>7</v></c><c r="AA5" t="s"><v>0</v></c></row>`;
    expect(cellValue(row, "A", table)).toBe("one");
    expect(cellValue(row, "C", table)).toBe("7");
    expect(cellValue(row, "AA", table)).toBe("zero");
    expect(cellValue(row, "B", table)).toBeNull();
    const cells = rowCells(row, table);
    expect(cells[0]).toBe("one");
    expect(cells[1]).toBeNull();
    expect(cells[2]).toBe("7");
    expect(cells[26]).toBe("zero");
  });
});

describe("Government Units List", () => {
  const rec = (head: string[], cells: (string | null)[]) =>
    Object.fromEntries(head.map((h, i) => [h, cells[i] ?? null]));
  const county = rec(GP_HEAD, [
    "100001",
    "COUNTY OF AUTAUGA",
    "1 - COUNTY",
    "ADMINISTRATOR",
    "135 N COURT ST",
    "STE B",
    "PRATTVILLE",
    "AL",
    "36067",
    "3049",
    "www.autaugaco.org",
    "COUNTY",
    "61,464",
    "2024",
    "01",
    "001",
    "99001",
    "AUTAUGA",
    "Y",
  ]);
  const city = rec(GP_HEAD, [
    "100002",
    "CITY OF PRATTVILLE",
    "2 - MUNICIPAL",
    "MAYOR",
    "101 W MAIN ST",
    null,
    "PRATTVILLE",
    "AL",
    "36067",
    null,
    "https://www.prattvilleal.gov",
    "CITY",
    "38,000",
    "2024",
    "01",
    "001",
    "62328",
    "AUTAUGA",
    "Y",
  ]);
  const mud = rec(SD_HEAD, [
    "248086",
    "BRAZORIA COUNTY MUD 50",
    "4 - SPECIAL DISTRICT",
    "91 - WATER SUPPLY UTILITY",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "48",
    "039",
    "BRAZORIA",
    "Y",
  ]);

  it("reads a unit as printed, normalising numbers, ZIP and website", () => {
    const u = unitOf("General Purpose", county)!;
    expect(u).toMatchObject({
      id: "100001",
      name: "COUNTY OF AUTAUGA",
      type: "1 - COUNTY",
      title: "ADMINISTRATOR",
      address: "135 N COURT ST, STE B",
      zip: "36067-3049",
      website: "http://www.autaugaco.org/",
      population: 61464,
      population_year: "2024",
      active: true,
    });
    expect(count("1,234,567")).toBe(1234567);
    expect(count("S")).toBeNull();
    expect(website("not a site")).toBeNull();
    expect(website("HTTPS://Example.GOV/path")).toBe("https://example.gov/path");
  });

  it("takes the FIPS state for a unit listed without an address", () => {
    const u = unitOf("Special District", mud)!;
    expect(u.state).toBe("TX");
    expect(u.address).toBeNull();
    expect(u.kind).toBe("91 - WATER SUPPLY UTILITY");
  });

  it("groups units by county and category and holds repeated identifiers", () => {
    const held: HeldRecord[] = [];
    const groups = groupUnits(
      [
        { sheet: "General Purpose", record: city },
        { sheet: "General Purpose", record: county },
        { sheet: "General Purpose", record: county },
        { sheet: "Special District", record: mud },
      ],
      held,
    );
    expect(held).toEqual([{ key: "100001", reason: "unit identifier listed twice" }]);
    expect(groups.map((g) => `${g.geo}:${g.category}:${g.units.length}`)).toEqual([
      "01001:general:2",
      "48039:special:1",
    ]);
    expect(groups[0]!.units.map((u) => u.id)).toEqual(["100002", "100001"]);
    const row = govUnitsRow(groups[0]!, 2026, "https://www2.census.gov/x.zip");
    expect(row.id).toBe("govunits:01001:general");
    expect(row.county_geoids).toEqual(["01001"]);
    expect(row.state).toBe("AL");
    expect(row.title).toBe("Autauga, AL: county, municipal and township governments (2)");
    expect(row.item["cells"]).toMatchObject({
      units: 2,
      county_population: 61464,
      largest: "COUNTY OF AUTAUGA",
    });
    expect(row.text).toContain("CITY OF PRATTVILLE");
    const statewide = {
      geo: "51",
      state: "VA",
      areaName: null,
      category: "pensions" as const,
      units: [],
    };
    expect(areaLabel(statewide)).toBe("VA (statewide)");
    expect(govUnitsRow({ ...statewide, units: groups[0]!.units }, 2026, "x").county_geoids).toEqual(
      [],
    );
    expect(titleCase("MCLEAN COUNTY")).toBe("McLean County");
  });

  it("splits the workbook into parts that cover every sheet and keep each state in one part per sheet", () => {
    const sheets = new Set(PARTS.flatMap((p) => p.sheets));
    expect([...sheets].sort()).toEqual(
      [
        "DEP School Dist",
        "General Purpose",
        "Public Pension Sys",
        "School District",
        "Special District",
      ].sort(),
    );
    for (const sheet of ["General Purpose", "Special District"]) {
      const ranges = PARTS.filter((p) => p.sheets.includes(sheet)).map((p) => p.states!);
      for (let st = 1; st <= 56; st++) {
        const code = String(st).padStart(2, "0");
        expect(ranges.filter(([a, b]) => code >= a && code <= b)).toHaveLength(1);
      }
    }
  });

  it("refuses a part that reads too few units", async () => {
    const book = workbook({
      "General Purpose": [GP_HEAD, GP_HEAD.map((h) => (county[h] as string | null) ?? null)],
    });
    const outer = zipOf({ "Govt_Units_2026_Final.xlsx": book });
    const http = {
      requests: [],
      remaining: 9,
      getText: async (url: string) => ({
        status: 200,
        text: url.endsWith("datasets/") ? `<a href="2026/">` : "",
        record: {} as never,
      }),
      getBytes: async () => ({ status: 200, bytes: outer, record: {} as never }),
    };
    await expect(
      censusGovUnits.collect({
        http: http as never,
        corpus: {} as never,
        cursor: null,
        now: new Date("2026-10-28T00:00:00Z"),
        env: () => undefined,
      }),
    ).rejects.toThrow(/only 1 units read for part 1/);
  });
});

describe("Business Trends and Outlook Survey", () => {
  it("reads estimates, suppressions and Excel serial dates", () => {
    expect(estimate("14.6%")).toBe(14.6);
    expect(estimate("56.5")).toBe(56.5);
    expect(estimate("S")).toBeNull();
    expect(estimate("")).toBeNull();
    expect(serialDate("45180")).toBe("2023-09-11");
    expect(serialDate("12")).toBeNull();
  });

  it("builds per-area series, pairing standard errors and keeping suppressed periods empty", () => {
    const periods = readPeriods([
      {
        Smpdt: "202620",
        "Collection Start": "46286",
        "Col End": "46299",
        "Reference Period Start": null,
        "Ref End": null,
        "Publication Date": "46303",
      },
      {
        Smpdt: "202621",
        "Collection Start": "46300",
        "Col End": "46313",
        "Reference Period Start": null,
        "Ref End": null,
        "Publication Date": "46317",
      },
      {
        Smpdt: "Source: note",
        "Collection Start": null,
        "Col End": null,
        "Reference Period Start": null,
        "Ref End": null,
        "Publication Date": null,
      },
    ]);
    expect(periods.map((p) => [p.smpdt, p.collection_end])).toEqual([
      ["202620", "2026-10-04"],
      ["202621", "2026-10-18"],
    ]);
    const idx = [
      { State: "AK", "Option Text": "Current performance", "202621": "66.1", "202620": "S" },
      { State: "AK", "Option Text": "Revenues", "202621": "41.3", "202620": "39.8" },
    ];
    const idxSe = [
      { State: "AK", "Option Text": "Current performance", "202621": "3.48", "202620": "S" },
      { State: "AK", "Option Text": "Revenues", "202621": "4.34", "202620": "3.59" },
    ];
    const resp = [
      {
        State: "AK",
        "Question ID": "7",
        Question:
          "In the last two weeks, did this business use Super Intelligence or SI (formerly referred to as Artificial Intelligence)",
        "Answer ID": "1",
        Answer: "Yes",
        "202621": "22.0%",
        "202620": "21.5%",
      },
    ];
    const respSe = [{ ...resp[0]!, "202621": "2.10%", "202620": "1.90%" }];
    const areas = areaSeries(idx, idxSe, resp, respSe, "State");
    const ak = areas.get("AK")!;
    expect(ak.indexes["Current performance"]).toEqual([
      ["202620", null, null],
      ["202621", 66.1, 3.48],
    ]);
    expect(ak.shares["ai_use"]).toEqual([
      ["202620", 21.5, 1.9],
      ["202621", 22, 2.1],
    ]);
    expect(ak.suppressed).toBe(1);
    const row = btosRow(ak, periods, "2026-10-28");
    expect(row.id).toBe("btos:AK");
    expect(row.state).toBe("AK");
    expect(row.item["cells"]).toMatchObject({
      current_performance: 66.1,
      ai_use_pct: 22,
      latest_collection_end: "2026-10-18",
      periods: 2,
    });
    expect(row.detail["facts"]).toContainEqual([
      "Suppressed estimates",
      "1 values the Census Bureau suppressed for quality are left empty",
    ]);
  });
});
