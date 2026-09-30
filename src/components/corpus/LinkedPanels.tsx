import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getCountyProfile, getCourtMap, getDocketLinks } from "@/lib/external/linking.functions";
import { useCorpus } from "@/lib/corpus/store";
import { stateByUsps } from "@/lib/corpus/geo";
import { UsMap } from "@/components/corpus/UsMap";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { useJudgeMatcher } from "@/lib/external/useDirectory";
import { surnameLetter } from "@/lib/external/directoryTree";

function Box({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline gap-2"><h2 className="eyebrow">{title}</h2>{hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}</div>
      {children}
    </section>
  );
}

/** Court page: state mini-map (court's state highlighted) + court-map facts. */
export function CourtContext({ courtId, fallbackState, known }: { courtId: string; fallbackState?: string | undefined; known?: Set<string> }) {
  const fn = useServerFn(getCourtMap);
  const q = useQuery({ queryKey: ["court-map", courtId], queryFn: () => fn({ data: { id: courtId } }), staleTime: Infinity });
  const { geo } = useCorpus();
  const usps = (q.data?.state ?? fallbackState ?? "").toUpperCase();
  const st = stateByUsps.get(usps);
  const values = useMemo(() => new Map(st ? [[st.fips, 1]] : []), [st]);
  const facts = (q.data?.facts ?? []).filter(([k]) => !known?.has(k));
  if (q.error) return <ExternalError error={q.error} />;
  if (!q.data && !st) return null;
  return (
    <div className="mb-5 grid gap-4 md:grid-cols-[16rem_1fr]">
      <Box title="Location" hint={st ? st.name : "State not recorded"}>
        {geo && st ? <Link to="/places/$state" params={{ state: usps }} aria-label={`Open ${st.name}`}><UsMap geo={geo} values={values} valueLabel="court location" /></Link> : <p className="text-[12px] text-muted-foreground">Not recorded</p>}
      </Box>
      {facts.length ? (
        <Box title="Court map record" hint="fields not already shown above">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">{facts.map(([k, v], i) => <div key={i}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
        </Box>
      ) : null}
    </div>
  );
}

/** Related dockets from the docket-links table, by exact court id or MDL number. */
export function RelatedDockets({ by, id }: { by: "court" | "mdl"; id: string }) {
  const fn = useServerFn(getDocketLinks);
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ["docket-links", by, id, offset], queryFn: () => fn({ data: { by, id, offset } }), staleTime: 5 * 60_000 });
  if (q.error) return <ExternalError error={q.error} />;
  if (q.data && !q.data.rows.length) return null;
  const total = q.data?.total;
  return (
    <Box title="Related dockets" hint={q.isLoading ? "Loading…" : total != null ? `${total.toLocaleString()} exact ${by === "mdl" ? "MDL" : "court"} matches in the docket-links table` : "too large to count"}>
      <div className="overflow-x-auto"><table className="w-full text-[12px]">
        <thead className="text-left text-[11px] text-muted-foreground"><tr><th className="px-2 py-1">Docket</th><th className="px-2 py-1">Court</th><th className="px-2 py-1">MDL</th><th className="px-2 py-1">Date</th><th className="px-2 py-1">Source</th></tr></thead>
        <tbody className="divide-y divide-border">{(q.data?.rows ?? []).map((r, i) => (
          <tr key={i}>
            <td className="px-2 py-1 font-mono">{r.evidence_url ? <a href={r.evidence_url} target="_blank" rel="noreferrer" className="underline">{r.docket_number}</a> : r.docket_number}</td>
            <td className="px-2 py-1">{r.court_id ? <Link to="/courts/$id" params={{ id: r.court_id }} className="underline decoration-dotted">{r.court_id}</Link> : "—"}</td>
            <td className="px-2 py-1">{r.mdl ? <Link to="/matters/$id" params={{ id: r.mdl }} className="underline decoration-dotted">{r.mdl}</Link> : "—"}</td>
            <td className="px-2 py-1 whitespace-nowrap">{r.event_date ?? "Not recorded"}{r.date_basis ? <span className="text-muted-foreground"> · {r.date_basis.replace(/_/g, " ")}</span> : null}</td>
            <td className="px-2 py-1 text-muted-foreground">{r.source_dataset}</td>
          </tr>))}</tbody>
      </table></div>
      {total != null && total > 50 ? (
        <div className="mt-2 flex items-center gap-3 text-[12px]">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="underline disabled:opacity-40">Previous</button>
          <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + 50, total)} of {total.toLocaleString()}</span>
          <button disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} className="underline disabled:opacity-40">Next</button>
        </div>
      ) : null}
    </Box>
  );
}

/** Judge names printed in an MDL record; link only on a unique exact profile match. */
export function MdlJudges({ raw }: { raw: Record<string, unknown> | null }) {
  const match = useJudgeMatcher();
  const names = useMemo(() => {
    const s = JSON.stringify(raw ?? {});
    const out = new Set<string>();
    for (const m of s.matchAll(/\\?"judge_name_as_printed\\?":\s*\\?"([^"\\]+)/g)) out.add(m[1]!.trim());
    return [...out].filter(Boolean);
  }, [raw]);
  if (!names.length) return null;
  return (
    <Box title="Judges named on this MDL" hint="Linked only when exactly one judge profile has that exact name">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">{names.map((n) => {
        const id = match?.(n);
        return id ? <Link key={n} to="/judges/$id" params={{ id }} className="underline">{n}</Link> : <Link key={n} to="/people" search={{ kind: "judges", letter: surnameLetter(n), offset: 0 }} className="underline decoration-dotted" title="No single exact profile match; opens the A–Z index">{n}</Link>;
      })}</div>
    </Box>
  );
}

/** County profile links (corpus_context) + document groups with other copies. */
export function CountyProfile({ fips, county, state }: { fips: string; county?: string | undefined; state?: string | undefined }) {
  const fn = useServerFn(getCountyProfile);
  const q = useQuery({ queryKey: ["county-profile", fips, county, state], queryFn: () => fn({ data: { fips, ...(county ? { county } : {}), ...(state ? { state } : {}) } }), staleTime: Infinity });
  if (q.error) return <ExternalError error={q.error} />;
  if (!q.data) return <p className="mt-2 text-[12px] text-muted-foreground">Loading county profile…</p>;
  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="eyebrow">County profile</div>
        {q.data.items.length ? (
          <ul className="mt-1 divide-y divide-border rounded border border-border bg-surface text-[12px]">{q.data.items.map((it, i) => (
            <li key={i} className="flex items-baseline gap-3 px-2 py-1.5">
              <span className="w-36 shrink-0 truncate text-[11px] text-muted-foreground">{it.kind_label ?? "—"}</span>
              <a href={it.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">{it.title}</a>
              <span className="shrink-0 text-[11px] text-muted-foreground">{it.publisher ?? ""}{it.as_of ? ` · captured ${it.as_of}` : ""}</span>
            </li>))}</ul>
        ) : <p className="text-[12px] text-muted-foreground">Not recorded</p>}
      </div>
      {q.data.groups.length ? (
        <div>
          <div className="eyebrow">Document groups for this county</div>
          <ul className="mt-1 divide-y divide-border rounded border border-border bg-surface text-[12px]">{q.data.groups.map((g) => (
            <li key={g.id} className="flex items-baseline gap-3 px-2 py-1.5"><span className="min-w-0 flex-1 truncate">{g.title}</span>{g.source_count > 1 ? <span className="shrink-0 text-[11px] text-muted-foreground">{g.source_count - 1} other {g.source_count === 2 ? "copy" : "copies"}</span> : null}</li>))}</ul>
        </div>
      ) : null}
    </div>
  );
}
