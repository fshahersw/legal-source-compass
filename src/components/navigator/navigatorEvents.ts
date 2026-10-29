/** Open the navigator from anywhere (the header's Agent button), optionally with a task to start. */
export const NAVIGATOR_OPEN_EVENT = "navigator:open";

export type NavigatorOpenDetail = { task?: string | undefined };

export function openNavigator(task?: string) {
  window.dispatchEvent(
    new CustomEvent<NavigatorOpenDetail>(NAVIGATOR_OPEN_EVENT, {
      detail: { task: task?.slice(0, 2000) },
    }),
  );
}

/** Example tasks offered when the navigator opens, by where the user is. */
export function navigatorSuggestions(path: string): string[] {
  if (path.startsWith("/safety/products"))
    return [
      "Which drugs are rising with no MDL linked? Open the top three and compare their death reports.",
      "Find the product here with the largest rise that is already in a pending MDL and open its MDL page.",
    ];
  if (path.startsWith("/matters/"))
    return [
      "Summarize this MDL: judge, court, size over time and the companies named as defendants.",
      "Find the products linked to this MDL and check whether their FDA reports are still rising.",
    ];
  if (path.startsWith("/insights/stories"))
    return [
      "Group the dots by court and tell me which judge holds the most cases.",
      "Find Pfizer in the defendant network and list the MDLs it is linked to.",
    ];
  if (path.startsWith("/sources/library"))
    return [
      "Every weekday at 8:00, check for drugs with rising FDA reports and no MDL, and save a short report.",
      "Read my latest report and tell me what needs my attention.",
      "What do you remember about how I like my briefs?",
    ];
  return [
    "Which drugs have FDA reports rising fastest with no MDL yet? Open the top one.",
    "Chart the ten largest pending MDLs by pending cases with Python and write a one-page PDF brief.",
    "Everything on the Depo-Provera MDL: judge, court, pending cases, defendants and the FDA signal.",
    "Which court holds the most MDL cases right now, and which MDLs are there?",
  ];
}
