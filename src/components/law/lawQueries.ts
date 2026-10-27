import { getCfrRadar } from "@/lib/law/cfrRadar.functions";

export const cfrRadarQuery = {
  queryKey: ["law", "cfr-radar"],
  queryFn: () => getCfrRadar(),
  staleTime: 30 * 60 * 1000,
};

/** Phrase search (English stemming) for the product-liability block on state code pages. */
export const PRODUCT_LIABILITY_QUERY = '"product liability"';
