import { describe, expect, it } from "vitest";
import { buildFdaRecallEvents, eventYears, firmLeaders, toEvents, type EnforcementRow } from "./fdaRecallEvents";

const row = (o: Partial<EnforcementRow>): EnforcementRow => ({
  ev: "1",
  cls: "Class II",
  firm: "Acme Foods",
  fn: "ACME FOODS",
  st: "Terminated",
  idt: "2025-03-01",
  rd: "2025-04-01",
  ...o,
});

describe("toEvents", () => {
  it("groups product rows on FDA's event id, never on reason text", () => {
    // 48 product rows of one event (the Silver Moon shape) and one other event.
    const rows = Array.from({ length: 48 }, (_, i) =>
      row({ ev: "9001", cls: i === 3 ? "Class I" : "Class II", st: i === 7 ? "Ongoing" : "Terminated", idt: i === 5 ? "2025-02-20" : "2025-03-01" }),
    );
    rows.push(row({ ev: "9002" }));
    const { events, rowsWithoutEvent } = toEvents("food", rows);
    expect(events).toHaveLength(2);
    const big = events.find((e) => e.eventId === "9001")!;
    expect(big.rows).toBe(48);
    expect(big.classI).toBe(true);
    expect(big.ongoing).toBe(true);
    expect(big.initiated).toBe("2025-02-20");
    expect(rowsWithoutEvent).toBe(0);
  });

  it("counts rows without an event id instead of inventing events", () => {
    const { events, rowsWithoutEvent } = toEvents("drug", [row({ ev: null }), row({ ev: " " }), row({ ev: "5" })]);
    expect(events).toHaveLength(1);
    expect(rowsWithoutEvent).toBe(2);
  });
});

describe("eventYears", () => {
  it("counts events by initiation year and center, with Class I, and flags the latest year partial", () => {
    const { events: drug } = toEvents("drug", [row({ ev: "a", idt: "2024-05-01", cls: "Class I" }), row({ ev: "b", idt: "2026-09-30" })]);
    const { events: device } = toEvents("device", [row({ ev: "c", idt: "2024-06-01" })]);
    const years = eventYears([...drug, ...device], 2024);
    expect(years.map((y) => y.year)).toEqual(["2024", "2025", "2026"]);
    expect(years[0]).toMatchObject({ drug: 1, device: 1, food: 0, classI: 1, total: 2, partial: false });
    expect(years[1]!.total).toBe(0);
    expect(years[2]!.partial).toBe(true);
  });
});

describe("firmLeaders", () => {
  it("ranks firms by events in the window and keeps each center's exact firm key apart", () => {
    const { events: food } = toEvents("food", [
      ...Array.from({ length: 121 }, () => row({ ev: "x1", fn: "ALBERTSONS COMPANIES LLC", firm: "Albertsons Companies LLC", idt: "2026-06-01" })),
      row({ ev: "m1", fn: "MEDLINE INDUSTRIES LP", firm: "Medline", idt: "2026-06-02" }),
      row({ ev: "m2", fn: "MEDLINE INDUSTRIES LP", firm: "Medline", idt: "2026-06-03" }),
    ]);
    const leaders = firmLeaders(food, "2026-01-01", "2026-12-31");
    expect(leaders[0]).toMatchObject({ firmKey: "MEDLINE INDUSTRIES LP", events: 2 });
    expect(leaders[1]).toMatchObject({ firmKey: "ALBERTSONS COMPANIES LLC", events: 1, rows: 121 });
  });
});

describe("buildFdaRecallEvents", () => {
  it("reports events, rows and the 12-month window ending at the latest initiation", () => {
    const p = buildFdaRecallEvents(
      {
        device: [row({ ev: "d1", idt: "2026-10-01", cls: "Class I" }), row({ ev: "d1", idt: "2026-10-01" }), row({ ev: "d2", idt: "2025-01-01" })],
        drug: [row({ ev: null })],
      },
      "2026-10-27T00:00:00Z",
    );
    expect(p.window).toEqual({ from: "2025-10-02", to: "2026-10-01" });
    expect(p.kpis).toMatchObject({ eventsLast12: 1, classILast12: 1, rows: 4, events: 2, rowsWithoutEvent: 1 });
  });
});
