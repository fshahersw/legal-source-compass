/**
 * Server-only reads of the verified-image datasets (court_buildings, judge_portraits_open, agency_images,
 * committee_marks, company_logos_open, state_capitol_images). One record per exact id; ids are validated before any
 * query, and a record that fails validation is dropped (null), never repaired. Until a dataset is published the reads
 * return nothing and the pages render as they did without it.
 */
import { restGet } from "@/lib/external/rest.server";
import { AGENCY_ID, parseAgencyImages, type AgencyImages } from "./agencyImages";
import { parseCommitteeMark, type CommitteeMark } from "./committeeMarks";
import { CIK, parseCompanyLogo, type OpenCompanyLogo } from "./companyLogos";
import { COURT_ID, parseCourtBuildings, type CourtBuildings } from "./courtBuildings";
import { JUDGE_PROFILE_ID, parseJudgePortrait, type OpenJudgePortrait } from "./judgePortraits";
import { parseStateCapitol, USPS, type StateCapitolPhoto } from "./stateCapitols";
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";

export type VisualDataset =
  | "court_buildings"
  | "judge_portraits_open"
  | "agency_images"
  | "committee_marks"
  | "company_logos_open"
  | "state_capitol_images";

type Fields = Record<string, unknown>;

/**
 * Dev-only fixture: on only when the Vite dev server runs (`import.meta.env.DEV`, statically false in production
 * builds, which drop this branch) AND the server was started with VISUALS_FIXTURE=1. Returns undefined when off.
 */
async function fixtureItem(dataset: VisualDataset, id: string): Promise<Fields | null | undefined> {
  if (!(import.meta.env.DEV && process.env["VISUALS_FIXTURE"] === "1")) return undefined;
  const { readVisualFixtureItem } = await import("./fixtures.server");
  return readVisualFixtureItem(dataset, id);
}

/** The named top-level item fields of one record (`item->field`), or null when there is no record with this id. */
export async function readVisualFields(
  dataset: VisualDataset,
  id: string,
  fields: readonly string[],
): Promise<Fields | null> {
  const fixture = await fixtureItem(dataset, id);
  if (fixture !== undefined)
    return fixture ? Object.fromEntries(fields.map((f) => [f, fixture[f]])) : null;
  const select = ["id", ...fields.map((f) => `${f}:item->${f}`)].join(",");
  const { rows } = await restGet<Fields[]>(
    `corpus_records?select=${select}&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows.length === 1 && rows[0]!["id"] === id ? rows[0]! : null;
}

export async function readCourtBuildings(id: string): Promise<CourtBuildings | null> {
  if (!COURT_ID.test(id)) return null;
  const r = await readVisualFields("court_buildings", id, ["buildings", "counts"]);
  return r ? parseCourtBuildings(id, r["buildings"], r["counts"]) : null;
}

export async function readOpenJudgePortrait(id: string): Promise<OpenJudgePortrait | null> {
  if (!JUDGE_PROFILE_ID.test(id)) return null;
  const r = await readVisualFields("judge_portraits_open", id, ["portrait", "identity"]);
  return r ? parseJudgePortrait(id, r["portrait"], r["identity"]) : null;
}

export async function readAgencyImages(id: string): Promise<AgencyImages | null> {
  if (!AGENCY_ID.test(id)) return null;
  const r = await readVisualFields("agency_images", id, ["photos", "marks"]);
  return r ? parseAgencyImages(id, r["photos"], r["marks"]) : null;
}

export async function readCommitteeMark(id: string): Promise<CommitteeMark | null> {
  if (!COMMITTEE_CODE.test(id)) return null;
  const r = await readVisualFields("committee_marks", id, ["mark"]);
  return r ? parseCommitteeMark(id, r["mark"]) : null;
}

export async function readOpenCompanyLogo(cik: string): Promise<OpenCompanyLogo | null> {
  if (!CIK.test(cik)) return null;
  const r = await readVisualFields("company_logos_open", cik, ["logo"]);
  return r ? parseCompanyLogo(cik, r["logo"]) : null;
}

export async function readStateCapitol(usps: string): Promise<StateCapitolPhoto | null> {
  if (!USPS.test(usps)) return null;
  const r = await readVisualFields("state_capitol_images", usps, ["photo"]);
  return r ? parseStateCapitol(usps, r["photo"]) : null;
}
