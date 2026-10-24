import { queryOptions } from "@tanstack/react-query";
import { getJpmlMdlSeries, getJpmlNational } from "./jpmlSeries.functions";

const staleTime = 10 * 60 * 1000;

export const jpmlNationalQuery = queryOptions({
  queryKey: ["jpml-series", "national"],
  queryFn: () => getJpmlNational(),
  staleTime,
});

export const jpmlMdlSeriesQuery = (mdl: number) =>
  queryOptions({
    queryKey: ["jpml-series", "mdl", mdl],
    queryFn: () => getJpmlMdlSeries({ data: { mdl } }),
    staleTime,
  });
