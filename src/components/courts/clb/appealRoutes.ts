/**
 * Pure parser for a court's record in clb_court_appeals_to (CourtListener's court-appeals-to table): which courts its
 * appeals go to and which courts' appeals come to it, as recorded. A court links only when the stored link is exactly
 * `/courts/<id>`. Malformed entries are dropped.
 */
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const COURT_ID = /^[a-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type RouteCourt = {
  courtId: string;
  name: string;
  link: string | null;
  start: string | null;
  end: string | null;
  edgeId: number;
};
export type AppealRoutes = { courtId: string; appealsTo: RouteCourt[]; appealsFrom: RouteCourt[] };

function routeCourt(v: unknown): RouteCourt | null {
  const o = obj(v);
  const courtId = str(o?.["court_id"], 40);
  const edgeId = o?.["edge_id"];
  if (
    !o ||
    !courtId ||
    !COURT_ID.test(courtId) ||
    typeof edgeId !== "number" ||
    !Number.isInteger(edgeId)
  )
    return null;
  const link = str(o["link"], 60);
  const start = str(o["start"], 10);
  const end = str(o["end"], 10);
  return {
    courtId,
    name: str(o["name"]) ?? courtId,
    link: link === `/courts/${courtId}` ? link : null,
    start: start && DAY.test(start) ? start : null,
    end: end && DAY.test(end) ? end : null,
    edgeId,
  };
}

export function parseAppealRoutes(raw: unknown, courtId: string): AppealRoutes | null {
  const p = obj(raw);
  const court = obj(p?.["court"]);
  if (!p || court?.["court_id"] !== courtId) return null;
  const pick = (k: string) =>
    arr(p[k]).flatMap((x) => {
      const c = routeCourt(x);
      return c ? [c] : [];
    });
  const appealsTo = pick("appeals_to");
  const appealsFrom = pick("appeals_from");
  return appealsTo.length || appealsFrom.length ? { courtId, appealsTo, appealsFrom } : null;
}
