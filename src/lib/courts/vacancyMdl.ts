/**
 * Vacancy x MDL load board: which districts that hold pending MDL actions are losing judges or running short of
 * judges, and which judges who created a vacancy still hold MDLs. Pure. Every join is by exact identifier:
 * vacancy -> district by court id; vacancy incumbent -> MDL judge by the FJC judge id recorded on the vacancy
 * (only when the vacancy dataset marks that link "exact"). Vacancies without such a link stay unlinked; nothing is
 * matched by name. Each source keeps its own date (JPML report, FCMS period, vacancy list).
 */

export type VacancyInput = {
  id: string;
  courtId: string | null;
  courtName: string | null;
  status: "open" | "announced";
  /** Name as the AO list prints it ("Hayes,William Q."). */
  incumbent: string | null;
  reason: string | null;
  vacancyDate: string | null;
  daysOpen: number | null;
  fjcNid: string | null;
  linkBasis: string | null;
  judgeProfileId: string | null;
};

export type DistrictLoadInput = {
  courtId: string;
  name: string;
  asOf: string | null;
  active: number | null;
  judgeships: number | null;
  pendingMdls: number | null;
  pendingActions: number | null;
};

export type MdlJudgeInput = {
  nid: string;
  name: string;
  pending: { mdl: number; title: string; pending: number | null }[];
};

export type BoardRow = {
  courtId: string;
  name: string;
  pendingActions: number;
  pendingMdls: number | null;
  active: number | null;
  judgeships: number | null;
  open: number;
  announced: number;
  longestDaysOpen: number | null;
  vacantJudgeshipMonths: number | null;
  /** Rank computed in the corpus from FCMS values (1 = most months; ties share a rank). */
  vacantRank: { rank: number; of: number } | null;
  /** Other districts with the same number of vacant judgeship months. */
  vacantTied: number | null;
};

export type DepartingJudge = {
  vacancyId: string;
  courtId: string | null;
  courtName: string | null;
  status: "open" | "announced";
  reason: string | null;
  vacancyDate: string | null;
  incumbent: string | null;
  judgeProfileId: string | null;
  mdls: { mdl: number; title: string; pending: number | null }[];
  pendingActions: number;
};

export type Board = {
  rows: BoardRow[];
  departing: DepartingJudge[];
  /** Open or announced vacancies whose incumbent has no exact FJC link (left unlinked, never guessed). */
  unlinked: number;
  /** Of those, the vacancies in districts that hold pending MDL actions: their MDLs cannot be checked. */
  unlinkedInMdlDistricts: number;
  kpis: {
    mdlDistricts: number;
    mdlDistrictsWithVacancy: number;
    openInMdlDistricts: number;
    announcedInMdlDistricts: number;
    actionsInDistrictsWithVacancy: number;
    longestOpen: { courtId: string; name: string; days: number } | null;
  };
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildBoard(
  vacancies: readonly VacancyInput[],
  districts: readonly DistrictLoadInput[],
  vacantMonths: ReadonlyMap<
    string,
    { value: number | null; rank: { rank: number; of: number } | null; tied?: number | null }
  >,
  judges: readonly MdlJudgeInput[],
): Board {
  const byCourt = new Map<string, VacancyInput[]>();
  for (const v of vacancies)
    if (v.courtId) byCourt.set(v.courtId, [...(byCourt.get(v.courtId) ?? []), v]);
  const rows: BoardRow[] = districts
    .filter((d) => isNum(d.pendingActions) && d.pendingActions > 0)
    .map((d) => {
      const vs = byCourt.get(d.courtId) ?? [];
      const days = vs.map((v) => v.daysOpen).filter(isNum);
      const vm = vacantMonths.get(d.courtId);
      return {
        courtId: d.courtId,
        name: d.name,
        pendingActions: d.pendingActions!,
        pendingMdls: d.pendingMdls,
        active: d.active,
        judgeships: d.judgeships,
        open: vs.filter((v) => v.status === "open").length,
        announced: vs.filter((v) => v.status === "announced").length,
        longestDaysOpen: days.length ? Math.max(...days) : null,
        vacantJudgeshipMonths: vm?.value ?? null,
        vacantRank: vm?.rank ?? null,
        vacantTied: vm?.tied ?? null,
      };
    })
    .sort((a, b) => b.pendingActions - a.pendingActions || a.courtId.localeCompare(b.courtId));

  const judgeByNid = new Map(judges.map((j) => [j.nid, j]));
  const departing: DepartingJudge[] = [];
  const mdlCourts = new Set(rows.map((r) => r.courtId));
  let unlinked = 0;
  let unlinkedInMdlDistricts = 0;
  for (const v of vacancies) {
    if (v.linkBasis !== "exact" || !v.fjcNid) {
      unlinked++;
      if (v.courtId && mdlCourts.has(v.courtId)) unlinkedInMdlDistricts++;
      continue;
    }
    const j = judgeByNid.get(v.fjcNid);
    const mdls = j?.pending.filter((p) => p.mdl > 0) ?? [];
    if (!mdls.length) continue;
    departing.push({
      vacancyId: v.id,
      courtId: v.courtId,
      courtName: v.courtName,
      status: v.status,
      reason: v.reason,
      vacancyDate: v.vacancyDate,
      incumbent: v.incumbent,
      judgeProfileId: v.judgeProfileId,
      mdls,
      pendingActions: mdls.reduce((a, m) => a + (m.pending ?? 0), 0),
    });
  }
  departing.sort(
    (a, b) => b.pendingActions - a.pendingActions || a.vacancyId.localeCompare(b.vacancyId),
  );

  const withVacancy = rows.filter((r) => r.open + r.announced > 0);
  let longestOpen: Board["kpis"]["longestOpen"] = null;
  for (const r of rows) {
    const open = (byCourt.get(r.courtId) ?? [])
      .filter((v) => v.status === "open")
      .map((v) => v.daysOpen)
      .filter(isNum);
    for (const d of open)
      if (!longestOpen || d > longestOpen.days)
        longestOpen = { courtId: r.courtId, name: r.name, days: d };
  }
  return {
    rows,
    departing,
    unlinked,
    unlinkedInMdlDistricts,
    kpis: {
      mdlDistricts: rows.length,
      mdlDistrictsWithVacancy: withVacancy.length,
      openInMdlDistricts: rows.reduce((a, r) => a + r.open, 0),
      announcedInMdlDistricts: rows.reduce((a, r) => a + r.announced, 0),
      actionsInDistrictsWithVacancy: withVacancy.reduce((a, r) => a + r.pendingActions, 0),
      longestOpen,
    },
  };
}

/** Rank text for vacant judgeship months: ties are said, and a zero shared with other districts is not ranked. */
export function vacantRankText(r: Pick<BoardRow, "vacantJudgeshipMonths" | "vacantRank" | "vacantTied">) {
  if (!r.vacantRank) return "Not recorded";
  if (r.vacantJudgeshipMonths === 0 && r.vacantTied) return "Not ranked (zero, shared)";
  const base = `${r.vacantRank.rank} of ${r.vacantRank.of}`;
  return r.vacantTied ? `${base}, tied with ${r.vacantTied}` : base;
}

/** "Hayes,William Q." -> "William Q. Hayes", as printed otherwise. */
export function aoDisplayName(name: string | null): string | null {
  if (!name) return null;
  const m = /^([^,]+),\s*(.+)$/.exec(name.trim());
  return m ? `${m[2]} ${m[1]}` : name.trim();
}
