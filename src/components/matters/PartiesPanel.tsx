import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  DataTable,
  EmptyState,
  FilterField,
  LinkOut,
  Loading,
  NotRecorded,
  Panel,
  RangePager,
  Scope,
  SegmentedControl,
  StatTile,
  selectClass,
  td,
  th,
} from "@/components/matters/common";
import { Input } from "@/components/ui/input";
import { getMatterParties } from "@/lib/matters/matters.functions";
import {
  appearanceFacets,
  mentionsSeegerWeiss,
  splitParties,
  type AppearanceRow,
  type PartyKind,
} from "@/lib/matters/parties";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const KIND_LABELS: Record<PartyKind, string> = {
  firm: "Firms",
  attorney: "Attorneys",
  party: "Parties",
};

function Appearances({ rows }: { rows: AppearanceRow[] }) {
  const [side, setSide] = useState("");
  const [firm, setFirm] = useState("");
  const [text, setText] = useState("");
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!side || r.side === side) &&
        (!firm || (r.firmId ?? r.firm) === firm) &&
        (!q || `${r.attorney} ${r.firm ?? ""} ${r.role ?? ""}`.toLowerCase().includes(q)),
    );
  }, [rows, side, firm, text]);
  const facets = useMemo(() => appearanceFacets(rows), [rows]);
  const [offset, setOffset] = useState(0);
  const page = filtered.slice(offset, offset + 50);
  if (!rows.length) return null;
  return (
    <Panel
      id="appearances"
      title="Appearances by tracked firms in the saved dockets"
      note="Each row is one attorney appearance on one saved docket. The same attorney appears once per docket; rows are never merged, and the docket id below tells them apart."
      aside={<Chip>{rows.length.toLocaleString()} appearances</Chip>}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <FilterField label="Search">
            <Input
              aria-label="Search appearances"
              className="h-8 text-[12px]"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOffset(0);
              }}
              placeholder="Attorney, firm or role"
            />
          </FilterField>
          <FilterField label="Firm (as tracked)">
            <select
              className={selectClass}
              value={firm}
              onChange={(e) => {
                setFirm(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All firms</option>
              {facets.firm.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.count.toLocaleString()})
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Side">
            <select
              className={selectClass}
              value={side}
              onChange={(e) => {
                setSide(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Both sides</option>
              {facets.side.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} ({s.count.toLocaleString()})
                </option>
              ))}
            </select>
          </FilterField>
        </div>
        <DataTable caption="Attorney appearances recorded for tracked firms">
          <thead>
            <tr>
              <th className={th} scope="col">
                Attorney (as recorded)
              </th>
              <th className={th} scope="col">
                Firm
              </th>
              <th className={th} scope="col">
                Role
              </th>
              <th className={th} scope="col">
                Side
              </th>
              <th className={th} scope="col">
                Docket id (source)
              </th>
              <th className={th} scope="col">
                Linkage to MDL
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className={`${td} font-medium`}>{r.attorney}</td>
                <td className={td}>{r.firm ?? <NotRecorded />}</td>
                <td className={td}>{r.role ?? <NotRecorded />}</td>
                <td className={`${td} capitalize`}>{r.side ?? <NotRecorded />}</td>
                <td className={`${td} font-mono text-[11px]`} title={r.matterId ?? undefined}>
                  {r.matterId ? r.matterId.slice(0, 8) : <NotRecorded />}
                </td>
                <td className={td}>{r.linkage ?? <NotRecorded />}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {filtered.length > 50 ? (
          <RangePager
            offset={offset}
            pageSize={50}
            shown={page.length}
            total={filtered.length}
            onOffset={setOffset}
          />
        ) : null}
      </div>
    </Panel>
  );
}

export function PartiesPanel({ payload }: { payload: MatterOverviewPayload }) {
  const mdl = payload.overview.mdl;
  const fn = useServerFn(getMatterParties);
  const [kind, setKind] = useState<PartyKind>("firm");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const query = useQuery({
    queryKey: ["matter-parties", mdl, kind, q, offset],
    queryFn: () => fn({ data: { id: mdl, kind, q, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const counsel = query.data?.counsel;
  const appearances = query.data?.appearances;
  const summary = payload.overview.counsel;
  const swRows = (appearances?.rows ?? []).filter((r) => r.firmId === "seeger_weiss");
  const split = useMemo(
    () => (counsel && kind === "party" ? splitParties(counsel.rows) : null),
    [counsel, kind],
  );
  const rows = split ? split.listed : (counsel?.rows ?? []);
  const none =
    counsel &&
    counsel.totals.firm === 0 &&
    counsel.totals.attorney === 0 &&
    counsel.totals.party === 0;

  return (
    <div className="space-y-4">
      <Panel
        id="parties"
        title="Parties and counsel"
        note="Names exactly as the sources recorded them. Spellings are never merged, and an individual's name on the plaintiff side is counted rather than listed."
      >
        {query.isLoading ? <Loading what="counsel" /> : null}
        {query.error ? <ExternalError error={query.error} /> : null}
        {counsel ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Firm records in the corpus"
                value={
                  counsel.totals.firm === null
                    ? "Not recorded"
                    : counsel.totals.firm.toLocaleString()
                }
                note="Firm text as recorded on the master docket; spellings not merged"
              />
              <StatTile
                label="Attorney records in the corpus"
                value={
                  counsel.totals.attorney === null
                    ? "Not recorded"
                    : counsel.totals.attorney.toLocaleString()
                }
                note="Own identifiers, never merged by name"
              />
              <StatTile
                label="Party records in the corpus"
                value={
                  counsel.totals.party === null
                    ? "Not recorded"
                    : counsel.totals.party.toLocaleString()
                }
                note="As recorded on the master docket"
              />
              <StatTile
                label="Seeger Weiss in saved dockets"
                value={appearances?.published ? swRows.length.toLocaleString() : "Not recorded"}
                note={
                  appearances?.published
                    ? swRows.length
                      ? "Attorney appearances for the tracked firm"
                      : "No appearance recorded in the saved sample; not proof of absence"
                    : "Appearance data is not published"
                }
              />
            </div>
            {summary ? (
              <Scope title="Saved-docket counsel directory">
                {summary.totalFirms !== null
                  ? `${summary.totalFirms.toLocaleString()} firms`
                  : "Firms not counted"}
                {summary.totalAttorneys !== null
                  ? ` and ${summary.totalAttorneys.toLocaleString()} attorneys`
                  : ""}{" "}
                seen in the saved firm-focused docket sample.
                {Object.keys(summary.bySide).length
                  ? ` The source's own tally by side: ${Object.entries(summary.bySide)
                      .map(([k, n]) => `${k} ${n.toLocaleString()}`)
                      .join(", ")}.`
                  : ""}{" "}
                {summary.qualification ? summary.qualification.split(";")[0] + "." : ""}
              </Scope>
            ) : null}
            {summary?.leadershipOrders.length ? (
              <div className="text-[12px]">
                <span className="font-medium text-muted-foreground">
                  Leadership-related entries:{" "}
                </span>
                {summary.leadershipOrders.slice(0, 6).map((o, i) => (
                  <span key={`${o.url}-${i}`} className="mr-3 inline-block">
                    <LinkOut href={o.url}>
                      {o.title ?? "Order"}
                      {o.date ? ` · ${o.date}` : ""}
                    </LinkOut>
                  </span>
                ))}
              </div>
            ) : null}
            {none ? (
              <EmptyState>
                No counsel or party records are in the connected corpus for this MDL’s master
                docket. This is a coverage gap, not evidence that none exist.
              </EmptyState>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <SegmentedControl
                    label="Record kind"
                    value={kind}
                    onChange={(k) => {
                      setKind(k);
                      setOffset(0);
                    }}
                    options={(["firm", "attorney", "party"] as PartyKind[]).map((k) => ({
                      value: k,
                      label: `${KIND_LABELS[k]} (${(counsel.totals[k] ?? 0).toLocaleString()})`,
                    }))}
                  />
                  <FilterField label={`Search ${KIND_LABELS[kind].toLowerCase()}`}>
                    <Input
                      aria-label={`Search ${KIND_LABELS[kind].toLowerCase()}`}
                      className="h-8 w-64 text-[12px]"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setOffset(0);
                      }}
                      placeholder="Name or firm"
                    />
                  </FilterField>
                </div>
                {rows.length ? (
                  <DataTable caption={`${KIND_LABELS[kind]} recorded for the master docket`}>
                    <thead>
                      <tr>
                        <th className={th} scope="col">
                          Name (as recorded)
                        </th>
                        <th className={th} scope="col">
                          {kind === "attorney" ? "Firm line" : "Detail"}
                        </th>
                        <th className={th} scope="col">
                          Role
                        </th>
                        <th className={th} scope="col">
                          Linked records
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/40">
                          <td className={`${td} font-medium`}>
                            {r.name}
                            {mentionsSeegerWeiss(r.name) || mentionsSeegerWeiss(r.detail) ? (
                              <Chip tone="primary">Seeger Weiss</Chip>
                            ) : null}
                          </td>
                          <td className={`${td} text-muted-foreground`}>
                            {r.detail ?? <NotRecorded />}
                          </td>
                          <td className={td}>{r.role ?? <NotRecorded />}</td>
                          <td className={td}>{r.countText ?? <NotRecorded />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                ) : (
                  <EmptyState>
                    {q
                      ? "No record matches this search."
                      : `No ${KIND_LABELS[kind].toLowerCase()} recorded.`}
                  </EmptyState>
                )}
                {split && split.counted ? (
                  <p className="text-[12px] text-muted-foreground">
                    {split.counted.toLocaleString()} party{" "}
                    {split.counted === 1
                      ? "record on this page names"
                      : "records on this page name"}{" "}
                    an individual and {split.counted === 1 ? "is" : "are"} counted, not listed.
                  </p>
                ) : null}
                <RangePager
                  offset={counsel.offset}
                  pageSize={counsel.pageSize}
                  shown={counsel.rows.length}
                  total={counsel.total}
                  capped={counsel.capped}
                  onOffset={setOffset}
                />
              </>
            )}
          </div>
        ) : null}
      </Panel>
      {appearances ? <Appearances rows={appearances.rows} /> : null}
    </div>
  );
}
