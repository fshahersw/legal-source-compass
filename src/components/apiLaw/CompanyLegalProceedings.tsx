import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import {
  getCompanyLegalProceedings,
  getLegalProceedingsText,
  type LegalFiling,
  type LegalSection,
} from "@/lib/external/apiLaw.functions";

const fmtN = (n: number) => n.toLocaleString("en-US");

/**
 * Form 10-K legal proceedings of one registrant (/companies/<cik>): Item 3 and the litigation or contingency notes it
 * points to, exact text as filed with accession number, and the MDL numbers or captions the filing mentions. A mention
 * links to the MDL only when this atlas holds it, and is never shown as membership. Renders nothing while loading,
 * when the dataset is not published, or when no filing of this company was read.
 */
export function CompanyLegalProceedings({
  cik,
  className = "",
}: {
  cik: string;
  className?: string;
}) {
  const fn = useServerFn(getCompanyLegalProceedings);
  const q = useQuery({
    queryKey: ["company-legal-proceedings", cik],
    queryFn: () => fn({ data: { cik } }),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const [showAll, setShowAll] = useState(false);
  if (q.isLoading) return null;
  if (q.isError)
    return (
      <div className={className}>
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          }
        >
          10-K legal proceedings could not be loaded.
        </StateNote>
      </div>
    );
  const filings = q.data ?? [];
  if (!filings.length) return null;
  const shown = showAll ? filings : filings.slice(0, 2);
  return (
    <Panel
      className={className}
      title="Legal proceedings in Form 10-K"
      subtitle="Item 3 and the litigation notes it points to, exact text as filed"
      actions={
        <Link
          to={"/companies/legal-proceedings" as never}
          className="text-[12px] text-primary hover:underline"
        >
          All companies
        </Link>
      }
      footnote={
        <>
          Source: SEC EDGAR Form 10-K primary documents. Text is the filing's visible text with tags
          removed; nothing is rephrased. An MDL number or caption in a filing is a mention, not
          evidence that the company is a party to that MDL.
        </>
      }
    >
      <ul className="divide-y divide-border/60">
        {shown.map((f) => (
          <FilingRow key={f.id} filing={f} />
        ))}
      </ul>
      {filings.length > 2 ? (
        <div className="border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {showAll ? "Show fewer filings" : `Show all ${filings.length} filings`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function FilingRow({ filing: f }: { filing: LegalFiling }) {
  const mdls = new Map<number, { held: boolean; written: string[]; sections: Set<string> }>();
  for (const m of f.mentions) {
    const e = mdls.get(m.mdl_number) ?? {
      held: m.held_mdl,
      written: [],
      sections: new Set<string>(),
    };
    if (!e.written.includes(m.as_written)) e.written.push(m.as_written);
    e.sections.add(m.section);
    mdls.set(m.mdl_number, e);
  }
  return (
    <li className="space-y-1.5 px-3 py-2 text-[12.5px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span>
          <span className="font-medium">
            {f.form} for {f.period ?? "period not recorded"}
          </span>
          <span className="ml-2 text-muted-foreground">filed {f.filed || "date not recorded"}</span>
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">{f.accession}</span>
        </span>
        <span className="flex gap-x-3">
          <SourceLink href={f.documentUrl}>Document</SourceLink>
          <SourceLink href={f.indexUrl}>Filing index</SourceLink>
        </span>
      </div>
      {f.sections.length ? (
        <div className="space-y-1">
          {f.sections.map((s) => (
            <SectionText key={s.label} id={f.id} section={s} />
          ))}
        </div>
      ) : (
        <p className="m-0 text-muted-foreground">
          No Item 3 heading or litigation note was found in this filing's text.
        </p>
      )}
      {mdls.size ? (
        <p className="m-0 text-[12px] text-muted-foreground">
          MDLs mentioned:{" "}
          {[...mdls.entries()].map(([n, e], i) => (
            <span key={n}>
              {i ? "; " : ""}
              {e.held ? (
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(n) }}
                  className="text-primary hover:underline"
                >
                  MDL No. {n}
                </Link>
              ) : (
                <span>MDL No. {n}</span>
              )}{" "}
              <span title={e.written.join(" · ")}>(in {[...e.sections].join(", ")})</span>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function SectionText({ id, section: s }: { id: string; section: LegalSection }) {
  const [open, setOpen] = useState(false);
  const fn = useServerFn(getLegalProceedingsText);
  const q = useQuery({
    queryKey: ["legal-proceedings-text", id, s.label],
    queryFn: () => fn({ data: { id, section: s.label } }),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-left text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span>{s.heading}</span>
        <span className="text-muted-foreground">
          · {fmtN(s.chars)} characters{s.truncated ? ", shown in part" : ""}
        </span>
      </button>
      {open ? (
        q.isLoading ? (
          <div
            className="mt-1 h-24 animate-pulse rounded border border-border bg-muted/40"
            aria-label="Loading text"
          />
        ) : q.isError || !q.data ? (
          <p role="alert" className="m-0 mt-1 text-destructive">
            The text could not be loaded.
          </p>
        ) : (
          <div className="mt-1 max-h-96 overflow-y-auto rounded border border-border bg-background px-3 py-2">
            <p className="m-0 whitespace-pre-wrap break-words text-[12.5px] leading-5">
              {q.data.text}
            </p>
            {q.data.truncated ? (
              <p className="m-0 mt-2 text-[11px] text-muted-foreground">
                The section continues in the filing; open the document for the rest.
              </p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
