import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid, type FolderItem } from "@/components/corpus/FolderGrid";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { LawLevel } from "@/components/corpus/LawOutline";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { getLawOutlineStatus, listLawCollections } from "@/lib/external/corpus.functions";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { sectionOf } from "@/lib/external/groups";
import { kindLabel, LAW_GROUP_LABELS, lawGroup, STATE_DATASETS, type LawGroup } from "@/lib/external/lawTree";

type S = { ds?: string | undefined; view?: string | undefined; scope?: string | undefined; state?: string | undefined; kind?: string | undefined; group?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined);

export const Route = createFileRoute("/law")({
  validateSearch: (s: Record<string, unknown>): S => ({ ds: str(s["ds"]), view: str(s["view"]), scope: str(s["scope"]), state: str(s["state"]), kind: str(s["kind"]), group: str(s["group"]) }),
  head: () => pageHead("Law & regulation", "Browse law top-down: federal or a state, then type of law, then collection and provision."),
  component: LawPage,
});

const FED_GROUPS: LawGroup[] = ["statutes", "regulations", "register", "notices", "other"];
const stName = (c: string) => (c === "FEDERAL" ? "Federal" : stateByUsps.get(c)?.name ?? c);

/** Shown wherever the categorized outline would be: it is held until it passes publication checks. */
function OutlineHeld({ reason }: { reason: string | null }) {
  return (
    <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
      <span className="mr-1 font-semibold text-foreground">Categorized outline not published.</span>
      {reason ?? "The categorized law catalog and outline have not passed publication checks."} Law
      record sets are listed by dataset below; none of the held outline is shown.
    </p>
  );
}

const NO_COLLECTIONS: Awaited<ReturnType<typeof listLawCollections>> = [];

function LawPage() {
  const s = Route.useSearch();
  const collFn = useServerFn(listLawCollections);
  const statusFn = useServerFn(getLawOutlineStatus);
  const colls = useQuery({ queryKey: ["law-collections"], queryFn: () => collFn(), staleTime: 60_000 });
  const status = useQuery({ queryKey: ["law-outline-status"], queryFn: () => statusFn(), staleTime: 60_000 });
  const datasets = useDatasets();
  if (s.view === "list" || s.ds === "outline") return <SectionPage section="law" path="/law" ds={s.ds === "outline" ? undefined : s.ds} />;

  const lawDs = (datasets.data ?? []).filter((d) => sectionOf(d.id) === "law");
  const coll = colls.data ?? NO_COLLECTIONS;
  const outlineOn = status.data?.available === true;
  const dsFolder = (d: { id: string; label: string; records: number | null; ready: boolean | null }, extra: Partial<S>): FolderItem => ({ key: d.id, label: datasetDisplayName(d.id, d.label), count: d.records ?? undefined, note: d.ready === false ? "Imported · not cleared for publication" : "Imported records", link: { to: "/law", search: { ...extra, ds: d.id } } });

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Law & regulation", to: "/law" }];
  const scopeLabel = s.scope === "federal" ? "Federal" : s.scope === "states" ? "States" : s.scope === "reference" ? "Reference tools" : s.scope === "mixed" ? "Mixed federal & state law" : undefined;
  if (scopeLabel) crumbs.push({ label: scopeLabel, to: "/law", search: { scope: s.scope! } });
  if (s.state) crumbs.push({ label: stName(s.state), to: "/law", search: { scope: "states", state: s.state } });
  if (s.group) crumbs.push({ label: LAW_GROUP_LABELS[s.group as LawGroup] ?? s.group, to: "/law", search: { scope: s.scope ?? "federal", group: s.group } });
  if (s.kind) crumbs.push({ label: kindLabel(s.kind) });
  if (s.ds) crumbs.push({ label: datasetDisplayName(s.ds, lawDs.find((d) => d.id === s.ds)?.label) });
  const last = crumbs[crumbs.length - 1]!; if (crumbs.length > 2) { delete last.to; delete last.search; }

  let body: React.ReactNode;
  const err = colls.error ?? status.error ?? datasets.error;
  if (err) body = <ExternalError error={err} />;
  else if (colls.isLoading || status.isLoading || datasets.isLoading) body = <p className="text-[13px] text-muted-foreground">Loading law collections…</p>;
  else if (s.ds) body = <DatasetBrowser key={s.ds} dataset={s.ds} />;
  else if (s.kind) {
    const code = s.scope === "federal" ? "FEDERAL" : s.state ?? "";
    const c = coll.find((x) => x.state === code && x.kind === s.kind);
    body = outlineOn ? (
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        <h2 className="eyebrow mb-2">{stName(code)} · {kindLabel(s.kind)}{c ? ` · ${c.provisions.toLocaleString()} provisions` : ""}</h2>
        <LawLevel key={`${code}-${s.kind}`} state={code} kind={s.kind} parent={0} />
      </div>
    ) : (
      <OutlineHeld reason={status.data?.reason ?? null} />
    );
  } else if (!s.scope) {
    const fedProv = coll.filter((c) => c.state === "FEDERAL").reduce((a, c) => a + c.provisions, 0);
    const states = new Set(coll.filter((c) => c.state !== "FEDERAL").map((c) => c.state));
    body = (
      <div className="space-y-4">
        {outlineOn ? null : <OutlineHeld reason={status.data?.reason ?? null} />}
        <FolderGrid title="Jurisdiction" items={[
      { key: "federal", label: "Federal", note: outlineOn ? "Outline provisions · record sets listed separately" : "Record sets · outline held", count: outlineOn ? fedProv : undefined, link: { to: "/law", search: { scope: "federal" } } },
      { key: "states", label: "States", note: outlineOn ? `${states.size} jurisdictions with law outlines` : "Code datasets · outline held", count: outlineOn ? states.size : undefined, link: { to: "/law", search: { scope: "states" } } },
      { key: "reference", label: "Reference tools", note: "Limitation periods and citations", count: lawDs.filter((d) => lawGroup(d.id) === "reference").reduce((a, d) => a + (d.records ?? 0), 0), link: { to: "/law", search: { scope: "reference" } } },
      { key: "mixed", label: "Mixed federal & state law", note: "Multiple jurisdictions and legal types", link: { to: "/law", search: { scope: "mixed" } } },
      { key: "list", label: "All law datasets (list)", note: "Every law record set in one list", link: { to: "/law", search: { view: "list" } } },
    ]} />
      </div>
    );
  } else if (s.scope === "mixed") {
    body = <FolderGrid title="Mixed federal & state law" items={lawDs.filter((d) => lawGroup(d.id) === "mixed").map((d) => dsFolder(d, { scope: "mixed" }))} />;
  } else if (s.scope === "federal" && s.group) {
    body = <FolderGrid title={LAW_GROUP_LABELS[s.group as LawGroup] ?? s.group} items={lawDs.filter((d) => lawGroup(d.id) === s.group).map((d) => dsFolder(d, { scope: "federal", group: s.group }))} />;
  } else if (s.scope === "federal") {
    body = (
      <div className="space-y-5">
        {outlineOn ? <FolderGrid title="Type of law" hint="law outlines by collection" items={coll.filter((c) => c.state === "FEDERAL").sort((a, b) => b.provisions - a.provisions).map((c) => ({ key: c.kind, label: kindLabel(c.kind), count: c.provisions, link: { to: "/law", search: { scope: "federal", kind: c.kind } } }))} /> : <OutlineHeld reason={status.data?.reason ?? null} />}
        <FolderGrid title="Federal record sets" items={FED_GROUPS.map((g) => ({ key: g, label: LAW_GROUP_LABELS[g], count: lawDs.filter((d) => lawGroup(d.id) === g).reduce((a, d) => a + (d.records ?? 0), 0), link: { to: "/law", search: { scope: "federal", group: g } } }))} />
      </div>
    );
  } else if (s.scope === "reference") {
    body = <FolderGrid title="Reference tools" items={lawDs.filter((d) => lawGroup(d.id) === "reference").map((d) => dsFolder(d, { scope: "reference" }))} />;
  } else if (!s.state) {
    const codes = [...new Set(coll.filter((c) => c.state !== "FEDERAL").map((c) => c.state)), ...Object.values(STATE_DATASETS)];
    const uniq = [...new Set(codes)].sort((a, b) => stName(a).localeCompare(stName(b)));
    body = <FolderGrid title="Pick a state" hint={outlineOn ? "outline provisions; separate code datasets are not added to this count" : "states with a published code dataset; the categorized outline is not published"} items={uniq.map((code) => ({ key: code, label: stName(code), count: coll.some((c) => c.state === code) ? coll.filter((c) => c.state === code).reduce((a, c) => a + c.provisions, 0) : undefined, link: { to: "/law", search: { scope: "states", state: code } } }))} />;
  } else {
    const own = lawDs.filter((d) => STATE_DATASETS[d.id] === s.state);
    body = (
      <div className="space-y-5">
        {outlineOn ? <FolderGrid title="Type of law" items={coll.filter((c) => c.state === s.state).sort((a, b) => b.provisions - a.provisions).map((c) => ({ key: c.kind, label: kindLabel(c.kind), count: c.provisions, link: { to: "/law", search: { scope: "states", state: s.state, kind: c.kind } } }))} /> : <OutlineHeld reason={status.data?.reason ?? null} />}
        {own.length ? <FolderGrid title="State code datasets" items={own.map((d) => dsFolder(d, { scope: "states", state: s.state }))} /> : null}
      </div>
    );
  }

  const title = s.kind ? kindLabel(s.kind) : s.ds ? datasetDisplayName(s.ds, lawDs.find((d) => d.id === s.ds)?.label) : s.state ? `${stName(s.state)} law` : scopeLabel ?? "Law & regulation";
  return <AppShell breadcrumbs={crumbs} title={title} description="Open a folder to narrow down: jurisdiction, then type of law, then collection and provision.">{body}</AppShell>;
}
