/**
 * NHTSA defect-investigation pipeline: which probes are open, how often a probe's own record cites a recall campaign
 * that exists in the recall data (exact campaign number), how long that took, and the recalls NHTSA's Office of Defects
 * Investigation influenced. Pure and tested (nhtsaPipeline.test.ts).
 *
 * Accuracy: an open investigation is not a defect finding. Rows NHTSA still marks "Open" but opened before 2015
 * (legacy action numbers such as ID92001, SQ, TA) or with no opening date or manufacturer are kept apart as "legacy" and
 * "incomplete", never counted as current probes. A recall link needs the exact NNXNNN000 campaign number on the
 * investigation and the same id in the recall dataset (which starts in 2010).
 */

export type InvestigationRow = {
  id: string;
  type: string | null;
  opened: string | null;
  closed: string | null;
  recall: string | null;
  mfr: string | null;
  subject: string | null;
};

export type RecallRow = {
  id: string;
  date: string | null;
  mfr: string | null;
  inf: string | null;
  dnd: string | boolean | null;
  po: string | boolean | null;
  pa: string | number | null;
};

export type ProbeStatus = "current" | "legacy" | "incomplete";

export type OpenProbe = {
  id: string;
  type: string;
  opened: string | null;
  ageDays: number | null;
  manufacturer: string | null;
  subject: string | null;
  status: ProbeStatus;
};

export type ConversionRow = {
  type: string;
  closed: number;
  citesRecall: number;
  matched: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
};

export type RecallYear = {
  year: string;
  campaigns: number;
  odi: number;
  doNotDrive: number;
  partial: boolean;
};

export type NhtsaPipelinePayload = {
  asOf: string | null;
  open: OpenProbe[];
  openCounts: Record<ProbeStatus, number>;
  conversion: ConversionRow[];
  recallYears: RecallYear[];
  odiVehiclesLast12: number | null;
  odiCampaignsLast12: number;
  totals: { investigations: number; recalls: number; citing: number; matched: number };
  readAt: string;
};

export const CAMPAIGN = /^\d{2}[VEITC]\d{3}000$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | null | undefined) =>
  typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);
const truthy = (v: string | boolean | null) => v === true || v === "true";
const LEGACY_BEFORE = "2015-01-01";
const LINK_FROM = "2010-01-01";

/** Status of an investigation NHTSA marks open. */
export function probeStatus(r: Pick<InvestigationRow, "opened" | "mfr">): ProbeStatus {
  const opened = day(r.opened);
  if (!opened) return "incomplete";
  if (opened < LEGACY_BEFORE) return "legacy";
  if (!(r.mfr ?? "").trim()) return "incomplete";
  return "current";
}

/** Quantile of sorted values (linear interpolation); null for an empty list. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

const TYPE_ORDER = [
  "Preliminary evaluation",
  "Engineering analysis",
  "Recall query",
  "Defect petition",
  "Audit query",
];

export function buildNhtsaPipeline(
  investigations: readonly InvestigationRow[],
  recalls: readonly RecallRow[],
  readAt: string,
): NhtsaPipelinePayload {
  const recallDate = new Map<string, string | null>();
  for (const r of recalls) recallDate.set(r.id, day(r.date));
  const dates: string[] = [];
  for (const i of investigations) {
    const o = day(i.opened);
    const c = day(i.closed);
    if (o) dates.push(o);
    if (c) dates.push(c);
  }
  const asOf = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;

  const open: OpenProbe[] = [];
  const openCounts: Record<ProbeStatus, number> = { current: 0, legacy: 0, incomplete: 0 };
  const conv = new Map<
    string,
    { closed: number; cites: number; matched: number; days: number[] }
  >();
  let citing = 0;
  let matched = 0;
  for (const i of investigations) {
    const type = (i.type ?? "").trim() || "Not recorded";
    const campaign = (i.recall ?? "").trim();
    const cites = CAMPAIGN.test(campaign);
    const link = cites && recallDate.has(campaign);
    if (cites) citing += 1;
    if (link) matched += 1;
    if ((i.closed ?? "").trim() === "Open") {
      const status = probeStatus(i);
      openCounts[status] += 1;
      const opened = day(i.opened);
      open.push({
        id: i.id,
        type,
        opened,
        ageDays: opened && asOf ? daysBetween(opened, asOf) : null,
        manufacturer: (i.mfr ?? "").trim() || null,
        subject: (i.subject ?? "").trim() || null,
        status,
      });
      continue;
    }
    const opened = day(i.opened);
    const closed = day(i.closed);
    if (!opened || !closed || opened < LINK_FROM || !TYPE_ORDER.includes(type)) continue;
    const c = conv.get(type) ?? { closed: 0, cites: 0, matched: 0, days: [] };
    c.closed += 1;
    if (cites) c.cites += 1;
    if (link) {
      c.matched += 1;
      const rd = recallDate.get(campaign);
      if (rd) c.days.push(daysBetween(opened, rd));
    }
    conv.set(type, c);
  }
  const conversion = TYPE_ORDER.filter((t) => conv.has(t)).map((type) => {
    const c = conv.get(type)!;
    const sorted = [...c.days].sort((a, b) => a - b);
    return {
      type,
      closed: c.closed,
      citesRecall: c.cites,
      matched: c.matched,
      medianDays: quantile(sorted, 0.5),
      p25Days: quantile(sorted, 0.25),
      p75Days: quantile(sorted, 0.75),
    };
  });

  const recallDates = recalls.map((r) => day(r.date)).filter((d): d is string => !!d);
  const latestRecall = recallDates.length ? recallDates.reduce((a, b) => (a > b ? a : b)) : null;
  const years = new Map<string, RecallYear>();
  if (latestRecall) {
    const last = Number(latestRecall.slice(0, 4));
    for (let y = 2010; y <= last; y += 1)
      years.set(String(y), {
        year: String(y),
        campaigns: 0,
        odi: 0,
        doNotDrive: 0,
        partial: y === last && !latestRecall.endsWith("-12-31"),
      });
  }
  let odiVehicles = 0;
  let odiVehiclesKnown = false;
  let odiCampaignsLast12 = 0;
  const from12 = latestRecall
    ? new Date(ms(latestRecall) - 364 * 86_400_000).toISOString().slice(0, 10)
    : null;
  for (const r of recalls) {
    const d = day(r.date);
    if (!d) continue;
    const y = years.get(d.slice(0, 4));
    const odi = (r.inf ?? "").trim().toUpperCase() === "ODI";
    if (y) {
      y.campaigns += 1;
      if (odi) y.odi += 1;
      if (truthy(r.dnd) || truthy(r.po)) y.doNotDrive += 1;
    }
    if (odi && from12 && d >= from12) {
      odiCampaignsLast12 += 1;
      const n = typeof r.pa === "number" ? r.pa : Number(String(r.pa ?? "").replace(/,/g, ""));
      if (r.pa !== null && r.pa !== "" && Number.isFinite(n)) {
        odiVehicles += n;
        odiVehiclesKnown = true;
      }
    }
  }
  open.sort(
    (a, b) =>
      ["current", "incomplete", "legacy"].indexOf(a.status) -
        ["current", "incomplete", "legacy"].indexOf(b.status) ||
      (b.opened ?? "").localeCompare(a.opened ?? "") ||
      a.id.localeCompare(b.id),
  );
  return {
    asOf,
    open,
    openCounts,
    conversion,
    recallYears: [...years.values()],
    odiVehiclesLast12: odiVehiclesKnown ? odiVehicles : null,
    odiCampaignsLast12,
    totals: { investigations: investigations.length, recalls: recalls.length, citing, matched },
    readAt,
  };
}

/** Current open probes per manufacturer (exact recorded name), for the complaint radar. */
export function openProbesByManufacturer(open: readonly OpenProbe[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of open)
    if (p.status === "current" && p.manufacturer)
      m.set(p.manufacturer, (m.get(p.manufacturer) ?? 0) + 1);
  return m;
}
