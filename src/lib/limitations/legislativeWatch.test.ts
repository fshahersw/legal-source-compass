import { describe, expect, it } from "vitest";
import { WATCH_PHRASES, parseWatchRow, summarizeWatch, watchPath } from "./legislativeWatch";

/* Rows shaped like the sampled state_bills records (2026-10-27). */
const tn = {
  id: "tn-114-sb866",
  source_url: "https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=SB0866&ga=114",
  c: {
    state: "TN",
    title:
      "Statutes of Limitations and Repose - As enacted, specifies that a party filing a counterclaim ... is not subject to the four-year statute of repose. - Amends TCA Title 28.",
    status: "signed",
    session: "114",
    identifier: "SB 866",
    session_name: "114th Regular Session (2025-2026)",
    status_label: "Signed by the executive",
    latest_action: "Pub. Ch. 684",
    latest_action_date: "2026-04-24",
  },
  f: {
    outcome: ["enacted"],
    state: ["TN"],
    session_role: ["current"],
    subject: ["Statutes of Limitations and Repose"],
  },
};
const ut = {
  id: "ut-2026-hb139",
  source_url: "https://le.utah.gov/~2026/bills/static/HB0139.html",
  c: {
    state: "UT",
    title: "Female Genital Mutilation Amendments",
    identifier: "HB 139",
    session: "2026",
    session_name: "2026 General Session",
    status_label: "Signed by the executive",
    latest_action: "Governor Signed",
    latest_action_date: "2026-03-26",
  },
  f: { outcome: ["enacted"], subject: ["Crimes", "Statute of Limitations"] },
};
const pending = {
  id: "tx-89r-sb293",
  source_url: "https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB293",
  c: {
    state: "TX",
    title: "Relating to the limitation of actions",
    identifier: "SB 293",
    session: "89R",
    status_label: "Introduced",
    latest_action_date: "2025-01-14",
  },
  f: { outcome: ["none"] },
};

describe("legislative change watch", () => {
  it("searches current sessions only, by exact phrases, within the state_bills dataset", () => {
    const path = decodeURIComponent(watchPath());
    expect(path).toContain("dataset=eq.state_bills");
    expect(path).toContain('filters=cs.{"session_role":["current"]}');
    for (const p of WATCH_PHRASES) expect(path).toContain(`search_vector.phfts(simple).${p}`);
    expect(path).toContain("limit=500");
  });
  it("keeps the outcome and links as printed and says what the text mentions", () => {
    const b = parseWatchRow(tn)!;
    expect(b).toMatchObject({
      outcome: "enacted",
      identifier: "SB 866",
      mentions: "repose",
      latestActionDate: "2026-04-24",
    });
    expect(b.sourceUrl).toContain("capitol.tn.gov");
    expect(parseWatchRow(ut)!.mentions).toBe("limitations");
    expect(parseWatchRow(pending)!.outcome).toBe("pending");
    expect(parseWatchRow({ id: "x", c: { state: "Texas" } })).toBeNull();
  });
  it("summarizes bills, states and enactments, with recorded zeros between months", () => {
    const bills = [tn, ut, pending].map((r) => parseWatchRow(r)!);
    const s = summarizeWatch(bills, "2026-10-01");
    expect([s.bills, s.states, s.enacted, s.enactedStates, s.pending]).toEqual([3, 3, 2, 2, 1]);
    expect(s.byMonth[0]).toEqual({ month: "2025-01", enacted: 0, other: 1, partial: false });
    expect(s.byMonth.at(-1)).toEqual({ month: "2026-04", enacted: 1, other: 0, partial: false });
    expect(s.byMonth).toHaveLength(16);
    expect(summarizeWatch(bills, "2026-04-15").byMonth.at(-1)!.partial).toBe(true);
    expect(summarizeWatch([], null).byMonth).toEqual([]);
  });
});
