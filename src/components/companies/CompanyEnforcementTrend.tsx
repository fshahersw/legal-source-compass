/**
 * Trend card above a company's Enforcement table: DOJ press releases, SEC actions and FTC actions naming the registrant,
 * by year. It reads the same query as the table, so the card and the rows below it are the same items.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { companyEnforcementQuery } from "@/components/enforcement/actions/actionsView";
import { StaticTrend } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import { buildCompanyEnforcementYears, COMPANY_READ_LIMITS } from "@/lib/trends/company";

export function CompanyEnforcementTrend({ cik, className }: { cik: string; className?: string }) {
  const q = useQuery(companyEnforcementQuery(cik));
  const block = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    return buildCompanyEnforcementYears({
      cik,
      doj: { dates: d.doj.map((r) => r.date), limit: COMPANY_READ_LIMITS.doj, total: d.dojTotal },
      sec: { dates: d.sec.map((r) => r.date), limit: COMPANY_READ_LIMITS.sec, total: d.secTotal },
      ftc: {
        dates: d.ftcActions.map((r) => r.date),
        limit: COMPANY_READ_LIMITS.ftc,
        total: null,
      },
      today: new Date().toISOString().slice(0, 10),
    });
  }, [cik, q.data]);
  const def = useMemo(
    () =>
      staticDef({
        id: `company-enforcement-years-${cik}`,
        title: "Enforcement items naming this company, by year",
        measure: "enforcement items naming the company",
        detail: {
          to: "/insights/trends",
          search: { view: "national", topic: "enforcement" },
          label: "Enforcement trends",
        },
        group: "enforcement",
      }),
    [cik],
  );
  if (!block) return null;
  return (
    <div className={className}>
      <div className="max-w-xl">
        <StaticTrend def={def} block={block} emptyReason="" />
      </div>
    </div>
  );
}
