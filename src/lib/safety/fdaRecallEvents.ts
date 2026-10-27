/**
 * FDA recall events from openFDA enforcement reports. openFDA publishes one row per recalled product; FDA groups the
 * products of one recall under an event id (detail.fields.event_id). This model counts events, not product rows:
 * an event is dated by its earliest recall initiation date, is Class I when any of its products is Class I, and is
 * ongoing when any product is still "Ongoing". Pure and tested (fdaRecallEvents.test.ts).
 */

export type FdaCenter = "drug" | "device" | "food";

export const FDA_CENTER_LABEL: Record<FdaCenter, string> = {
  drug: "Drugs",
  device: "Devices",
  food: "Food",
};

export const FDA_ENFORCEMENT_DATASETS: Record<FdaCenter, string> = {
  drug: "agency_safety_openfda_drug_enforcement",
  device: "agency_safety_openfda_device_enforcement",
  food: "agency_safety_openfda_food_enforcement",
};

/** One openFDA enforcement row as read (a narrow projection). */
export type EnforcementRow = {
  ev: string | null;
  cls: string | null;
  firm: string | null;
  fn: string | null;
  st: string | null;
  idt: string | null;
  rd: string | null;
};

export type FdaEvent = {
  center: FdaCenter;
  eventId: string;
  initiated: string | null;
  reported: string | null;
  classI: boolean;
  ongoing: boolean;
  firm: string;
  firmKey: string;
  rows: number;
};

export type FdaEventYear = {
  year: string;
  drug: number;
  device: number;
  food: number;
  classI: number;
  total: number;
  partial: boolean;
};

export type FdaFirmRow = {
  firmKey: string;
  firm: string;
  center: FdaCenter;
  events: number;
  classI: number;
  rows: number;
};

export type FdaRecallEventsPayload = {
  years: FdaEventYear[];
  firms: FdaFirmRow[];
  kpis: {
    eventsLast12: number;
    classILast12: number;
    ongoing: number;
    rows: number;
    events: number;
    rowsWithoutEvent: number;
    eventsWithoutDate: number;
  };
  window: { from: string; to: string } | null;
  latestInitiation: string | null;
  readAt: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | null | undefined): string | null =>
  typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null;
const minDay = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Group product rows into FDA events on the event id. Rows without an event id are counted, never invented. */
export function toEvents(
  center: FdaCenter,
  rows: readonly EnforcementRow[],
): { events: FdaEvent[]; rowsWithoutEvent: number } {
  const byId = new Map<string, FdaEvent & { names: Map<string, number> }>();
  let rowsWithoutEvent = 0;
  for (const r of rows) {
    const id = (r.ev ?? "").trim();
    if (!id) {
      rowsWithoutEvent += 1;
      continue;
    }
    let e = byId.get(id);
    if (!e) {
      e = {
        center,
        eventId: id,
        initiated: null,
        reported: null,
        classI: false,
        ongoing: false,
        firm: "",
        firmKey: "",
        rows: 0,
        names: new Map(),
      };
      byId.set(id, e);
    }
    e.rows += 1;
    e.initiated = minDay(e.initiated, day(r.idt));
    e.reported = minDay(e.reported, day(r.rd));
    if ((r.cls ?? "").trim() === "Class I") e.classI = true;
    if ((r.st ?? "").trim() === "Ongoing") e.ongoing = true;
    const name = (r.firm ?? "").trim();
    if (name) e.names.set(name, (e.names.get(name) ?? 0) + 1);
    if (!e.firmKey) e.firmKey = (r.fn ?? "").trim();
  }
  const events = [...byId.values()].map(({ names, ...e }) => {
    const top = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { ...e, firm: top?.[0] ?? e.firmKey };
  });
  return { events, rowsWithoutEvent };
}

/**
 * FDA classifies a recall weeks to months after it starts, so the newest months are incomplete (in October 2026 the
 * enforcement reports held about 110–190 events a month through August, then 48 for September and 5 for October).
 * The 12-month KPI window leaves out the latest initiation month and the LAG - 1 months before it.
 */
export const CLASSIFICATION_LAG_MONTHS = 3;

/** Twelve whole calendar months ending CLASSIFICATION_LAG_MONTHS months before the latest initiation month. */
export function classifiedWindow(latest: string): { from: string; to: string } {
  const y = Number(latest.slice(0, 4));
  const m = Number(latest.slice(5, 7)) - 1;
  const end = new Date(Date.UTC(y, m - CLASSIFICATION_LAG_MONTHS + 1, 0)); // last day of the end month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Events per initiation year by center with the Class I count. The latest year is partial unless it ends on 31 Dec;
 * the year the enforcement reports start is partial too when the first report is dated after 1 January (openFDA's
 * reports begin in June 2012, so recalls started and reported before then are missing).
 */
export function eventYears(events: readonly FdaEvent[], firstYear = 2012): FdaEventYear[] {
  const latest = events.reduce<string | null>(
    (m, e) => (e.initiated && (!m || e.initiated > m) ? e.initiated : m),
    null,
  );
  if (!latest) return [];
  const firstReport = events.reduce<string | null>(
    (m, e) => (e.reported && (!m || e.reported < m) ? e.reported : m),
    null,
  );
  const lastYear = Number(latest.slice(0, 4));
  const out = new Map<string, FdaEventYear>();
  for (let y = firstYear; y <= lastYear; y += 1)
    out.set(String(y), {
      year: String(y),
      drug: 0,
      device: 0,
      food: 0,
      classI: 0,
      total: 0,
      partial:
        (y === lastYear && !latest.endsWith("-12-31")) ||
        (!!firstReport && Number(firstReport.slice(0, 4)) === y && !firstReport.endsWith("-01-01")),
    });
  for (const e of events) {
    if (!e.initiated) continue;
    const row = out.get(e.initiated.slice(0, 4));
    if (!row) continue;
    row[e.center] += 1;
    row.total += 1;
    if (e.classI) row.classI += 1;
  }
  return [...out.values()];
}

/** Firms by events initiated in the window, keyed on the exact normalised firm name of one center (never merged). */
export function firmLeaders(
  events: readonly FdaEvent[],
  from: string,
  to: string,
  limit = 50,
): FdaFirmRow[] {
  const m = new Map<string, FdaFirmRow>();
  for (const e of events) {
    if (!e.initiated || e.initiated < from || e.initiated > to || !e.firmKey) continue;
    const key = `${e.center}\u0000${e.firmKey}`;
    const row = m.get(key) ?? {
      firmKey: e.firmKey,
      firm: e.firm || e.firmKey,
      center: e.center,
      events: 0,
      classI: 0,
      rows: 0,
    };
    row.events += 1;
    row.rows += e.rows;
    if (e.classI) row.classI += 1;
    m.set(key, row);
  }
  return [...m.values()]
    .sort((a, b) => b.events - a.events || b.classI - a.classI || a.firm.localeCompare(b.firm))
    .slice(0, limit);
}

/** The payload the /safety section shows, from each center's rows. */
export function buildFdaRecallEvents(
  byCenter: Partial<Record<FdaCenter, readonly EnforcementRow[]>>,
  readAt: string,
): FdaRecallEventsPayload {
  const all: FdaEvent[] = [];
  let rowsWithoutEvent = 0;
  let rows = 0;
  for (const center of ["drug", "device", "food"] as const) {
    const list = byCenter[center] ?? [];
    rows += list.length;
    const r = toEvents(center, list);
    all.push(...r.events);
    rowsWithoutEvent += r.rowsWithoutEvent;
  }
  const latest = all.reduce<string | null>(
    (m, e) => (e.initiated && (!m || e.initiated > m) ? e.initiated : m),
    null,
  );
  const window = latest ? classifiedWindow(latest) : null;
  const recent = window
    ? all.filter((e) => e.initiated && e.initiated >= window.from && e.initiated <= window.to)
    : [];
  return {
    years: eventYears(all),
    firms: window ? firmLeaders(all, window.from, window.to) : [],
    kpis: {
      eventsLast12: recent.length,
      classILast12: recent.filter((e) => e.classI).length,
      ongoing: all.filter((e) => e.ongoing).length,
      rows,
      events: all.length,
      rowsWithoutEvent,
      eventsWithoutDate: all.filter((e) => !e.initiated).length,
    },
    window,
    latestInitiation: latest,
    readAt,
  };
}
