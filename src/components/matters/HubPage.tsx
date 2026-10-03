import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  DataTable,
  EmptyState,
  FilterField,
  Loading,
  NotRecorded,
  Scope,
  selectClass,
  td,
  th,
} from "@/components/matters/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { evidenceKindLabel } from "@/lib/matters/cases";
import { getMatterHub } from "@/lib/matters/matters.functions";
import { TIER_LABELS, type SwTier } from "@/lib/matters/tiers";
import type { HubRow } from "@/lib/matters/types";

type Sort = "priority" | "pending" | "mdl";
/** A stable empty list, so the memoised filter does not re-run on every render while data loads. */
const NO_HUB_ROWS: HubRow[] = [];

function Coverage({ row }: { row: HubRow }) {
  const chips: { key: string; node: React.ReactNode }[] = [];
  const num = (n: number | null) => (n === null ? null : n.toLocaleString());
  const mix = (row.metrics?.byBasis ?? [])
    .slice(0, 4)
    .map((k) => `${evidenceKindLabel(k.kind)} ${k.count.toLocaleString()}`)
    .join(" · ");
  if (row.registryDockets !== null)
    chips.push({
      key: "registry",
      node: (
        <Chip
          tone="success"
          title={`Member-like dockets in the Seeger Weiss matter registry, each with its evidence. Not the size of the MDL.${mix ? ` By evidence: ${mix}.` : ""}`}
        >
          Registry dockets {num(row.registryDockets)}
        </Chip>
      ),
    });
  const entries = row.metrics?.entries ?? null;
  if (entries && entries.captured !== null)
    chips.push({
      key: "registry-entries",
      node: (
        <Chip
          tone={entries.complete === true ? "success" : "neutral"}
          title={`Docket entries the matter registry captured for the master docket${entries.providerTotal !== null ? ` against ${entries.providerTotal.toLocaleString()} reported by the provider` : " (provider total not recorded)"}${entries.complete === true ? "; complete at capture" : entries.complete === false ? "; capture continues" : ""}${entries.published !== null ? `. ${entries.published.toLocaleString()} published` : ""}.`}
        >
          Entries {num(entries.captured)}
          {entries.providerTotal !== null ? ` of ${num(entries.providerTotal)}` : ""}
        </Chip>
      ),
    });
  const parties = row.metrics?.parties ?? null;
  if (parties && parties.published !== null)
    chips.push({
      key: "registry-parties",
      node: (
        <Chip title="Parties of the master docket the matter registry published, with their counsel.">
          Parties {num(parties.published)}
        </Chip>
      ),
    });
  if (row.casesInSample !== null)
    chips.push({
      key: "cases",
      node: (
        <Chip title="Dockets the corpus links to this MDL (master + saved docket sample); not the size of the MDL.">
          Cases {num(row.casesInSample)}
        </Chip>
      ),
    });
  if (row.docketEntriesInSample !== null && !(entries && entries.captured !== null))
    chips.push({
      key: "entries",
      node: (
        <Chip title="Docket entries with docket text in the saved sample.">
          Entries {num(row.docketEntriesInSample)}
        </Chip>
      ),
    });
  if (row.savedDocuments !== null)
    chips.push({
      key: "saved",
      node: (
        <Chip title="Categorized documents in the saved docket sample.">
          Saved docs {num(row.savedDocuments)}
        </Chip>
      ),
    });
  if (row.registry && "open" in row.registry)
    chips.push({
      key: "pdf",
      node: (
        <Chip
          tone="success"
          title="Verified PDFs on the master docket: open (linkable) and held (status unconfirmed, no link)."
        >
          PDFs {row.registry.open.toLocaleString()} open
          {row.registry.held ? ` · ${row.registry.held.toLocaleString()} held` : ""}
        </Chip>
      ),
    });
  if (row.swAppearances !== null)
    chips.push({
      key: "sw",
      node: (
        <Chip
          tone="primary"
          title="Seeger Weiss attorney appearances recorded in the saved docket sample; the sample is not complete."
        >
          SW appearances {num(row.swAppearances)}
        </Chip>
      ),
    });
  if (!chips.length)
    return <span className="text-[11px] text-muted-foreground">No corpus coverage yet</span>;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <span key={c.key}>{c.node}</span>
        ))}
      </div>
      {row.metrics?.lastCaptured ? (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Registry captures last observed {row.metrics.lastCaptured}
        </div>
      ) : null}
    </div>
  );
}

function TierTable({ tier, rows }: { tier: SwTier; rows: HubRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby={`tier-${tier}`} className="space-y-2">
      <h2 id={`tier-${tier}`} className="font-display text-[15px] font-semibold">
        {TIER_LABELS[tier]}{" "}
        <span className="ml-1 text-[12px] font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      <DataTable caption={TIER_LABELS[tier]}>
        <thead>
          <tr>
            <th className={th} scope="col">
              MDL
            </th>
            <th className={th} scope="col">
              Matter
            </th>
            <th className={th} scope="col">
              Court and judge
            </th>
            <th className={th} scope="col">
              Status
            </th>
            <th className={`${th} text-right`} scope="col">
              Actions (JPML)
            </th>
            <th className={th} scope="col">
              In the corpus
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mdl} className="hover:bg-muted/40">
              <td className={`${td} font-mono font-semibold tabular-nums`}>
                {r.inCorpus ? (
                  <Link
                    to="/matters/$id"
                    params={{ id: r.mdl }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {r.mdl}
                  </Link>
                ) : (
                  r.mdl
                )}
              </td>
              <td className={`${td} max-w-[26rem]`}>
                <div className="font-medium">{r.shortName}</div>
                {r.title ? (
                  <div className="line-clamp-2 text-[11px] text-muted-foreground">{r.title}</div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    No MDL record in the corpus (outside the JPML pending list captured 2026-09-01)
                  </div>
                )}
              </td>
              <td className={td}>
                <div>{r.courtName ?? <NotRecorded />}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {r.masterDocket ?? "master docket not recorded"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {r.judgePrinted ? (
                    r.judgeProfileId ? (
                      <>
                        Judge{" "}
                        <Link
                          to="/judges/$id"
                          params={{ id: r.judgeProfileId }}
                          className="text-primary underline-offset-2 hover:underline"
                          title="Judge profile linked to this MDL's record"
                        >
                          {r.judgePrinted}
                        </Link>
                      </>
                    ) : (
                      `Judge ${r.judgePrinted}`
                    )
                  ) : (
                    "Judge not recorded"
                  )}
                </div>
              </td>
              <td className={td}>
                {r.status ? (
                  <Chip tone={r.status === "pending" ? "success" : "neutral"}>
                    <span className="capitalize">{r.status}</span>
                  </Chip>
                ) : (
                  <NotRecorded />
                )}
                {r.asOf ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    as of {r.asOf}
                  </div>
                ) : null}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {r.pendingActions !== null || r.totalActions !== null ? (
                  <>
                    <div>
                      {r.pendingActions !== null ? r.pendingActions.toLocaleString() : "—"} pending
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.totalActions !== null
                        ? `${r.totalActions.toLocaleString()} total`
                        : "total not recorded"}
                    </div>
                  </>
                ) : (
                  <NotRecorded />
                )}
              </td>
              <td className={td}>
                <Coverage row={r} />
                {r.inCorpus ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
                    <Link
                      to="/matters/$id"
                      params={{ id: r.mdl }}
                      search={{ tab: "documents" }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Documents
                    </Link>
                    <Link
                      to="/matters/$id"
                      params={{ id: r.mdl }}
                      search={{ tab: "docket" }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Docket
                    </Link>
                    <Link
                      to="/matters/$id"
                      params={{ id: r.mdl }}
                      search={{ tab: "cases" }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Cases
                    </Link>
                    <Link
                      to="/matters/$id"
                      params={{ id: r.mdl }}
                      search={{ tab: "parties" }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Counsel
                    </Link>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

export function HubPage() {
  const fn = useServerFn(getMatterHub);
  const q = useQuery({ queryKey: ["matter-hub"], queryFn: () => fn(), staleTime: 2 * 60_000 });
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const rows = q.data ?? NO_HUB_ROWS;
  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (status === "missing" ? r.inCorpus : status && r.status !== status) return false;
      return (
        !needle ||
        `${r.mdl} ${r.shortName} ${r.title ?? ""} ${r.courtName ?? ""} ${r.judgePrinted ?? ""} ${r.masterDocket ?? ""}`
          .toLowerCase()
          .includes(needle)
      );
    });
    if (sort === "pending")
      return [...list].sort((a, b) => (b.pendingActions ?? -1) - (a.pendingActions ?? -1));
    if (sort === "mdl") return [...list].sort((a, b) => Number(a.mdl) - Number(b.mdl));
    return list;
  }, [rows, text, status, sort]);
  const t1 = filtered.filter((r) => r.tier === 1);
  const t2 = filtered.filter((r) => r.tier === 2);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Matters", to: "/matters" },
        { label: "Seeger Weiss hub" },
      ]}
      title="Seeger Weiss matters"
      description="Priority MDLs for the firm, Tier 1 first. Each row shows what the corpus holds for the matter and links to its master docket, cases, docket entries, documents and counsel."
    >
      <div className="space-y-4">
        <Scope title="How to read this page">
          Tiers order the list only; they do not assert that the firm represents anyone in a matter.
          Coverage chips count what the corpus holds (never the size of the MDL). “SW appearances”
          counts attorney appearances for the tracked firm in the saved docket sample, which is
          incomplete. Unknown values read “Not recorded”.
        </Scope>
        <div className="grid gap-2 sm:grid-cols-4">
          <FilterField label="Search">
            <Input
              aria-label="Search matters"
              className="h-8 text-[12px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="MDL number, name, court or judge"
            />
          </FilterField>
          <FilterField label="Status">
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any status</option>
              <option value="pending">Pending</option>
              <option value="terminated">Terminated</option>
              <option value="missing">No MDL record</option>
            </select>
          </FilterField>
          <FilterField label="Order">
            <select
              className={selectClass}
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="priority">Priority order</option>
              <option value="pending">Pending actions, most first</option>
              <option value="mdl">MDL number</option>
            </select>
          </FilterField>
          <div className="flex items-end">
            {text || status || sort !== "priority" ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setText("");
                  setStatus("");
                  setSort("priority");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        {q.isLoading ? <Loading what="the matters hub" /> : null}
        {q.error ? <ExternalError error={q.error} /> : null}
        {q.data && !filtered.length ? (
          <EmptyState>No matter matches these filters.</EmptyState>
        ) : null}
        {sort === "priority" ? (
          <>
            <TierTable tier={1} rows={t1} />
            <TierTable tier={2} rows={t2} />
          </>
        ) : (
          <TierTable tier={1} rows={filtered} />
        )}
      </div>
    </AppShell>
  );
}
