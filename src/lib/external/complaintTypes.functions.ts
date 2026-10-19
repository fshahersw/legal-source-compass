/**
 * Complaint and report types across sources already in the corpus: SaferProducts.gov consumer reports by product category and
 * hazard theme, NHTSA vehicle complaints by component (summed over makes), MAUDE device reports by event type, and FAERS reports for
 * the mass-tort drugs tracked. Read-only. Reports are not incidence and do not establish causation; values that fail validation are
 * dropped and counted.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

export type Labelled = { label: string; count: number };
export type ConsumerCategory = {
  name: string;
  reports: number;
  injuries: number | null;
  deaths: number | null;
  changePct: number | null;
  themes: Labelled[];
};
export type VehicleComponent = {
  component: string;
  complaints: number;
  crashes: number;
  fires: number;
  injured: number;
  deaths: number;
  byYear: { year: string; count: number }[];
  topMakes: Labelled[];
};
export type DeviceYear = {
  year: number;
  death: number;
  injury: number;
  malfunction: number;
  other: number;
  partial: boolean;
};
export type ReportProduct = {
  product: string;
  mdl: number | null;
  reports: number;
  deaths: number | null;
  serious: number | null;
  injuries: number | null;
  malfunctions: number | null;
  topProblem: string | null;
  lawyerShare: number | null;
  peakYear: number | null;
};
export type ComplaintTypes = {
  consumer: { categories: ConsumerCategory[]; themes: Labelled[] };
  vehicles: { components: VehicleComponent[]; total: number };
  devices: { national: DeviceYear[]; products: ReportProduct[] };
  drugs: { products: ReportProduct[] };
  dropped: number;
};

export const SAFER_THEME_LABELS: Record<string, string> = {
  fire: "Fire",
  burn: "Burn",
  laceration: "Laceration",
  ingestion: "Ingestion",
  poisoning: "Poisoning",
  electric_shock: "Electric shock",
  choking: "Choking",
  fall: "Fall",
  carbon_monoxide: "Carbon monoxide",
  suffocation: "Suffocation",
  battery: "Battery",
  tip_over: "Tip-over",
  lead: "Lead",
  strangulation: "Strangulation",
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.trim() !== "—" ? v.trim().slice(0, max) : null;
/** Stored numbers may be numbers or display strings ("65,930", "5.5%"). */
export function count(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const signed = (v: unknown) => {
  const n = typeof v === "number" ? v : count(v);
  return n !== null && Number.isFinite(n) ? n : null;
};

export function parseConsumer(rows: { c: unknown; s: unknown }[]) {
  let dropped = 0;
  const totals = new Map<string, number>();
  const categories: ConsumerCategory[] = [];
  for (const row of rows) {
    const c = obj(row.c);
    const s = obj(row.s);
    const name = str(c?.["name"]);
    const reports = count(c?.["reports"]);
    if (!c || !name || reports === null) {
      dropped += 1;
      continue;
    }
    const themes = Object.entries(obj(s?.["themes"]) ?? {})
      .filter(([k, v]) => SAFER_THEME_LABELS[k] && count(v) !== null)
      .map(([k, v]) => ({ label: SAFER_THEME_LABELS[k]!, count: count(v)! }))
      .sort((a, b) => b.count - a.count);
    for (const t of themes) totals.set(t.label, (totals.get(t.label) ?? 0) + t.count);
    categories.push({
      name,
      reports,
      injuries: count(c["injuries"]),
      deaths: count(c["deaths"]),
      changePct: signed(c["change_pct"]),
      themes,
    });
  }
  return {
    categories: categories.sort((a, b) => b.reports - a.reports),
    themes: [...totals]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => b.count - a.count),
    dropped,
  };
}

export function parseVehicles(rows: { t: unknown }[]) {
  let dropped = 0;
  const by = new Map<
    string,
    VehicleComponent & { makes: Map<string, number>; years: Map<string, number> }
  >();
  for (const row of rows) {
    const t = obj(row.t);
    const component = str(t?.["component"], 80);
    const make = str(t?.["make"], 80);
    const total = count(t?.["total"]);
    if (!t || !component || !make || total === null) {
      dropped += 1;
      continue;
    }
    const entry =
      by.get(component) ??
      ({
        component,
        complaints: 0,
        crashes: 0,
        fires: 0,
        injured: 0,
        deaths: 0,
        byYear: [],
        topMakes: [],
        makes: new Map(),
        years: new Map(),
      } as VehicleComponent & {
        makes: Map<string, number>;
        years: Map<string, number>;
      });
    entry.complaints += total;
    entry.crashes += count(t["crash"]) ?? 0;
    entry.fires += count(t["fire"]) ?? 0;
    entry.injured += count(t["injured"]) ?? 0;
    entry.deaths += count(t["deaths"]) ?? 0;
    entry.makes.set(make, (entry.makes.get(make) ?? 0) + total);
    for (const [y, v] of Object.entries(obj(t["years"]) ?? {}))
      if (/^\d{4}$/.test(y) && count(v) !== null)
        entry.years.set(y, (entry.years.get(y) ?? 0) + count(v)!);
    by.set(component, entry);
  }
  const components = [...by.values()]
    .map(({ makes, years, ...rest }) => ({
      ...rest,
      topMakes: [...makes]
        .map(([label, n]) => ({ label, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      byYear: [...years]
        .map(([year, n]) => ({ year, count: n }))
        .sort((a, b) => a.year.localeCompare(b.year)),
    }))
    .sort((a, b) => b.complaints - a.complaints);
  return { components, total: components.reduce((s, c) => s + c.complaints, 0), dropped };
}

function product(
  id: string,
  c: Record<string, unknown> | null,
  peak: unknown,
): ReportProduct | null {
  const name = str(c?.["product"]);
  const reports = count(c?.["reports"]);
  if (!c || !name || reports === null) return null;
  const p = obj(peak);
  return {
    product: name,
    mdl: /^\d{3,5}$/.test(id) ? Number(id) : null,
    reports,
    deaths: count(c["deaths"]),
    serious: count(c["serious"]),
    injuries: count(c["injuries"]),
    malfunctions: count(c["malfunctions"]),
    topProblem: str(c["top_problem"]),
    lawyerShare: count(c["lawyer_share"]),
    peakYear: count(p?.["year"]),
  };
}

export function parseDevices(
  rows: { id: string; c: unknown; s: unknown; k: unknown; pk: unknown }[],
) {
  let dropped = 0;
  let national: DeviceYear[] = [];
  const products: ReportProduct[] = [];
  for (const row of rows) {
    if (row.k === "maude_national") {
      national = (Array.isArray(row.s) ? row.s : [])
        .map((x) => {
          const o = obj(x);
          const year = count(o?.["year"]);
          if (!o || year === null) return null;
          return {
            year,
            death: count(o["death"]) ?? 0,
            injury: count(o["injury"]) ?? 0,
            malfunction: count(o["malfunction"]) ?? 0,
            other: count(o["other_or_unclassified"]) ?? 0,
            partial: o["partial"] === true,
          };
        })
        .filter((x): x is DeviceYear => !!x);
      continue;
    }
    const p = product(row.id, obj(row.c), row.pk);
    if (p) products.push(p);
    else dropped += 1;
  }
  return { national, products: products.sort((a, b) => b.reports - a.reports), dropped };
}

export const getComplaintTypes = createServerFn({ method: "GET" }).handler(
  async (): Promise<ComplaintTypes> => {
    const [consumer, vehicles, devices, drugs] = await Promise.all([
      restGet<{ c: unknown; s: unknown }[]>(
        "corpus_records?select=c:item->cells,s:item->safer&dataset=eq.saferproducts_products&item->cells->>level=eq.Category&limit=60",
      ),
      restGet<{ t: unknown }[]>(
        "corpus_records?select=t:item->trend&dataset=eq.agency_safety_nhtsa_complaint_trends&limit=2000",
      ),
      restGet<{ id: string; c: unknown; s: unknown; k: unknown; pk: unknown }[]>(
        "corpus_records?select=id,c:item->cells,s:item->series,k:item->kind,pk:item->peak&dataset=eq.fda_device_event_series&limit=60",
      ),
      restGet<{ id: string; c: unknown; pk: unknown }[]>(
        "corpus_records?select=id,c:item->cells,pk:item->peak&dataset=eq.fda_faers_product_series&limit=60",
      ),
    ]);
    const c = parseConsumer(consumer.rows);
    const v = parseVehicles(vehicles.rows);
    const d = parseDevices(devices.rows);
    let droppedDrugs = 0;
    const drugProducts: ReportProduct[] = [];
    for (const row of drugs.rows) {
      const p = product(row.id, obj(row.c), row.pk);
      if (p) drugProducts.push(p);
      else droppedDrugs += 1;
    }
    return {
      consumer: { categories: c.categories, themes: c.themes },
      vehicles: { components: v.components, total: v.total },
      devices: { national: d.national, products: d.products },
      drugs: { products: drugProducts.sort((a, b) => b.reports - a.reports) },
      dropped: c.dropped + v.dropped + d.dropped + droppedDrugs,
    };
  },
);
