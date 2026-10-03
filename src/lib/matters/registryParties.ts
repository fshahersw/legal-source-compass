/**
 * Pure: parties and counsel of a matter's master docket from the matter registry's party projection
 * (`sw_matter_parties_v1`, contract §6.4), grouped for the Parties & counsel tab.
 *
 * Publication rules (owner decision 2026-10-03, contract §6.0): party names are shown exactly as the court record prints
 * them, counsel as name + firm + role only. The projection omits sealed counsel and withholds names that contain contact
 * details; this module also refuses to show anything that looks like an email address or phone number, and it never
 * reads a contact field. Firm names are the strings the docket printed: spellings are never merged, so "Weitz &
 * Luxenberg, P.C." and "Weitz and Luxenberg, P.C." are two firms here, as on the docket.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : (str(v)?.trim() ?? null);
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export const REGISTRY_PARTIES_DATASET = "sw_matter_parties_v1";

/**
 * The firm whose attorneys are highlighted. The whole printed firm line must be this name; only capitalisation, spacing
 * and commas or periods are ignored ("SEEGER WEISS, LLP" is the firm; "Seeger Weiss - Newark" is not).
 */
export const SEEGER_WEISS_FIRM = "Seeger Weiss LLP";
const normalizeFirm = (s: string) => collapse(s.replace(/[.,]/g, " ")).toLowerCase();
const SW_EXACT = normalizeFirm(SEEGER_WEISS_FIRM);

/** True only when the printed firm line IS "Seeger Weiss LLP" ("SEEGER WEISS LLP", "Seeger Weiss, LLP"); an added office is not. */
export function isSeegerWeissFirm(firm: string | null | undefined): boolean {
  return !!firm && normalizeFirm(firm) === SW_EXACT;
}

/** A firm line that mentions the firm's name without being the exact line: listed apart, never merged or highlighted. */
export function isSeegerWeissNearMiss(firm: string | null | undefined): boolean {
  return !!firm && !isSeegerWeissFirm(firm) && /seeger[\s,]+weiss/i.test(firm);
}

/** Contact details never appear, whatever the source row says. */
const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const looksLikeContact = (s: string) => EMAIL.test(s) || PHONE.test(s);
const safeText = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const text = collapse(s);
  return looksLikeContact(text) ? null : text;
};

/* ------------------------------------------------------------------ one projected row */

export type CounselEntry = {
  /** CourtListener attorney id; null when the entry carries none. */
  attorneyId: string | null;
  /** Null while the attorney record is not collected (or was withheld). */
  name: string | null;
  firm: string | null;
  roles: string[];
  terminated: boolean;
};

export type ParsedPartyRow = {
  id: string;
  nativePartyId: string | null;
  docketKey: string | null;
  /** The party's name as printed; null when the projection withheld it. */
  name: string | null;
  nameWithheld: boolean;
  /** Party types as printed ("Plaintiff", "Defendant", "Third Party Defendant"...). */
  types: string[];
  /** The court-record note ("3:26-cv-03513-JD TERMINATED: 07/30/2026"). */
  note: string | null;
  dateTerminated: string | null;
  counselCount: number | null;
  leadCounselCount: number | null;
  sealedOmitted: number;
  counsel: CounselEntry[];
};

const PARTY_ID = /^sw-party:[a-z]{2,20}:[A-Za-z0-9._-]{1,40}:[A-Za-z0-9._-]{1,40}$/;

/** One `sw_matter_parties_v1` row (id, listing cells, `detail.registry.counsel`) -> parsed row; null when malformed. */
export function parseRegistryPartyRow(row: {
  id: unknown;
  cells: unknown;
  counsel: unknown;
}): ParsedPartyRow | null {
  const id = str(row.id);
  if (!id || !PARTY_ID.test(id) || !isObj(row.cells)) return null;
  const cells = row.cells;
  const name = cells["name_withheld"] === true ? null : safeText(cells["party_name"]);
  const typeText = str(cells["party_types"]);
  const types = typeText
    ? [
        ...new Set(
          typeText
            .split(/\s+\/\s+/)
            .map((t) => collapse(t))
            .filter(Boolean),
        ),
      ]
    : [];
  const counsel: CounselEntry[] = [];
  if (Array.isArray(row.counsel)) {
    for (const c of row.counsel) {
      if (!isObj(c)) continue;
      const roles = Array.isArray(c["roles"])
        ? c["roles"].flatMap((r) => (typeof r === "string" && r.trim() ? [collapse(r)] : []))
        : [];
      counsel.push({
        attorneyId: idStr(c["native_attorney_id"]),
        name: safeText(c["name"]),
        firm: safeText(c["firm"]),
        roles,
        terminated: c["terminated"] === true,
      });
    }
  }
  return {
    id,
    nativePartyId: idStr(cells["native_party_id"]),
    docketKey: str(cells["docket_key"]),
    name,
    nameWithheld: name === null,
    types,
    note: safeText(cells["extra_info"]),
    dateTerminated: str(cells["date_terminated"]),
    counselCount: int(cells["counsel_count"]),
    leadCounselCount: int(cells["lead_counsel_count"]),
    sealedOmitted: int(cells["counsel_sealed_omitted"]) ?? 0,
    counsel,
  };
}

/* ------------------------------------------------------------------ the matter's model */

export type PartyView = {
  id: string;
  name: string | null;
  types: string[];
  note: string | null;
  dateTerminated: string | null;
  counselCount: number | null;
  leadCounselCount: number | null;
  /** The first few counsel entries (name + firm); the Counsel view lists everyone. */
  counselPreview: { name: string | null; firm: string | null; lead: boolean }[];
};

export type AttorneyView = {
  key: string;
  name: string | null;
  firm: string | null;
  roles: string[];
  /** Terminated on every party they appear for. */
  terminated: boolean;
  parties: number;
};

export type FirmGroup = {
  /** The firm line as printed; null for attorneys with no firm line. */
  firm: string | null;
  seegerWeiss: boolean;
  attorneys: AttorneyView[];
  /** Distinct parties represented by any attorney of the firm. */
  parties: number;
};

export type PartiesCounts = {
  parties: number;
  namesWithheld: number;
  counselEntries: number;
  attorneys: number;
  firms: number;
  /** Counsel entries whose attorney record is not collected (no name). */
  unresolved: number;
  /** Sealed counsel the projection left out. */
  sealedOmitted: number;
};

export type SeegerWeissSummary = {
  /** Exact firm lines found ("Seeger Weiss LLP", "SEEGER WEISS LLP"). */
  firmLines: string[];
  attorneys: AttorneyView[];
  /** Distinct parties those attorneys appear for. */
  parties: number;
  /** Firm lines that mention the name without being it; listed, never merged. */
  nearMisses: { firm: string; attorneys: number }[];
};

/** A party with the lowercase text its search runs over (names, note, and every counsel name and firm). */
type PartyRecord = PartyView & { search: string };

export type PartiesModel = {
  parties: PartyRecord[];
  /** Party types with the number of parties of that type (a party with several types counts under each). */
  types: { value: string; count: number }[];
  firms: FirmGroup[];
  counts: PartiesCounts;
  seegerWeiss: SeegerWeissSummary;
};

const PREVIEW = 4;
const TYPE_ORDER = ["Defendant", "Plaintiff"];

export function buildPartiesModel(rows: ParsedPartyRow[]): PartiesModel {
  const parties: PartyRecord[] = [];
  const typeCounts = new Map<string, number>();
  const agg = new Map<
    string,
    {
      name: string;
      firm: string | null;
      roles: Set<string>;
      parties: Set<string>;
      active: boolean;
    }
  >();
  let counselEntries = 0;
  let unresolved = 0;
  let sealedOmitted = 0;
  let namesWithheld = 0;
  for (const row of rows) {
    if (row.nameWithheld) namesWithheld++;
    sealedOmitted += row.sealedOmitted;
    for (const t of row.types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    const searchParts: string[] = [row.name ?? "", row.note ?? ""];
    for (const c of row.counsel) {
      counselEntries++;
      if (c.name === null) {
        unresolved++;
        continue;
      }
      searchParts.push(c.name, c.firm ?? "");
      // An attorney is identified by the court's own attorney id; an entry without one is told apart by name + firm.
      const key = c.attorneyId ?? `name:${c.name}|${c.firm ?? ""}`;
      const a = agg.get(key) ?? {
        name: c.name,
        firm: c.firm,
        roles: new Set<string>(),
        parties: new Set<string>(),
        active: false,
      };
      for (const r of c.roles) a.roles.add(r);
      a.parties.add(row.id);
      if (!c.terminated) a.active = true;
      agg.set(key, a);
    }
    parties.push({
      id: row.id,
      name: row.name,
      types: row.types,
      note: row.note,
      dateTerminated: row.dateTerminated,
      counselCount: row.counselCount ?? row.counsel.length,
      leadCounselCount: row.leadCounselCount,
      counselPreview: row.counsel.slice(0, PREVIEW).map((c) => ({
        name: c.name,
        firm: c.firm,
        lead: c.roles.some((r) => /^lead attorney/i.test(r)),
      })),
      search: searchParts.join(" ").toLowerCase(),
    });
  }

  const byFirm = new Map<string | null, { attorneys: AttorneyView[]; parties: Set<string> }>();
  for (const [key, a] of agg) {
    const view: AttorneyView = {
      key,
      name: a.name,
      firm: a.firm,
      roles: [...a.roles].sort(),
      terminated: !a.active,
      parties: a.parties.size,
    };
    const g = byFirm.get(a.firm) ?? { attorneys: [], parties: new Set<string>() };
    g.attorneys.push(view);
    for (const p of a.parties) g.parties.add(p);
    byFirm.set(a.firm, g);
  }
  const firms: FirmGroup[] = [...byFirm.entries()].map(([firm, g]) => ({
    firm,
    seegerWeiss: isSeegerWeissFirm(firm),
    attorneys: g.attorneys.sort((x, y) => x.name?.localeCompare(y.name ?? "", "en") ?? 0),
    parties: g.parties.size,
  }));
  // The exact firm first, firms with a printed line before the unrecorded one, then the largest.
  firms.sort(
    (a, b) =>
      Number(b.seegerWeiss) - Number(a.seegerWeiss) ||
      Number(a.firm === null) - Number(b.firm === null) ||
      b.attorneys.length - a.attorneys.length ||
      (a.firm ?? "").localeCompare(b.firm ?? "", "en"),
  );

  const types = [...typeCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      const ra = TYPE_ORDER.indexOf(a.value);
      const rb = TYPE_ORDER.indexOf(b.value);
      if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
      return b.count - a.count || a.value.localeCompare(b.value, "en");
    });

  const exact = firms.filter((g) => g.seegerWeiss);
  const swParties = new Set<string>();
  for (const a of agg.values())
    if (isSeegerWeissFirm(a.firm)) for (const p of a.parties) swParties.add(p);
  return {
    parties,
    types,
    firms,
    counts: {
      parties: parties.length,
      namesWithheld,
      counselEntries,
      attorneys: agg.size,
      firms: firms.length,
      unresolved,
      sealedOmitted,
    },
    seegerWeiss: {
      firmLines: exact.flatMap((g) => (g.firm ? [g.firm] : [])),
      attorneys: exact.flatMap((g) => g.attorneys),
      parties: swParties.size,
      nearMisses: firms
        .filter((g) => isSeegerWeissNearMiss(g.firm))
        .map((g) => ({ firm: g.firm!, attorneys: g.attorneys.length })),
    },
  };
}

/* ------------------------------------------------------------------ queries over the model */

/** The client-facing part of a party (no search text). */
export function partyView(p: PartyView): PartyView {
  return {
    id: p.id,
    name: p.name,
    types: p.types,
    note: p.note,
    dateTerminated: p.dateTerminated,
    counselCount: p.counselCount,
    leadCounselCount: p.leadCounselCount,
    counselPreview: p.counselPreview,
  };
}

export type PartyFilter = { type: string; q: string };

/** Parties of one type (or all) whose name, court note, or any counsel's name or firm contains the text; docket order. */
export function pickParties(model: PartiesModel, f: PartyFilter): PartyView[] {
  const q = f.q.trim().toLowerCase();
  return model.parties
    .filter((p) => (!f.type || p.types.includes(f.type)) && (!q || p.search.includes(q)))
    .map(partyView);
}

/** The first few parties of each type, for the grouped overview. */
export function groupParties(
  model: PartiesModel,
  perGroup: number,
): { type: string; count: number; rows: PartyView[] }[] {
  return model.types.map((t) => ({
    type: t.value,
    count: t.count,
    rows: model.parties
      .filter((p) => p.types.includes(t.value))
      .slice(0, perGroup)
      .map(partyView),
  }));
}

/** Firms whose name, or any of whose attorneys' names, contains the text. */
export function pickFirms(model: PartiesModel, q: string): FirmGroup[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return model.firms;
  const has = (s: string | null) => !!s && s.toLowerCase().includes(needle);
  return model.firms.filter((g) => has(g.firm) || g.attorneys.some((a) => has(a.name)));
}
