import { BarList } from "@/components/corpus/BarList";
import {
  Chip,
  DataTable,
  LinkOut,
  NotRecorded,
  Panel,
  Scope,
  StatTile,
  td,
  th,
} from "@/components/matters/common";
import { evidenceKindLabel } from "@/lib/matters/cases";
import { entryTypeLabel } from "@/lib/matters/entries";
import { orNotRecorded } from "@/lib/matters/overview";
import { formatUtc } from "@/lib/matters/registry";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const PROVIDER_LABELS: Record<string, string> = {
  courtlistener: "CourtListener",
  docketbird: "DocketBird",
  jpml: "JPML",
  "official-court": "Court website",
};

/** Source-backed member relationships and the recorded coverage for this matter. */
function RegistryCard({ payload }: { payload: MatterOverviewPayload }) {
  const reg = payload.registry;
  if (!reg) return null;
  const byBasis = Object.entries(reg.members.byBasis).sort((a, b) => b[1] - a[1]);
  return (
    <Panel
      id="registry-coverage"
      title="Membership & coverage"
      note="Member-like dockets have recorded relationship evidence. This is a partial count, not the size of the MDL."
      aside={
        <>
          {reg.tier ? <Chip tone="primary">{reg.tier.replace(/^tier/, "Tier ")}</Chip> : null}
          {reg.projectedAt ? <span>Coverage as of {formatUtc(reg.projectedAt)}</span> : null}
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Member-like dockets"
            value={reg.members.rows !== null ? reg.members.rows.toLocaleString() : <NotRecorded />}
            note={
              reg.members.actions !== null
                ? `${reg.members.actions.toLocaleString()} counted as actions · not a census`
                : "Partial count, not a census"
            }
          />
          <div className="rounded-md border border-border bg-background p-3 sm:col-span-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Membership evidence
            </div>
            {byBasis.length ? (
              <ul className="mt-1 space-y-0.5 text-[12px]">
                {byBasis.map(([kind, n]) => (
                  <li key={kind} className="flex justify-between gap-2">
                    <span>{evidenceKindLabel(kind)}</span>
                    <span className="tabular-nums">{n.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">No members recorded</p>
            )}
          </div>
          {reg.entries.length ? (
            reg.entries.map((e) => (
              <StatTile
                key={`${e.provider}-${e.docketKey}`}
                label={`Docket entries · ${PROVIDER_LABELS[e.provider] ?? e.provider}`}
                value={e.captured !== null ? e.captured.toLocaleString() : <NotRecorded />}
                note={
                  e.providerTotal !== null
                    ? `of ${e.providerTotal.toLocaleString()} reported${e.complete ? " · complete at last check" : e.complete === false ? " · partial" : ""}`
                    : "Provider total not recorded"
                }
              />
            ))
          ) : (
            <StatTile label="Docket entries" value={<NotRecorded />} />
          )}
          {reg.parties.length ? (
            <StatTile
              label="Parties & counsel"
              value={reg.parties
                .map((p) => (p.captured !== null ? p.captured.toLocaleString() : "—"))
                .join(" / ")}
              note={`${reg.parties.map((p) => p.kind).join(" / ")} on the master docket${reg.parties.every((p) => p.complete) ? " · complete at last check" : ""}`}
            />
          ) : null}
        </div>
        {reg.docketbirdGraph.length || reg.gaps.length ? (
          <details className="rounded-md border border-border bg-background px-3 py-2 text-[12px]">
            <summary className="w-fit cursor-pointer font-medium">
              Source & coverage details
            </summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              {reg.docketbirdGraph.length ? (
                <p>
                  DocketBird index:{" "}
                  {reg.docketbirdGraph
                    .map((g) =>
                      g.returned !== null && g.totalMembers !== null
                        ? `${g.returned.toLocaleString()} of ${g.totalMembers.toLocaleString()} indexed members${g.truncated ? " (partial results)" : ""}`
                        : "coverage not recorded",
                    )
                    .join("; ")}
                  . This index supports relationships; it is not a full MDL count.
                </p>
              ) : null}
              {reg.gaps.length ? (
                <Scope title="Known limits">
                  {reg.gaps.map((g, i) => (
                    <span key={i} className="block">
                      {g}
                    </span>
                  ))}
                </Scope>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </Panel>
  );
}

const asRows = (m: Record<string, number>) =>
  Object.entries(m)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

export function OverviewPanel({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const cases = o.cases;
  const counsel = o.counsel;

  return (
    <div className="space-y-4">
      <RegistryCard payload={payload} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="JPML action counts" note="Each dated report counts actions in this MDL.">
          {o.actions.snapshots.length ? (
            <DataTable caption="JPML action counts by report date" narrow>
              <thead>
                <tr>
                  <th className={th} scope="col">
                    Report date
                  </th>
                  <th className={`${th} text-right`} scope="col">
                    Total actions
                  </th>
                  <th className={`${th} text-right`} scope="col">
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.actions.snapshots.map((s) => (
                  <tr key={s.asOf}>
                    <td className={`${td} font-mono`}>{s.asOf}</td>
                    <td className={`${td} text-right tabular-nums`}>{orNotRecorded(s.total)}</td>
                    <td className={`${td} text-right tabular-nums`}>{orNotRecorded(s.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No dated JPML action reports are recorded for this MDL.
            </p>
          )}
        </Panel>
      </div>

      {cases &&
      (Object.keys(cases.byCourt).length > 1 || Object.keys(cases.byFiledYear).length > 1) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <BarList
            title="Sample cases by court"
            rows={asRows(cases.byCourt)}
            limit={8}
            unit="dockets in this matter's saved sample"
          />
          <BarList
            title="Sample cases by filing year"
            rows={asRows(cases.byFiledYear).sort((a, b) => b.label.localeCompare(a.label))}
            limit={10}
            unit="dockets in this matter's saved sample"
          />
        </div>
      ) : null}

      {o.activity && Object.keys(o.activity.byEntryType).length ? (
        <BarList
          title="Docket entries by type"
          rows={asRows(o.activity.byEntryType).map((r) => ({
            ...r,
            label: entryTypeLabel(r.label),
          }))}
          limit={9}
          unit="docket entries in the saved sample"
        />
      ) : null}

      <details className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
        <summary className="cursor-pointer font-medium">
          Source & coverage details
          {payload.master?.sourceAsOf ? (
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              Selection snapshot {payload.master.sourceAsOf}
            </span>
          ) : null}
        </summary>
        <div className="mt-3 space-y-2">
          {[
            { title: "Cases", text: cases?.qualification },
            { title: "Docket text", text: o.activity?.qualification },
            { title: "Saved documents", text: o.docketDocuments?.qualification },
            { title: "Counsel", text: counsel?.qualification },
          ]
            .filter((x) => x.text)
            .map((x) => (
              <Scope key={x.title} title={x.title}>
                {x.text}
              </Scope>
            ))}
          {!cases?.qualification &&
          !o.activity?.qualification &&
          !o.docketDocuments?.qualification &&
          !counsel?.qualification ? (
            <p className="text-[13px] text-muted-foreground">
              No source qualifications are recorded for this matter's lists.
            </p>
          ) : null}
          {payload.master?.sourceAsOf || payload.master?.sourceCheckedAt ? (
            <p className="text-[12px] text-muted-foreground">
              {payload.master.sourceAsOf
                ? `Original selection snapshot: ${payload.master.sourceAsOf}. `
                : ""}
              {payload.master.sourceCheckedAt ? (
                <>CourtListener checked — {payload.master.sourceCheckedAt.slice(0, 10)}. </>
              ) : null}
              Master-docket dates and filing information are from CourtListener metadata.{" "}
              {o.masterDocket.clDocketId ? (
                <LinkOut
                  href={`https://www.courtlistener.com/docket/${o.masterDocket.clDocketId}/`}
                >
                  Open the live docket
                </LinkOut>
              ) : null}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
