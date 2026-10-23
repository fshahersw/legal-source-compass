import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getAppealsOutcomes,
  getBankruptcyFilings,
  getCourtSittingJudges,
  getJudgeNominations,
  getSenateVoteMembers,
  getVacanciesOverview,
  parseAppealsCell,
  parseAppealsProfile,
  parseBankruptcyFilings,
  parseCoverage,
  parseCriminalProfile,
  parseCriminalYear,
  parseFjcRecord,
  parseNomination,
  parseSenateVote,
  parseVacancy,
  parseVoteMembers,
  safeHttps,
  toCourtJudge,
} from "./judiciary.functions";

const CELL = {
  terminated: 1744,
  merits: 700,
  merits_appeals: 650,
  merits_original: 50,
  procedural: 900,
  consolidated: 144,
  affirmed: 400,
  partial: 40,
  reversed: 27,
  dismissed: 100,
  remanded: 13,
  other: 0,
  coa_denied: 60,
  outcome_missing: 10,
  reversed_pct: 4.2,
  affirmed_pct: 67.7,
  published_pct: 12.5,
  median_days: 600,
};

const DISTRICT = {
  kind: "district",
  court_id: "nysd",
  district_label: "New York - Southern",
  circuit_id: "ca2",
  series: [
    { fy: 2026, ...CELL },
    { fy: 2025, ...CELL },
    { fy: 2025, ...CELL, terminated: 1 }, // duplicate year: dropped
    { fy: 2024, ...CELL, reversed: 9999 }, // parts exceed the merits base: dropped
  ],
  window: CELL,
  circuit_from_districts_window: { ...CELL, reversed_pct: 7.9 },
  by_nature_window: [{ nature: "criminal", label: "Criminal", ...CELL }, { nature: "x" }],
  top_nos_window: [{ nos: 442, label: "CIVIL RIGHTS JOBS", ...CELL }],
  reversal_rank_in_circuit: 6,
  districts_ranked_in_circuit: 6,
  pending_2026_06_30: 1283,
};

describe("appeals", () => {
  it("keeps outcome counts only when they fit inside the merits base", () => {
    expect(parseAppealsCell(CELL)?.affirmedInPart).toBe(40);
    expect(parseAppealsCell({ ...CELL, merits: 2000 })).toBeNull();
    expect(parseAppealsCell({ ...CELL, merits_appeals: 701 })).toBeNull();
    expect(parseAppealsCell({ ...CELL, reversed_pct: 140 })?.reversedPct).toBeNull();
    expect(parseAppealsCell({ ...CELL, terminated: -1 })).toBeNull();
  });

  it("parses a district record, flags the partial year and drops malformed rows", () => {
    const p = parseAppealsProfile(DISTRICT, "nysd")!;
    expect(p.series.map((s) => s.fy)).toEqual([2025, 2026]);
    expect(p.series.find((s) => s.fy === 2026)!.partialYear).toBe(true);
    expect(p.series.find((s) => s.fy === 2025)!.terminated).toBe(1744);
    expect(p.label).toBe("New York - Southern");
    expect(p.circuitId).toBe("ca2");
    expect(p.byNature).toHaveLength(1);
    expect(p.circuitBase?.reversedPct).toBe(7.9);
    expect(p.reversalRank).toBe(6);
  });

  it("refuses a record for another court and an impossible rank", () => {
    expect(parseAppealsProfile(DISTRICT, "nyed")).toBeNull();
    expect(
      parseAppealsProfile({ ...DISTRICT, reversal_rank_in_circuit: 9 }, "nysd")!.reversalRank,
    ).toBeNull();
    expect(parseAppealsProfile({ ...DISTRICT, circuit_id: "../x" }, "nysd")!.circuitId).toBeNull();
  });

  it("links an origin only through a well-formed court id", () => {
    const p = parseAppealsProfile(
      {
        kind: "circuit",
        court_id: "ca9",
        circuit_name: "Ninth Circuit",
        series: [{ fy: 2025, ...CELL }],
        by_origin_window: [
          { origin: "district:cacd", label: "California - Central", court_id: "cacd", ...CELL },
          { origin: "agency:6", label: "Agency", court_id: "javascript:alert(1)", ...CELL },
        ],
      },
      "ca9",
    )!;
    expect(p.byOrigin.map((o) => o.courtId)).toEqual(["cacd", null]);
  });

  it("reads the circuit record for a circuit id and the district record otherwise", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValue({ rows: [], total: null });
    const handler = getAppealsOutcomes as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    await handler({ data: { id: "ca9" } });
    await handler({ data: { id: "nysd" } });
    expect(mocked.mock.calls[0]![0]).toContain(
      "dataset=eq.fjc_appeals_outcomes&id=eq.circuit%3Aca9",
    );
    expect(mocked.mock.calls[1]![0]).toContain("id=eq.district%3Anysd");
  });
});

const CYEAR = {
  fy: 2025,
  partial: false,
  filed: 717,
  terminated: 893,
  disposed: 890,
  pending: 1500,
  convicted: 800,
  disp_convicted_plea: 760,
  disp_convicted_bench: 2,
  disp_convicted_jury: 38,
  disp_acquitted_bench: 1,
  disp_acquitted_jury: 4,
  disp_dismissed: 85,
  sent_prison: 700,
  sent_probation: 90,
  sent_fine_only: 5,
  conviction_pct: 89.9,
  plea_pct: 95,
  trial_pct: 5,
  prison_pct: 87.5,
  median_prison_months: 46,
  median_days_to_termination: 420,
};

describe("criminal", () => {
  it("requires convictions to add up and sentences to fit inside them", () => {
    expect(parseCriminalYear(CYEAR)?.acquitted).toBe(5);
    expect(parseCriminalYear({ ...CYEAR, disp_convicted_plea: 761 })).toBeNull();
    expect(parseCriminalYear({ ...CYEAR, sent_prison: 801 })).toBeNull();
    expect(parseCriminalYear({ ...CYEAR, disposed: 1000 })).toBeNull();
  });

  it("parses the district record with ranks and drops bad offense rows", () => {
    const p = parseCriminalProfile(
      {
        court_id: "nysd",
        district_label: "New York - Southern",
        series: [CYEAR, { ...CYEAR, fy: 2026 }],
        offenses_window: [
          {
            group: "drugs",
            label: "Drug offenses",
            disposed: 100,
            convicted: 97,
            prison_pct: 96.8,
          },
          { group: "bad", label: "Bad", disposed: 1, convicted: 2 },
        ],
        counsel_window: [
          { label: "Criminal Justice Act appointment", disposed: 10, share_pct: 50.3 },
        ],
        ranks_latest: { filed: 18, prison_pct: 46 },
        ranks_of: { filed: 94 },
      },
      "nysd",
    )!;
    expect(p.series.at(-1)!.partialYear).toBe(true);
    expect(p.offenses).toHaveLength(1);
    expect(p.ranks).toMatchObject({ filed: 18, of: 94 });
  });
});

describe("bankruptcy", () => {
  const PERIOD = {
    period: "2025",
    label: "FY2025",
    filed: 5558,
    closed: 5000,
    pending_end: 4983,
    filed_ch7: 3000,
    filed_ch11: 505,
    filed_ch12: 0,
    filed_ch13: 2000,
    filed_ch15: 10,
    filed_business: 800,
    filed_consumer: 4758,
    filed_business_ch11: 480,
    business_share_pct: 14.4,
  };
  const REC = {
    court_id: "nysd",
    bankruptcy_court_id: "nysb",
    district_label: "New York - Southern",
    series: [PERIOD, { ...PERIOD, period: "2024", filed_ch7: 9000 }],
    ranks_fy2025: { filed: 39, business_ch11: 5, of: 94 },
  };

  it("answers for the district or its bankruptcy court and drops a period whose chapters exceed the total", () => {
    expect(parseBankruptcyFilings(REC, "nysb")!.series).toHaveLength(1);
    expect(parseBankruptcyFilings(REC, "nysd")!.ranks.of).toBe(94);
    expect(parseBankruptcyFilings(REC, "nyed")).toBeNull();
  });

  it("shows nothing when the court filter matches more than one record", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [REC, REC], total: null });
    const handler = getBankruptcyFilings as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    expect(await handler({ data: { id: "nysd" } })).toBeNull();
    expect(mocked.mock.calls[0]![0]).toContain(
      `filters=cs.${encodeURIComponent(JSON.stringify({ court: ["nysd"] }))}`,
    );
  });
});

describe("vacancies", () => {
  const OPEN = {
    id: "vac:casd:2021-08-01:hayes-q-william:ec6d04f917",
    court_id: "casd",
    court_name: "District Court, S.D. California",
    court_as_published: "09 - CA-S",
    incumbent: "Hayes,William Q.",
    reason: "Senior",
    vacancy_date: "2021-08-01",
    status: "open",
    days_open_as_of_2026_10_22: 1908,
    nominees: [
      { nominee: "Kanter,Rebecca Suzanne", nomination_date: "2024-02-01", on_current_list: false },
    ],
    pending_nominee: null,
    emergency: { current: true, latest: { days_pending: "1908", weighted: "600" } },
    confirmations: [],
    first_listed: "2021-08",
    last_listed: "2026-10",
    incumbent_fjc_link: {
      fjc_nid: "1392031",
      judge_profile_id: "566301a594ec3aa52263ddfc46ada806",
    },
  };

  it("never shows an earlier, no longer listed nominee as pending", () => {
    const v = parseVacancy(OPEN)!;
    expect(v.pendingNominee).toBeNull();
    expect(v.latestNominee).toBe("Kanter,Rebecca Suzanne");
    expect(v.emergency).toBe(true);
    expect(v.emergencyDaysPending).toBe("1908");
    expect(v.incumbentJudgeId).toBe("566301a594ec3aa52263ddfc46ada806");
  });

  it("reads the pending nominee from a vacancy record or a court summary row", () => {
    expect(
      parseVacancy({
        ...OPEN,
        pending_nominee: { nominee: "Long,Jr.,Robert E.", nomination_date: "2026-09-14" },
      })!.pendingNominee,
    ).toBe("Long,Jr.,Robert E.");
    expect(
      parseVacancy({
        ...OPEN,
        emergency: undefined,
        pending_nominee: "Axt,Philip",
        pending_nomination_date: "2026-09-14",
      })!.pendingNominationDate,
    ).toBe("2026-09-14");
  });

  it("drops unknown statuses, bad links and non-numeric emergency figures", () => {
    expect(parseVacancy({ ...OPEN, status: "rumoured" })).toBeNull();
    const v = parseVacancy({
      ...OPEN,
      court_id: "/evil",
      incumbent_fjc_link: { judge_profile_id: "x" },
      emergency: { current: true, latest: { days_pending: "<b>9</b>" } },
    })!;
    expect(v.courtId).toBeNull();
    expect(v.incumbentJudgeId).toBeNull();
    expect(v.emergencyDaysPending).toBeNull();
  });

  it("counts coverage by report status", () => {
    expect(
      parseCoverage({
        parsed: 1294,
        "not parsed: scanned image without a text layer": 283,
        "not parsed: PDF layout of this report type not supported": 232,
        "partial: 15 rows parsed, the report prints a total of 16": 2,
        "no rows found": 83,
      }),
    ).toEqual({ parsed: 1294, notParsed: 515, partial: 2, noRows: 83 });
  });

  it("builds the overview from the national record and the status filters", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({
        rows: [
          {
            series: [{ month: "2026-10", vacancies_listed: 28, reports: { vacancies: "parsed" } }],
            coverage: { parsed: 3 },
            recent: [],
          },
        ],
        total: null,
      })
      .mockResolvedValueOnce({ rows: [OPEN], total: null })
      .mockResolvedValueOnce({ rows: [], total: null })
      .mockResolvedValueOnce({ rows: [OPEN], total: null });
    const handler = getVacanciesOverview as unknown as () => Promise<{
      open: unknown[];
      emergencies: unknown[];
      series: { parsed: boolean }[];
    }>;
    const r = await handler();
    expect(r.open).toHaveLength(1);
    expect(r.emergencies).toHaveLength(1);
    expect(r.series[0]!.parsed).toBe(true);
    expect(mocked.mock.calls[1]![0]).toContain(
      encodeURIComponent(JSON.stringify({ status: ["open"] })),
    );
  });
});

const VOTE = {
  vote_id: "117-1-220",
  date: "2021-06-08",
  question: "On the Nomination",
  result_text: "Nomination Confirmed (66-33)",
  yeas: 66,
  nays: 33,
  party_split: [
    { party: "D", yea: 48, nay: 0, not_voting: 0, present: 0 },
    { party: "R", yea: 16, nay: 33, not_voting: 1, present: 0 },
    { party: "I", yea: 2, nay: 0, not_voting: 0, present: 0 },
  ],
  page_url: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1171/vote_117_1_00220.htm",
  en_bloc_size: 1,
};
const NOM = {
  id: "nom:117-PN393",
  citation: "PN393",
  congress: 117,
  received_date: "2021-04-19",
  nominee_name: "Julien Xavier Neals",
  description:
    "Julien Xavier Neals, of New Jersey, to be United States District Judge for the District of New Jersey, vice Jose L. Linares, retired.",
  category: "district",
  court_ids: ["njd"],
  predecessor_text: "Jose L. Linares, retired",
  new_position: false,
  status: "confirmed",
  status_date: "2021-06-08",
  referral: { date: "2021-04-19", committee: "Judiciary Committee" },
  hearings: [{ date: "2021-05-12", citation: "S.Hrg. 117-1" }],
  committee_actions: [
    { date: "2021-06-03", text: "Committee on the Judiciary. Ordered to be reported favorably." },
  ],
  cloture: [],
  confirmation: { date: "2021-06-08", method: "Roll call", yeas: 66, nays: 33, record_vote: 220 },
  senate_votes: [VOTE],
  congress_url: "https://www.congress.gov/nomination/117th-congress/393",
};

describe("nominations and votes", () => {
  it("shows a party split only when it adds up to the published tally", () => {
    expect(parseSenateVote(VOTE)!.split).toHaveLength(3);
    expect(parseSenateVote({ ...VOTE, yeas: 67 })!.split).toEqual([]);
    expect(parseSenateVote({ ...VOTE, vote_id: "117-3-220" })).toBeNull();
    expect(parseSenateVote({ ...VOTE, page_url: "https://evil.example/x" })!.pageUrl).toBeNull();
  });

  it("parses a nomination and refuses unknown statuses and citations", () => {
    const n = parseNomination(NOM)!;
    expect(n.courtIds).toEqual(["njd"]);
    expect(n.confirmation).toMatchObject({ method: "Roll call", yeas: 66, recordVote: 220 });
    expect(n.votes).toHaveLength(1);
    expect(parseNomination({ ...NOM, status: "approved" })).toBeNull();
    expect(parseNomination({ ...NOM, citation: "PN-1" })).toBeNull();
    expect(
      parseNomination({ ...NOM, confirmation: { ...NOM.confirmation, method: "Acclaim" } })!
        .confirmation,
    ).toBeNull();
    expect(
      parseNomination({ ...NOM, congress_url: "http://www.congress.gov/x" })!.congressUrl,
    ).toBeNull();
  });

  it("reads nominations by the judge profile filter, oldest first", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({
      rows: [
        NOM,
        {
          ...NOM,
          id: "nom:116-PN1",
          congress: 116,
          citation: "PN1",
          received_date: "2020-01-01",
          status: "returned",
        },
      ],
      total: null,
    });
    const handler = getJudgeNominations as unknown as (a: {
      data: { id: string };
    }) => Promise<{ citation: string }[]>;
    const r = await handler({ data: { id: "8ccc346b923c95670f7cd81c48f321a4" } });
    expect(r.map((n) => n.citation)).toEqual(["PN1", "PN393"]);
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.judicial_nominations");
  });

  it("returns senators exactly as published and rejects a record for another vote", async () => {
    const raw = {
      vote_id: "117-1-220",
      members: [
        { name: "Baldwin (D-WI)", party: "D", state: "WI", vote: "Yea" },
        { name: "<script>", party: "lower", state: "WI", vote: "Yea" },
      ],
      page_url: VOTE.page_url,
    };
    expect(parseVoteMembers(raw, "117-1-220")!.members).toEqual([
      { name: "Baldwin (D-WI)", party: "D", state: "WI", vote: "Yea" },
    ]);
    expect(parseVoteMembers(raw, "117-1-221")).toBeNull();
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [raw], total: null });
    const handler = getSenateVoteMembers as unknown as (a: {
      data: { voteId: string };
    }) => Promise<unknown>;
    expect(await handler({ data: { voteId: "117-1-220" } })).not.toBeNull();
    expect(mocked.mock.calls[0]![0]).toContain("id=eq.vote%3A117-1-220");
  });
});

const PROFILE = {
  nid: "10226111",
  name: "Julien Xavier Neals",
  status: "Active",
  sitting: true,
  birth_year: 1965,
  gender: "Male",
  race_ethnicity: "African American",
  demographics_label: "as recorded by the Federal Judicial Center",
  services: [
    {
      court: "U.S. District Court for the District of New Jersey",
      court_id: "njd",
      title: "Judge",
      president: "Joseph R. Biden",
      party: "Democratic",
      appointing_party_label: "Appointed by a Democratic president",
      seat_id: "NJ0602",
      vote_label: "Roll call 66-33",
      confirmation: "2021-06-08",
      commission: "2021-06-10",
    },
  ],
  mdls: [{ mdl: 2738, title: "IN RE: X", pending: 10 }],
  judge_profile_id: "8ccc346b923c95670f7cd81c48f321a4",
};

describe("FJC record", () => {
  it("keeps the party only as an appointing-president label", () => {
    const r = parseFjcRecord(PROFILE)!;
    expect(r.services[0]!.partyLabel).toBe("Appointed by a Democratic president");
    expect(r.demographicsLabel).toBe("as recorded by the Federal Judicial Center");
    const bare = parseFjcRecord({
      ...PROFILE,
      services: [{ ...PROFILE.services[0], appointing_party_label: "Democratic" }],
    })!;
    expect(bare.services[0]!.partyLabel).toBeNull();
    expect(JSON.stringify(bare)).not.toContain('"Democratic"');
  });

  it("builds a court roster row from the service at that court", () => {
    const j = toCourtJudge(PROFILE, "njd")!;
    expect(j).toMatchObject({
      partyLabel: "Appointed by a Democratic president",
      voteLabel: "Roll call 66-33",
      mdlActions: 10,
    });
    expect(toCourtJudge(PROFILE, "nysd")).toBeNull();
  });

  it("asks for sitting judges of the court only", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ profile: PROFILE }], total: null });
    const handler = getCourtSittingJudges as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown[]>;
    expect(await handler({ data: { id: "njd" } })).toHaveLength(1);
    expect(mocked.mock.calls[0]![0]).toContain(
      encodeURIComponent(JSON.stringify({ court: ["njd"], sitting: ["yes"] })),
    );
  });
});

describe("links", () => {
  it("accepts only https on the named host", () => {
    expect(safeHttps("https://www.senate.gov/a", ["www.senate.gov"])).toBe(
      "https://www.senate.gov/a",
    );
    expect(safeHttps("https://www.senate.gov.evil.example/a", ["www.senate.gov"])).toBeNull();
    expect(safeHttps("javascript:alert(1)", ["www.senate.gov"])).toBeNull();
  });
});
