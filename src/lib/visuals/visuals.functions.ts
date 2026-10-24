/** Verified images for court, judge, agency, committee, company and state pages. Read-only server functions. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";
import { AGENCY_ID, type AgencyImages } from "./agencyImages";
import type { CommitteeMark } from "./committeeMarks";
import { CIK, type OpenCompanyLogo } from "./companyLogos";
import { COURT_ID, type CourtBuildings } from "./courtBuildings";
import { JUDGE_PROFILE_ID, type OpenJudgePortrait } from "./judgePortraits";
import { USPS, type StateCapitolPhoto } from "./stateCapitols";
import {
  readAgencyImages,
  readCommitteeMark,
  readCourtBuildings,
  readOpenCompanyLogo,
  readOpenJudgePortrait,
  readStateCapitol,
} from "./visuals.server";

const idOf = (re: RegExp) => (d: unknown) =>
  z
    .object({ id: z.string().regex(re) })
    .strict()
    .parse(d);

export const getCourtBuildings = createServerFn({ method: "GET" })
  .inputValidator(idOf(COURT_ID))
  .handler(({ data }): Promise<CourtBuildings | null> => readCourtBuildings(data.id));

export const getOpenJudgePortrait = createServerFn({ method: "GET" })
  .inputValidator(idOf(JUDGE_PROFILE_ID))
  .handler(({ data }): Promise<OpenJudgePortrait | null> => readOpenJudgePortrait(data.id));

export const getAgencyImages = createServerFn({ method: "GET" })
  .inputValidator(idOf(AGENCY_ID))
  .handler(({ data }): Promise<AgencyImages | null> => readAgencyImages(data.id));

export const getCommitteeMark = createServerFn({ method: "GET" })
  .inputValidator(idOf(COMMITTEE_CODE))
  .handler(({ data }): Promise<CommitteeMark | null> => readCommitteeMark(data.id));

export const getOpenCompanyLogo = createServerFn({ method: "GET" })
  .inputValidator(idOf(CIK))
  .handler(({ data }): Promise<OpenCompanyLogo | null> => readOpenCompanyLogo(data.id));

export const getStateCapitol = createServerFn({ method: "GET" })
  .inputValidator(idOf(USPS))
  .handler(({ data }): Promise<StateCapitolPhoto | null> => readStateCapitol(data.id));
