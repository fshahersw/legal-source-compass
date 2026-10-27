import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { CfrBlocks, CfrNotes } from "@/components/regulatory/CfrText";
import { AsOfPicker, CfrVersionList } from "@/components/regulatory/CfrHistory";
import { RelatedPanel } from "@/components/semantic/RelatedPanel";
import { CitedInFilings } from "@/components/law/CitedInFilings";
import { SectionProductsPanel } from "@/components/law/SectionProductsPanel";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/corpus/head";
import {
  CFR_IDENTIFIER,
  CFR_PART,
  CFR_TITLE,
  ISO_DATE,
  blocksToText,
  ecfrOnDateUrl,
  type CfrHistory,
  type CfrNote,
  type CfrSection,
} from "@/lib/external/ecfrFull";
import { getCfrAsOf, getCfrSection } from "@/lib/external/ecfrFull.functions";
import { formatLawText } from "@/lib/external/formatLawText";

type S = { part?: string | undefined; asof?: string | undefined };

export const Route = createFileRoute("/law_/cfr/$title/$section")({
  validateSearch: (s: Record<string, unknown>): S => ({
    part: typeof s["part"] === "string" && CFR_PART.test(s["part"]) ? s["part"] : undefined,
    asof: typeof s["asof"] === "string" && ISO_DATE.test(s["asof"]) ? s["asof"] : undefined,
  }),
  head: ({ params }) =>
    pageHead(
      `${params.title} CFR ${params.section}`,
      `${params.title} CFR ${params.section}: full current text from the eCFR, its change history and the text as of past dates.`,
    ),
  component: CfrSectionPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`),
  );
}

function CfrSectionPage() {
  const { title, section } = Route.useParams();
  const { part, asof } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/cfr/$title/$section" });
  const sectionFn = useServerFn(getCfrSection);
  const valid = CFR_TITLE.test(title) && CFR_IDENTIFIER.test(section);
  const q = useQuery({
    queryKey: ["cfr-section", title, section, part ?? null],
    queryFn: () => sectionFn({ data: { title, identifier: section, part: part ?? null } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const data = q.data;
  const s = data?.status === "ok" ? data.section : null;
  const partId = s?.part ?? data?.history?.part ?? part ?? null;
  const crumbs: { label: string; to?: string }[] = [
    { label: "Home", to: "/" },
    { label: "Law & regulation", to: "/law" },
    { label: "Code of Federal Regulations", to: "/law/cfr" },
    { label: `Title ${title}`, to: `/law/cfr/${title}` },
  ];
  if (partId)
    crumbs.push({
      label: `Part ${partId}`,
      to: `/law/cfr/${title}/part/${encodeURIComponent(partId)}`,
    });
  crumbs.push({ label: s?.kind === "appendix" ? section : `§ ${section}` });
  const pick = (date: string | null) =>
    void navigate({ search: (prev) => ({ ...prev, asof: date ?? undefined }) });

  return (
    <AppShell
      breadcrumbs={crumbs}
      title={s ? s.citation : `${title} CFR ${section}`}
      {...(s?.heading ? { description: s.heading } : {})}
    >
      {!valid ? (
        <p className="text-[13px] text-muted-foreground">
          “{title} CFR {section}” is not a CFR citation this collection can look up.{" "}
          <Link to="/law/cfr" className="text-primary underline">
            Browse the CFR
          </Link>
        </p>
      ) : q.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          <div className="h-6 w-2/3 animate-pulse rounded bg-muted/60" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
        </div>
      ) : q.error ? (
        <ExternalError error={q.error} />
      ) : !data ? null : data.status === "ok" ? (
        <SectionBody
          section={data.section}
          history={data.history}
          partNotes={data.partNotes}
          asof={asof ?? null}
          onPick={pick}
        />
      ) : data.status === "fallback" ? (
        <div className="space-y-4">
          <p role="status" className="rounded-lg border border-border bg-muted/50 p-3 text-[13px]">
            The full-text collection has no row for this section. Showing the earlier stored text
            {data.fallback.asOf ? ` (as of ${data.fallback.asOf})` : ""} from the{" "}
            {data.fallback.dataset === "ecfr_section_text"
              ? "partial eCFR text set"
              : "CFR sections set"}
            .
          </p>
          <section className="rounded-xl border border-border bg-card shadow-xs p-4">
            <h2 className="m-0 mb-2 text-[14px] font-semibold">{data.fallback.title}</h2>
            <div className="max-w-[78ch] space-y-1.5 text-[14px] leading-relaxed">
              {formatLawText(data.fallback.text).map((t, k) => (
                <p key={k} className="m-0">
                  {t}
                </p>
              ))}
            </div>
            {data.fallback.ecfrUrl ? (
              <a
                href={data.fallback.ecfrUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
              >
                Official eCFR <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </section>
          {data.history ? (
            <HistoryPanel history={data.history} asof={asof ?? null} onPick={pick} />
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-muted-foreground">
            {data.history
              ? "This section is not in the current eCFR. Its change history is below; choose a date to read the text in effect then."
              : `No section ${title} CFR ${section} is recorded in the current eCFR or its change history since 2017.`}{" "}
            <Link to="/law/cfr/$title" params={{ title }} className="text-primary underline">
              Parts of title {title}
            </Link>
          </p>
          {data.history ? (
            <>
              {asof ? (
                <AsOfView
                  title={title}
                  identifier={section}
                  kind={data.history.kind}
                  part={data.history.part}
                  date={asof}
                  onClose={() => pick(null)}
                />
              ) : null}
              <HistoryPanel history={data.history} asof={asof ?? null} onPick={pick} />
            </>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

function SectionBody({
  section: s,
  history,
  partNotes,
  asof,
  onPick,
}: {
  section: CfrSection;
  history: CfrHistory | null;
  partNotes: CfrNote[];
  asof: string | null;
  onPick: (date: string | null) => void;
}) {
  const path = s.path.filter((p) => p.type !== "title" && p.type !== "subject_group");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {s.ecfrUrl ? (
          <Button asChild size="sm">
            <a href={s.ecfrUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 size-3.5" />
              Official eCFR
            </a>
          </Button>
        ) : null}
        {s.blocks.length ? (
          <Button size="sm" variant="outline" onClick={() => copy(blocksToText(s.blocks), "Text")}>
            <Copy className="mr-1 size-3.5" />
            Copy text
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => copy(s.citation, "Citation")}>
          <Copy className="mr-1 size-3.5" />
          Copy citation
        </Button>
        <span className="text-[12px] text-muted-foreground">
          eCFR text up to date as of {s.asOf}
          {s.reserved ? " · reserved" : ""}
        </span>
      </div>
      {path.length ? (
        <p className="m-0 text-[12px] text-muted-foreground">
          {path.map((p, k) => (
            <span key={k}>
              {k ? " · " : ""}
              {p.type === "part" && s.part ? (
                <Link
                  to="/law/cfr/$title/part/$part"
                  params={{ title: s.titleNumber, part: s.part }}
                  className="hover:underline"
                >
                  {p.label}
                </Link>
              ) : (
                p.label
              )}
            </span>
          ))}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          {asof ? (
            <AsOfView
              title={s.titleNumber}
              identifier={s.identifier}
              kind={s.kind}
              part={s.part}
              date={asof}
              onClose={() => onPick(null)}
            />
          ) : (
            <section
              aria-label="Current text"
              className="rounded-xl border border-border bg-card shadow-xs p-4 shadow-card"
            >
              {s.blocks.length ? (
                <CfrBlocks blocks={s.blocks} label="Section text" />
              ) : (
                <p className="m-0 text-[13px] text-muted-foreground">
                  {s.reserved
                    ? "This section is reserved: the eCFR prints its heading only."
                    : "The eCFR prints no text under this heading (see the notes below)."}
                </p>
              )}
              {!s.layoutExact && s.blocks.length ? (
                <p className="m-0 mt-3 text-[11px] text-muted-foreground">
                  Paragraph layout could not be read; the text is shown line by line.
                </p>
              ) : null}
            </section>
          )}
          <CfrNotes notes={s.notes} title="Notes printed with this section" />
          <CfrNotes notes={partNotes} title="Authority and source for the part" />
          <p className="m-0 text-[11px] text-muted-foreground">
            {s.qualification ?? "eCFR text; the official legal edition is the annual CFR."}
            {s.sourceUrl ? (
              <>
                {" "}
                Source file:{" "}
                <a
                  href={s.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  GovInfo eCFR bulk XML, title {s.titleNumber}
                </a>
                {s.sourceSha256 ? ` (SHA-256 ${s.sourceSha256.slice(0, 12)}…)` : ""}.
              </>
            ) : null}
          </p>
        </div>
        <aside className="min-w-0 space-y-3">
          {history ? (
            <HistoryPanel history={history} asof={asof} onPick={onPick} />
          ) : (
            <section className="rounded-xl border border-border bg-card shadow-xs p-3 text-[12px] text-muted-foreground">
              No change history is recorded for this section.
            </section>
          )}
          {!s.reserved ? <RelatedPanel dataset="ecfr_sections_full" recordId={s.id} quiet /> : null}
        </aside>
      </div>
      <SectionProductsPanel title={s.titleNumber} section={s.identifier} />
      <CitedInFilings dataset="ecfr_sections_full" id={s.id} citation={s.citation} />
    </div>
  );
}

function HistoryPanel({
  history,
  asof,
  onPick,
}: {
  history: CfrHistory;
  asof: string | null;
  onPick: (d: string | null) => void;
}) {
  const changes = history.versions.filter((v) => v.substantive && v.date >= "2017-01-03").length;
  return (
    <section
      aria-label="Change history"
      className="rounded-xl border border-border bg-card shadow-xs p-3"
    >
      <h2 className="eyebrow mb-1">Change history</h2>
      <p className="m-0 mb-2 text-[11px] text-muted-foreground">
        {history.versions.length} version{history.versions.length === 1 ? "" : "s"} listed by the
        eCFR; {changes} substantive change
        {changes === 1 ? "" : "s"} since 2017-01-03.
      </p>
      <div className="mb-3">
        <AsOfPicker value={asof} today={today()} onPick={onPick} />
      </div>
      <CfrVersionList history={history} selected={asof} onPick={onPick} />
      {history.qualification ? (
        <p className="m-0 mt-3 text-[10px] leading-snug text-muted-foreground">
          {history.qualification}
        </p>
      ) : null}
    </section>
  );
}

function AsOfView({
  title,
  identifier,
  kind,
  part,
  date,
  onClose,
}: {
  title: string;
  identifier: string;
  kind: "section" | "appendix";
  part: string | null;
  date: string;
  onClose: () => void;
}) {
  const asOfFn = useServerFn(getCfrAsOf);
  const valid = date >= "2017-01-03" && date <= today();
  const q = useQuery({
    queryKey: ["cfr-asof", title, identifier, kind, part, date],
    queryFn: () => asOfFn({ data: { title, identifier, kind, part, date } }),
    enabled: valid,
    staleTime: Infinity,
    retry: false,
  });
  const r = q.data;
  return (
    <section
      aria-label={`Text as of ${date}`}
      className="rounded-lg border border-primary/40 bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
        <p className="m-0 text-[12px]">
          <span className="font-semibold">Text as of {date}</span>
          <span className="text-muted-foreground">
            {" "}
            · read live from the eCFR API, not stored here
          </span>
        </p>
        <span className="flex items-center gap-3 text-[12px]">
          <a
            href={ecfrOnDateUrl(date, title, identifier, kind, part)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            eCFR on this date <ExternalLink className="size-3" aria-hidden />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-0.5 hover:bg-muted"
          >
            Back to current text
          </button>
        </span>
      </div>
      {!valid ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          Choose a date from 2017-01-03 (when the eCFR point-in-time record starts) to today.
        </p>
      ) : q.isLoading ? (
        <div
          className="h-32 animate-pulse rounded bg-muted/50"
          aria-busy="true"
          aria-label="Loading the text as of this date"
        />
      ) : q.error ? (
        <p className="m-0 text-[13px] text-destructive">
          The text as of this date could not be read:{" "}
          {q.error instanceof Error ? q.error.message : String(q.error)}
        </p>
      ) : !r ? null : r.status !== "ok" ? (
        <p className="m-0 text-[13px] text-muted-foreground">{r.message}</p>
      ) : (
        <>
          {r.heading ? <p className="m-0 mb-2 text-[13px] font-semibold">{r.heading}</p> : null}
          {r.blocks.length ? (
            <CfrBlocks blocks={r.blocks} label={`Text as of ${date}`} />
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground">
              The eCFR prints no text under this heading on that date.
            </p>
          )}
          {r.notes.length ? (
            <div className="mt-3">
              <CfrNotes notes={r.notes} title="Notes printed with the section on that date" />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
