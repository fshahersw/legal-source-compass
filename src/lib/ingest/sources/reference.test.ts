import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseXml, childText } from "../xmlTree";
import { zipEntries, zipText } from "../zip";
import { govmanEntities, govmanRow, latestEdition } from "./govman";
import {
  bioSections,
  closingDate,
  ordinalNumber,
  parseCommittees,
  parseMembers,
  surname,
} from "./cdir";
import { parseDelimited, parsePmr, usDate } from "./fdaPmr";
import { csvFields, parseOverdose, overdoseRow, TOTAL } from "./cdcOverdose";

/** A one-entry deflated ZIP built in memory. */
function zipOf(name: string, text: string): Uint8Array {
  const data = Buffer.from(text, "utf8");
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
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + nameB.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameB.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat([local, nameB, comp, central, nameB, end]));
}

describe("zip and xml helpers", () => {
  it("reads a deflated entry", async () => {
    const z = zipOf("pkg/text/a.txt", "hello directory");
    expect(zipEntries(z).map((e) => e.name)).toEqual(["pkg/text/a.txt"]);
    expect((await zipText(z, (n) => n.endsWith(".txt")))?.text).toBe("hello directory");
    expect(await zipText(z, (n) => n.endsWith(".pdf"))).toBeNull();
  });

  it("builds a tree with attributes, entities and comments skipped", () => {
    const doc = parseXml(
      '<?xml version="1.0"?><a x="1"><!-- c --><b>Tom &amp; Jerry&#8212;ok</b><c/></a>',
    );
    const a = doc.children[0]!;
    expect(a.attrs["x"]).toBe("1");
    expect(childText(a, "b")).toBe("Tom & Jerry—ok");
    expect(a.children.map((c) => c.tag)).toEqual(["b", "c"]);
  });
});

const MANUAL = `<?xml version="1.0"?><GovernmentManual>
<Entity EntityId="117" ParentId="0" SortOrder="22"><EntityType>Parent</EntityType><Category>Executive Branch: Departments</Category>
<AgencyName>Department of Health and Human Services</AgencyName>
<Addresses><Address EntityAddressId="1" SortOrder="1"><FooterDetails><Email/><WebAddress>http://www.hhs.gov</WebAddress></FooterDetails><Address>200 Independence Avenue SW., Washington, DC 20201</Address><Phone>202-690-6343</Phone><Phone2/><Fax/></Address></Addresses>
<LeaderShipTables><LeaderShipTable><FooterDetails><WebAddress>https://www.hhs.gov/about</WebAddress></FooterDetails><Header/><LeaderShipTableValues>
<Values><NameColumnValue>Jane Doe</NameColumnValue><TitleColumnValue>SECRETARY</TitleColumnValue></Values>
<Values><NameColumnValue/><TitleColumnValue>-----</TitleColumnValue></Values></LeaderShipTableValues></LeaderShipTable></LeaderShipTables>
<MissionStatement><Heading/><Record><Paragraph>Protects   the health.</Paragraph></Record></MissionStatement>
<SourceOfInformationDetails><EntitySourceOfInformation><FooterDetails><WebAddress>https://www.hhs.gov/foia</WebAddress></FooterDetails><Header>FOIA</Header><Paragraph>Requests go here.</Paragraph></EntitySourceOfInformation></SourceOfInformationDetails>
<Childrens><SubEntityLevelOne EntityId="315" ParentId="117" SortOrder="7"><Category>Executive Branch: Departments</Category><AgencyName>Food and Drug Administration</AgencyName>
<LeaderShipTables/><ProgramAndActivities><ProgramAndActivity><Activity><Details><Detail><FooterDetails><WebAddress>https://www.fda.gov/about-fda</WebAddress></FooterDetails><Paragraph>The FDA protects the public health.</Paragraph></Detail></Details></Activity></ProgramAndActivity></ProgramAndActivities>
</SubEntityLevelOne></Childrens></Entity></GovernmentManual>`;

describe("Government Manual", () => {
  it("reads every level with its own sections and keeps the nesting as arrangement only", () => {
    const ents = govmanEntities(MANUAL);
    expect(ents.map((e) => [e.id, e.parent, e.level])).toEqual([
      ["117", "0", 0],
      ["315", "117", 1],
    ]);
    expect(ents[0]!.leaders).toEqual([{ table: null, title: "SECRETARY", name: "Jane Doe" }]);
    expect(ents[0]!.mission).toEqual(["Protects the health."]);
    expect(ents[0]!.sources[0]).toMatchObject({ heading: "FOIA", url: "https://www.hhs.gov/foia" });
    expect(ents[1]!.programs[0]!.details[0]!.text).toBe("The FDA protects the public health.");
    const row = govmanRow(ents[1]!, "GOVMAN-2025-12-31", new Map(ents.map((e) => [e.id, e.name])));
    expect(row.id).toBe("govman:315");
    expect((row.item["cells"] as Record<string, unknown>)["within"]).toBe(
      "Department of Health and Human Services",
    );
    expect(latestEdition('href="/app/details/GOVMAN-2024-12-31" ... GOVMAN-2025-12-31')).toBe(
      "GOVMAN-2025-12-31",
    );
  });
});

const DIRECTORY = `Closing date for compilation of the Congressional Directory was October 1, 2025.

                                ILLINOIS

ILLINOIS

        2020 Census Population                         Governor                           Delegation

 SENATORS

RICHARD J. DURBIN, Democrat, of Springfield, IL; born in East St. Louis,
IL, November 21, 1944; education: J.D., Georgetown University Law Center,
1969; professional history: attorney (Illinois Bar 1969).

                          Congressional Office
                        https://durbin.senate.gov

711 Hart Senate Office Building, Washington, DC 20510     (202) 224-2152

                            District Offices

230 South Dearborn, Suite 3892, Chicago, IL 60604....     (312) 353-4952
250 West Cherry Street, Suite 115D, Carbondale, IL        (618) 351-1122
 62901...............................................

*  *  *

                                REPRESENTATIVES

                            TWENTY-THIRD DISTRICT

 MIKE BOST, Republican, of Murphysboro, IL; born in Murphysboro, IL,
December 30, 1960; education: high school.

                          Congressional Office
                        https://bost.house.gov

352 Cannon House Office Building, Washington, DC 20515     (202) 225-5661
`;

describe("Congressional Directory", () => {
  it("reads members with their seat, offices and labelled biography", () => {
    const ms = parseMembers(DIRECTORY);
    expect(ms.map((m) => [m.name, m.chamber, m.state, m.district])).toEqual([
      ["RICHARD J. DURBIN", "Senate", "IL", null],
      ["MIKE BOST", "House", "IL", "23"],
    ]);
    const d = ms[0]!;
    expect(d.hometown).toBe("Springfield, IL");
    expect(d.website).toBe("https://durbin.senate.gov");
    expect(d.washington).toEqual({
      address: "711 Hart Senate Office Building, Washington, DC 20510",
      phone: "(202) 224-2152",
    });
    expect(d.districtOffices[1]).toEqual({
      address: "250 West Cherry Street, Suite 115D, Carbondale, IL 62901",
      phone: "(618) 351-1122",
    });
    expect(d.sections["education"]).toBe("J.D., Georgetown University Law Center, 1969");
    expect(closingDate(DIRECTORY)).toBe("2025-10-01");
    expect(ordinalNumber("TWENTY-THIRD")).toBe(23);
    expect(surname("JAMES C. JUSTICE, Jr.")).toBe("JUSTICE");
    expect(bioSections("X, Democrat, of Y; born in Z, 1950; education: B.A.")["born"]).toBe(
      "Z, 1950",
    );
  });

  it("reads committee rosters in printed order with printed roles and wrapped roles", () => {
    const text = `
                    STANDING COMMITTEES OF THE SENATE

                                           Judiciary

                                      Room SD-224        (ph) (202) 224-5225
                                       https://judiciary.senate.gov


Chuck Grassley (ia) chair            Richard J. Durbin (il) ranking
Lindsey Graham (sc)                      member
John Cornyn (tx)                     Sheldon Whitehouse (ri)

                              SUBCOMMITTEES

                        THE CONSTITUTION

Eric Schmitt (mo) chair              Richard Blumenthal (ct) ranking member
John Cornyn (tx)

                    STANDING COMMITTEES OF THE HOUSE

                                                   Agriculture

                            Majority:      Room 1301 LHOB        (ph) (202) 225-2171

Glenn Thompson (pa-15) chairman      Angie Craig (mn-02)
Dusty Johnson (sd-at)

                            JOINT COMMITTEES
`;
    const cs = parseCommittees(text);
    const j = cs.find((c) => c.name === "Judiciary")!;
    expect(j.room).toBe("SD-224");
    expect(j.members.map((m) => [m.name, m.side, m.role])).toEqual([
      ["Chuck Grassley", "majority", "chair"],
      ["Lindsey Graham", "majority", null],
      ["John Cornyn", "majority", null],
      ["Richard J. Durbin", "minority", "ranking member"],
      ["Sheldon Whitehouse", "minority", null],
    ]);
    expect(j.subcommittees[0]!.name).toBe("THE CONSTITUTION");
    const ag = cs.find((c) => c.chamber === "House")!;
    expect(ag.members.map((m) => [m.name, m.state, m.district])).toEqual([
      ["Glenn Thompson", "PA", "15"],
      ["Dusty Johnson", "SD", "At large"],
      ["Angie Craig", "MN", "2"],
    ]);
  });
});

describe("FDA postmarketing requirements", () => {
  it("parses quoted tilde-delimited fields with embedded newlines and dates", () => {
    expect(parseDelimited('a~"b ~ c"~d\r\n1~"x\ny"~3\r\n')).toEqual([
      ["a", "b ~ c", "d"],
      ["1", "x\ny", "3"],
    ]);
    expect(usDate("8/23/2021 0:00:00")).toBe("2021-08-23");
    expect(usDate("")).toBeNull();
    const header =
      '"Internal Identifier"~"FDA Center"~"Application Type"~"Application Number"~"Applicant Name"~"Product Name"~"Original Application Approval Date"~"Submission Type"~"Submission Number"~"PMR/PMC Unique Identifier"~"PMR or PMC"~"PMR/PMC Type"~"CDER PMR/PMC Set Number"~"PMR/PMC Number"~"PMR/PMC Description"~"PMR/PMC Status"~"PMR/PMC Status Explanation"~"PMR/PMC Original Final Report Due Date"~"Last Annual Status Report Received Date"';
    const row =
      '383243~"CBER"~"BLA"~125742.00~"BioNTech"~"COMIRNATY"~8/23/2021 0:00:00~"Supplement"~656~"125742/656-3"~"PMR"~"FDAAA PMR"~~3~"Study of\nmyocarditis."~"Delayed"~~9/30/2026 0:00:00~10/17/2025 0:00:00';
    const { records } = parsePmr(`${header}\r\n${row}\r\n`);
    expect(records[0]).toMatchObject({
      applicationNumber: "125742",
      status: "Delayed",
      description: "Study of myocarditis.",
      finalReportDue: "2026-09-30",
    });
    expect(() => parsePmr('"Other"~"Header"\r\n')).toThrow();
  });
});

describe("CDC overdose deaths", () => {
  it("keeps suppressed values empty and reads the latest 12-month period", () => {
    expect(csvFields('"AK","Alaska","2015","April","Opioids, incl. (T40)",,,"100","**"')).toEqual([
      "AK",
      "Alaska",
      "2015",
      "April",
      "Opioids, incl. (T40)",
      "",
      "",
      "100",
      "**",
    ]);
    const csv = [
      '"state","state_name","year","month","indicator","data_value","predicted_value","percent_complete","footnote_symbol"',
      `"US","United States","2025","May","${TOTAL}","74800","75100","100","*"`,
      `"US","United States","2026","May","${TOTAL}","65351","66478","100","*"`,
      `"US","United States","2026","April","${TOTAL}",,,"100","**"`,
      '"XX1","bad","2026","May","x","1","1","1",""',
    ].join("\n");
    const s = parseOverdose(csv);
    expect(s.map((x) => x.code)).toEqual(["US"]);
    expect(s[0]!.indicators[TOTAL]!.map((p) => [p[0], p[1]])).toEqual([
      ["2025-05", 74800],
      ["2026-04", null],
      ["2026-05", 65351],
    ]);
    const cells = overdoseRow(s[0]!, "2026-10-28").item["cells"] as Record<string, unknown>;
    expect(cells["latest_period"]).toBe("2026-05");
    expect(cells["change_vs_year_before_pct"]).toBe(-12.6);
  });
});
