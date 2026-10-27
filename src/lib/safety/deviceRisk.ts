/**
 * Device risk map by FDA product code: the FDA product classification (device class, implant and life-sustaining flags)
 * joined exactly on product code to the openFDA PMA approvals and supplements. Most devices clear through 510(k), so a
 * code without a PMA record is normal, not a gap. MAUDE adverse-event series join on the same code once they are loaded.
 * Pure and tested (deviceRisk.test.ts).
 */

export const CLASSIFICATION_DATASET = "agency_safety_openfda_device_classification_20261002";
export const PMA_DATASET = "agency_safety_openfda_device_pma";

export type ClassificationRow = {
  pc: string | null;
  name: string | null;
  cls: string | null;
  implant: string | null;
  life: string | null;
};

export type PmaRow = { pc: string | null; nid: string | null; dd: string | null };

export const CLASS_LABEL: Record<string, string> = {
  "1": "Class I",
  "2": "Class II",
  "3": "Class III",
  U: "Unclassified",
  N: "Not classified",
  f: "HDE (f)",
};
const CLASS_ORDER = ["3", "2", "1", "f", "U", "N"];

export type RiskCell = {
  cls: string;
  label: string;
  implant: "Implant" | "Not an implant" | "Not recorded";
  codes: number;
  codesWithPma: number;
  originals: number;
  supplements: number;
};

export type RiskCode = {
  code: string;
  name: string;
  cls: string;
  implant: boolean | null;
  lifeSustaining: boolean | null;
  originals: number;
  supplements: number;
  latestDecision: string | null;
  /** A product page exists for this code (safety subject maude:<code>). */
  hasSubject: boolean;
};

export type DeviceRiskPayload = {
  cells: RiskCell[];
  codes: RiskCode[];
  years: { year: string; implant: number; other: number; partial: boolean }[];
  totals: {
    codes: number;
    implantCodes: number;
    classIIICodes: number;
    codesWithPma: number;
    pmaRows: number;
    pmaUnmatched: number;
    implantSupplements: number;
  };
  latestDecision: string | null;
  readAt: string;
};

const flag = (v: string | null): boolean | null => (v === "Y" ? true : v === "N" ? false : null);
const isSupplement = (nid: string | null) => /:S\d+$/.test((nid ?? "").trim());

export function buildDeviceRisk(
  classification: readonly ClassificationRow[],
  pma: readonly PmaRow[],
  readAt: string,
  /** Product codes that have a maude:<code> safety subject (exact code); empty when the subject list is unavailable. */
  subjectCodes: ReadonlySet<string> = new Set(),
): DeviceRiskPayload {
  const pmaBy = new Map<
    string,
    { originals: number; supplements: number; latest: string | null }
  >();
  for (const p of pma) {
    const code = (p.pc ?? "").trim();
    if (!code) continue;
    const e = pmaBy.get(code) ?? { originals: 0, supplements: 0, latest: null };
    if (isSupplement(p.nid)) e.supplements += 1;
    else e.originals += 1;
    const d = p.dd && /^\d{4}-\d{2}-\d{2}/.test(p.dd) ? p.dd.slice(0, 10) : null;
    if (d && (!e.latest || d > e.latest)) e.latest = d;
    pmaBy.set(code, e);
  }
  const codes: RiskCode[] = [];
  const cells = new Map<string, RiskCell>();
  const known = new Set<string>();
  for (const c of classification) {
    const code = (c.pc ?? "").trim();
    if (!code || known.has(code)) continue;
    known.add(code);
    const cls = (c.cls ?? "").trim() || "N";
    const implant = flag((c.implant ?? "").trim());
    const p = pmaBy.get(code);
    codes.push({
      code,
      name: (c.name ?? "").trim() || code,
      cls,
      implant,
      lifeSustaining: flag((c.life ?? "").trim()),
      originals: p?.originals ?? 0,
      supplements: p?.supplements ?? 0,
      latestDecision: p?.latest ?? null,
      hasSubject: subjectCodes.has(code),
    });
    const implantLabel =
      implant === true ? "Implant" : implant === false ? "Not an implant" : "Not recorded";
    const key = `${cls}\u0000${implantLabel}`;
    const cell = cells.get(key) ?? {
      cls,
      label: CLASS_LABEL[cls] ?? cls,
      implant: implantLabel,
      codes: 0,
      codesWithPma: 0,
      originals: 0,
      supplements: 0,
    };
    cell.codes += 1;
    if (p) cell.codesWithPma += 1;
    cell.originals += p?.originals ?? 0;
    cell.supplements += p?.supplements ?? 0;
    cells.set(key, cell);
  }
  const implantCodes = new Set(codes.filter((c) => c.implant === true).map((c) => c.code));
  let pmaUnmatched = 0;
  let latestDecision: string | null = null;
  const years = new Map<
    string,
    { year: string; implant: number; other: number; partial: boolean }
  >();
  for (const p of pma) {
    const code = (p.pc ?? "").trim();
    if (!known.has(code)) {
      pmaUnmatched += 1;
      continue;
    }
    const d = p.dd && /^\d{4}-\d{2}-\d{2}/.test(p.dd) ? p.dd.slice(0, 10) : null;
    if (!d || !isSupplement(p.nid)) continue;
    if (!latestDecision || d > latestDecision) latestDecision = d;
    const y = d.slice(0, 4);
    if (Number(y) < 2000) continue;
    const row = years.get(y) ?? { year: y, implant: 0, other: 0, partial: false };
    if (implantCodes.has(code)) row.implant += 1;
    else row.other += 1;
    years.set(y, row);
  }
  const yearRows = [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
  // Fill missing years with 0 (a PMA year with no decision is a true zero) and mark the last one partial.
  const filled: typeof yearRows = [];
  if (yearRows.length) {
    const first = Number(yearRows[0]!.year);
    const last = Number(yearRows[yearRows.length - 1]!.year);
    for (let y = first; y <= last; y += 1)
      filled.push(
        years.get(String(y)) ?? { year: String(y), implant: 0, other: 0, partial: false },
      );
    if (latestDecision && !latestDecision.endsWith("-12-31"))
      filled[filled.length - 1]!.partial = true;
  }
  codes.sort((a, b) => b.supplements - a.supplements || a.code.localeCompare(b.code));
  return {
    cells: [...cells.values()].sort(
      (a, b) =>
        CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) ||
        a.implant.localeCompare(b.implant),
    ),
    codes,
    years: filled,
    totals: {
      codes: codes.length,
      implantCodes: implantCodes.size,
      classIIICodes: codes.filter((c) => c.cls === "3").length,
      codesWithPma: codes.filter((c) => c.originals + c.supplements > 0).length,
      pmaRows: pma.length,
      pmaUnmatched,
      implantSupplements: codes
        .filter((c) => c.implant === true)
        .reduce((s, c) => s + c.supplements, 0),
    },
    latestDecision,
    readAt,
  };
}
