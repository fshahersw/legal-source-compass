/**
 * Open-licence judge portraits (dataset judge_portraits_open, id = judge profile id). The binding to the profile is
 * an exact identifier chain recorded in item.identity (Federal Judicial Center biography node id); it is shown only
 * for judge records without a recorded or crosswalked portrait. A record that fails validation is dropped.
 */
import { httpsUrl, obj, optionalText, parseOpenImage, type OpenImage } from "./common";

export const JUDGE_PORTRAITS_DATASET = "judge_portraits_open";
/** Judge profile ids are 32 lowercase hex characters. */
export const JUDGE_PROFILE_ID = /^[0-9a-f]{32}$/;

export type JudgePortraitIdentity = {
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
  if (raw === undefined || raw === null)
    return { wikidata: null, fjcSlug: null, fjcNid: null, fjcUrl: null };
  const o = obj(raw);
  if (!o) return null;
  const wikidata = optionalText(o["wikidata"], 20);
  const slug = optionalText(o["fjc_slug"], 120);
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
  if (!wikidata.ok || !slug.ok || nid === undefined || badUrl) return null;
  if (wikidata.value && !/^Q\d{1,12}$/.test(wikidata.value)) return null;
  if (slug.value && !/^[a-z0-9-]{1,120}$/.test(slug.value)) return null;
  return { wikidata: wikidata.value, fjcSlug: slug.value, fjcNid: nid, fjcUrl: url };
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
  const date = optionalText(p?.["image_date"], 60);
  const id = identityOf(identity);
  if (!image || !date.ok || !id) return null;
  return { ...image, judgeId, imageDate: date.value, identity: id };
}
