/**
 * When a scheduled agent task runs next. Times are wall-clock times in the schedule's time zone (default
 * America/Chicago), so "every weekday at 8:00" stays at 8:00 across daylight-saving changes. Pure; shared by the
 * server (computing next_run_at) and the folder UI (describing a schedule).
 */
export const CADENCES = ["once", "hourly", "daily", "weekdays", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];
export type ScheduleSpec = {
  cadence: Cadence;
  /** "HH:MM", 24-hour; for hourly only the minutes count. */
  at: string;
  /** 0 = Sunday … 6 = Saturday (weekly). */
  weekday?: number | null | undefined;
  /** 1-28 (monthly). */
  monthday?: number | null | undefined;
  tz?: string | undefined;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return {
    y: Number(p["year"]),
    m: Number(p["month"]),
    d: Number(p["day"]),
    h: Number(p["hour"]),
    mi: Number(p["minute"]),
    s: Number(p["second"]),
    wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p["weekday"] ?? ""),
  };
}

/** The UTC instant of a wall-clock time in a zone (the later instant if the time repeats, shifted if it is skipped). */
export function zonedInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const diff = Date.UTC(y, m - 1, d, h, mi) - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function validTimeZone(tz: string | undefined): string {
  if (!tz) return "America/Chicago";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "America/Chicago";
  }
}

/** The next run strictly after `from` (ms), or null for a "once" schedule that has already run. */
export function nextRun(
  spec: ScheduleSpec,
  from: number,
  opts: { ran?: boolean } = {},
): number | null {
  const tz = validTimeZone(spec.tz);
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(spec.at);
  const hh = m ? Number(m[1]) : 8;
  const mm = m ? Number(m[2]) : 0;
  if (spec.cadence === "once" && opts.ran) return null;
  if (spec.cadence === "hourly") {
    const p = parts(from, tz);
    let t = zonedInstant(p.y, p.m, p.d, p.h, mm, tz);
    while (t <= from) t += 3600_000;
    return t;
  }
  const today = parts(from, tz);
  for (let k = 0; k < 400; k++) {
    // walk calendar days in the zone, starting today
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + k));
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const wd = day.getUTCDay();
    const ok =
      spec.cadence === "daily" ||
      spec.cadence === "once" ||
      (spec.cadence === "weekdays" && wd >= 1 && wd <= 5) ||
      (spec.cadence === "weekly" && wd === (spec.weekday ?? 1)) ||
      (spec.cadence === "monthly" && d === Math.min(28, Math.max(1, spec.monthday ?? 1)));
    if (!ok) continue;
    const t = zonedInstant(y, mo, d, hh, mm, tz);
    if (t > from) return t;
  }
  return null;
}

/** "Every weekday at 8:00 (America/Chicago)". */
export function describeSchedule(spec: ScheduleSpec): string {
  const tz = validTimeZone(spec.tz);
  const [h, mi] = spec.at.split(":").map(Number);
  const time = `${((h ?? 8) % 12 || 12).toString()}:${String(mi ?? 0).padStart(2, "0")} ${(h ?? 8) < 12 ? "AM" : "PM"}`;
  const zone = tz === "America/Chicago" ? "Central" : tz;
  switch (spec.cadence) {
    case "once":
      return `Once, at ${time} ${zone}`;
    case "hourly":
      return `Every hour at :${String(mi ?? 0).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${time} ${zone}`;
    case "weekdays":
      return `Weekdays at ${time} ${zone}`;
    case "weekly":
      return `Every ${WEEKDAYS[spec.weekday ?? 1]} at ${time} ${zone}`;
    case "monthly":
      return `Monthly on day ${spec.monthday ?? 1} at ${time} ${zone}`;
  }
}
