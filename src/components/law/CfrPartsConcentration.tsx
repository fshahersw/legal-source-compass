/**
 * CFR title lead chart: the parts that hold most of the title's sections, as a ranked bar list with each part's
 * share, and every other part as one row. Each bar opens its part.
 */
import { ChartCard } from "@/components/kit/ChartCard";
import { BarList } from "@/components/kit/BarList";
import { cfrConcentration, type CfrPartInput } from "./cfrParts";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (v: number) => (v >= 10 ? `${Math.round(v)}%` : v < 0.1 ? "<0.1%" : `${v.toFixed(1)}%`);

export function CfrPartsConcentration({
  title,
  parts,
  asOf,
}: {
  title: string;
  parts: readonly CfrPartInput[];
  asOf: string | null;
}) {
  const c = cfrConcentration(parts, 8);
  if (!c) return null;
  const topShare = c.top.reduce((a, p) => a + p.share, 0);
  const label = (p: { title: string }) => p.title.replace(new RegExp(`^${title} CFR `), "");
  const source = {
    source: { label: "Electronic Code of Federal Regulations (eCFR)", href: `https://www.ecfr.gov/current/title-${title}` },
    asOf: asOf ?? undefined,
    about: (
      <p>
        Sections counted in each part of the current eCFR text. Reserved parts
        {c.unrecordedParts ? " and parts without a recorded section count" : ""} are left out of
        the shares
        {c.reservedParts || c.unrecordedParts
          ? ` (${[
              c.reservedParts ? `${fmt(c.reservedParts)} reserved` : "",
              c.unrecordedParts ? `${fmt(c.unrecordedParts)} not counted` : "",
            ]
              .filter(Boolean)
              .join(", ")})`
          : ""}
        .
      </p>
    ),
  };
  const rows = [
    ...c.top.map((p) => ({ key: p.identifier, part: label(p), sections: p.sections, share: p.share })),
    ...(c.other
      ? [
          {
            key: "other",
            part: `All other parts (${fmt(c.other.parts)})`,
            sections: c.other.sections,
            share: c.other.share,
          },
        ]
      : []),
  ];
  return (
    <ChartCard
      id="cfr-parts"
      title={
        c.other
          ? `The ${c.top.length} largest of ${fmt(c.recordedParts)} parts hold ${pct(topShare)} of title ${title}'s ${fmt(c.totalSections)} sections`
          : `Title ${title}'s ${fmt(c.totalSections)} sections by part`
      }
      subtitle={
        c.other
          ? `The other ${fmt(c.other.parts)} parts hold ${pct(c.other.share)} · select a part to open it`
          : "Select a part to open it"
      }
      source={source}
      data={{
        title: `CFR title ${title}: sections by part`,
        rows,
        rowKey: (r) => r.key,
        columns: [
          { key: "part", label: "Part", value: (r) => r.part },
          { key: "sections", label: "Sections", value: (r) => r.sections },
          { key: "share", label: "Share of title (%)", value: (r) => Math.round(r.share * 10) / 10 },
        ],
        source,
      }}
    >
      <BarList
        ariaLabel={`Largest parts of CFR title ${title} by sections`}
        items={[
          ...c.top.map((p) => ({
            id: p.identifier,
            label: label(p),
            value: p.sections,
            display: `${fmt(p.sections)} · ${pct(p.share)}`,
            to: `/law/cfr/${title}/part/${encodeURIComponent(p.identifier)}`,
          })),
        ]}
      />
    </ChartCard>
  );
}
