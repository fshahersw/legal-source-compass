import { Building2, FileCheck2, Gavel, Landmark, Scale } from "lucide-react";
import {
  getCompanyEnforcement,
  getDojOverview,
  getOfficialSettlements,
} from "@/lib/external/enforcementActions.functions";

/** Sections of /law/enforcement: the agency data sets (existing tabs) and the enforcement-action sources. */
export type ActionsView = "doj" | "ftc" | "sec" | "settlements";

export const ACTION_VIEWS: { id: ActionsView | "agency"; label: string; Icon: typeof Landmark }[] =
  [
    { id: "agency", label: "Agency data", Icon: Landmark },
    { id: "doj", label: "DOJ press releases", Icon: Scale },
    { id: "ftc", label: "FTC cases and actions", Icon: Building2 },
    { id: "sec", label: "SEC actions", Icon: Gavel },
    { id: "settlements", label: "Confirmed settlements", Icon: FileCheck2 },
  ];

/** `?actions=` value, or undefined for the agency-data tabs; anything unrecognised is dropped. */
export function normalizeActionsView(raw: unknown): ActionsView | undefined {
  return raw === "doj" || raw === "ftc" || raw === "sec" || raw === "settlements" ? raw : undefined;
}

export const dojOverviewQuery = {
  queryKey: ["enforcement-actions", "doj-overview"],
  queryFn: () => getDojOverview(),
  staleTime: 10 * 60 * 1000,
};

export const officialSettlementsQuery = {
  queryKey: ["enforcement-actions", "official-settlements"],
  queryFn: () => getOfficialSettlements(),
  staleTime: 10 * 60 * 1000,
};

export const companyEnforcementQuery = (cik: string) => ({
  queryKey: ["enforcement-actions", "company", cik],
  queryFn: () => getCompanyEnforcement({ data: { cik } }),
  staleTime: 10 * 60 * 1000,
});
