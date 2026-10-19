import type { RecallDomain, RecallDomainData } from "@/lib/external/recallPatterns.functions";

export const RECALL_DOMAIN_OPTIONS: { id: RecallDomain; label: string }[] = [
  { id: "fda_drug", label: "Drugs" },
  { id: "fda_device", label: "Devices" },
  { id: "fda_food", label: "Foods" },
  { id: "cpsc", label: "Consumer products" },
  { id: "nhtsa", label: "Vehicles" },
];

export type RecallInsight = { id: string; text: string; target: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) =>
  `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;
export const dayLabel = (d: string | null) =>
  d
    ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`
    : "Not recorded";
export const n = (v: number) => v.toLocaleString("en-US");

/** Plain statements drawn only from the stored figures; nothing is inferred beyond them. */
export function recallInsights(data: RecallDomainData): RecallInsight[] {
  const o = data.overview;
  if (!o) return [];
  const out: RecallInsight[] = [];
  for (const t of o.rising.slice(0, 2)) {
    const g = t.growth;
    if (!g || g.changePct === null || g.changePct <= 0) continue;
    out.push({
      id: `rising-${t.theme}`,
      text: `${t.label} recalls rose ${Math.round(g.changePct)}%: ${n(g.recent)} in ${g.recentYears} against ${n(g.prior)} in ${g.priorYears}.`,
      target: data.themes.find((i) => i.title === t.label)?.id ?? null,
    });
  }
  const spikes = [...o.anomalies].sort(
    (a, b) => b.count / Math.max(1, b.trailingMedian) - a.count / Math.max(1, a.trailingMedian),
  );
  const top = spikes[0];
  if (top) {
    const lead = top.topFirms[0];
    const unit =
      top.measure === "units"
        ? "units potentially affected"
        : top.measure === "product_rows"
          ? "products recalled"
          : "recalls";
    out.push({
      id: `spike-${top.month}-${top.measure}`,
      text:
        `Largest spike: ${monthLabel(top.month)}, ${n(top.count)} ${unit} against a usual ${n(top.trailingMedian)}` +
        (lead && top.topFirmShare !== null
          ? top.pattern === "one firm"
            ? `, ${Math.round(top.topFirmShare)}% from ${lead.firm}.`
            : ` across ${n(top.firms)} firms (largest: ${lead.firm}, ${Math.round(top.topFirmShare)}%).`
          : "."),
      target: null,
    });
  }
  const cluster = data.clusters[0];
  if (cluster && cluster.firms) {
    out.push({
      id: `cluster-${cluster.id}`,
      text:
        `${n(cluster.firms)} firms recalled ${cluster.note ?? "products"} for ${cluster.title.split(" · ")[0]} within ${cluster.spanDays ?? 0} days from ${dayLabel(cluster.first)}` +
        (cluster.suppliers[0]
          ? `; ${cluster.suppliers[0]} is named as the supplier.`
          : "; no supplier is named in the recall reasons."),
      target: cluster.id,
    });
  }
  const supplier = data.suppliers[0];
  if (supplier && (supplier.firms ?? 0) >= 3) {
    out.push({
      id: `supplier-${supplier.id}`,
      text: `${supplier.title} is named as the supplier by ${n(supplier.firms ?? 0)} recalling firms (${n(supplier.events)} recalls).`,
      target: supplier.id,
    });
  }
  const firm = data.firms[0];
  if (firm) {
    const theme = firm.repeatThemes[0] ?? firm.themes[0];
    out.push({
      id: `firm-${firm.id}`,
      text: `${firm.title} has the most recalls here (${n(firm.events)}${firm.first && firm.last ? `, ${firm.first.slice(0, 4)}–${firm.last.slice(0, 4)}` : ""})${theme ? `, most often for ${theme.label.toLowerCase()} (${n(theme.events)})` : ""}.`,
      target: firm.id,
    });
  }
  if (o.untagged > 0 && o.events > 0) {
    out.push({
      id: "untagged",
      text: `${n(o.untagged)} of ${n(o.events)} recalls (${Math.round((100 * o.untagged) / o.events)}%) match none of the keyword themes; theme counts leave them out.`,
      target: null,
    });
  }
  return out;
}
