import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  EmptyState,
  FilterField,
  Loading,
  NotRecorded,
  Panel,
  RangePager,
  Scope,
  SegmentedControl,
  StatTile,
  selectClass,
} from "@/components/matters/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getMatterPartiesSummary,
  getMatterRegistryCounsel,
  getMatterRegistryParties,
} from "@/lib/matters/matters.functions";
import { SEEGER_WEISS_FIRM, type PartyView } from "@/lib/matters/registryParties";
import type {
  FirmListItem,
  MatterOverviewPayload,
  RegistryPartiesSummary,
} from "@/lib/matters/types";

type View = "parties" | "counsel";

function PartyRow({ p }: { p: PartyView }) {
  const more = (p.counselCount ?? 0) - p.counselPreview.length;
  return (
    <li className="grid gap-x-4 gap-y-1 border-t border-border px-3 py-2 first:border-t-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="break-words text-[13px] font-medium">
          {p.name ?? <span className="font-normal text-muted-foreground">Name withheld</span>}
          {p.dateTerminated ? (
            <span className="ml-2 align-middle">
              <Chip title="Date the court record shows the party terminated">
                Terminated {p.dateTerminated}
              </Chip>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {p.types.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
        {p.note ? (
          <div className="mt-0.5 break-words text-[11px] text-muted-foreground">{p.note}</div>
        ) : null}
      </div>
      <div className="min-w-0 text-[12px]">
        {p.counselPreview.length ? (
          <ul className="space-y-0.5">
            {p.counselPreview.map((c, i) => (
              <li key={i} className="break-words">
                {c.name ?? (
                  <span className="text-muted-foreground">Attorney record not collected</span>
                )}
                {c.firm ? <span className="text-muted-foreground"> · {c.firm}</span> : null}
                {c.lead ? (
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground">lead</span>
                ) : null}
              </li>
            ))}
            {more > 0 ? (
              <li className="text-muted-foreground">
                +{more.toLocaleString()} more counsel (see Counsel by firm)
              </li>
            ) : null}
          </ul>
        ) : (
          <span className="text-muted-foreground">
            {p.counselCount === 0 || p.counselCount === null
              ? "No counsel recorded"
              : "Counsel not collected yet"}
          </span>
        )}
      </div>
    </li>
  );
}

function PartiesView({ mdl, types }: { mdl: string; types: { value: string; count: number }[] }) {
  const fn = useServerFn(getMatterRegistryParties);
  const [type, setType] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = draft.trim();
      setQ((prev) => (prev === text ? prev : text));
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const query = useQuery({
    queryKey: ["matter-registry-parties", mdl, type, q, offset],
    queryFn: () => fn({ data: { id: mdl, type, q, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  const filtered = !!type || !!q;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <FilterField label="Party type">
          <select
            className={selectClass}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} ({t.count.toLocaleString()})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Search parties">
          <Input
            aria-label="Search parties"
            className="h-8 w-72 max-w-full text-[12px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Party, court note, attorney or firm"
          />
        </FilterField>
        {filtered || draft ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              setType("");
              setDraft("");
              setQ("");
              setOffset(0);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {query.isLoading ? <Loading what="parties" /> : null}
      {query.error ? <ExternalError error={query.error} /> : null}
      {data ? (
        <div className={query.isFetching ? "opacity-70 transition-opacity" : ""}>
          {data.groups ? (
            <div className="space-y-4">
              {data.groups.map((g) => (
                <section key={g.type} aria-label={`${g.type} parties`}>
                  <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.type}
                    <span className="font-normal normal-case tabular-nums">
                      {g.count.toLocaleString()} {g.count === 1 ? "party" : "parties"}
                    </span>
                  </h3>
                  <ul className="rounded-md border border-border">
                    {g.rows.map((p) => (
                      <PartyRow key={p.id} p={p} />
                    ))}
                  </ul>
                  {g.count > g.rows.length ? (
                    <button
                      type="button"
                      className="mt-1 text-[12px] text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setType(g.type);
                        setOffset(0);
                      }}
                    >
                      Show all {g.count.toLocaleString()} {g.type} parties
                    </button>
                  ) : null}
                </section>
              ))}
            </div>
          ) : data.rows.length ? (
            <ul className="rounded-md border border-border">
              {data.rows.map((p) => (
                <PartyRow key={p.id} p={p} />
              ))}
            </ul>
          ) : (
            <EmptyState>No party matches this search.</EmptyState>
          )}
          {!data.groups ? (
            <RangePager
              offset={data.offset}
              pageSize={data.pageSize}
              shown={data.rows.length}
              total={data.total}
              onOffset={setOffset}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FirmCard({ g }: { g: FirmListItem }) {
  return (
    <details
      open={g.seegerWeiss}
      className={`rounded-md border ${g.seegerWeiss ? "border-primary/40 bg-primary/5" : "border-border"}`}
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
        <span className="font-medium">{g.firm ?? "Firm line not recorded"}</span>
        {g.seegerWeiss ? (
          <Chip
            tone="primary"
            title="The printed firm line is “Seeger Weiss LLP” (capitalisation, spacing and commas aside)."
          >
            Seeger Weiss
          </Chip>
        ) : null}
        <span className="text-[12px] text-muted-foreground">
          {g.attorneyCount.toLocaleString()} {g.attorneyCount === 1 ? "attorney" : "attorneys"} ·{" "}
          {g.parties.toLocaleString()} {g.parties === 1 ? "party" : "parties"}
        </span>
      </summary>
      <ul className="divide-y divide-border border-t border-border text-[12px]">
        {g.attorneys.map((a) => (
          <li
            key={a.key}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5"
          >
            <span className="min-w-0">
              <span className="font-medium">{a.name}</span>
              {a.roles.length ? (
                <span className="ml-2 text-muted-foreground">{a.roles.join(" · ")}</span>
              ) : null}
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {a.terminated ? <Chip tone="warning">Terminated</Chip> : null}
              <span className="tabular-nums">
                {a.parties.toLocaleString()} {a.parties === 1 ? "party" : "parties"}
              </span>
            </span>
          </li>
        ))}
        {g.attorneyCount > g.attorneys.length ? (
          <li className="px-3 py-1.5 text-muted-foreground">
            {(g.attorneyCount - g.attorneys.length).toLocaleString()} more attorneys of this firm
            line are not listed.
          </li>
        ) : null}
      </ul>
    </details>
  );
}

function CounselView({ mdl }: { mdl: string }) {
  const fn = useServerFn(getMatterRegistryCounsel);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = draft.trim();
      setQ((prev) => (prev === text ? prev : text));
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const query = useQuery({
    queryKey: ["matter-registry-counsel", mdl, q, offset],
    queryFn: () => fn({ data: { id: mdl, q, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  return (
    <div className="space-y-3">
      <FilterField label="Search counsel">
        <Input
          aria-label="Search counsel"
          className="h-8 w-72 max-w-full text-[12px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Firm or attorney name"
        />
      </FilterField>
      {query.isLoading ? <Loading what="counsel" /> : null}
      {query.error ? <ExternalError error={query.error} /> : null}
      {data ? (
        <div className={`space-y-2 ${query.isFetching ? "opacity-70 transition-opacity" : ""}`}>
          {data.firms.length ? (
            data.firms.map((g) => <FirmCard key={g.firm ?? "none"} g={g} />)
          ) : (
            <EmptyState>No firm or attorney matches this search.</EmptyState>
          )}
          <RangePager
            offset={data.offset}
            pageSize={data.pageSize}
            shown={data.firms.length}
            total={data.total}
            onOffset={setOffset}
          />
        </div>
      ) : null}
    </div>
  );
}

function SeegerWeissCard({ summary }: { summary: RegistryPartiesSummary }) {
  const sw = summary.seegerWeiss;
  const shown = sw.attorneys.slice(0, 14);
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[12px]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[14px] font-semibold">{SEEGER_WEISS_FIRM}</span>
        {sw.attorneys.length ? (
          <span className="text-muted-foreground">
            {sw.attorneys.length.toLocaleString()}{" "}
            {sw.attorneys.length === 1 ? "attorney" : "attorneys"} on the master docket, appearing
            for {sw.parties.toLocaleString()} {sw.parties === 1 ? "party" : "parties"}
          </span>
        ) : null}
      </div>
      {sw.attorneys.length ? (
        <p className="mt-1.5 leading-relaxed">
          {shown.map((a, i) => (
            <span key={a.key}>
              {i ? "; " : ""}
              <span className="font-medium">{a.name}</span>
              {a.roles.length ? (
                <span className="text-muted-foreground"> ({a.roles.join(", ")})</span>
              ) : null}
            </span>
          ))}
          {sw.attorneys.length > shown.length
            ? `; and ${(sw.attorneys.length - shown.length).toLocaleString()} more (see Counsel by firm)`
            : ""}
          .
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">
          No attorney whose firm line is “{SEEGER_WEISS_FIRM}” (capitalisation, spacing and commas
          aside) appears among the {summary.counts.counselEntries.toLocaleString()} counsel entries
          collected for this docket so far. That is a statement about the collected records, not
          about the firm's role in the matter.
        </p>
      )}
      {sw.nearMisses.length ? (
        <p className="mt-1.5 text-muted-foreground">
          Not counted as the firm (the printed line differs):{" "}
          {sw.nearMisses.map((n) => `“${n.firm}” (${n.attorneys.toLocaleString()})`).join(", ")}.
          Firm lines are shown as the docket printed them and are never merged.
        </p>
      ) : null}
    </div>
  );
}

/** Parties and counsel of the master docket from the matter registry; names as published, counsel by name, firm and role. */
export function RegistryParties({ payload }: { payload: MatterOverviewPayload }) {
  const mdl = payload.overview.mdl;
  const released = !!payload.registryReleased.parties;
  const fn = useServerFn(getMatterPartiesSummary);
  const summary = useQuery({
    queryKey: ["matter-parties-summary", mdl],
    enabled: released,
    queryFn: () => fn({ data: { id: mdl } }),
    staleTime: 5 * 60_000,
  });
  const [view, setView] = useState<View>("parties");
  const captured = payload.registry?.parties ?? [];
  const note = (
    <Scope title="Not yet available">
      {captured.length
        ? `The matter registry captured ${captured
            .map(
              (p) =>
                `${p.captured !== null ? p.captured.toLocaleString() : "an unrecorded number of"} ${p.kind}`,
            )
            .join(
              " and ",
            )} from the master docket${captured.every((p) => p.complete === true) ? " (complete at capture)" : ""}, but none are published for this matter yet. `
        : "The matter registry has not collected the master docket's parties yet. "}
      The lists below come from the saved firm-focused sample only.
    </Scope>
  );
  if (!released) return <div>{note}</div>;
  if (summary.isLoading)
    return (
      <Panel id="registry-parties" title="Parties and counsel on the master docket">
        <Loading what="parties and counsel" />
      </Panel>
    );
  if (summary.error)
    return (
      <Panel id="registry-parties" title="Parties and counsel on the master docket">
        <ExternalError error={summary.error} />
      </Panel>
    );
  const s = summary.data;
  if (!s) return <div>{note}</div>;
  const c = s.counts;
  const record = payload.registry?.record ?? null;
  return (
    <Panel
      id="registry-parties"
      title="Parties and counsel on the master docket"
      note="From the matter registry's collection of the master docket's party list: party names as the court record prints them, and counsel by name, firm and role."
      aside={<Chip tone="primary">Matter registry</Chip>}
    >
      <div className="space-y-3">
        <Scope title="Scope">
          Collection is partial where the CourtListener request limit has not allowed a full read
          {record && record.partiesPublished !== null
            ? ` (${record.partiesPublished.toLocaleString()} parties published for this matter)`
            : ""}
          . Sealed counsel are left out
          {c.sealedOmitted ? ` (${c.sealedOmitted.toLocaleString()} omitted)` : ""}, no contact
          details are published, and names that mention sealing, restriction, in camera, ex parte or
          redaction are withheld
          {c.namesWithheld ? ` (${c.namesWithheld.toLocaleString()} here)` : ""}.
          {c.unresolved
            ? ` ${c.unresolved.toLocaleString()} counsel entries are not resolved to an attorney record yet.`
            : ""}
        </Scope>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Parties"
            value={c.parties.toLocaleString()}
            note={`${s.types
              .slice(0, 3)
              .map((t) => `${t.value} ${t.count.toLocaleString()}`)
              .join(" · ")} · a party with several printed types counts under each`}
          />
          <StatTile
            label="Attorneys"
            value={c.attorneys.toLocaleString()}
            note={`${c.counselEntries.toLocaleString()} counsel entries`}
          />
          <StatTile
            label="Firm lines"
            value={c.firms.toLocaleString()}
            note="As printed; spellings not merged"
          />
          <StatTile
            label="Seeger Weiss LLP"
            value={
              s.seegerWeiss.attorneys.length ? (
                s.seegerWeiss.attorneys.length.toLocaleString()
              ) : (
                <NotRecorded />
              )
            }
            note={
              s.seegerWeiss.attorneys.length
                ? `attorneys, for ${s.seegerWeiss.parties.toLocaleString()} parties`
                : "none in the collected records"
            }
          />
        </div>
        <SeegerWeissCard summary={s} />
        <SegmentedControl
          label="Party and counsel views"
          value={view}
          onChange={setView}
          options={[
            { value: "parties", label: `Parties (${c.parties.toLocaleString()})` },
            { value: "counsel", label: `Counsel by firm (${c.firms.toLocaleString()})` },
          ]}
        />
        {view === "parties" ? <PartiesView mdl={mdl} types={s.types} /> : <CounselView mdl={mdl} />}
      </div>
    </Panel>
  );
}
