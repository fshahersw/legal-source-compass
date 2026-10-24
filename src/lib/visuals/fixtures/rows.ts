/**
 * DEV FIXTURE, not data. Read only by fixtures.server.ts when the Vite dev server runs with VISUALS_FIXTURE=1 and no
 * build file for the dataset exists in private/build/visual_registry/. Never imported by production code (the
 * importing branch is guarded by `import.meta.env.DEV`).
 *
 * Every row is taken from a real lead in the owner's visual registry (11cf86c0-image-registry.json, Page Visuals
 * sheet of the workbook) with the real image URLs; agency marks are the registry's Federal Register logo rows, whose
 * licence and author the registry records as not specified (null here). Rendition URLs and pixel sizes were read from the Wikimedia Commons
 * imageinfo API and the Library of Congress IIIF service on 2026-10-24; licences from the Commons file pages and the
 * Library's item records (Highsmith items link the 482_high rights statement); the judge's profile id from the FJC
 * biography node id (fjc.gov/node/12007541) and the corpus row of judge_profiles_fjc with that node id. The field
 * names follow the contract in WORKER_RULES_VIS.md ("Datasets").
 */

export type FixtureRow = { id: string; item: Record<string, unknown> };

const COMMONS_THUMB =
  "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail";
const DIRKSEN =
  "7/73/Dirksen_United_States_Courthouse%2C_Chicago_Loop%2C_Chicago%2C_Illinois_%2811004376983%29.jpg";
const ROSZKOWSKI =
  "3/3c/Stan_Roszkowski_US_Courthouse%2C_BMO_Harris_Bank_Center_in_downtown_Rockford.jpg";
const thumbUrl = (path: string, width: number, ext = "") =>
  `https://thumb.wikimedia.org/wikipedia/commons/thumb/${path}/${width}px-${path.split("/").pop()}${ext}${COMMONS_THUMB}`;
const highsm = (service: string, pct: string) =>
  `https://tile.loc.gov/image-services/iiif/service:pnp:highsm:${service}/full/pct:${pct}/0/default.jpg`;
const HIGHSMITH_STATEMENT = "https://www.loc.gov/rr/print/res/482_high.html";

export const court_buildings: FixtureRow[] = [
  {
    id: "ilnd",
    item: {
      buildings: [
        {
          asset_id: "court-building-8717c649b09f911f",
          building: "Dirksen Federal Building and US Courthouse",
          street_address: "219 South Dearborn Street",
          city: "Chicago",
          state: "IL",
          latitude: 41.8788181,
          longitude: -87.628962,
          relationship_label: "Listed by U.S. Courts as a location of this court",
          evidence_url: "https://www.uscourts.gov/federal-court-finder/location/913",
          photo: {
            file_page:
              "https://commons.wikimedia.org/wiki/File:Dirksen_United_States_Courthouse,_Chicago_Loop,_Chicago,_Illinois_(11004376983).jpg",
            display: { url: thumbUrl(DIRKSEN, 960), width: 960, height: 720 },
            thumb: { url: thumbUrl(DIRKSEN, 330), width: 330, height: 247 },
            license: "CC BY-SA 2.0",
            license_family: "cc by-sa",
            license_url: "https://creativecommons.org/licenses/by-sa/2.0",
            license_url_is_deed: true,
            author: "Ken Lund from Reno, Nevada, USA",
            credit: null,
            verified_at: "2026-10-24T01:40:00Z",
          },
        },
        {
          asset_id: "court-building-aca2aead7582f129",
          building: "Stanley J. Roszkowski Federal Courthouse",
          street_address: "327 South Church Street",
          city: "Rockford",
          state: "IL",
          latitude: 42.2696243,
          longitude: -89.0983787,
          relationship_label: "Listed by U.S. Courts as a location of this court",
          evidence_url: "https://www.uscourts.gov/federal-court-finder/location/914",
          photo: {
            file_page:
              "https://commons.wikimedia.org/wiki/File:Stan_Roszkowski_US_Courthouse,_BMO_Harris_Bank_Center_in_downtown_Rockford.jpg",
            display: { url: thumbUrl(ROSZKOWSKI, 960), width: 960, height: 720 },
            thumb: { url: thumbUrl(ROSZKOWSKI, 330), width: 330, height: 248 },
            license: "CC BY-SA 3.0",
            license_family: "cc by-sa",
            license_url: "https://creativecommons.org/licenses/by-sa/3.0",
            license_url_is_deed: true,
            author: "Alexbaumgarner",
            credit: null,
            verified_at: "2026-10-24T05:39:00Z",
          },
        },
      ],
      counts: { buildings_listed: 2, buildings_shown: 2 },
    },
  },
  {
    id: "ca10",
    item: {
      buildings: [
        {
          asset_id: "court-building-ab27c95c5a3466e8",
          building: "Byron White Federal Courthouse",
          street_address: "1823 Stout Street",
          city: "Denver",
          state: "CO",
          latitude: 39.7485292,
          longitude: -104.990474,
          relationship_label: "Headquarters listed by U.S. Courts",
          evidence_url: "https://www.uscourts.gov/federal-court-finder/location/250",
          photo: {
            file_page: "https://www.loc.gov/item/2010719071/",
            display: { url: highsm("03500:03515", "25"), width: 987, height: 641 },
            thumb: { url: highsm("03500:03515", "12.5"), width: 494, height: 321 },
            license: "Public domain (Carol M. Highsmith Archive)",
            license_family: "public domain",
            license_url: HIGHSMITH_STATEMENT,
            license_url_is_deed: false,
            author: "Carol M. Highsmith",
            credit:
              "Library of Congress, Prints & Photographs Division, photograph by Carol M. Highsmith [LC-DIG-highsm-03515]",
            verified_at: "2026-10-24T05:45:00Z",
          },
        },
      ],
      counts: { buildings_listed: 1, buildings_shown: 1 },
    },
  },
];

const SWEENEY = "3/35/Charlotte_Sweeney_profile_2.jpg";
export const judge_portraits_open: FixtureRow[] = [
  {
    id: "f251088a2a884cf7e4745c1966f732b0",
    item: {
      portrait: {
        file_page: "https://commons.wikimedia.org/wiki/File:Charlotte_Sweeney_profile_2.jpg",
        display: { url: thumbUrl(SWEENEY, 960), width: 960, height: 1152 },
        thumb: { url: thumbUrl(SWEENEY, 330), width: 330, height: 396 },
        license: "CC BY-SA 4.0",
        license_family: "cc by-sa",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0",
        license_url_is_deed: true,
        author: "Noot Noots",
        credit: null,
        image_date: "2023-02-03",
        verified_at: "2026-10-24T05:39:00Z",
      },
      identity: {
        wikidata: "Q107938370",
        fjc_slug: "sweeney-charlotte-noelle",
        fjc_nid: "12007541",
        fjc_url: "https://www.fjc.gov/history/judges/sweeney-charlotte-noelle",
      },
    },
  },
];

export const agency_images: FixtureRow[] = [
  {
    id: "160",
    item: {
      photos: [
        {
          building: "J. Edgar Hoover Building",
          photo_date: "2012-01-01",
          display: { url: highsm("25100:25144", "25"), width: 1536, height: 609 },
          thumb: { url: highsm("25100:25144", "12.5"), width: 768, height: 305 },
          source_page: "https://www.loc.gov/item/2013634629/",
          license: "Public domain (Carol M. Highsmith Archive)",
          license_family: "public domain",
          license_url: HIGHSMITH_STATEMENT,
          license_url_is_deed: false,
          author: "Carol M. Highsmith",
          credit_line:
            "Library of Congress, Prints & Photographs Division, photograph by Carol M. Highsmith [LC-DIG-highsm-25144]",
          occupancy_note: "Current occupancy not verified.",
          verified_at: "2026-10-24T05:45:00Z",
        },
      ],
      // The FBI has a GSA mark on the site, which wins over this one.
      marks: [
        {
          url: "https://agency-logos.federalregister.gov/160/medium.png?1321992917",
          width: 245,
          height: 252,
          mime: "image/png",
          source_page: "https://www.federalregister.gov/agencies/federal-bureau-of-investigation",
          license: null,
          author: null,
          rights_status: "restricted",
        },
      ],
    },
  },
  {
    id: "5",
    item: {
      photos: [],
      marks: [
        {
          url: "https://agency-logos.federalregister.gov/5/medium.jpg?1321651510",
          width: 245,
          height: 118,
          mime: "image/jpeg",
          source_page:
            "https://www.federalregister.gov/agencies/agency-for-healthcare-research-and-quality",
          license: null,
          author: null,
          rights_status: "review_required",
        },
      ],
    },
  },
];

export const committee_marks: FixtureRow[] = [
  {
    id: "hsru00",
    item: {
      mark: {
        url: "https://rules.house.gov/sites/evo-subsites/republicans-rules.house.gov/files/2025-logo.png",
        width: 1162,
        height: 1120,
        mime: "image/png",
        source_page: "https://rules.house.gov/",
        policy_url: "https://rules.house.gov/copyright",
        policy_quote:
          "Except as otherwise noted in this website, all of the content of the website constitutes a work of the Federal government under sections 105 and 403 of title 17 of the U.S. Code.",
        branding_note:
          "Official committee majority website branding observed on the collection date; chair-specific variants may change.",
        verified_at: "2026-10-24T03:15:48Z",
      },
    },
  },
];

const THREE_M = "1/15/3M_wordmark.svg";
export const company_logos_open: FixtureRow[] = [
  {
    id: "0000066740",
    item: {
      logo: {
        file_page: "https://commons.wikimedia.org/wiki/File:3M_wordmark.svg",
        display: { url: thumbUrl(THREE_M, 960, ".png"), width: 960, height: 506 },
        thumb: { url: thumbUrl(THREE_M, 330, ".png"), width: 330, height: 174 },
        license: "Public domain",
        license_family: "public domain",
        license_url: "https://commons.wikimedia.org/wiki/File:3M_wordmark.svg#Licensing",
        license_url_is_deed: false,
        author: "Stephen Dunne of Siegel & Gale",
        wikidata: "Q159433",
        statement_id: "Q159433$f2dae5b9-4533-0112-ff57-776cae6062ac",
        trademark_note:
          "Logo shown to identify the company. Trademarks belong to their owners; no endorsement implied.",
        verified_at: "2026-10-24T05:39:00Z",
      },
    },
  },
];

const ALABAMA = "f/fc/Alabama_State_Capitol%2C_Montgomery%2C_West_view_20160713_1.jpg";
export const state_capitol_images: FixtureRow[] = [
  {
    id: "AL",
    item: {
      photo: {
        building: "Alabama State Capitol",
        file_page:
          "https://commons.wikimedia.org/wiki/File:Alabama_State_Capitol,_Montgomery,_West_view_20160713_1.jpg",
        display: { url: thumbUrl(ALABAMA, 960), width: 960, height: 768 },
        thumb: { url: thumbUrl(ALABAMA, 330), width: 330, height: 264 },
        license: "CC BY-SA 4.0",
        license_family: "cc by-sa",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0",
        license_url_is_deed: true,
        author: "DXR",
        credit: null,
        verified_at: "2026-10-24T05:39:00Z",
      },
    },
  },
];
