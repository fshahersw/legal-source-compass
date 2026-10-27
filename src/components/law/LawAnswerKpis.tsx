/**
 * Law & government landing: answer KPIs for mass-tort work instead of collection sizes. What is open for comment at
 * the product-safety agencies, which mass-tort regulations changed in the last year, how many civil-justice bills
 * became law, and what federal litigation-funding bills are pending, each from its own section's read with source
 * and date, and an AI summary grounded in exactly these figures.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AiSummary, AskAiButton, KpiCard, KpiGrid, buildSectionContext } from "@/components/kit";
import { cfrRadarQuery } from "./lawQueries";
import { rulemakingTrackerQuery } from "@/components/rulemaking/rulemakingQueries";
import { legislationWatchQuery } from "@/components/legislation/legislationWatchQuery";
import { stageCounts } from "@/lib/law/legislationWatch";
import { ordinal } from "@/lib/analytics/trend";

const fmt = (v: number) => v.toLocaleString("en-US");
const REGS = { label: "Regulations.gov", url: "https://www.regulations.gov/" };
const FR = {
  label: "Federal Register API",
  url: "https://www.federalregister.gov/developers/documentation/api/v1",
};
const ECFR = { label: "eCFR point-in-time versions", url: "https://www.ecfr.gov/" };
const OPEN_STATES = { label: "Open States bulk data", url: "https://open.pluralpolicy.com/data/" };
const CONGRESS = {
  label: "GovInfo Bill Status",
  url: "https://www.govinfo.gov/bulkdata/BILLSTATUS",
};
const ID = "law-answers";

function open(to: string, label: string) {
  return (
    <Link to={to} className="text-meta font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}

const stateOf = (q: { isPending: boolean; isError: boolean }) =>
  q.isPending ? ("loading" as const) : q.isError ? ("error" as const) : ("ready" as const);

export function LawAnswerKpis() {
  const rm = useQuery(rulemakingTrackerQuery);
  const cfr = useQuery(cfrRadarQuery);
  const leg = useQuery(legislationWatchQuery);
  const dated = rm.data ? rm.data.deadlines.filter((d) => d.window !== "open_ended") : [];
  const within30 = dated.filter((d) => d.window === "30").length;
  const partialYear = rm.data?.fr[0]?.years.find((y) => y.partial)?.year ?? null;
  const frAsOf = rm.data?.fr.find((f) => f.asOf)?.asOf ?? null;
  const proposed =
    rm.data && partialYear
      ? rm.data.fr.reduce<number | null>((a, f) => {
          const v = f.years.find((y) => y.year === partialYear)?.proposed;
          return a == null || v == null ? null : a + v;
        }, 0)
      : null;
  const counts = leg.data ? stageCounts(leg.data.stateBills) : null;
  const fundingEnacted = leg.data
    ? leg.data.stateBills.filter((b) => b.stage === "enacted" && b.topics.includes("funding"))
        .length
    : null;
  const federalPending = leg.data ? leg.data.federal.filter((b) => !b.becameLaw).length : null;

  const ready = rm.data || cfr.data || leg.data;
  const context = ready
    ? buildSectionContext({
        id: ID,
        title: "What changed in law for mass torts",
        scope:
          "FDA, NHTSA, CPSC, EPA and FTC rulemaking; watched drug, device, vehicle and consumer-product CFR parts; state and federal civil-justice bills",
        period: [rm.data?.today, cfr.data?.today, leg.data?.today].find(Boolean) ?? null,
        source: [REGS.label, FR.label, ECFR.label, OPEN_STATES.label, CONGRESS.label].join("; "),
        figures: [
          {
            label: "Open comment periods, five agencies",
            value: rm.data ? dated.length : null,
            unit: "documents",
          },
          { label: "Closing within 30 days", value: rm.data ? within30 : null, unit: "documents" },
          {
            label: `Proposed rules published ${partialYear ?? ""} (partial year)`,
            value: proposed,
            unit: "documents",
          },
          {
            label: "Mass-tort CFR sections changed in the last 12 months",
            value: cfr.data?.last12.sections,
            unit: "sections",
          },
          {
            label: "State civil-justice bills enacted (current and preceding sessions)",
            value: counts?.enacted,
            unit: "bills",
          },
          { label: "State litigation-funding bills enacted", value: fundingEnacted, unit: "bills" },
          {
            label: "Federal litigation-funding bills pending",
            value: federalPending,
            unit: "bills",
          },
        ],
      })
    : null;

  return (
    <section id={ID} aria-label="What changed in law for mass torts" className="space-y-3">
      <KpiGrid columns={5} label="Law and government answers">
        <KpiCard
          as="li"
          label="Open comment periods"
          state={stateOf(rm)}
          value={rm.data ? fmt(dated.length) : null}
          meta={
            rm.data
              ? `FDA, NHTSA, CPSC, EPA, FTC · ${fmt(within30)} close within 30 days`
              : undefined
          }
          action={open("/law/rulemaking", "Deadlines")}
          source={{ source: REGS, asOf: rm.data?.today }}
        />
        <KpiCard
          as="li"
          label={`Proposed rules${partialYear ? ` in ${partialYear}` : ""}`}
          state={stateOf(rm)}
          value={proposed == null ? null : fmt(proposed)}
          meta="Same five agencies"
          partial={frAsOf ? `Partial year, through ${frAsOf}` : undefined}
          source={{ source: FR, asOf: frAsOf ?? undefined }}
        />
        <KpiCard
          as="li"
          label="Mass-tort CFR sections changed"
          state={stateOf(cfr)}
          value={cfr.data ? fmt(cfr.data.last12.sections) : null}
          meta={
            cfr.data ? `Last 12 months · ${fmt(cfr.data.parts.length)} watched parts` : undefined
          }
          action={open("/law/cfr", "Radar")}
          source={{ source: ECFR, asOf: cfr.data?.today }}
        />
        <KpiCard
          as="li"
          label="Civil-justice bills enacted"
          state={stateOf(leg)}
          value={counts ? fmt(counts.enacted) : null}
          meta={
            fundingEnacted == null
              ? undefined
              : `${fmt(fundingEnacted)} on litigation funding · title or summary match`
          }
          action={open("/law/legislation", "Watch")}
          source={{
            source: OPEN_STATES,
            period: "Current and preceding sessions",
            asOf: leg.data?.today,
          }}
        />
        <KpiCard
          as="li"
          label="Federal funding bills pending"
          state={stateOf(leg)}
          value={federalPending == null ? null : fmt(federalPending)}
          meta={leg.data ? `${ordinal(leg.data.congress)} Congress` : undefined}
          source={{ source: CONGRESS, asOf: leg.data?.today }}
        />
      </KpiGrid>
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId={ID}
            title="What changed in law for mass torts"
            context={context}
            questions={[
              "Which comment deadlines should a mass-tort firm watch this month?",
              "Which regulation changes this year matter for product cases?",
              "Where is litigation-funding legislation moving?",
            ]}
          />
        }
      />
    </section>
  );
}
