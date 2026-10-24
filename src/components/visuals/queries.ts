import { queryOptions } from "@tanstack/react-query";
import {
  getAgencyImages,
  getCommitteeMark,
  getCourtBuildings,
  getOpenCompanyLogo,
  getOpenJudgePortrait,
  getStateCapitol,
} from "@/lib/visuals/visuals.functions";

const STALE = 30 * 60_000;

export const courtBuildingsQuery = (courtId: string) =>
  queryOptions({
    queryKey: ["visual", "court-buildings", courtId],
    queryFn: () => getCourtBuildings({ data: { id: courtId } }),
    staleTime: STALE,
    retry: 1,
  });

export const openJudgePortraitQuery = (judgeId: string) =>
  queryOptions({
    queryKey: ["visual", "judge-portrait-open", judgeId],
    queryFn: () => getOpenJudgePortrait({ data: { id: judgeId } }),
    staleTime: STALE,
    retry: 1,
  });

export const agencyImagesQuery = (agencyId: string) =>
  queryOptions({
    queryKey: ["visual", "agency-images", agencyId],
    queryFn: () => getAgencyImages({ data: { id: agencyId } }),
    staleTime: STALE,
    retry: 1,
  });

export const committeeMarkQuery = (code: string) =>
  queryOptions({
    queryKey: ["visual", "committee-mark", code],
    queryFn: () => getCommitteeMark({ data: { id: code } }),
    staleTime: STALE,
    retry: 1,
  });

export const openCompanyLogoQuery = (cik: string) =>
  queryOptions({
    queryKey: ["visual", "company-logo-open", cik],
    queryFn: () => getOpenCompanyLogo({ data: { id: cik } }),
    staleTime: STALE,
    retry: 1,
  });

export const stateCapitolQuery = (usps: string) =>
  queryOptions({
    queryKey: ["visual", "state-capitol", usps],
    queryFn: () => getStateCapitol({ data: { id: usps } }),
    staleTime: STALE,
    retry: 1,
  });
