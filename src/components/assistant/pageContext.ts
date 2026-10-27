import { MAX_PAGE_TEXT, type PageContext } from "@/lib/assistant/protocol";

const squash = (s: string) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function label(el: Element | null): string {
  if (!el || el === document.body) return "";
  const h = el as HTMLElement;
  const text =
    h.getAttribute("aria-label") ??
    (h as HTMLInputElement).placeholder ??
    h.getAttribute("title") ??
    h.innerText ??
    "";
  return `${el.tagName.toLowerCase()}: ${squash(text).slice(0, 200)}`;
}

/** What the user is looking at: route, headings, the page's text, selection, focus and any open dialog (never the assistant itself). */
export function collectPageContext(assistantRoot: HTMLElement | null): PageContext {
  const inAssistant = (el: Element | null) => !!(el && assistantRoot && assistantRoot.contains(el));
  const main = document.querySelector("main") ?? document.body;
  const headings = [...main.querySelectorAll("h1, h2, h3")]
    .map((h) => squash((h as HTMLElement).innerText))
    .filter(Boolean)
    .slice(0, 40)
    .map((h) => h.slice(0, 200));
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => !inAssistant(d));
  const selection = window.getSelection();
  const selected =
    selection && selection.rangeCount && !inAssistant(selection.anchorNode?.parentElement ?? null)
      ? selection.toString()
      : "";
  const active = document.activeElement;
  const scrollable = document.scrollingElement;
  const scrolled =
    scrollable && scrollable.scrollHeight > scrollable.clientHeight
      ? Math.round(
          (100 * scrollable.scrollTop) / (scrollable.scrollHeight - scrollable.clientHeight),
        )
      : 0;
  return {
    path: `${location.pathname}${location.search}`.slice(0, 600),
    title: document.title.slice(0, 300),
    headings,
    text: squash((main as HTMLElement).innerText ?? "").slice(0, MAX_PAGE_TEXT),
    selection: squash(selected).slice(0, 3000),
    focus: inAssistant(active) ? "" : label(active).slice(0, 300),
    dialog: dialogs
      .map((d) => squash((d as HTMLElement).innerText))
      .join("\n---\n")
      .slice(0, 3000),
    viewport: `${window.innerWidth}x${window.innerHeight}, ${scrolled}% down`,
  };
}

/** Suggested first questions for the page the user is on. */
export function suggestionsFor(path: string): string[] {
  if (path.startsWith("/law/monitoring"))
    return [
      "Which recall themes are rising fastest, and why might that be?",
      "Summarize the largest multi-firm food cluster and its supplier",
      "Which firms have repeated sterility recalls?",
      "What drove the unusual months on this page?",
      "How are recall themes classified here?",
    ];
  if (path.startsWith("/courts/analytics"))
    return [
      "Which districts hold most pending MDL actions, and how has that changed since FY2005?",
      "Which MDL venues have the oldest civil dockets?",
      "Compare opposition deadlines and page limits in the largest MDL districts",
      "How is the jury-eligible population on this page estimated?",
    ];
  if (path.startsWith("/courts/vacancies"))
    return [
      "Which MDL districts have open or announced judgeship vacancies?",
      "Which departing judges still hold MDLs?",
      "How long have vacancies in MDL districts been open?",
      "How are vacancies linked to judges on this page?",
    ];
  if (path.startsWith("/law/rulemaking"))
    return [
      "Which FDA, NHTSA or CPSC comment periods close this month?",
      "Which open proposals matter for drug and device cases?",
      "How far behind schedule is the agenda for these agencies?",
      "How is a comment deadline counted here?",
    ];
  if (path.startsWith("/law/cfr"))
    return [
      "Which drug and device regulations changed in the last year?",
      "Which Federal Register rule changed this section?",
      "Which filings cite this section, and in which MDLs?",
      "How is a substantive change counted?",
    ];
  if (path.startsWith("/law/legislation"))
    return [
      "Which states enacted litigation-funding laws?",
      "Where are damages-limit bills moving this session?",
      "When did Congress pay most attention to PFAS?",
      "How are bills matched to a topic here?",
    ];
  if (/^\/courts\/[^/]+$/.test(path))
    return [
      "Summarize this court: caseload, MDLs and judges",
      "Where do appeals from this court go?",
      "Which law firms appear most in MDLs here?",
      "Find recent opinions from this court on product liability",
      "How is the data on this page sourced?",
    ];
  if (path.startsWith("/judges/"))
    return [
      "Summarize this judge's docket activity and MDL experience",
      "Find this judge's notable opinions",
      "How long do this judge's civil cases take?",
      "What sources does this profile use?",
    ];
  if (path.startsWith("/companies"))
    return [
      "Summarize this company's litigation and recall exposure",
      "What do the latest SEC filings say about legal proceedings?",
      "Find recent news about this company",
      "Which MDLs involve this company?",
    ];
  if (path.startsWith("/matters") || path.startsWith("/mdl"))
    return [
      "Summarize this MDL: court, judge, size and pace",
      "Which firms lead on each side?",
      "Where do the member cases come from?",
      "Find recent orders or news on this litigation",
    ];
  if (path.startsWith("/sources"))
    return [
      "Which datasets cover drug recalls?",
      "Where does the court data come from?",
      "How do I research a product's recall history?",
      "Which sources are official agency portals?",
    ];
  return [
    "What can I find on this page?",
    "Which MDLs are pending in the Northern District of California?",
    "Find recent FDA recalls for a product",
    "Search case law on federal preemption of failure-to-warn claims",
    "How is this page's data sourced?",
  ];
}
