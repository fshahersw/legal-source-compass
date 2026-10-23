import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { BodyLines, Fact, Footnotes, StatusBadge } from "@/components/uscode/UsCodeText";
import { RegulationsUnderSectionPanel } from "@/components/authorities/RegulationsUnderSectionPanel";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";
import {
  getUsCodeSection,
  getUsCodeSectionLaws,
  govinfoEditionUrl,
  LINK_KIND_LABELS,
  containerLabel,
  containerSmallCaps,
  smartTitle,
  STATUS_LABELS,
  TITLE_KEY,
  UNIT_KEY,
  type SectionLaw,
  type UscNote,
  type UscSection,
} from "@/lib/external/usCode.functions";

export const Route = createFileRoute("/law_/uscode/$title/$section")({
  head: ({ params }) =>
    pageHead(
      `${params.title.replace(/a$/, " App.")} U.S.C. ${params.section}`,
      `Official text of ${params.title} U.S.C. ${params.section} with its source credit, notes and amending laws.`,
    ),
  component: SectionPage,
});

/** Lines rendered before "Show the full text"; a handful of sections (e.g. 42 U.S.C. § 1395ww) print thousands. */
const BODY_LIMIT = 600;

/**
 * The heading under the page title. A bracketed status unit prints "[§ 14. Repealed. … 116 Stat. 1812]"; the "[" sits
 * in its number, so the closing bracket is dropped here (the text panel keeps the printed form).
 */
const pageSubtitle = (s: UscSection) =>
  s.num?.startsWith("[") && s.heading?.endsWith("]") ? s.heading.slice(0, -1) : (s.heading ?? "");

const longDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "Not recorded";

function SectionPage() {
  const { title, section } = Route.useParams();
  const valid = TITLE_KEY.test(title) && UNIT_KEY.test(section);
  const fn = useServerFn(getUsCodeSection);
  const q = useQuery({
    queryKey: ["us-code-section", title, section],
    queryFn: () => fn({ data: { title, key: section } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const s = q.data;
  const titleLabel = title.endsWith("a")
    ? `Title ${title.slice(0, -1)} Appendix`
    : `Title ${title}`;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "United States Code", to: "/law/uscode" },
        { label: titleLabel, to: `/law/uscode/${title}` },
        { label: s ? s.citation : section },
      ]}
      title={s ? s.citation : `${title} U.S.C. ${section}`}
      {...(s?.heading ? { description: pageSubtitle(s) } : {})}
    >
      {!valid ? (
        <p className="text-sm text-muted-foreground">
          “{section}” is not a section of the United States Code.
        </p>
      ) : null}
      {q.error ? <ExternalError error={q.error} /> : null}
      {q.isLoading ? (
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading the section"
        />
      ) : null}
      {q.data === null ? (
        <p className="text-sm text-muted-foreground">
          No unit {section} is recorded in {titleLabel} of the current release point.{" "}
          <Link
            to="/law/uscode/$title"
            params={{ title }}
            search={{ q: section, c: undefined }}
            className="text-primary underline"
          >
            Search {titleLabel}
          </Link>
        </p>
      ) : null}
      {s ? <SectionBody s={s} /> : null}
    </AppShell>
  );
}

function SectionBody({ s }: { s: UscSection }) {
  const titleLabel = s.title.endsWith("a")
    ? `Title ${s.title.slice(0, -1)} Appendix`
    : `Title ${s.title}`;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        {s.path.length ? (
          <nav
            aria-label="Location in the Code"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted-foreground"
          >
            <Link
              to="/law/uscode/$title"
              params={{ title: s.title }}
              search={{ q: undefined, c: undefined }}
              className="hover:text-foreground hover:underline"
            >
              {titleLabel}
            </Link>
            {s.path.map((p) => (
              <span key={p.index} className="inline-flex items-center gap-1.5">
                <span aria-hidden>›</span>
                <Link
                  to="/law/uscode/$title"
                  params={{ title: s.title }}
                  search={{ q: undefined, c: p.index }}
                  className={cn(
                    "hover:text-foreground hover:underline",
                    containerSmallCaps(p.num) && "[font-variant:small-caps]",
                  )}
                >
                  {containerLabel(p.num, p.heading)}
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
        {s.status ? (
          <p
            role="note"
            className="m-0 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px]"
          >
            The Office of the Law Revision Counsel marks this unit{" "}
            <strong>{(STATUS_LABELS[s.status] ?? s.status).toLowerCase()}</strong>. The heading
            above states what happened to it; the notes below give the details.
          </p>
        ) : null}
        <section aria-label="Text" className="rounded-lg border border-border bg-surface px-4 py-3">
          <h2 className="m-0 mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            <span>{s.num ?? s.citation}</span>
            <span className="font-normal">{s.heading}</span>
            <StatusBadge status={s.status} />
          </h2>
          {s.lines.length ? (
            <BodyLines key={s.key} lines={s.lines} limit={BODY_LIMIT} />
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground">
              {s.status
                ? "No text is printed for this unit."
                : "The Code prints no text for this unit beyond its heading."}
            </p>
          )}
          <Footnotes items={s.footnotes} />
          {s.credit ? (
            <p className="m-0 mt-3 border-t border-border/70 pt-2 text-[12px] text-muted-foreground">
              <span className="sr-only">Source credit: </span>
              {s.credit}
            </p>
          ) : null}
        </section>
        {s.notes.length ? <Notes notes={s.notes} /> : null}
        <AmendingLaws title={s.title} section={s.key} />
        {s.kind === "section" ? (
          <RegulationsUnderSectionPanel title={s.title} sectionKey={s.key} />
        ) : null}
      </div>
      <aside className="space-y-3 self-start xl:sticky xl:top-2">
        <section
          aria-label="Source"
          className="rounded-lg border border-border bg-surface px-4 py-3"
        >
          <dl className="m-0 grid gap-y-1.5 text-xs">
            <Fact label="Release point" wrap>
              {s.release} (through Public Law {s.release}, {longDate(s.lawDate)})
            </Fact>
            <Fact label="Kind">
              {s.kind === "courtRule"
                ? "Court rule (appendix)"
                : s.kind === "reorganizationPlan"
                  ? "Reorganization plan (appendix)"
                  : "Section"}
            </Fact>
          </dl>
          <p className="m-0 mt-2 text-[12px]">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {s.urlKind === "section"
                ? "Official text on uscode.house.gov"
                : `${titleLabel} on uscode.house.gov`}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
          {s.urlKind === "title" ? (
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              The Office does not publish a separate page for this unit; the link opens its title.
            </p>
          ) : null}
        </section>
        <Editions s={s} />
        {s.prev || s.next ? (
          <nav
            aria-label="Neighbouring units"
            className="flex flex-wrap justify-between gap-2 text-[12px]"
          >
            {s.prev ? (
              <Link
                to="/law/uscode/$title/$section"
                params={{ title: s.title, section: s.prev.key }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ArrowLeft className="size-3" aria-hidden /> {s.prev.citation}
              </Link>
            ) : (
              <span />
            )}
            {s.next ? (
              <Link
                to="/law/uscode/$title/$section"
                params={{ title: s.title, section: s.next.key }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {s.next.citation} <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null}
          </nav>
        ) : null}
      </aside>
    </div>
  );
}

function Editions({ s }: { s: UscSection }) {
  if (s.kind !== "section" || s.title.endsWith("a"))
    return (
      <section
        aria-label="Earlier editions"
        className="rounded-lg border border-border bg-surface px-4 py-3 text-[12px] text-muted-foreground"
      >
        GovInfo's annual editions are not linked for appendix units.
      </section>
    );
  const years = [...s.govinfoYears].sort((a, b) => b - a);
  return (
    <section
      aria-label="Earlier editions"
      className="rounded-lg border border-border bg-surface px-4 py-3"
    >
      <h2 className="eyebrow m-0">Annual editions on GovInfo</h2>
      {years.length ? (
        <>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-2 gap-y-1 p-0 text-[12px]">
            {years.map((y) => (
              <li key={y}>
                <a
                  href={govinfoEditionUrl(s.title, s.key, y)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary hover:underline"
                >
                  {y}
                </a>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[11px] text-muted-foreground">
            {s.govinfoYearsBasis === "section"
              ? "Editions whose printing contains this section number, as GovInfo lists them."
              : "Editions of this title; a year in which the section did not yet exist opens GovInfo's no-result page."}
          </p>
        </>
      ) : (
        <p className="m-0 mt-2 text-[12px] text-muted-foreground">
          No annual edition on GovInfo (1994–2024) contains this section number.
        </p>
      )}
    </section>
  );
}

function Notes({ notes }: { notes: UscNote[] }) {
  const [shown, setShown] = useState(false);
  const groups: { group: string | null; notes: UscNote[] }[] = [];
  for (const n of notes) {
    const last = groups[groups.length - 1];
    if (last && last.group === n.group) last.notes.push(n);
    else groups.push({ group: n.group, notes: [n] });
  }
  return (
    <details
      className="rounded-lg border border-border bg-surface"
      onToggle={(e) => setShown((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">
        Notes{" "}
        <span className="font-normal text-muted-foreground">
          ({notes.length.toLocaleString("en-US")})
        </span>
      </summary>
      {shown ? (
        <div className="space-y-4 border-t border-border/70 px-4 py-3">
          {groups.map((g, i) => (
            <div key={i} className="space-y-3">
              {g.group ? <h3 className="eyebrow m-0">{g.group}</h3> : null}
              {g.notes.map((n, j) => (
                <div key={j}>
                  {n.heading ? (
                    <h4 className="m-0 mb-1 text-[13px] font-medium">{n.heading}</h4>
                  ) : null}
                  <BodyLines lines={n.lines} className="text-[12.5px]" />
                  <Footnotes items={n.footnotes} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function AmendingLaws({ title, section }: { title: string; section: string }) {
  const fn = useServerFn(getUsCodeSectionLaws);
  const q = useQuery({
    queryKey: ["us-code-section-laws", title, section],
    queryFn: () => fn({ data: { title, key: section } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section
      aria-label="Enacting and amending laws"
      className="rounded-lg border border-border bg-surface"
    >
      <header className="border-b border-border/70 px-4 py-2.5">
        <h2 className="m-0 text-sm font-semibold">Enacting and amending laws</h2>
        <p className="m-0 mt-0.5 text-[11px] text-muted-foreground">
          Laws named in this unit's source credit or notes, and laws whose Statutes at Large text or
          margin cites it. Matched on public law number, act date and chapter, or Statutes at Large
          page only.
        </p>
      </header>
      {q.isLoading ? (
        <div
          className="m-3 h-20 animate-pulse rounded bg-muted/50"
          aria-busy="true"
          aria-label="Loading laws"
        />
      ) : null}
      {q.error ? (
        <div className="p-3">
          <ExternalError error={q.error} />
        </div>
      ) : null}
      {q.data && q.data.laws.length === 0 ? (
        <p className="m-0 px-4 py-3 text-xs text-muted-foreground">
          No enacted law is linked to this unit.
        </p>
      ) : null}
      {q.data?.laws.length ? (
        <>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[36rem] text-left text-[12px]">
              <thead className="sticky top-0 border-b border-border bg-surface text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Law
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Enacted
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Statutes at Large
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Linked by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {q.data.laws.map((law) => (
                  <LawRow key={law.lawId} law={law} />
                ))}
              </tbody>
            </table>
          </div>
          {q.data.total !== null && q.data.total > q.data.laws.length + q.data.dropped ? (
            <p className="m-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
              Showing {q.data.laws.length.toLocaleString("en-US")} of{" "}
              {q.data.total.toLocaleString("en-US")} linked laws.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function LawRow({ law }: { law: SectionLaw }) {
  const link = law.govinfo[0];
  return (
    <tr className="align-top">
      <td className="px-3 py-1.5">
        {link ? (
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
            title={law.title ?? undefined}
          >
            {law.label}
          </a>
        ) : (
          <span className="font-medium">{law.label}</span>
        )}
        {law.title ? (
          <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
            {law.title}
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">{longDate(law.enacted)}</td>
      <td className="whitespace-nowrap px-3 py-1.5">{law.statutes ?? "Not recorded"}</td>
      <td
        className="px-3 py-1.5 text-muted-foreground"
        title={law.evidence.map(([, t]) => t).join("\n")}
      >
        {law.kinds.map((k) => LINK_KIND_LABELS[k]).join("; ")}
      </td>
    </tr>
  );
}
