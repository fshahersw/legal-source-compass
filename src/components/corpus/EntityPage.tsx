import { cn } from "@/lib/utils";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  isSourceIdKey,
  isStorageMetaKey,
  splitProvenanceLabel,
  splitProviderKey,
  splitProviderValue,
  subtitleWithoutIds,
} from "./recordDisplay";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { Fragment, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CorpusLink,
  DatasetBrowser,
  useAppRoutes,
  useDatasets,
} from "@/components/corpus/DatasetBrowser";
import { getEntity } from "@/lib/external/entity.functions";
import { buildEntityView, type EntitySection } from "@/lib/external/entityView";
import { CaseCatalog } from "@/components/corpus/CaseCatalog";
import { DocketDocuments } from "@/components/corpus/DocketDocuments";
import { fileUrl, resolveLink, searchLinkOutcome } from "@/lib/external/groups";
import { displayValue } from "@/lib/external/domainRegistry";
import { isStoredFilePath, isStoredMarkLabel, plainMediaLabel } from "@/lib/corpus/heldMedia";

/** How recorded no-result openFDA name searches are listed (see searchLinkOutcome). */
const SEARCH_OUTCOMES = [
  {
    outcome: "no_matches",
    heading: "openFDA name search returned no matches",
    suffix: "no matches",
    title:
      "The openFDA name searches that were run and recorded as returning no results (openFDA answers “No matches found!”). They are searches, not sources.",
  },
  {
    outcome: "no_exact_match",
    heading: "openFDA name search found no exact match",
    suffix: "no exact match",
    title:
      "The openFDA name searches that were run. None found a manufacturer name matching this company exactly: a search finds either nothing (openFDA answers “No matches found!”) or only other spellings.",
  },
] as const;

export const entityQuery = (dataset: string, id: string) =>
  queryOptions({
    queryKey: ["entity", dataset, id],
    queryFn: async (): Promise<{ raw: Record<string, unknown> | null }> => {
      const r = await getEntity({ data: { dataset, id } });
      return { raw: r.json ? (JSON.parse(r.json) as Record<string, unknown>) : null };
    },
    staleTime: 5 * 60_000,
  });

export function EntityPage({
  dataset,
  id,
  crumbs,
  docket,
  lead,
  header,
  extra,
  linkFilter,
}: {
  dataset: string;
  id: string;
  crumbs: { label: string; to?: string; search?: Record<string, string> | undefined }[];
  docket?: { kind: "mdl" | "court"; id: string } | undefined;
  lead?: (
    raw: Record<string, unknown>,
    view: ReturnType<typeof buildEntityView>,
  ) => React.ReactNode;
  /**
   * Replaces the whole header card (lead and key facts). The key facts then move to the record details, so nothing
   * recorded is dropped.
   */
  header?: (
    raw: Record<string, unknown>,
    view: ReturnType<typeof buildEntityView>,
  ) => React.ReactNode;
  extra?: (raw: Record<string, unknown>) => React.ReactNode;
  linkFilter?: (
    links: ReturnType<typeof buildEntityView>["links"],
  ) => ReturnType<typeof buildEntityView>["links"];
}) {
  const { data } = useSuspenseQuery(entityQuery(dataset, id));
  const { aliases } = useDatasets();
  if (!data.raw)
    return (
      <AppShell breadcrumbs={crumbs} title="Record not found">
        <p className="text-[13px] text-muted-foreground">The corpus has no record “{id}”.</p>
      </AppShell>
    );
  const v = buildEntityView(data.raw);
  // A stored identity-mark image is the page's mark (the header draws it), not a link to list.
  const ownLinks = v.links.filter((l) => !(isStoredMarkLabel(l.label) && isStoredFilePath(l.url)));
  const shownLinks = linkFilter ? linkFilter(ownLinks) : ownLinks;
  const withheldLinks = ownLinks.length - shownLinks.length;
  // Searches recorded as finding nothing usable are listed as such, not as source links.
  const raw = data.raw;
  const outcomes = shownLinks.map((l) => searchLinkOutcome(dataset, raw, l));
  const visibleLinks = shownLinks.filter((_, i) => outcomes[i] === null);
  const queryGroups = SEARCH_OUTCOMES.map((o) => ({
    ...o,
    links: shownLinks.filter((_, i) => outcomes[i] === o.outcome),
  })).filter((g) => g.links.length);
  // Facts the page header already prints (the title, or one part of the subtitle) move to "More details".
  const printed = new Set(
    [v.title, ...(v.subtitle ? v.subtitle.split(" · ") : [])].map((t) => t.trim()),
  );
  const repeats = ([, val]: (typeof v.facts)[number]) =>
    typeof val === "string" && printed.has(val.trim());
  // Same value under another key (State / States / Location) is printed once; counters of empty lists and
  // record ids add nothing to the identity box and move to the technical details.
  const seenVals = new Set<string>();
  const dupe = ([, val]: (typeof v.facts)[number]) => {
    if (typeof val !== "string") return false;
    const k = val.trim().toLowerCase();
    if (seenVals.has(k)) return true;
    seenVals.add(k);
    return false;
  };
  const isNoise = ([k, val]: (typeof v.facts)[number]) =>
    /\bcount$/i.test(k) && String(val) === "0";
  const isId = ([k]: (typeof v.facts)[number]) => isSourceIdKey(k) || isStorageMetaKey(k);
  const moved = v.facts.filter((f) => isNoise(f) || isId(f));
  const facts = v.facts.filter((f) => !isNoise(f) && !isId(f) && !dupe(f));
  const custom = header ? header(data.raw, v) : null;
  const key = header ? [] : facts.slice(0, 8).filter((f) => !repeats(f));
  // A caller's lead replaces the photo; the facts box is drawn only when it has something to hold.
  const leadNode = lead && !header ? lead(data.raw, v) : null;
  const hasLead = leadNode !== null && leadNode !== undefined && leadNode !== false;
  const photo = !lead && v.photo ? v.photo : null;
  const rest = header ? facts : [...facts.slice(0, 8).filter(repeats), ...facts.slice(8)];
  const technical = [...moved, ...v.technical];
  // Source identifiers stay in the technical details, not the header line.
  const subtitle = subtitleWithoutIds(v.subtitle);
  const nav = [
    ...(docket
      ? [
          { key: "cases", label: "Cases" },
          { key: "docket", label: "Docket documents" },
        ]
      : []),
    ...v.sections.map((s) => ({ key: s.key, label: plainMediaLabel(s.label) })),
  ];
  return (
    <AppShell
      breadcrumbs={[...crumbs, { label: v.title }]}
      title={v.title}
      {...(subtitle ? { description: subtitle } : {})}
    >
      {v.qualification ? (
        <div className="mb-3 flex items-center text-xs text-muted-foreground">
          <InfoPopover
            label="About this record"
            showLabel
            align="start"
            contentClassName="max-w-md"
          >
            <p className="whitespace-pre-wrap">{v.qualification}</p>
          </InfoPopover>
        </div>
      ) : null}
      {custom}
      {!header && (key.length || hasLead || photo) ? (
        <div className="mb-5 flex flex-col gap-4 rounded-xl border border-border bg-card shadow-xs p-4 shadow-card sm:flex-row">
          {hasLead ? leadNode : null}
          {photo ? (
            <Img
              src={photo}
              className="h-36 w-28 shrink-0 rounded-md border border-border object-cover"
            />
          ) : null}
          {key.length ? (
            <dl className="grid flex-1 content-start grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2">
              {key.map(([k, val], i) => {
                // Provider names and provenance notes move into tooltips; the recorded value is unchanged.
                const name = splitProviderKey(k);
                const shown = typeof val === "string" ? splitProviderValue(val) : null;
                return (
                  <div key={i} className="min-w-0">
                    <dt
                      className="text-[11px] text-muted-foreground"
                      title={name.note ?? undefined}
                    >
                      {name.text}
                    </dt>
                    <dd className="break-words" title={shown?.note ?? undefined}>
                      {displayValue(shown ? shown.text : val)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </div>
      ) : null}
      {visibleLinks.length || queryGroups.length ? (
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1">
          {visibleLinks.map((l) => {
            const { text, note } = splitProvenanceLabel(l.label);
            return note ? (
              <span key={l.url} title={note}>
                <CorpusLink url={l.url} label={text} aliases={aliases} />
              </span>
            ) : (
              <CorpusLink key={l.url} url={l.url} label={l.label} aliases={aliases} />
            );
          })}
          {queryGroups.map((g) => (
            <span key={g.outcome} className="text-[12px] text-muted-foreground" title={g.title}>
              {g.heading}:{" "}
              {g.links.map((l, i) => (
                <Fragment key={l.url}>
                  {i ? ", " : null}
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    title={l.url}
                    className="underline-offset-2 hover:underline"
                  >
                    {g.links.length > 1 ? `query ${i + 1} (${g.suffix})` : `query (${g.suffix})`}
                  </a>
                </Fragment>
              ))}
            </span>
          ))}
        </div>
      ) : null}
      {withheldLinks > 0 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          {withheldLinks} conflicting homepage link withheld; the recorded court system does not
          match the destination. Original data is unchanged.
        </p>
      ) : null}
      {extra ? extra(data.raw) : null}
      {extra && (rest.length || docket || v.sections.length || v.text) ? (
        <h2 id="entity-record" className="mt-10 mb-3 scroll-mt-16 text-heading text-foreground">
          Record details
        </h2>
      ) : null}
      {nav.length > 1 && !extra ? (
        <nav
          aria-label={extra ? "Record details" : "On this page"}
          className={
            extra
              ? "-mx-1 mb-4 flex flex-wrap gap-1 px-1"
              : "sticky top-0 z-10 -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-border bg-background px-1 py-2"
          }
        >
          {nav.map((n) => (
            <a
              key={n.key}
              href={`#${n.key}`}
              className={cn(
                "rounded px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground",
                extra ? "max-w-full truncate" : "whitespace-nowrap",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="space-y-6">
        {rest.length ? (
          <Section id="more" label="More details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
              {rest.map(([k, val], i) => (
                <div key={i}>
                  <dt className="text-[11px] text-muted-foreground">{k}</dt>
                  <dd className="break-words">{displayValue(val)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}
        {docket ? (
          <Section id="cases" label="Tracked cases">
            <CaseCatalog
              scope={
                docket.kind === "mdl"
                  ? { mdl: docket.id.replace(/^mdl:/i, "").replace(/^0+/, "") }
                  : { court: docket.id }
              }
            />
          </Section>
        ) : null}
        {docket ? (
          <Section
            id="docket"
            label={docket.kind === "mdl" ? "Docket documents" : "MDL documents filed here"}
          >
            <DocketDocuments kind={docket.kind} id={docket.id} />
          </Section>
        ) : null}
        {v.sections.map((s) => (
          <SectionView key={s.key} s={s} aliases={aliases} />
        ))}
        {v.text ? <FullText text={v.text} /> : null}
      </div>
      {technical.length || v.provenanceJson || v.empty.length ? (
        <details className="mt-8 border-t border-border pt-3 text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">
            Technical details and provenance
          </summary>
          {v.empty.length ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Not recorded for this entry: {v.empty.join(", ")}.
            </p>
          ) : null}
          {technical.length ? (
            <dl className="mt-2 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-3 gap-y-1">
              {technical.map(([k, val], i) => (
                <div key={i} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{displayValue(val)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {v.provenanceJson ? (
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 text-[11px]">
              {v.provenanceJson}
            </pre>
          ) : null}
        </details>
      ) : null}
    </AppShell>
  );
}

function Section({
  id,
  label,
  children,
  right,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-14">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{label}</h2>
        {right}
      </div>
      <div className="rounded-xl border border-border bg-card shadow-xs p-3 shadow-card">
        {children}
      </div>
    </section>
  );
}

function SectionView({ s, aliases }: { s: EntitySection; aliases: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const routes = useAppRoutes();
  if (s.kind === "facts")
    return (
      <Section id={s.key} label={s.label}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {s.facts.map(([k, v], i) => (
            <div key={i}>
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className="break-words">{displayValue(v)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    );
  if (s.kind === "list")
    return (
      <Section id={s.key} label={s.label}>
        <ul className="list-disc space-y-1 pl-5 text-[13px]">
          {s.items.map((t, i) => (
            <li key={i} className="break-words">
              {t}
            </li>
          ))}
        </ul>
      </Section>
    );
  if (s.kind === "items")
    return (
      <Section id={s.key} label={`${plainMediaLabel(s.label)} (${s.items.length})`}>
        <ul className="divide-y divide-border text-[13px]">
          {s.items.slice(0, all ? undefined : 25).map((it, i) => (
            <li key={i} className="py-1.5">
              <div className="break-words font-medium">{it.title}</div>
              {it.subtitle ? (
                <div className="break-words text-[11px] text-muted-foreground">{it.subtitle}</div>
              ) : null}
              {it.links.length ? (
                <div className="flex flex-wrap gap-x-3">
                  {it.links.map((l) => (
                    <CorpusLink
                      key={l.url}
                      url={l.url}
                      label={plainMediaLabel(l.label)}
                      aliases={aliases}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {s.items.length > 25 && !all ? (
          <button className="mt-2 text-[12px] text-primary" onClick={() => setAll(true)}>
            Show all {s.items.length}
          </button>
        ) : null}
      </Section>
    );
  if (s.kind === "table")
    return (
      <Section id={s.key} label={`${s.label} (${s.rows.length.toLocaleString()})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            {s.columns.some(Boolean) ? (
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {s.columns.map((c, i) => (
                    <th key={i} className="px-2 py-1">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody className="divide-y divide-border">
              {s.rows.slice(0, all ? undefined : 25).map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="max-w-[22rem] px-2 py-1 align-top">
                      {j === 0 && s.links[i] ? (
                        <CorpusLink url={s.links[i]!} label={c} aliases={aliases} />
                      ) : (
                        <span className="break-words">{c}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.rows.length > 25 && !all ? (
          <button className="mt-2 text-[12px] text-primary" onClick={() => setAll(true)}>
            Show all {s.rows.length.toLocaleString()}
          </button>
        ) : null}
      </Section>
    );
  const r = s.link ? resolveLink(s.link, aliases, routes) : null;
  const embed = r?.kind === "dataset" ? r : null;
  return (
    <Section
      id={s.key}
      label={`${s.label}${s.total != null ? ` (${s.total.toLocaleString()})` : ""}`}
      right={
        s.link && !embed ? <CorpusLink url={s.link} label="See all" aliases={aliases} /> : null
      }
    >
      {embed ? (
        <DatasetBrowser
          key={s.link!}
          dataset={embed.dataset}
          initialQ={embed.q}
          initialFilters={embed.filters}
          compact
        />
      ) : (
        <ul className="divide-y divide-border text-[13px]">
          {s.sample.map((it, i) => (
            <li key={i} className="py-1.5">
              {it.link ? (
                <CorpusLink url={it.link} label={it.title} aliases={aliases} />
              ) : (
                <span className="break-words font-medium">{it.title}</span>
              )}
              {it.subtitle ? (
                <span className="ml-2 break-words text-[11px] text-muted-foreground">
                  {it.subtitle}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Clean scraped text into readable paragraphs; collapsed by default. */
function FullText({ text }: { text: string }) {
  const paras = text
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1)
    .filter((p, i, a) => a.indexOf(p) === i);
  if (!paras.length) return null;
  return (
    <details className="rounded-xl border border-border bg-card shadow-xs p-3 shadow-card">
      <summary className="cursor-pointer text-[13px] font-medium">
        Full text{" "}
        <span className="text-[11px] font-normal text-muted-foreground">
          ({paras.length} paragraphs)
        </span>
      </summary>
      <div className="mt-3 max-h-[32rem] max-w-3xl space-y-3 overflow-auto text-[13px] leading-relaxed">
        {paras.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </details>
  );
}

function Img({ src, className }: { src: string; className: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <img
      src={src.startsWith("/") ? fileUrl(src) : src}
      alt=""
      className={className}
      onError={() => setBad(true)}
    />
  );
}

export function EntityError({ error }: { error: Error }) {
  return (
    <p role="alert" className="p-6 text-[13px] text-destructive">
      Could not load this record: {error.message}
    </p>
  );
}
