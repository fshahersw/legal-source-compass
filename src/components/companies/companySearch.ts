/**
 * URL search state for /companies/$cik. Anything unrecognised is dropped rather than guessed; a default leaves no
 * parameter behind, and the grain and document only stay with the tabs that use them.
 */
import { IR_ID } from "./companyStatements";

export const COMPANY_TABS = [
  "overview",
  "statements",
  "segments",
  "documents",
  "filings",
  "litigation",
] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

export type CompanySearch = {
  tab?: CompanyTab | undefined;
  /** Statements and segments: "quarterly"; the default is fiscal years. */
  grain?: "quarterly" | undefined;
  /** Investor documents: the open document's record id. */
  doc?: string | undefined;
};

export function normalizeCompanySearch(raw: Record<string, unknown>): CompanySearch {
  const tab =
    typeof raw["tab"] === "string" && (COMPANY_TABS as readonly string[]).includes(raw["tab"])
      ? (raw["tab"] as CompanyTab)
      : undefined;
  const out: CompanySearch = {};
  if (tab && tab !== "overview") out.tab = tab;
  if (raw["grain"] === "quarterly" && (tab === "statements" || tab === "segments"))
    out.grain = "quarterly";
  if (tab === "documents" && typeof raw["doc"] === "string" && IR_ID.test(raw["doc"]))
    out.doc = raw["doc"];
  return out;
}

export const tabOf = (s: CompanySearch): CompanyTab => s.tab ?? "overview";
