/** Shared test fixtures: a row as the ecfr_parallel_authorities select returns it (`p` = detail.ptoa). */
type P = Record<string, unknown>;
export function stored(
  over: P = {},
  cfr: P = {},
  link: P = {},
  id = "usc:42:1395hh:cfr42",
): unknown {
  return {
    id,
    source_url:
      "https://www.govinfo.gov/content/pkg/GPO-CFR-INDEX-2025/pdf/GPO-CFR-INDEX-2025-4.pdf#page=71",
    p: {
      edition: "2025",
      package: "GPO-CFR-INDEX-2025",
      page: 1034,
      heading: "42 U.S.C.",
      authority: "1395hh",
      citation: "42 U.S.C. 1395hh",
      category: "usc",
      sub: null,
      variant: null,
      link: {
        state: "resolved",
        kind: "exact",
        id: "42:1395hh",
        title: "42",
        key: "1395hh",
        href: "/law/uscode/42/1395hh",
        ...link,
      },
      cfr: {
        title: 42,
        label: "Parts",
        parts_text: "400, 405, 9999",
        parts: ["400", "405", "9999"],
        parts_stored: ["400", "405"],
        part_ranges: [],
        unparsed: [],
        ...cfr,
      },
      leader_missing: false,
      ...over,
    },
  };
}
