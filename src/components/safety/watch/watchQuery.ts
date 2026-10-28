import { getProductWatch } from "@/lib/external/productWatch.functions";

export const productWatchQuery = {
  queryKey: ["product-watch"] as const,
  queryFn: () => getProductWatch(),
  staleTime: 5 * 60_000,
};
