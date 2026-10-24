/**
 * Judge portraits (dataset judge_portraits_open, id = judge profile id). The binding to the profile is the exact
 * identifier chain recorded in item.identity: the Federal Judicial Center biography node id (basis "fjc_node_id"), or,
 * for state and special-court judges with no such id, a unique exact name within the same state (basis
 * "exact_name_same_state", with the state recorded). Any other or missing basis drops the record. A portrait is shown
 * only for judge records without a recorded or crosswalked one, with its credit as recorded.
 */
import { httpsUrl, obj, optionalText, parseOpenImage, text, type OpenImage } from "./common";

export const JUDGE_PORTRAITS_DATASET = "judge_portraits_open";
/** Judge profile ids are 32 lowercase hex characters. */
export const JUDGE_PROFILE_ID = /^[0-9a-f]{32}$/;

export const IDENTITY_BASES = ["fjc_node_id", "exact_name_same_state"] as const;
export type IdentityBasis = (typeof IDENTITY_BASES)[number];

export type JudgePortraitIdentity = {
  /** How the portrait was bound to this profile. */
  basis: IdentityBasis;
  /** The state a name-based binding is unique within; null for an FJC node id binding. */
  state: string | null;
  wikidata: string | null;
  fjcSlug: string | null;
  fjcNid: string | null;
  fjcUrl: string | null;
};

export type OpenJudgePortrait = OpenImage & {
  judgeId: string;
  imageDate: string | null;
  identity: JudgePortraitIdentity;
};

const FJC_HOSTS = new Set(["www.fjc.gov", "fjc.gov"]);

function identityOf(raw: unknown): JudgePortraitIdentity | null {
  const o = obj(raw);
  if (!o) return null;
  const basis = text(o["basis"], 40) as IdentityBasis | null;
  if (!basis || !IDENTITY_BASES.includes(basis)) return null;
  const wikidata = optionalText(o["wikidata"], 20);
  const slug = optionalText(o["fjc_slug"], 120);
  const state = optionalText(o["state"], 60);
  const nidRaw = o["fjc_nid"];
  const nid =
    nidRaw === undefined || nidRaw === null
      ? null
      : typeof nidRaw === "number" && Number.isInteger(nidRaw) && nidRaw > 0
        ? String(nidRaw)
        : typeof nidRaw === "string" && /^\d{1,12}$/.test(nidRaw)
          ? nidRaw
          : undefined;
  const urlRaw = o["fjc_url"];
  const url = urlRaw === undefined || urlRaw === null ? null : httpsUrl(urlRaw, FJC_HOSTS);
  const badUrl = url === null && urlRaw !== undefined && urlRaw !== null;
  if (!wikidata.ok || !slug.ok || !state.ok || nid === undefined || badUrl) return null;
  if (wikidata.value && !/^Q\d{1,12}$/.test(wikidata.value)) return null;
  if (slug.value && !/^[a-z0-9-]{1,120}$/.test(slug.value)) return null;
  // Each basis needs its own evidence: a node id, or the state the exact name is unique within.
  if (basis === "fjc_node_id" && !nid) return null;
  if (basis === "exact_name_same_state" && !state.value) return null;
  return {
    basis,
    state: basis === "exact_name_same_state" ? state.value : null,
    wikidata: wikidata.value,
    fjcSlug: slug.value,
    fjcNid: nid,
    fjcUrl: url,
  };
}

/** item.portrait + item.identity of a judge_portraits_open record. */
export function parseJudgePortrait(
  judgeId: string,
  portrait: unknown,
  identity: unknown,
): OpenJudgePortrait | null {
  if (!JUDGE_PROFILE_ID.test(judgeId)) return null;
  const image = parseOpenImage(portrait);
  const p = obj(portrait);
  // The image date is context, not evidence: a value that is not a short plain date (the registry sometimes carries a
  // raw Wikidata qualifier string) is left out instead of costing the portrait.
  const date = optionalText(p?.["image_date"], 60);
  const id = identityOf(identity);
  if (!image || !id) return null;
  return { ...image, judgeId, imageDate: date.ok ? date.value : null, identity: id };
}
