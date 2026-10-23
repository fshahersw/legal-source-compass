import type { Acquisition, RegCode, RegisterIssue } from "@/lib/external/stateRegs.functions";

export const ACQUISITION_LABEL: Record<Acquisition, string> = {
  acquired: "Rule text held",
  sample: "Rule text: validation sample",
  parser_ready: "Parser ready, text not loaded",
  index_only: "Index only, text not copied",
  deferred: "Deferred (publisher not usable now)",
  blocked: "Not retrieved",
  not_started: "No parser yet",
};

export const STATUS_LABEL: Record<string, string> = {
  official_free: "Official publisher, free",
  official_partial: "Official publisher, partial",
  commercial_only: "Published only by a commercial vendor",
  vendor_operated: "State site operated by a commercial vendor",
  paid_official: "Official text sold by the state",
  no_compiled_code: "No compiled code",
};

export const ACCESS_LABEL: Record<string, string> = {
  api: "API (JSON)",
  html: "Web pages",
  pdf: "PDF files",
  bulk: "Bulk files",
  portal: "Interactive portal",
  none: "Not available",
};

/** One line on how the code was read, without claiming more than the coverage row says. */
export function acquisitionLine(c: RegCode): string {
  const base = ACQUISITION_LABEL[c.acquisition];
  if (c.acquisition === "acquired") return `${base}: ${c.textRules.toLocaleString("en-US")} rules`;
  if (c.acquisition === "sample" && c.sampleRules !== null)
    return `${base} (${c.sampleRules.toLocaleString("en-US")} rules built and checked; full load pending)`;
  return base;
}

export function robotsLine(c: RegCode): string {
  if (c.robotsAllowed === null) return "Not recorded";
  if (!c.robotsAllowed) return "Disallowed by robots.txt";
  return c.crawlDelay ? `Allowed (crawl delay ${c.crawlDelay} s)` : "Allowed";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function issueWhen(i: Pick<RegisterIssue, "date" | "period">): string {
  if (i.date) {
    const [y, m, d] = i.date.split("-");
    return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
  }
  if (i.period) {
    const [y, m] = i.period.split("-");
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  return "Not recorded";
}

export function fmtDate(iso: string | null): string {
  return iso ? issueWhen({ date: iso.slice(0, 10), period: null }) : "Not recorded";
}

/** Issues per year, newest year first (for the register timeline). */
export function issuesByYear(issues: RegisterIssue[]): { year: string; issues: RegisterIssue[] }[] {
  const by = new Map<string, RegisterIssue[]>();
  for (const i of issues) {
    const y = (i.date ?? i.period ?? "").slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    by.set(y, [...(by.get(y) ?? []), i]);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([year, list]) => ({
      year,
      issues: [...list].sort((a, b) =>
        (a.date ?? a.period ?? "") < (b.date ?? b.period ?? "") ? 1 : -1,
      ),
    }));
}

export const CHECK_LABEL: Record<string, string> = {
  confirmed: "Text matches the publisher's bytes",
  mostly_confirmed: "Text mostly matches the publisher's bytes",
  partly_confirmed: "Text only partly matches the publisher's bytes",
  not_checked: "Text not checked",
  absent: "No text printed",
};

const ORDER: Acquisition[] = [
  "acquired",
  "sample",
  "parser_ready",
  "index_only",
  "deferred",
  "not_started",
  "blocked",
];

/** Counts by acquisition state, in a fixed order (for the summary line). */
export function coverageSummary(
  codes: RegCode[],
): { key: Acquisition; label: string; count: number }[] {
  return ORDER.map((k) => ({
    key: k,
    label: ACQUISITION_LABEL[k],
    count: codes.filter((c) => c.acquisition === k).length,
  })).filter((x) => x.count > 0);
}

export type RegTab = "contents" | "search" | "register" | "source";
export const REG_TABS: { id: RegTab; label: string }[] = [
  { id: "contents", label: "Contents" },
  { id: "search", label: "Search" },
  { id: "register", label: "Register" },
  { id: "source", label: "Source and coverage" },
];

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
