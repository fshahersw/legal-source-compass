import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, BookOpen, Clock3, Gavel, Landmark, ScrollText } from "lucide-react";
import { stateByUsps } from "@/lib/corpus/geo";
import { StateLegislationPanel } from "@/components/legislation/StateLegislationPanel";
import { StateDelegationPanel } from "@/components/legislation/StateDelegationPanel";
import { getStateCodeEntry } from "@/lib/law/stateCode.functions";
import { getStateLaw, type StateLaw } from "@/lib/external/stateLaw.functions";
import { externalHref } from "@/lib/external/href";

type CodeEntryRows = Awaited<ReturnType<typeof getStateCodeEntry>>;

/** One law row: icon, title, what the atlas holds, and the publisher, edition or date detail. */
function Row({
  icon,
  title,
  status,
  detail,
  wrap,
  testId,
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  detail?: ReactNode;
  /** Wraps the row body in a link when the row leads somewhere. */
  wrap?: ((body: ReactNode) => ReactNode) | undefined;
  testId: string;
}) {
  const body = (
    <>
      <span className="resource-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-5">{title}</span>
        <span className="block text-[11.5px] leading-4 text-muted-foreground">{status}</span>
        {detail ? (
          <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {wrap ? <ArrowUpRight className="size-4 shrink-0 text-primary" aria-hidden /> : null}
    </>
  );
  return (
    <li data-testid={testId}>{wrap ? wrap(body) : <div className="resource-row">{body}</div>}</li>
  );
}

const withCount = (n: number | null | undefined, noun: string) =>
  n ? `${n.toLocaleString("en-US")} ${noun}` : null;

/**
 * Law for the state in one place: the statutory code with its source edition, the constitution, the administrative code,
 * state rules of court, the time-limits rules, and recent legislation. Each row says what the atlas holds and from which
 * publisher and edition; where the atlas holds nothing, or a part could not be checked, the row says so.
 */
export function LawSection({
  usps,
  stateName,
  onOpenCourts,
}: {
  usps: string;
  stateName: string;
  onOpenCourts: () => void;
}) {
  const lawFn = useServerFn(getStateLaw);
  const codeFn = useServerFn(getStateCodeEntry);
  const law = useQuery({
    queryKey: ["state-law", usps],
    queryFn: () => lawFn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  // The statute catalogue is keyed by the 50 states and DC; a territory has no entry, so it is not asked for one.
  const catalogued = stateByUsps.has(usps);
  const code = useQuery({
    queryKey: ["state-code-entry", usps],
    queryFn: () => codeFn({ data: { state: usps } }),
    enabled: catalogued,
    staleTime: 60_000,
  });
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        className="resource-panel"
        aria-label={`Law of ${stateName}`}
        data-testid="law-section"
      >
        <div className="research-band">
          <h3 className="flex items-center gap-2 text-label font-semibold text-foreground">
            <BookOpen className="size-4" aria-hidden />
            Codes, rules and time limits
          </h3>
          <span className="text-[11px] text-muted-foreground">official publishers</span>
        </div>
        <ul className="m-0 list-none divide-y divide-border/70 p-0">
          <CodeRows
            loading={catalogued && code.isPending}
            error={catalogued && !!code.error}
            rows={code.data ?? []}
            stateName={stateName}
            onRetry={() => void code.refetch()}
          />
          <LawRows
            law={law.data}
            loading={law.isPending}
            error={!!law.error}
            usps={usps}
            stateName={stateName}
            onRetry={() => void law.refetch()}
            onOpenCourts={onOpenCourts}
          />
        </ul>
      </section>
      <StateDelegationPanel key={`delegation-${usps}`} usps={usps} />
      <StateLegislationPanel key={`legislation-${usps}`} usps={usps} />
    </div>
  );
}

function CodeRows({
  loading,
  error,
  rows,
  stateName,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  rows: CodeEntryRows;
  stateName: string;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <li className="px-3 py-3 text-xs text-muted-foreground" role="status">
        Loading statutes…
      </li>
    );
  if (error)
    return (
      <li className="px-3 py-3 text-xs" role="alert">
        Statute availability could not be checked.{" "}
        <button type="button" className="text-primary underline" onClick={onRetry}>
          Retry
        </button>
      </li>
    );
  if (!rows.length)
    return (
      <Row
        testId="law-code"
        icon={<BookOpen className="size-4" aria-hidden />}
        title="Statutes"
        status={`A reviewed copy of the ${stateName} code is not in the atlas yet.`}
        detail="The Law and resources tab lists the official publisher."
      />
    );
  return (
    <>
      {rows.map((row) => (
        <Row
          key={`${row.kind}-${row.datasetId ?? row.state}`}
          testId="law-code"
          icon={<BookOpen className="size-4" aria-hidden />}
          title={row.codeName}
          status={
            withCount(row.sectionCount, "sections · read and search in the atlas") ??
            "Browse titles and sections in the atlas"
          }
          detail={
            <>
              {row.edition ? `Edition: ${row.edition}. ` : ""}
              {row.currency
                ? `Current through ${row.currency}.`
                : row.edition
                  ? "Currency date not stated by the source."
                  : "Edition and currency are not stated by the source."}
            </>
          }
          wrap={(body) => (
            <Link
              to="/law/codes/$state"
              params={{ state: row.state }}
              search={{ q: "" }}
              className="resource-row"
            >
              {body}
            </Link>
          )}
        />
      ))}
    </>
  );
}

function LawRows({
  law,
  loading,
  error,
  usps,
  stateName,
  onRetry,
  onOpenCourts,
}: {
  law: StateLaw | undefined;
  loading: boolean;
  error: boolean;
  usps: string;
  stateName: string;
  onRetry: () => void;
  onOpenCourts: () => void;
}) {
  if (loading)
    return (
      <li className="px-3 py-3 text-xs text-muted-foreground" role="status">
        Loading constitution, regulations and rules…
      </li>
    );
  if (error || !law)
    return (
      <li className="px-3 py-3 text-xs" role="alert">
        Constitution, regulations and rules could not load.{" "}
        <button type="button" className="text-primary underline" onClick={onRetry}>
          Retry
        </button>
      </li>
    );
  const unchecked = (part: StateLaw["unavailable"][number]) => law.unavailable.includes(part);
  const c = law.constitution;
  const r = law.regulations;
  return (
    <>
      <Row
        testId="law-constitution"
        icon={<Landmark className="size-4" aria-hidden />}
        title="Constitution"
        status={
          unchecked("constitution")
            ? "Could not be checked"
            : c
              ? `${c.title}${c.publisher ? ` · ${c.publisher}` : ""}`
              : `No constitution record for ${stateName}.`
        }
        detail={
          c
            ? [c.statusLabel, c.edition, withCount(c.units, "provisions")]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        wrap={
          c
            ? (body) => (
                <Link
                  to="/law/constitutions/$state"
                  params={{ state: usps }}
                  search={{ article: undefined, q: "" }}
                  className="resource-row"
                >
                  {body}
                </Link>
              )
            : undefined
        }
      />
      <Row
        testId="law-regulations"
        icon={<ScrollText className="size-4" aria-hidden />}
        title="Administrative code (regulations)"
        status={
          unchecked("regulations")
            ? "Could not be checked"
            : r
              ? `${r.code}${r.publisher ? ` · ${r.publisher}` : ""}`
              : `No administrative code index for ${stateName} yet.`
        }
        detail={
          r
            ? [r.statusLabel, withCount(r.entries, "indexed entries")].filter(Boolean).join(" · ")
            : unchecked("regulations")
              ? undefined
              : "Indexes exist for a limited set of states; federal regulations are under Law and regulation."
        }
        wrap={
          r
            ? (body) => (
                <Link
                  to="/law/regulations/$state"
                  params={{ state: usps }}
                  search={{ q: "", level: undefined }}
                  className="resource-row"
                >
                  {body}
                </Link>
              )
            : undefined
        }
      />
      <li data-testid="law-rules">
        <div className="resource-row">
          <span className="resource-icon">
            <Gavel className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-5">Court rules</span>
            {unchecked("rules") ? (
              <span className="block text-[11.5px] text-muted-foreground">
                Could not be checked
              </span>
            ) : law.rules.length ? (
              <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                {law.rules.slice(0, 6).map((d) => (
                  <li key={d.id} className="text-[11.5px] leading-4">
                    {d.url ? (
                      <a
                        href={externalHref(d.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {d.title}
                      </a>
                    ) : (
                      d.title
                    )}
                    <span className="text-muted-foreground">
                      {d.sections != null ? ` · ${d.sections.toLocaleString("en-US")} rules` : ""}
                      {d.status ? ` · ${d.status}` : ""}
                    </span>
                  </li>
                ))}
                {law.rules.length > 6 ? (
                  <li className="text-[11px] text-muted-foreground">
                    and {law.rules.length - 6} more documents
                  </li>
                ) : null}
              </ul>
            ) : (
              <span className="block text-[11.5px] leading-4 text-muted-foreground">
                No state rules of court are in the atlas for {stateName} yet. Federal and local
                rules are on each federal court's page.
              </span>
            )}
            <button
              type="button"
              onClick={onOpenCourts}
              className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
            >
              Courts of {stateName}
            </button>
          </span>
        </div>
      </li>
      <Row
        testId="law-limitations"
        icon={<Clock3 className="size-4" aria-hidden />}
        title="Time limits"
        status={
          unchecked("limitations")
            ? "Could not be checked"
            : law.limitations
              ? `${law.limitations.toLocaleString("en-US")} limitation periods recorded for ${stateName}`
              : `No limitation periods are recorded for ${stateName}.`
        }
        detail="Compute a deadline from the cited rule in Time limits."
        wrap={(body) => (
          <Link to="/limitations" search={{ state: usps }} className="resource-row">
            {body}
          </Link>
        )}
      />
    </>
  );
}
