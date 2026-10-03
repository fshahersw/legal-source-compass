import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  EmptyState,
  FilterField,
  LinkOut,
  Loading,
  Panel,
  RangePager,
  Scope,
  SegmentedControl,
  selectClass,
} from "@/components/matters/common";
import { RegistryTimeline } from "@/components/matters/RegistryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ENTRY_SOURCE_NOTES,
  entryTypeLabel,
  groupEntriesByMonth,
  type DocketEntry,
} from "@/lib/matters/entries";
import { getMatterEntries, getMatterEntryText } from "@/lib/matters/matters.functions";
import type { MatterOverviewPayload } from "@/lib/matters/types";

function EntryText({ id }: { id: string }) {
  const fn = useServerFn(getMatterEntryText);
  const q = useQuery({
    queryKey: ["matter-entry-text", id],
    queryFn: () => fn({ data: { id } }),
    staleTime: 30 * 60_000,
  });
  if (q.isLoading) return <p className="text-[12px] text-muted-foreground">Loading docket text…</p>;
  if (q.error) return <ExternalError error={q.error} />;
  if (!q.data?.text)
    return (
      <p className="text-[12px] text-muted-foreground">No docket text recorded for this entry.</p>
    );
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Docket text (verbatim from the source)
      </p>
      <p className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2.5 text-[12px] leading-relaxed">
        {q.data.text}
      </p>
    </div>
  );
}

function EntryRow({ entry, mdl }: { entry: DocketEntry; mdl: string }) {
  const [open, setOpen] = useState(false);
  const sampleId = entry.source === "activity" ? entry.id.replace(/^activity:/, "") : null;
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <div className="text-right">
        <div className="font-mono text-[13px] font-semibold tabular-nums">
          {entry.entryNumber !== null ? `#${entry.entryNumber}` : "—"}
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {entry.date ?? "Date not recorded"}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {entry.dateBasis === "entered" ? "entered" : "filed"}
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.entryType ? <Chip tone="primary">{entry.entryType}</Chip> : null}
          {entry.documentCount !== null ? (
            <Chip
              tone={entry.documentCount > 0 ? "success" : "neutral"}
              title="Documents the source itself lists for this entry; not a count of what the corpus holds."
            >
              {entry.documentCount} {entry.documentCount === 1 ? "document" : "documents"} listed by
              the source
            </Chip>
          ) : null}
        </div>
        {entry.description ? (
          <p className={`text-[13px] leading-snug ${open ? "" : "line-clamp-3"}`}>
            {entry.description}
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No docket text projected for this entry.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {sampleId ? (
            <button
              type="button"
              aria-expanded={open}
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide docket text" : "Show docket text"}
            </button>
          ) : null}
          {entry.entryNumber !== null ? (
            <Link
              to="/matters/$id"
              params={{ id: mdl }}
              search={{ tab: "documents", entry: entry.entryNumber }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Documents for entry {entry.entryNumber}
            </Link>
          ) : null}
          {entry.sourceUrl ? <LinkOut href={entry.sourceUrl}>CourtListener docket</LinkOut> : null}
        </div>
        {open && sampleId ? <EntryText id={sampleId} /> : null}
      </div>
    </li>
  );
}

/** The saved docket sample and CourtListener's entry list: the sources used for a matter the registry has no entries for. */
function SampleDocket({ payload }: { payload: MatterOverviewPayload }) {
  const mdl = payload.overview.mdl;
  const fn = useServerFn(getMatterEntries);
  const [source, setSource] = useState<"auto" | "activity" | "cl_entries">("auto");
  const [type, setType] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ((prev) => (prev === draft.trim() ? prev : draft.trim()));
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const query = useQuery({
    queryKey: ["matter-entries", mdl, source, type, q, offset],
    queryFn: () => fn({ data: { id: mdl, source, type: type || null, q, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
  const data = query.data;
  const groups = useMemo(() => groupEntriesByMonth(data?.entries ?? []), [data?.entries]);
  const typeOptions = useMemo(
    () =>
      Object.entries(payload.overview.activity?.byEntryType ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [payload.overview.activity],
  );
  const both = !!data?.available.activity && !!data?.available.clEntries;
  const active = data?.source;
  const note = active ? ENTRY_SOURCE_NOTES[active] : null;
  const newer =
    both &&
    data!.coverage.clLast &&
    data!.coverage.activityLast &&
    data!.coverage.clLast > data!.coverage.activityLast;

  if (query.isLoading) return <Loading what="docket entries" />;
  if (query.error) return <ExternalError error={query.error} />;
  if (!data || (!data.available.activity && !data.available.clEntries)) {
    const captures = (payload.registry?.entries ?? []).filter(
      (e) => e.captured !== null && e.captured > 0,
    );
    return (
      <Panel id="docket" title="Docket entries">
        <EmptyState>
          <span className="font-medium text-foreground">Not yet available.</span> The docket entries
          for this matter are not released in the connected corpus yet. The master docket
          {payload.overview.masterDocket.number
            ? ` ${payload.overview.masterDocket.number}`
            : ""}{" "}
          is listed in the header, and the Documents tab shows any verified PDFs filed on it.
        </EmptyState>
        {captures.length ? (
          <div className="mt-3">
            <Scope title="Captured, not released">
              {captures.map((e, i) => (
                <span key={`${e.provider}-${e.docketKey ?? i}`} className="block">
                  The matter registry captured {e.captured!.toLocaleString()}
                  {e.providerTotal !== null
                    ? ` of ${e.providerTotal.toLocaleString()} reported`
                    : ""}{" "}
                  entries from {e.provider === "courtlistener" ? "CourtListener" : e.provider}
                  {e.complete === true ? " (complete at capture)" : ""}
                  {e.observedAt ? ` on ${e.observedAt.slice(0, 10)}` : ""}. None of them is
                  published yet, so the timeline cannot be shown.
                </span>
              ))}
            </Scope>
          </div>
        ) : null}
      </Panel>
    );
  }

  return (
    <Panel
      id="docket"
      title="Docket entries"
      note={note?.title}
      aside={
        both ? (
          <SegmentedControl
            label="Docket entry source"
            value={active ?? "activity"}
            onChange={(s) => {
              setSource(s);
              setOffset(0);
              if (s === "cl_entries") {
                setType("");
                setDraft("");
                setQ("");
              }
            }}
            options={[
              {
                value: "activity",
                label: "With docket text",
                hint: `${data.available.activity?.toLocaleString()} entries from the saved sample`,
              },
              {
                value: "cl_entries",
                label: "Complete list",
                hint: `${data.available.clEntries?.toLocaleString()} entries, numbers and dates only`,
              },
            ]}
          />
        ) : null
      }
    >
      <div className="space-y-3">
        {note ? <Scope>{note.scope}</Scope> : null}
        {data.coverage.activityLast && active === "activity" ? (
          <p className="text-[12px] text-muted-foreground">
            Sample coverage ends {data.coverage.activityLast}.
            {newer ? (
              <>
                {" "}
                CourtListener lists entries through{" "}
                <span className="font-medium text-foreground">{data.coverage.clLast}</span>;{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setSource("cl_entries");
                    setOffset(0);
                  }}
                >
                  show the complete list
                </button>
                .
              </>
            ) : null}
          </p>
        ) : null}
        {active === "activity" ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <FilterField label="Search docket text">
              <Input
                aria-label="Search docket text"
                className="h-8 text-[12px]"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setOffset(0);
                }}
                placeholder="e.g. bellwether, Daubert, case management"
              />
            </FilterField>
            <FilterField label="Entry type">
              <select
                className={selectClass}
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All types</option>
                {typeOptions.map(([key, n]) => (
                  <option key={key} value={key}>
                    {entryTypeLabel(key)} ({n.toLocaleString()})
                  </option>
                ))}
              </select>
            </FilterField>
          </div>
        ) : null}
        {(type || q) && active === "activity" ? (
          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            <span className="font-medium text-foreground tabular-nums">
              {(data.total ?? 0).toLocaleString()}
              {data.capped ? "+" : ""}
            </span>{" "}
            entries match.{" "}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                setType("");
                setDraft("");
                setQ("");
                setOffset(0);
              }}
            >
              Clear
            </Button>
          </p>
        ) : null}
        {data.entries.length ? (
          <div className={query.isFetching ? "opacity-70 transition-opacity" : ""}>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky top-0 z-[1] -mx-1 border-b border-border bg-surface/95 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {g.label}{" "}
                  <span className="font-normal normal-case">· {g.entries.length} on this page</span>
                </h3>
                <ol>
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} mdl={mdl} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState>No entry matches these filters.</EmptyState>
        )}
        <RangePager
          offset={data.offset}
          pageSize={data.pageSize}
          shown={data.entries.length}
          total={data.total}
          capped={data.capped}
          onOffset={setOffset}
        />
      </div>
    </Panel>
  );
}

/**
 * The docket tab. A matter with entries in the matter registry shows the registry timeline (docket text as published,
 * server-side filters, documents from the archive); any other matter keeps the sources it had before.
 */
export function DocketPanel({ payload }: { payload: MatterOverviewPayload }) {
  const published = payload.registry?.record?.entriesPublished ?? null;
  // The dataset is released and the matter has rows (or the count is not filled in yet): try the registry timeline.
  if (payload.registryReleased.entries && published !== 0)
    return <RegistryTimeline payload={payload} fallback={<SampleDocket payload={payload} />} />;
  return <SampleDocket payload={payload} />;
}
