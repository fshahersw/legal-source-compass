/**
 * Regulatory record and defendants: the agency product signal, openFDA adverse-event series, regulator links (FDA
 * recalls and reports tied to this MDL by the published selection rule: a topical association, never membership), SEC
 * registrants whose own filings name the MDL with their company-wide litigation accruals, automated flags and the
 * product-signal lifecycle.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CompaniesCard,
  FdaReportsCard,
  FlagsCard,
  SignalCard,
  hasAdverseCard,
} from "@/components/lens/MdlLens";
import { MatterLifecyclePanel } from "@/components/litviz/MatterLifecyclePanel";
import {
  Card,
  CardBody,
  CardFooter,
  DataDrawer,
  SourceFooter,
  type DataColumn,
} from "@/components/kit";
import { MdlAdverseCards } from "@/components/mdl/MdlTrendCards";
import { money } from "@/components/companies/companyData";
import type {
  MdlCommandPayload,
  RegulatoryLink,
  SecDefendant,
  SecFinancialSeries,
} from "@/lib/matters/types";
import { mdlRegulatoryLinksQuery, mdlSecDefendantsQuery } from "./commandQueries";
import { Note, Out, Unavailable, day, fmt } from "./shared";

const linkColumns: DataColumn<RegulatoryLink>[] = [
  { key: "date", label: "Record date", value: (r) => r.date },
  { key: "title", label: "Record", value: (r) => r.title },
  { key: "firm", label: "Firm as recorded", value: (r) => r.firm },
  { key: "class", label: "Classification", value: (r) => r.classification },
  { key: "kind", label: "FDA record type", value: (r) => r.fdaKind },
  { key: "basis", label: "Link basis", value: (r) => r.linkBasis },
  {
    key: "src",
    label: "Source",
    value: (r) => r.sourceUrl,
    render: (r) => <Out href={r.sourceUrl}>{r.sourceUrl ? "Open" : ""}</Out>,
  },
];

function RegulatoryLinksCard({ mdl }: { mdl: string }) {
  const q = useQuery(mdlRegulatoryLinksQuery(mdl));
  if (q.isPending) return null;
  if (q.isError) return <Unavailable what="The regulator links" />;
  const d = q.data;
  if (!d.rows.length) return null;
  const byClass = new Map<string, number>();
  for (const r of d.rows) byClass.set(r.classification ?? "Not recorded", (byClass.get(r.classification ?? "Not recorded") ?? 0) + 1);
  const dated = d.rows.filter((r) => r.date).map((r) => r.date!).sort();
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-label text-foreground">
            Regulator records linked to this MDL{" "}
            <span className="tabular-nums text-muted-foreground">· {fmt(d.rows.length)}</span>
          </h3>
          <DataDrawer
            title={`MDL ${mdl}: regulator records linked to the MDL`}
            rows={d.rows}
            rowKey={(r) => r.id}
            columns={linkColumns}
            searchable
            source={{
              source: { label: "Seeger Weiss regulatory links (openFDA records)" },
              about: (
                <>
                  {d.rule ? <p>Selection rule: {d.rule}</p> : null}
                  {d.caveats.map((c) => (
                    <p key={c}>{c}</p>
                  ))}
                </>
              ),
            }}
          />
        </div>
        <ul className="mt-2 space-y-1 text-body">
          {[...byClass.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3">
                <span>{k}</span>
                <span className="tabular-nums">{fmt(v)}</span>
              </li>
            ))}
        </ul>
        <Note>A topical association by the published rule, not MDL membership.</Note>
      </CardBody>
      <CardFooter>
        <SourceFooter
          source={{ label: "openFDA records (Seeger Weiss regulatory links)", href: "https://open.fda.gov/" }}
          period={dated.length ? `${day(dated[0])} to ${day(dated.at(-1))}` : undefined}
          about={
            <>
              {d.rule ? <p>Selection rule: {d.rule}</p> : null}
              {d.caveats.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </>
          }
        />
      </CardFooter>
    </Card>
  );
}

function latestPoint(s: SecFinancialSeries | null) {
  if (!s?.points.length) return null;
  return [...s.points].sort((a, b) => b.end.localeCompare(a.end))[0]!;
}

function SecRow({ c }: { c: SecDefendant }) {
  const cells = [
    { label: "Litigation accrual", s: c.accrual },
    { label: "Legal payments", s: c.legalPayments },
    { label: "Reasonably possible loss", s: c.possibleLoss },
  ];
  return (
    <li className="border-t border-border py-2 first:border-t-0">
      <Link
        to="/companies/$cik"
        params={{ cik: c.cik }}
        className="text-body font-medium text-primary underline-offset-2 hover:underline"
      >
        {c.name}
      </Link>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-meta sm:grid-cols-3">
        {cells.map(({ label, s }) => {
          const p = latestPoint(s);
          return (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">
                {p ? `${money(p.value, p.unit)} · FY${p.fy}${p.end ? ` (to ${day(p.end)})` : ""}` : "Not recorded"}
              </dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

function SecDefendantsCard({ mdl }: { mdl: string }) {
  const q = useQuery(mdlSecDefendantsQuery(mdl));
  if (q.isPending) return null;
  if (q.isError) return <Unavailable what="The SEC registrants" />;
  const d = q.data;
  if (!d.named.length && !d.review.length) return null;
  return (
    <Card>
      <CardBody className="pt-4">
        <h3 className="text-label text-foreground">
          SEC registrants whose filings name this MDL{" "}
          <span className="tabular-nums text-muted-foreground">· {fmt(d.named.length)}</span>
        </h3>
        {d.named.length ? (
          <ul className="mt-1">
            {d.named.slice(0, 6).map((c) => (
              <SecRow key={c.cik} c={c} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted-foreground">No filing names this MDL directly.</p>
        )}
        {d.review.length ? (
          <Note>
            Requires review (weaker link): {d.review.slice(0, 5).map((c) => c.name).join(", ")}
            {d.review.length > 5 ? ` and ${d.review.length - 5} more` : ""}.
          </Note>
        ) : null}
        <Note>Figures are company-wide, never attributed to this MDL.</Note>
      </CardBody>
      <CardFooter>
        <SourceFooter
          source={{
            label: "SEC EDGAR filings and XBRL company facts",
            href: d.named[0]?.financialsSourceUrl ?? "https://www.sec.gov/edgar/search/",
          }}
          about={
            <>
              {d.caveats.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </>
          }
        />
      </CardFooter>
    </Card>
  );
}

export function RegulatorySection({ cmd }: { cmd: MdlCommandPayload }) {
  const lens = cmd.lens;
  const n = Number(cmd.mdl);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {lens?.signal ? (
          <SignalCard signal={lens.signal} showYears={!hasAdverseCard(lens.fdaReports)} />
        ) : null}
        {lens?.fdaReports.length ? <FdaReportsCard reports={lens.fdaReports} /> : null}
        <RegulatoryLinksCard mdl={cmd.mdl} />
        <SecDefendantsCard mdl={cmd.mdl} />
      </div>
      {lens ? <MdlAdverseCards mdl={n} systems={lens.fdaReports.map((r) => r.system)} /> : null}
      {lens?.companies.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CompaniesCard companies={lens.companies} />
        </div>
      ) : null}
      {lens?.insights.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <FlagsCard insights={lens.insights} />
        </div>
      ) : null}
      <MatterLifecyclePanel mdl={cmd.mdl} />
    </div>
  );
}
