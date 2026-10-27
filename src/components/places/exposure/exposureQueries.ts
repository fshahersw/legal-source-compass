import {
  getCountyExposure,
  getMdlExposure,
  getStateExposure,
} from "@/lib/external/exposureGeo.functions";

const staleTime = 10 * 60 * 1000;

export const stateExposureQuery = (usps: string) => ({
  queryKey: ["exposure", "state", usps],
  queryFn: () => getStateExposure({ data: { usps } }),
  staleTime,
});

export const countyExposureQuery = (fips: string) => ({
  queryKey: ["exposure", "county", fips],
  queryFn: () => getCountyExposure({ data: { fips } }),
  staleTime,
});

export const mdlExposureQuery = (mdl: string) => ({
  queryKey: ["exposure", "mdl", mdl],
  queryFn: () => getMdlExposure({ data: { mdl } }),
  staleTime,
});
