import { describe, expect, it } from "vitest";
import {
  LIVE_FRAME_GRACE_MS,
  RACE_HEDGE_MS,
  raceChosen,
  raceFailed,
  raceHedge,
  raceReady,
  startRace,
} from "./viewRace";

describe("view race", () => {
  it("is a race only when more than one view is offered, and queues all but the first", () => {
    expect(startRace(["reader", "browser"])).toMatchObject({ open: true, queued: ["browser"] });
    expect(startRace(["reader"])).toMatchObject({ open: false, queued: [] });
    expect(startRace(["embed"]).open).toBe(false);
  });

  it("starts the next view when the first has not answered within the delay", () => {
    const step = raceHedge(startRace(["reader", "browser"]));
    expect(step.start).toBe("browser");
    expect(step.race.queued).toEqual([]);
    // Nothing more to start the second time.
    expect(raceHedge(step.race).start).toBeUndefined();
  });

  it("does not start the next view when the first answered in time", () => {
    const won = raceReady(startRace(["reader", "browser"]), "reader");
    expect(won.show).toBe("reader");
    expect(raceHedge(won.race).start).toBeUndefined();
    expect(won.race.queued).toEqual([]);
  });

  it("shows the first view that is ready and ignores the other when it arrives", () => {
    const hedged = raceHedge(startRace(["reader", "browser"]));
    const first = raceReady(hedged.race, "browser");
    expect(first.show).toBe("browser");
    const second = raceReady(first.race, "reader");
    expect(second.show).toBeUndefined();
    expect(second.race.open).toBe(false);
  });

  it("starts the next view at once when the first fails, and shows the next when it is ready", () => {
    const afterFail = raceFailed(startRace(["reader", "browser"]), "reader");
    expect(afterFail.show).toBeUndefined();
    expect(afterFail.start).toBe("browser");
    expect(afterFail.race.open).toBe(true);
    expect(raceReady(afterFail.race, "browser").show).toBe("browser");
  });

  it("shows the error only when every view failed, counting each once", () => {
    const start = startRace(["reader", "browser"]);
    const first = raceFailed(start, "reader");
    const again = raceFailed(first.race, "reader");
    expect(again.show).toBeUndefined();
    const both = raceFailed(again.race, "browser");
    expect(both.show).toBe("blocked");
    expect(both.race.open).toBe(false);
  });

  it("does nothing once a person has chosen a view", () => {
    const chosen = raceChosen(startRace(["reader", "browser"]));
    expect(chosen.open).toBe(false);
    expect(chosen.queued).toEqual([]);
    expect(raceReady(chosen, "browser").show).toBeUndefined();
    expect(raceFailed(chosen, "reader").show).toBeUndefined();
    expect(raceHedge(chosen).start).toBeUndefined();
    expect(raceChosen(chosen)).toBe(chosen);
  });

  it("never decides anything for a single view", () => {
    const single = startRace(["reader"]);
    expect(raceReady(single, "reader").show).toBeUndefined();
    expect(raceFailed(single, "reader").show).toBeUndefined();
    expect(raceHedge(single).start).toBeUndefined();
  });

  it("keeps the delays short enough to feel immediate and long enough to spare a session", () => {
    expect(RACE_HEDGE_MS).toBeGreaterThanOrEqual(400);
    expect(RACE_HEDGE_MS).toBeLessThanOrEqual(1000);
    expect(LIVE_FRAME_GRACE_MS).toBeLessThanOrEqual(2500);
  });
});
