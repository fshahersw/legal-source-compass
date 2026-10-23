/** Display helpers for the judges-on-court-websites panels (pure, no data access). */
import {
  TITLE_LABEL,
  TITLE_ORDER,
  type PracticeDoc,
  type RosterJudge,
  type TitleClass,
} from "@/lib/external/judgePractices.functions";

/** True when the title words are the heading the court lists the judge under ("United States District Judges"), not words said of the judge. */
export const isListingHeading = (source: string | null): boolean =>
  !!source && /^listing (page )?heading$/i.test(source);

/** The title line of a judge: the printed words, or a statement that they are the list's heading, or that none is printed. */
export function titleLine(title: string | null, source: string | null): string {
  if (!title) return "Title not stated on the page";
  return isListingHeading(source) ? `Listed under “${title}”` : title;
}

/** The date as the court prints it beside the link; never a date taken from a file name. */
export const dateLabel = (d: Pick<PracticeDoc, "dateText" | "date">): string =>
  d.dateText ?? "No date printed";

/** Documents with a printed full date first (newest first), then the others in the order the court lists them. */
export function docsOrdered(docs: PracticeDoc[]): PracticeDoc[] {
  const dated = docs
    .filter((d) => d.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return [...dated, ...docs.filter((d) => !d.date)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "23 Oct 2026" from an ISO timestamp; the input unchanged when it cannot be read. */
export function retrievedLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

export type RosterGroup = { titleClass: TitleClass; label: string; judges: RosterJudge[] };

/** The bench grouped by title class in a fixed order (chief, district, senior, magistrate, bankruptcy, other, not stated); empty groups left out. */
export function groupRoster(judges: RosterJudge[]): RosterGroup[] {
  return TITLE_ORDER.map((titleClass) => ({
    titleClass,
    label: TITLE_LABEL[titleClass],
    judges: judges
      .filter((j) => j.titleClass === titleClass)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
  })).filter((g) => g.judges.length > 0);
}

export type RosterTotals = {
  judges: number;
  linked: number;
  noProfile: number;
  documents: number;
  withDocuments: number;
};
export function rosterTotals(judges: RosterJudge[]): RosterTotals {
  const linked = judges.filter((j) => j.profileId).length;
  return {
    judges: judges.length,
    linked,
    noProfile: judges.length - linked,
    documents: judges.reduce((n, j) => n + j.documents, 0),
    withDocuments: judges.filter((j) => j.documents > 0).length,
  };
}

/** Why a court has no judges list to show, in the words of the coverage record's status. */
export const STATUS_EXPLANATION: Record<string, string> = {
  no_judges_found:
    "No judges list could be read from the pages of this court's website that were fetched.",
  blocked_robots:
    "This court's robots.txt does not allow automated reading of its pages, so none were read.",
  blocked: "The court's website refused the request; the refusal was not bypassed.",
  not_checked: "This court's website was not read.",
};
