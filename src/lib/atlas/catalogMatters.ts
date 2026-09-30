/** Read-only case catalog from the uploaded catalog-matters.json (2,122 dockets). */
export type CatalogMatter = {
  docket_id: number;
  docket_number: string | null;
  court: string | null;
  case_name: string | null;
  defendant: string | null;
  judge: string | null;
  date_filed: string | null;
  date_terminated: string | null;
  status: string | null;
  firms: string[] | null;
  roles: string[] | null;
  mdl_master_docket_id: number | null;
  courtlistener_docket_url: string | null;
};

export type Count = { label: string; count: number };

function tally(values: string[]): Count[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Master docket id → MDL number, taken only from the uploaded docket documents (never guessed). */
export function mdlForMatter(m: CatalogMatter, masterMap: Record<string, string>): string | null {
  return m.mdl_master_docket_id == null ? null : masterMap[String(m.mdl_master_docket_id)] ?? null;
}

export type MatterFilter = { q?: string | undefined; court?: string | undefined; mdl?: string | undefined; firm?: string | undefined; judge?: string | undefined; status?: string | undefined; defendant?: string | undefined; role?: string | undefined; courts?: Set<string> | undefined };

export function filterMatters(rows: CatalogMatter[], f: MatterFilter, masterMap: Record<string, string>): CatalogMatter[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((m) => {
    if (f.court && m.court !== f.court) return false;
    if (f.mdl && mdlForMatter(m, masterMap) !== f.mdl) return false;
    if (f.firm && !(m.firms ?? []).includes(f.firm)) return false;
    if (f.judge && m.judge !== f.judge) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.defendant && m.defendant !== f.defendant) return false;
    if (f.role && !(m.roles ?? []).includes(f.role)) return false;
    if (f.courts && !(m.court && f.courts.has(m.court))) return false;
    if (!q) return true;
    return [m.case_name, m.defendant, m.docket_number, m.judge, ...(m.firms ?? [])].some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

export function summarizeMatters(rows: CatalogMatter[]) {
  return {
    total: rows.length,
    active: rows.filter((m) => m.status === "active").length,
    byFirm: tally(rows.flatMap((m) => m.firms ?? [])),
    byJudge: tally(rows.map((m) => m.judge).filter((j): j is string => !!j)),
    byCourt: tally(rows.map((m) => m.court ?? "unknown")),
    byYear: tally(rows.map((m) => (m.date_filed ?? "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y))).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export async function loadCatalog(): Promise<{ rows: CatalogMatter[]; masterMap: Record<string, string> }> {
  const [a, b] = await Promise.all([fetch("/data/catalog-matters.json"), fetch("/data/mdl-documents/master-dockets.json")]);
  if (!a.ok || !b.ok) throw new Error("The case catalog could not be loaded.");
  return { rows: (await a.json()) as CatalogMatter[], masterMap: (await b.json()) as Record<string, string> };
}
