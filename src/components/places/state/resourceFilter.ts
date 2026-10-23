/**
 * Which research resources belong on a state's page.
 *
 * Two rules (owner decisions): (1) links to commercial legal-research hosts and aggregators (FindLaw, Justia, Westlaw,
 * Lexis, Casetext, Ballotpedia and similar) are never shown as resources; (2) a resource whose official host clearly
 * belongs to another state (an Indiana university guide on the California page) is flagged and not shown unless the
 * resource itself says it covers the page's state. Nothing is deleted: hidden resources stay in the data and are listed,
 * with the reason, beneath the list. The classification is deterministic from the host and the resource's own text; an
 * unrecognised host is never flagged.
 */
import { STATES } from "@/lib/corpus/geo";

export type HiddenReason = "commercial" | "other_state";
export type ResourceFacts = {
  url: string;
  /** Host as recorded, for example "www.in.gov". */
  domain: string;
  title: string;
  /** The resource's own words: the titles it is given and the words of its URL path. Never a list heading or a tag. */
  text: string[];
};
export type Classification = { show: true } | { show: false; reason: HiddenReason; detail: string };

/** Registrable domains of commercial research publishers, directories and aggregators. */
export const COMMERCIAL_HOSTS: Record<string, string> = {
  "findlaw.com": "FindLaw",
  "justia.com": "Justia",
  "westlaw.com": "Westlaw",
  "thomsonreuters.com": "Thomson Reuters",
  "lexis.com": "Lexis",
  "lexisnexis.com": "LexisNexis",
  "casetext.com": "Casetext",
  "ballotpedia.org": "Ballotpedia",
  "vlex.com": "vLex",
  "fastcase.com": "Fastcase",
  "casemine.com": "CaseMine",
  "leagle.com": "Leagle",
  "anylaw.com": "AnyLaw",
  "nolo.com": "Nolo",
  "avvo.com": "Avvo",
  "lawyers.com": "Lawyers.com",
  "martindale.com": "Martindale",
  "hg.org": "HG.org",
  "lawserver.com": "LawServer",
  "casebriefs.com": "CaseBriefs",
  "quimbee.com": "Quimbee",
  "lawinsider.com": "Law Insider",
  "law360.com": "Law360",
  "bloomberglaw.com": "Bloomberg Law",
  "bna.com": "Bloomberg BNA",
  "trellis.law": "Trellis",
  "legalmatch.com": "LegalMatch",
  "google.com": "Google",
  "netronline.com": "Public Records Online (NETR)",
  "onlinesearches.com": "Online Searches",
  "vitalrec.com": "VitalRec",
  "hometownlocator.com": "Hometown Locator",
  "50states.com": "50states.com",
  "findyourunclaimedproperty.com": "Find Your Unclaimed Property",
};

const NAMES = new Map(STATES.map((s) => [s.usps, s.name]));
NAMES.set("PR", "Puerto Rico");
const BY_NAME = new Map(
  [...NAMES].map(([usps, name]) => [name.toLowerCase().replace(/[^a-z]/g, ""), usps]),
);
/** Short forms official sites use in place of the full state name. */
const NAME_ALIASES: Record<string, string> = {
  mass: "MA",
  mich: "MI",
  penn: "PA",
  ala: "AL",
  wisc: "WI",
  calif: "CA",
  tenn: "TN",
  miss: "MS",
  conn: "CT",
  minn: "MN",
  nebr: "NE",
  wash: "WA",
  oscn: "OK",
};
/** University and other non-government hosts whose home state is unambiguous. */
const ORG_HOSTS: Record<string, string> = {
  "rutgers.edu": "NJ",
  "unt.edu": "TX",
  "udel.edu": "DE",
  "ufl.edu": "FL",
  "uky.edu": "KY",
  "unc.edu": "NC",
  "ou.edu": "OK",
  "utk.edu": "TN",
  "ua.edu": "AL",
  "fsu.edu": "FL",
  "emory.edu": "GA",
  "uga.edu": "GA",
  "usg.edu": "GA",
  "uidaho.edu": "ID",
  "drake.edu": "IA",
  "uiowa.edu": "IA",
  "ku.edu": "KS",
  "washburnlaw.edu": "KS",
  "louisville.edu": "KY",
  "yale.edu": "CT",
  "nesl.edu": "MA",
  "harvard.edu": "MA",
  "umass.edu": "MA",
  "umich.edu": "MI",
  "usm.edu": "MS",
  "olemiss.edu": "MS",
  "wustl.edu": "MO",
  "unomaha.edu": "NE",
  "unm.edu": "NM",
  "nyls.edu": "NY",
  "cornell.edu": "NY",
  "duke.edu": "NC",
  "uoregon.edu": "OR",
  "psu.edu": "PA",
  "villanova.edu": "PA",
  "sc.edu": "SC",
  "uvm.edu": "VT",
  "vermontlaw.edu": "VT",
  "uw.edu": "WA",
  "uwyo.edu": "WY",
  "csus.edu": "CA",
  "stanford.edu": "CA",
  "berkeley.edu": "CA",
  "ucla.edu": "CA",
  "ucdavis.edu": "CA",
  "ucsf.edu": "CA",
  "scu.edu": "CA",
  "utexas.edu": "TX",
  "tamu.edu": "TX",
  "smu.edu": "TX",
  "uh.edu": "TX",
  "asu.edu": "AZ",
  "arizona.edu": "AZ",
  "colorado.edu": "CO",
  "du.edu": "CO",
  "gwu.edu": "DC",
  "georgetown.edu": "DC",
  "umd.edu": "MD",
  "umaryland.edu": "MD",
  "temple.edu": "PA",
  "upenn.edu": "PA",
  "pitt.edu": "PA",
  "nyu.edu": "NY",
  "columbia.edu": "NY",
  "fordham.edu": "NY",
  "buffalo.edu": "NY",
  "suffolk.edu": "MA",
  "bu.edu": "MA",
  "bc.edu": "MA",
  "uconn.edu": "CT",
  "osu.edu": "OH",
  "case.edu": "OH",
  "msu.edu": "MI",
  "wayne.edu": "MI",
  "umn.edu": "MN",
  "marquette.edu": "WI",
  "vanderbilt.edu": "TN",
  "memphis.edu": "TN",
  "lsu.edu": "LA",
  "tulane.edu": "LA",
  "ucf.edu": "FL",
  "miami.edu": "FL",
  "nova.edu": "FL",
  "gsu.edu": "GA",
  "virginia.edu": "VA",
  "wm.edu": "VA",
  "vcu.edu": "VA",
  "wlu.edu": "VA",
};
const SUFFIXES = [
  "courts",
  "court",
  "bar",
  "law",
  "legal",
  "leg",
  "legis",
  "legislature",
  "judiciary",
  "judicial",
  "judicialcouncil",
  "gov",
  "state",
  "supremecourt",
  "rules",
  "portal",
];
/** Federal hosts whose first label happens to be a state code (va.gov is Veterans Affairs). */
const FEDERAL_GOV = new Set(["va", "usa", "uscourts", "state", "us"]);

function labelsOf(host: string): string[] {
  return host
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/[/:?#].*$/, "")
    .split(".")
    .filter(Boolean);
}

/** Last two labels of a host ("caselaw.findlaw.com" -> "findlaw.com"). */
export function registrable(host: string): string {
  return labelsOf(host).slice(-2).join(".");
}

/** The commercial publisher a host belongs to, or null. */
export function commercialHost(host: string): string | null {
  return COMMERCIAL_HOSTS[registrable(host)] ?? null;
}

/** USPS code for a label that is a state name, an official short form, or a state code with a court/bar/legislature suffix. */
function stateOfLabel(label: string, allowBareCode: boolean): string | null {
  const bare = label.replace(/[^a-z]/g, "");
  if (bare.startsWith("my") && bare.length > 4) {
    const rest = stateOfLabel(bare.slice(2), false);
    if (rest) return rest;
  }
  if (allowBareCode && /^[a-z]{2}$/.test(label) && NAMES.has(label.toUpperCase()))
    return label.toUpperCase();
  if (BY_NAME.has(bare)) return BY_NAME.get(bare)!;
  if (NAME_ALIASES[bare]) return NAME_ALIASES[bare]!;
  for (const suffix of SUFFIXES) {
    if (bare.length > suffix.length && bare.endsWith(suffix)) {
      const head = bare.slice(0, -suffix.length);
      if (head.length === 2 && NAMES.has(head.toUpperCase())) return head.toUpperCase();
      if (BY_NAME.has(head)) return BY_NAME.get(head)!;
      if (NAME_ALIASES[head]) return NAME_ALIASES[head]!;
    }
  }
  return null;
}

/**
 * The state an official host clearly belongs to, or null when it cannot be told. Government hosts (`*.in.gov`,
 * `www.maine.gov`, `courts.state.ny.us`, `www.txcourts.gov`), state bar and court hosts (`wvbar.org`, `sccourts.org`) and
 * listed universities are recognised; anything else, and anything that could be national, returns null.
 */
export function hostState(host: string): string | null {
  const labels = labelsOf(host);
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const stem = `${second}.${tld}`;
  if (ORG_HOSTS[stem]) return ORG_HOSTS[stem]!;
  // Hosted guides: the label before the platform names the institution (law.indiana.libguides.com is Indiana's).
  if (stem === "libguides.com" && labels.length >= 3)
    return stateOfLabel(labels[labels.length - 3]!, false);
  if (tld === "us") {
    // ny.us, state.ny.us, co.travis.tx.us, city.xx.us: the label before "us" is the state
    return stateOfLabel(second, true);
  }
  if (tld === "gov") {
    if (FEDERAL_GOV.has(second)) return null;
    return stateOfLabel(second, true);
  }
  if (tld === "edu") return BY_NAME.get(second.replace(/[^a-z]/g, "")) ?? null;
  if (tld === "org" || tld === "com" || tld === "net") return stateOfLabel(second, false);
  return null;
}

const NATIONAL =
  /\b(nationwide|national|multi-?state|all (?:50 )?states|fifty[- ]state|50[- ]state|united states|u\.s\.|federal)\b/i;

/**
 * Whether the resource itself says it covers the state: its own words name the state or say it is national or multi-state.
 * State codes are not read ("IN" is also a word) and neither are collection tags.
 */
export function coversState(r: ResourceFacts, usps: string): boolean {
  const name = NAMES.get(usps);
  const text = [r.title, ...r.text].join(" \n ");
  if (name && new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i").test(text)) return true;
  return NATIONAL.test(text);
}

export function classifyResource(r: ResourceFacts, usps: string): Classification {
  const commercial = commercialHost(r.domain || r.url);
  if (commercial)
    return { show: false, reason: "commercial", detail: `${commercial} is a commercial host` };
  const home = hostState(r.domain || r.url);
  if (home && home !== usps && !coversState(r, usps))
    return {
      show: false,
      reason: "other_state",
      detail: `${r.domain} belongs to ${NAMES.get(home) ?? home}; nothing in the resource says it covers ${NAMES.get(usps) ?? usps}`,
    };
  return { show: true };
}

export type Hidden<T> = { row: T; reason: HiddenReason; detail: string };

/** Split resources into those shown and those hidden with a reason; the input is never changed. */
export function partitionResources<T>(
  rows: T[],
  usps: string,
  factsOf: (row: T) => ResourceFacts,
): { shown: T[]; hidden: Hidden<T>[] } {
  const shown: T[] = [];
  const hidden: Hidden<T>[] = [];
  for (const row of rows) {
    const c = classifyResource(factsOf(row), usps);
    if (c.show) shown.push(row);
    else hidden.push({ row, reason: c.reason, detail: c.detail });
  }
  return { shown, hidden };
}

export function hiddenCounts(hidden: { reason: HiddenReason }[]): {
  commercial: number;
  otherState: number;
} {
  return {
    commercial: hidden.filter((h) => h.reason === "commercial").length,
    otherState: hidden.filter((h) => h.reason === "other_state").length,
  };
}
