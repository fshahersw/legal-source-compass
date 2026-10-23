/**
 * A page that refuses framing can be shown as its text or in a live browser, and neither is always quicker (the text answers
 * in under a second on some sites and takes ten on others; a live browser takes two to five). So the text is started first and,
 * if it has not answered within a short delay (or has failed), the live browser is started too; the first one ready is shown
 * and the other keeps loading behind it, a click away. When the text answers promptly no browser is started at all, which is
 * the common case and spares the hosted-browser allowance. These are the pure rules; the panel keeps one race per opened
 * source. A person choosing a view ends the race: nothing is started or switched under them afterwards.
 */
import type { ViewMode } from "./sourceLinks";

/** How long the first view has to answer before the next one is started alongside it. */
export const RACE_HEDGE_MS = 700;

/**
 * A live browser's frame reports loaded a second or two before the remote page is painted in it, so when the text is still
 * on its way the live view waits this long before claiming the race.
 */
export const LIVE_FRAME_GRACE_MS = 1500;

export type Race = {
  /** Whether a view is still to be picked automatically. */
  open: boolean;
  /** How many views the race was started with. */
  size: number;
  /** The views that have failed. */
  failed: ViewMode[];
  /** Views not started yet, in order. */
  queued: ViewMode[];
};

export type RaceStep = {
  race: Race;
  /** The view to show now, if this step decided one. "blocked" means every view failed. */
  show?: ViewMode;
  /** A queued view to start now. */
  start?: ViewMode;
};

/** A race exists only when more than one view is offered. The first view is started by the caller at once. */
export function startRace(modes: ViewMode[]): Race {
  return { open: modes.length > 1, size: modes.length, failed: [], queued: modes.slice(1) };
}

function startNext(race: Race): RaceStep {
  if (!race.open || !race.queued.length) return { race };
  const [next, ...rest] = race.queued;
  return { race: { ...race, queued: rest }, start: next! };
}

/** The delay passed with no winner: start the next view alongside the first. */
export function raceHedge(race: Race): RaceStep {
  return startNext(race);
}

/** A started view is ready: the first to be ready wins; later ones change nothing and nothing more is started. */
export function raceReady(race: Race, mode: ViewMode): RaceStep {
  if (!race.open) return { race };
  return { race: { ...race, open: false, queued: [] }, show: mode };
}

/** A started view failed: the next is started at once; when every one has failed, the panel shows its error. */
export function raceFailed(race: Race, mode: ViewMode): RaceStep {
  if (!race.open) return { race };
  const failed = race.failed.includes(mode) ? race.failed : [...race.failed, mode];
  if (failed.length >= race.size)
    return { race: { ...race, open: false, failed, queued: [] }, show: "blocked" };
  return startNext({ ...race, failed });
}

/** The person chose a view themselves. */
export function raceChosen(race: Race): Race {
  return race.open ? { ...race, open: false, queued: [] } : race;
}
