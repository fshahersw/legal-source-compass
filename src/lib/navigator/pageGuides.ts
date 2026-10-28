/**
 * What the navigator should know about the site's key pages: what each shows, its address pattern, the query
 * parameters that set its view, and the controls worth using. Matched by path pattern; shared by the server (site map)
 * and the browser (read_page adds the guide of the page it reads).
 */
export type PageGuide = {
  /** Path pattern; `$name` is one path segment. */
  pattern: string;
  title: string;
  shows: string;
  /** Query parameters that set the view, with their values. */
  params?: string[];
  /** Controls the page offers, by their visible labels. */
  controls?: string[];
  /** How to get there from a name or id. */
  reach?: string;
};

export const PAGE_GUIDES: readonly PageGuide[] = [
  {
    pattern: "/search",
    title: "Site search",
    shows: "Search across every page, record and dataset; results grouped by section with links.",
    params: ["q=<words>"],
    reach:
      "Use /search?q=<name or number> to find the page of a product, company, court, judge or MDL by name.",
  },
  {
    pattern: "/safety/products",
    title: "Products & devices",
    shows:
      "Product watch (default): products whose FDA adverse-event reports in the last 12 months run above the count their own past predicts, by MDL status; emerging products with no MDL linked; litigated products; rising death reports; device codes. Other views list drugs, devices and MDL-named products.",
    params: [
      "view=watch|mdl|drugs|devices",
      "q=<product name> (with view=drugs, devices or mdl)",
      "page=<n>",
    ],
    controls: ["Drugs and devices", "Drugs (FAERS)", "Devices (MAUDE)", "Search products", "Reset"],
    reach:
      "Product profiles are /safety/products/<id>; ids look like faers:<drug>, maude:<code> or mdl:<number>.",
  },
  {
    pattern: "/safety/products/$id",
    title: "Product profile",
    shows:
      "One drug, device code or MDL product group: monthly FDA reports, reactions or problems, outcomes, recalls, the product watch line (signal, expected count, MDL status) and linked MDLs.",
    params: ["tab=overview|terms|records|sources", "grain=month"],
  },
  {
    pattern: "/matters/$id",
    title: "MDL page",
    shows:
      "One MDL by its number: JPML counts over time, judge and transferee court, key orders, docketed dates, counsel, documents and the regulatory record.",
    reach:
      "Open /matters/<MDL number>, for example /matters/3140 (/matters/lens/<number> redirects there).",
  },
  {
    pattern: "/matters",
    title: "MDLs and mass torts",
    shows: "Every MDL with status, size, court and judge; filters and rankings.",
  },
  {
    pattern: "/companies/$cik",
    title: "Company profile",
    shows:
      "One SEC registrant by its 10-digit CIK: filings, legal proceedings and MDL links from its filings, enforcement, recalls, payments and share price.",
    reach: "Open /companies/<10-digit CIK> (zero-padded), or search /search?q=<company name>.",
  },
  {
    pattern: "/courts/$id",
    title: "Court page",
    shows:
      "One court by its id (for example njd, cand, ohsd): judges, caseload, MDLs it hosts, locations.",
    reach:
      "District court ids are the state code, an optional n/s/e/w/m/c and d: njd, ilnd, ohsd, cacd.",
  },
  {
    pattern: "/judges/$id",
    title: "Judge page",
    shows: "One judge: court, service, MDLs assigned, caseload and published record.",
  },
  {
    pattern: "/insights/stories",
    title: "Visual stories",
    shows:
      "The MDL docket in motion: the docket race (largest MDLs in each JPML report), court map, every case as dots, the docket streamgraph, every MDL's life (heatmap), the defendant network and the co-defendant chord.",
    controls: [
      "Play",
      "Pause",
      "0.5×",
      "1×",
      "2×",
      "MDL",
      "Type",
      "Court",
      "Judge",
      "Year centralized",
      "First listed",
      "Largest",
      "Find a company, MDL or product",
    ],
  },
  {
    pattern: "/insights/explore",
    title: "Explore",
    shows:
      "Two metrics side by side across states or MDLs: scatter, fitted line, correlations with intervals.",
    params: ["type=state|mdl", "x=<metric id>", "y=<metric id>", "log=x|y|xy", "sel=<entity id>"],
  },
  {
    pattern: "/insights/trends",
    title: "Trends",
    shows: "One metric over time for up to six places or MDLs, and every national series by topic.",
    params: [
      "view=compare|national",
      "metric=<metric id>",
      "ids=<comma-separated ids>",
      "type=state|mdl",
    ],
  },
  {
    pattern: "/insights/rankings",
    title: "Rankings & maps",
    shows: "Rank and map any metric for any period, with movers between two periods.",
    params: ["type=state|mdl", "metric=<metric id>", "period=<period>", "compare=<period>"],
  },
  {
    pattern: "/insights",
    title: "Insights overview",
    shows:
      "Headline figures across the platform, what moved most, and links to the analysis tools.",
  },
  {
    pattern: "/enforcement",
    title: "Enforcement",
    shows: "Agency enforcement actions, exclusions, oversight reports and merger notices.",
    params: [
      "tab=actions|exclusions|oversight|merger",
      "agency=doj|sec|ftc|epa|… (with tab=actions)",
    ],
  },
  {
    pattern: "/places/$state",
    title: "State page",
    shows:
      "One state by its two-letter code (for example /places/NJ): courts, law, litigation, Census figures.",
  },
  {
    pattern: "/",
    title: "Overview",
    shows: "The national map and a briefing across the platform.",
  },
];

function toRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/\/$/, "")
    .split("/")
    .map((seg) => (seg.startsWith("$") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body || ""}/?$`);
}

/** The guide for a path (query ignored); static patterns win over parameterized ones. */
export function guideFor(path: string): PageGuide | null {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  const hits = PAGE_GUIDES.filter((g) => toRegex(g.pattern).test(clean));
  hits.sort(
    (a, b) =>
      a.pattern.split("$").length - b.pattern.split("$").length ||
      b.pattern.length - a.pattern.length,
  );
  return hits[0] ?? null;
}

export function renderGuide(g: PageGuide): string {
  return [
    `${g.title} (${g.pattern}): ${g.shows}`,
    g.params?.length ? `  View parameters: ${g.params.join("; ")}` : "",
    g.controls?.length ? `  Controls: ${g.controls.join(", ")}` : "",
    g.reach ? `  How to reach: ${g.reach}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
