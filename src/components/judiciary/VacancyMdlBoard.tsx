/**
 * Top of /courts/vacancies: which MDL-heavy districts are losing judges or running short of judges, and which
 * judges who created a vacancy still hold MDLs. Districts join vacancies by court id; a departing judge joins the
 * MDL list only through the FJC judge id the vacancy record links exactly. Senior status does not take MDLs away
 * from a judge, so nothing here implies reassignment.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/recharts";
import { DivergingDots } from "@/components/charts/d3/charts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { median } from "@/lib/courts/fcmsHistory";
import { vacantRankText, type BoardRow } from "@/lib/courts/vacancyMdl";
import {
  SOURCES,
  fmtDate,
  fmtInt,
  fmtOne,
  shortDistrict,
  vacancyBoardQuery,
} from "@/components/courts/venue/venueQueries";

const TITLE = "Vacancies in MDL districts";
const SHOW = 12;

const marker = (r: BoardRow) => {
  const parts: string[] = [];
  if (r.open) parts.push(`${r.open} open vacanc${r.open === 1 ? "y" : "ies"}`);
  if (r.announced) parts.push(`${r.announced} announced`);
  if (r.longestDaysOpen !== null) parts.push(`longest ${fmtInt(r.longestDaysOpen)} days`);
  return parts.join(" · ");
};

export function VacancyMdlBoard() {
  const q = useQuery(vacancyBoardQuery);
  const d = q.data;
  const rows = d?.rows ?? [];
  const shown = rows.slice(0, SHOW);
  const withVacancy = rows.filter((r) => r.open + r.announced > 0);
  const vm = median(rows.map((r) => r.vacantJudgeshipMonths));
  const jpml = d?.jpmlAsOf ? fmtDate(d.jpmlAsOf) : "the latest JPML report";
  const fcms = d?.fcmsPeriod ? `12 months to ${fmtDate(d.fcmsPeriod)}` : "the latest FCMS period";
  const listDate = d ? fmtDate(d.vacancyAsOf) : "";
  const unlinkedNote = d
    ? `${d.unlinkedInMdlDistricts} vacanc${d.unlinkedInMdlDistricts === 1 ? "y" : "ies"} in MDL districts have no exact judge link and are not matched by name`
    : undefined;
  const k = d?.kpis;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : !shown.length
        ? ({ kind: "empty", reason: "Pending MDL actions by district are not recorded." } as const)
        : ({ kind: "ready" } as const);
  const context =
    d && k
      ? buildSectionContext({
          id: "vacancy-mdl",
          title: TITLE,
          scope: "Federal districts holding pending MDL actions",
          period: `Vacancy list ${listDate}; JPML ${jpml}; FCMS ${fcms}`,
          source: `${SOURCES.vacancies.label}; ${SOURCES.jpml.label}; ${SOURCES.fcms.label}`,
          figures: [
            { label: "Districts holding pending MDL actions", value: k.mdlDistricts, period: jpml },
            {
              label: "MDL districts with an open or announced vacancy",
              value: k.mdlDistrictsWithVacancy,
              period: listDate,
            },
            {
              label: "Open vacancies in MDL districts",
              value: k.openInMdlDistricts,
              period: listDate,
            },
            {
              label: "Announced vacancies in MDL districts",
              value: k.announcedInMdlDistricts,
              period: listDate,
            },
            {
              label: "MDL actions pending in districts with a vacancy",
              value: k.actionsInDistrictsWithVacancy,
              period: jpml,
            },
            ...(k.longestOpen
              ? [
                  {
                    label: `Longest open vacancy in an MDL district (${k.longestOpen.name})`,
                    value: k.longestOpen.days,
                    unit: "days",
                    period: listDate,
                  },
                ]
              : []),
            {
              label:
                "Judges who created a vacancy and still hold MDLs, counting only vacancies linked to the judge by FJC id",
              value: d.departing.length,
              period: jpml,
            },
            {
              label:
                "Vacancies in MDL districts without an exact judge link (their MDLs cannot be checked)",
              value: d.unlinkedInMdlDistricts,
              period: listDate,
            },
            ...withVacancy.slice(0, 6).map((r) => ({
              label: `${r.name}, pending MDL actions`,
              value: r.pendingActions,
              period: jpml,
            })),
          ],
          maxFigures: 16,
        })
      : null;
  const dots = withVacancy.filter((r) => r.vacantJudgeshipMonths !== null).slice(0, 10);

  return (
    <Section
      id="vacancy-mdl"
      title="Vacancies where the MDLs are"
      description="Open and announced judgeship vacancies in the districts holding pending MDL actions."
    >
      <KpiGrid columns={4} label="Vacancy and MDL figures">
        <KpiCard
          as="li"
          label="MDL districts with a vacancy"
          value={k ? String(k.mdlDistrictsWithVacancy) : null}
          meta={
            k
              ? `of ${k.mdlDistricts} districts holding MDL actions · ${k.openInMdlDistricts} open, ${k.announcedInMdlDistricts} announced vacancies`
              : undefined
          }
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: SOURCES.vacancies.label, href: SOURCES.vacancies.url } }}
        />
        <KpiCard
          as="li"
          label="MDL actions in those districts"
          value={k ? fmtInt(k.actionsInDistrictsWithVacancy) : null}
          meta={`JPML report, ${jpml}`}
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: SOURCES.jpml.label, href: SOURCES.jpml.url } }}
        />
        <KpiCard
          as="li"
          label="Longest-open vacancy in an MDL district"
          value={k?.longestOpen ? fmtInt(k.longestOpen.days) : null}
          unit="days"
          meta={k?.longestOpen ? `${k.longestOpen.name}, as of ${listDate}` : undefined}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Departing MDL judges linked by FJC id"
          value={d ? String(d.departing.length) : null}
          meta={unlinkedNote}
          state={q.isPending ? "loading" : undefined}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            withVacancy[0]
              ? `${withVacancy[0].name} holds ${fmtInt(withVacancy[0].pendingActions)} pending MDL actions and has ${marker(withVacancy[0])}`
              : "Pending MDL actions by district, with vacancies"
          }
          subtitle={`Pending MDL actions (JPML, ${jpml}) · vacancies on the AO lists of ${listDate} · the ${SHOW} largest MDL districts`}
          status={status}
          sources={[SOURCES.jpml, SOURCES.vacancies]}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Bars are pending MDL actions in the JPML report of {jpml}; the note on each row
                counts the open and announced vacancies on the AO lists of {listDate}.
              </li>
              <li>Days open run from the published vacancy date to {listDate}.</li>
              <li>
                A judge who takes senior status keeps the MDLs assigned; a vacancy does not mean an
                MDL is reassigned.
              </li>
            </ul>
          }
          actions={
            <AskAiButton sectionId="vacancy-mdl" title={TITLE} context={context} size="icon" />
          }
          table={{
            caption: "MDL districts with vacancies",
            columns: [
              { label: "District" },
              { label: "Pending MDL actions", align: "right" },
              { label: "Open", align: "right" },
              { label: "Announced", align: "right" },
              { label: "Longest open (days)", align: "right" },
            ],
            rows: shown.map((r) => ({
              key: r.courtId,
              cells: [
                r.name,
                fmtInt(r.pendingActions),
                r.open,
                r.announced,
                r.longestDaysOpen ?? "Not recorded",
              ],
            })),
          }}
          minHeight={320}
        >
          <BarList
            ariaLabel="Pending MDL actions by district with vacancy markers"
            items={shown.map((r) => ({
              id: r.courtId,
              label: shortDistrict(r.name),
              value: r.pendingActions,
              display: fmtInt(r.pendingActions),
              note: marker(r) || undefined,
              to: `/courts/${r.courtId}`,
            }))}
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            dots[0] && vm !== null
              ? `Vacant judgeship months in MDL districts with a vacancy; the median MDL district had ${fmtOne(vm)}`
              : "Vacant judgeship months in MDL districts with a vacancy"
          }
          subtitle={`Months of judgeship vacancy in the period (FCMS) · ${fcms} · line: median of ${rows.length} MDL districts`}
          status={
            status.kind !== "ready"
              ? status
              : dots.length && vm !== null
                ? status
                : ({
                    kind: "empty",
                    reason: "Vacant judgeship months are not recorded for these districts.",
                  } as const)
          }
          sources={[SOURCES.fcms]}
          period={fcms}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                FCMS counts vacant judgeship months over the 12-month period. The rank is computed
                here from those values across districts (1 = most months); districts with the same
                value share a rank, and a zero shared with other districts is not ranked.
              </li>
              <li>
                The line is the median of all districts holding pending MDL actions with a recorded
                value.
              </li>
            </ul>
          }
          table={{
            caption: `Vacant judgeship months, ${fcms}`,
            columns: [
              { label: "District" },
              { label: "Vacant judgeship months", align: "right" },
              { label: "Rank among districts (computed; ties share a rank)" },
            ],
            rows: dots.map((r) => ({
              key: r.courtId,
              cells: [
                r.name,
                fmtOne(r.vacantJudgeshipMonths!),
                vacantRankText(r),
              ],
            })),
          }}
          minHeight={320}
        >
          {vm !== null && dots.length ? (
            <DivergingDots
              items={dots.map((r) => ({
                label: shortDistrict(r.name),
                value: r.vacantJudgeshipMonths,
              }))}
              baseline={vm}
              baselineLabel="Median MDL district"
              format={fmtOne}
              labelWidth={150}
            />
          ) : null}
        </ChartCard>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <DataDrawer
          title="Judges who created a vacancy and still hold MDLs"
          description={`Linked from the vacancy to the JPML judge list by the exact FJC judge id; vacancies without such a link are not matched.${unlinkedNote ? ` ${unlinkedNote}.` : ""}`}
          rows={d?.departing ?? []}
          rowKey={(r) => r.vacancyId}
          triggerLabel={`Departing MDL judges (${d?.departing.length ?? 0})`}
          columns={[
            {
              key: "judge",
              label: "Judge (as the AO lists)",
              value: (r) => r.incumbent,
              render: (r) =>
                r.judgeProfileId ? (
                  <Link
                    to="/judges/$id"
                    params={{ id: r.judgeProfileId }}
                    className="text-primary hover:underline"
                  >
                    {r.incumbent}
                  </Link>
                ) : (
                  r.incumbent
                ),
            },
            { key: "court", label: "Court", value: (r) => r.courtName },
            {
              key: "status",
              label: "Vacancy",
              value: (r) => (r.status === "open" ? "Open" : "Announced"),
            },
            {
              key: "reason",
              label: "Reason (as listed)",
              value: (r) => (r.reason === "Senior" ? "Took senior status" : r.reason),
            },
            { key: "date", label: "Vacancy date", value: (r) => r.vacancyDate },
            {
              key: "mdls",
              label: "Pending MDLs (JPML)",
              value: (r) =>
                r.mdls
                  .map((m) => `MDL ${m.mdl} (${m.pending ?? "Not recorded"} pending)`)
                  .join("; "),
              render: (r) => (
                <span className="flex flex-wrap gap-x-2">
                  {r.mdls.map((m) => (
                    <Link
                      key={m.mdl}
                      to="/matters/lens/$mdl"
                      params={{ mdl: String(m.mdl) }}
                      className="text-primary hover:underline"
                      title={m.title}
                    >
                      MDL {m.mdl}
                    </Link>
                  ))}
                </span>
              ),
            },
            {
              key: "pending",
              label: "Pending actions",
              align: "right",
              value: (r) => r.pendingActions,
            },
          ]}
          source={{
            source: [
              { label: SOURCES.vacancies.label, href: SOURCES.vacancies.url },
              { label: SOURCES.jpml.label, href: SOURCES.jpml.url },
            ],
          }}
        />
        <DataDrawer
          title="Districts holding pending MDL actions, with vacancies"
          rows={rows}
          rowKey={(r) => r.courtId}
          searchable
          triggerLabel={`All ${rows.length} MDL districts`}
          columns={[
            {
              key: "court",
              label: "District",
              value: (r) => r.name,
              render: (r) => (
                <Link
                  to="/courts/$id"
                  params={{ id: r.courtId }}
                  className="text-primary hover:underline"
                >
                  {r.name}
                </Link>
              ),
            },
            {
              key: "pending",
              label: `Pending MDL actions (${jpml})`,
              align: "right",
              value: (r) => r.pendingActions,
            },
            { key: "mdls", label: "Pending MDLs", align: "right", value: (r) => r.pendingMdls },
            { key: "active", label: "Active judges (FJC)", align: "right", value: (r) => r.active },
            {
              key: "seats",
              label: "Authorized judgeships",
              align: "right",
              value: (r) => r.judgeships,
            },
            { key: "open", label: "Open vacancies", align: "right", value: (r) => r.open },
            { key: "ann", label: "Announced vacancies", align: "right", value: (r) => r.announced },
            {
              key: "days",
              label: "Longest open (days)",
              align: "right",
              value: (r) => r.longestDaysOpen,
            },
            {
              key: "vm",
              label: "Vacant judgeship months (FCMS)",
              align: "right",
              value: (r) => r.vacantJudgeshipMonths,
            },
          ]}
          source={{
            source: [
              { label: SOURCES.jpml.label, href: SOURCES.jpml.url },
              { label: SOURCES.fjc.label, href: SOURCES.fjc.url },
            ],
          }}
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
