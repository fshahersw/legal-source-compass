/**
 * Days from an agency's first proposed rule to the first final rule after it, per RIN (Federal Register records held).
 * Renders nothing until the read function is published; agencies with too few finalized RINs are listed in the table
 * but not ranked.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { RankBars, rankTakeaway } from "@/components/charts/recharts";
import { MIN_FINALIZED, comparable } from "@/lib/law/ruleLifecycle";
import { ruleLifecycleQuery } from "./rulemakingQueries";

const SOURCE = {
  label: "Federal Register documents and their RINs (federalregister.gov)",
  url: "https://www.federalregister.gov/developers/documentation/api/v1",
};
const days = (v: number) => `${Math.round(v).toLocaleString("en-US")} days`;
const n = (v: number | null) => (v == null ? "Not recorded" : v.toLocaleString("en-US"));

export function RuleLifecyclePace() {
  const q = useQuery(ruleLifecycleQuery);
  const data = q.data;
  if (!data || !data.rows.length) return null;
  const ranked = comparable(data.rows);
  const title =
    rankTakeaway(
      ranked.map((r) => ({ label: r.agency, value: r.medianDays })),
      days,
      { verb: "takes longest, a median of" },
    ) ?? "Median days from first proposed rule to final rule";
  return (
    <ChartCard
      variant="editorial"
      className="mt-4"
      title={title}
      subtitle="Median days from an agency's first proposed rule on a RIN to the first final rule after it"
      sources={[SOURCE]}
      asOf={data.asOf ?? undefined}
      about={
        <ul className="list-disc space-y-1 pl-4">
          <li>
            RINs are grouped by agency prefix (0910 FDA, 2127 NHTSA, 3041 CPSC, 3084 FTC; EPA counts
            prefixes 2040, 2050, 2060, 2070, 2080 and 2090 only). A final rule published before the
            first proposal is not counted.
          </li>
          <li>
            Agencies with fewer than {MIN_FINALIZED} finalized RINs are not ranked. “Open” means no
            final rule in the Federal Register records held
            {data.asOf ? ` (through ${data.asOf})` : ""}; the rule may have been withdrawn.
          </li>
        </ul>
      }
      table={{
        caption: "Proposal to final rule, by agency",
        columns: [
          { label: "Agency" },
          { label: "RINs with a proposal" },
          { label: "Finalized" },
          { label: "Median days" },
          { label: "Middle half (days)" },
          { label: "Open proposals since 2021" },
        ],
        rows: data.rows.map((r) => ({
          key: r.prefix,
          cells: [
            `${r.agency} (${r.prefix})`,
            n(r.rinsProposed),
            n(r.finalized),
            r.medianDays == null ? "Not recorded" : Math.round(r.medianDays),
            r.p25Days == null || r.p75Days == null
              ? "Not recorded"
              : `${Math.round(r.p25Days)}–${Math.round(r.p75Days)}`,
            n(r.openSince2021),
          ],
        })),
      }}
    >
      <RankBars
        items={ranked.map((r) => ({ id: r.prefix, label: r.agency, value: r.medianDays }))}
        format={days}
        note={(id) => {
          const r = ranked.find((x) => x.prefix === id);
          return r
            ? `${n(r.finalized)} finalized RINs · ${n(r.openSince2021)} open since 2021`
            : null;
        }}
        ariaLabel="Median days from proposed to final rule by agency"
      />
    </ChartCard>
  );
}
