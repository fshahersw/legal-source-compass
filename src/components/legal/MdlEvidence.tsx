import { useQuery } from "@tanstack/react-query";
import { LEGAL_ENUMS, recordKey } from "@/lib/legal/schema";
import type { MdlPacket } from "@/lib/legal/packets";
import { mdlPacket } from "@/lib/legal/packets";
import { getLegalMdlPacket } from "@/lib/external/legal.functions";
import { GraphWalkthrough } from "./GraphWalkthrough";

export function MdlEvidence({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["legal-mdl-evidence", id], queryFn: async () => {
    const result = await getLegalMdlPacket({ data: { id } });
    return result.json ? mdlPacket.parse(JSON.parse(result.json)) : null;
  }, staleTime: 300_000 });
  if (query.isPending) return <p className="mb-4 text-xs text-muted-foreground">Loading reviewed source evidence…</p>;
  if (query.isError) return <p className="mb-4 text-xs text-destructive">Reviewed source evidence could not be loaded.</p>;
  if (!query.data) return <section className="mb-5 rounded-lg border border-border p-4"><h2 className="text-sm font-semibold">Reviewed MDL evidence</h2><p className="mt-2 text-xs text-muted-foreground">A source-reviewed evidence packet is not yet available for this MDL.</p></section>;
  return <MdlEvidenceView key={recordKey(query.data.mdl)} packet={query.data} />;
}

export function MdlEvidenceView({ packet }: { packet: MdlPacket }) {
  const records = new Map(packet.records.map((r) => [recordKey(r), r]));
  const mdl = records.get(recordKey(packet.mdl))!;
  const assignment = packet.edges.find((e) => e.type === "presided_by");
  const judge = assignment ? records.get(recordKey(assignment.to)) : null;
  const initials = judge?.title.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 3).join("") ?? "—";
  return <section className="mb-6 space-y-4" aria-label="Reviewed MDL evidence">
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">{mdl.id} · {mdl.court_id}</p><h2 className="mt-1 text-base font-semibold">Source-linked MDL evidence</h2><p className="mt-1 text-xs text-muted-foreground">As of {packet.as_of} · Status: {typeof mdl.attributes["status"] === "string" ? mdl.attributes["status"] : "Not recorded"}</p></div><span className="rounded border border-border px-2 py-1 text-xs">{packet.complete ? "Reviewed packet" : "Partial source coverage"}</span></div>
      <p className="mt-2 text-xs">Master docket: {String(mdl.identifiers["pacer_case_number"] ?? "Not recorded")} · <a href={mdl.source_url} target="_blank" rel="noreferrer" className="text-primary underline">Centralization source · {mdl.date}</a></p>
      {judge && assignment && <div className="mt-4 flex gap-3 border-t border-border pt-3"><div aria-label={`Initials for ${judge.title}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{initials}</div><div className="text-xs"><p className="font-medium">{judge.title}</p><p className="mt-1 text-muted-foreground">Presiding district judge · <a href={assignment.source_url} target="_blank" rel="noreferrer" className="underline">Court assignment · {assignment.date}</a></p><p className="mt-1"><a href={judge.source_url} target="_blank" rel="noreferrer" className="text-primary underline">FJC biographical source</a> · FJC nid {judge.identifiers["fjc_nid"]} · CourtListener person {judge.identifiers["courtlistener_person_id"]}</p></div></div>}
    </div>
    {(["jpml", "pinned", "docket", "related"] as const).map((section) => <div key={section} className="rounded-lg border border-border p-4"><h3 className="mb-3 text-sm font-semibold">{LEGAL_ENUMS.mdl_section[section]}</h3>
      {packet.documents.filter((d) => d.section === section).length ? <ul className="divide-y divide-border">{packet.documents.filter((d) => d.section === section).map((d) => {
        const record = records.get(recordKey(d.record))!;
        return <li key={recordKey(record)} className="py-2 text-xs"><a className="font-medium text-primary underline" href={record.source_url} target="_blank" rel="noreferrer">{record.title}</a><p className="mt-1 text-muted-foreground">{record.date} · {LEGAL_ENUMS.order_class[d.classification]}</p>{typeof record.attributes["text"] === "string" && <details className="mt-2"><summary className="cursor-pointer">Extracted text</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-sans leading-relaxed">{record.attributes["text"]}</pre></details>}</li>;
      })}</ul> : <p className="text-xs text-muted-foreground">No reviewed source rows in this packet.</p>}
    </div>)}
    <div className="rounded-lg border border-border p-4"><h3 className="mb-2 text-sm font-semibold">Leadership appointments</h3>{packet.leadership.length ? <ul className="space-y-2 text-xs">{packet.leadership.map((row, i) => <li key={i}>{row.name} · {LEGAL_ENUMS.counsel_role[row.role]} · <a className="text-primary underline" href={records.get(recordKey(row.source_record))!.source_url} target="_blank" rel="noreferrer">Appointment order · {row.date}</a></li>)}</ul> : <p className="text-xs text-muted-foreground">No appointment-order leadership has been verified in this packet.</p>}</div>
    <GraphWalkthrough records={packet.records} edges={packet.edges} start={packet.mdl} />
    <ul className="space-y-1 text-xs text-muted-foreground">{packet.qualifications.map((q) => <li key={q}>{q}</li>)}</ul>
  </section>;
}
