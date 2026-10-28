/**
 * The Official Congressional Directory as GPO publishes it on GovInfo (package CDIR-<date>, ZIP with the full text),
 * read into two datasets:
 *   cdir_members     one row per Member, Delegate and Resident Commissioner: the biography as printed (born,
 *                    education, professional history, election history...), the Washington office, website and
 *                    district offices with their phone numbers. Linked to congress_members only on an exact seat
 *                    match: House members by state and district, Senators by state and surname (unique among the
 *                    state's current Senators); otherwise unlinked.
 *   cdir_committees  one row per committee (Senate, House and joint): room, phone, websites, and the members of the
 *                    full committee and of each subcommittee in printed order, with the role printed after the name
 *                    (chair, ranking member, vice chair...) and the column it is printed in (majority / minority).
 *                    No role or party is inferred.
 * The directory states its closing date (members as of that date). Public domain (GPO).
 */
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CollectContext,
  CorpusRow,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { zipText } from "../zip.ts";

export const CDIR_MEMBERS = "cdir_members";
export const CDIR_COMMITTEES = "cdir_committees";
export const CDIR_DEFAULT = "CDIR-2026-02-20";

export const cdirZipUrl = (pkg: string) =>
  `https://www.govinfo.gov/content/pkg/${pkg}/zip/${pkg}.zip`;
export const cdirPageUrl = (pkg: string) => `https://www.govinfo.gov/app/details/${pkg}`;

export const STATES: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "AMERICAN SAMOA": "AS",
  "DISTRICT OF COLUMBIA": "DC",
  GUAM: "GU",
  "NORTHERN MARIANA ISLANDS": "MP",
  "PUERTO RICO": "PR",
  "VIRGIN ISLANDS": "VI",
  "VIRGIN ISLANDS OF THE UNITED STATES": "VI",
  "THE VIRGIN ISLANDS OF THE UNITED STATES": "VI",
};

const ORDINAL_UNITS: Record<string, number> = {
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOURTH: 4,
  FIFTH: 5,
  SIXTH: 6,
  SEVENTH: 7,
  EIGHTH: 8,
  NINTH: 9,
  TENTH: 10,
  ELEVENTH: 11,
  TWELFTH: 12,
  THIRTEENTH: 13,
  FOURTEENTH: 14,
  FIFTEENTH: 15,
  SIXTEENTH: 16,
  SEVENTEENTH: 17,
  EIGHTEENTH: 18,
  NINETEENTH: 19,
  NINTEENTH: 19,
  TWENTIETH: 20,
  THIRTIETH: 30,
  FORTIETH: 40,
  FIFTIETH: 50,
};
const TENS: Record<string, number> = { TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50 };

/** "TWENTY-THIRD" → 23; "FIRST" → 1; null for anything else. */
export function ordinalNumber(word: string): number | null {
  const w = word.trim().toUpperCase();
  if (w in ORDINAL_UNITS) return ORDINAL_UNITS[w]!;
  const m = /^([A-Z]+)-([A-Z]+)$/.exec(w);
  if (m && m[1]! in TENS && m[2]! in ORDINAL_UNITS && ORDINAL_UNITS[m[2]!]! < 10)
    return TENS[m[1]!]! + ORDINAL_UNITS[m[2]!]!;
  return null;
}

const ENTRY =
  /^\s{0,4}([A-Z][A-Za-z.'"’ \-()]{2,80}?(?:, (?:Jr\.|Sr\.|II|III|IV))?),? (Republican|Democrat|Independent)(?: Delegate| Resident Commissioner)?(?:,| of)/;
const PHONE = /\((\d{3})\)\s*(\d{3})-(\d{4})\s*$/;

function mostlyUpper(s: string): boolean {
  const letters = [...s].filter((c) => /[A-Za-z]/.test(c));
  return (
    letters.length > 0 && letters.filter((c) => c === c.toUpperCase()).length / letters.length > 0.8
  );
}

export type Office = { address: string; phone: string | null };

export type CdirMember = {
  key: string;
  name: string;
  party: string;
  hometown: string | null;
  state: string | null;
  stateName: string | null;
  chamber: "Senate" | "House" | "Delegate" | "Resident Commissioner" | "Vice President";
  district: string | null;
  bio: string;
  sections: Record<string, string>;
  website: string | null;
  washington: Office | null;
  districtOffices: Office[];
};

const cleanAddress = (s: string) =>
  s
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();

/** Office lines ("address.....  (202) 224-2152") with wrapped continuation lines folded into the previous one. */
function offices(lines: string[]): Office[] {
  const out: Office[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*\*\s+\*\s+\*/.test(line)) continue;
    const m = PHONE.exec(line);
    const text = m ? line.slice(0, m.index) : line;
    const addr = cleanAddress(text);
    const phone = m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
    if (!m && out.length && /^\s/.test(raw)) {
      out[out.length - 1]!.address = cleanAddress(`${out[out.length - 1]!.address} ${addr}`);
      continue;
    }
    if (!addr && phone && out.length && !out[out.length - 1]!.phone) {
      out[out.length - 1]!.phone = phone;
      continue;
    }
    if (addr) out.push({ address: addr, phone });
  }
  return out;
}

/** "born in X; education: ...; professional history: ..." → labelled sections (the label as printed, lowercased). */
export function bioSections(bio: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = bio.split(/;\s+(?=[a-z][a-z /-]{2,40}:\s)/);
  for (const p of parts.slice(1)) {
    const m = /^([a-z][a-z /-]{2,40}):\s+([\s\S]+)$/.exec(p.trim());
    if (m) out[m[1]!] = m[2]!.replace(/\.$/, "").trim();
  }
  const first = parts[0] ?? "";
  const born = /\bborn (?:in )?([^;]+)/.exec(first);
  if (born) out["born"] = born[1]!.trim();
  return out;
}

/** Members, Delegates and Resident Commissioners in printed order. */
export function parseMembers(text: string): CdirMember[] {
  const lines = text.replace(/\r/g, "").split("\n");
  // the member biographies end where the Senate's alphabetical list begins (the last such heading; the first is the contents page)
  let stop = lines.length;
  for (let i = lines.length - 1; i >= 0; i--)
    if (/^\s*ALPHABETICAL LIST OF SENATORS\s*$/i.test(lines[i]!)) {
      stop = i;
      break;
    }
  let stateName: string | null = null;
  let chamber: CdirMember["chamber"] = "Vice President";
  let district: string | null = null;
  const starts: {
    i: number;
    name: string;
    party: string;
    state: string | null;
    stateName: string | null;
    chamber: CdirMember["chamber"];
    district: string | null;
  }[] = [];
  for (let i = 0; i < stop; i++) {
    const l = lines[i]!;
    const t = l.trim();
    if (t && t === t.toUpperCase() && t in STATES) {
      // a state heading: followed within a few lines by the census population table
      const ahead = lines.slice(i + 1, i + 8).join(" ");
      if (/Census Population/i.test(ahead) || /--Congressional Districts--/.test(ahead)) {
        stateName = t;
        district = null;
      }
      continue;
    }
    if (/^SENATORS\b/.test(t) && !/REPRESENTATIVES/.test(t)) {
      chamber = "Senate";
      district = null;
      continue;
    }
    if (/^REPRESENTATIVES$/.test(t)) {
      chamber = "House";
      continue;
    }
    if (/^(DELEGATE|RESIDENT COMMISSIONER)$/.test(t)) {
      chamber = t === "DELEGATE" ? "Delegate" : "Resident Commissioner";
      district = t === "DELEGATE" ? "Delegate" : "Resident Commissioner";
      continue;
    }
    if (/^AT LARGE$/.test(t)) {
      if (chamber !== "Delegate" && chamber !== "Resident Commissioner") {
        chamber = "House";
        district = "At large";
      }
      continue;
    }
    const d = /^([A-Z]+(?:-[A-Z]+)?) DISTRICT$/.exec(t);
    if (d) {
      const n = ordinalNumber(d[1]!);
      if (n !== null) {
        chamber = "House";
        district = String(n);
      }
      continue;
    }
    const m = ENTRY.exec(l);
    if (m && mostlyUpper(m[1]!)) {
      starts.push({
        i,
        name: m[1]!.trim(),
        party: m[2]!,
        state: stateName ? STATES[stateName]! : null,
        stateName,
        chamber: stateName ? chamber : "Vice President",
        district: stateName && chamber !== "Senate" ? district : null,
      });
    }
  }
  const out: CdirMember[] = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]!;
    const next = k + 1 < starts.length ? starts[k + 1]!.i : stop;
    let body = lines.slice(s.i, next);
    const sep = body.findIndex(
      (l, j) =>
        j > 0 &&
        (/^\s*\*\s+\*\s+\*\s*$/.test(l) ||
          /^\s*[A-Z-]+ DISTRICT\s*$/.test(l) ||
          /^\s*(SENATORS|REPRESENTATIVES|AT LARGE|DELEGATE|RESIDENT COMMISSIONER)\s*$/.test(l)),
    );
    if (sep > 0) body = body.slice(0, sep);
    const officeAt = body.findIndex(
      (l) => /^\s*Congressional Office\s*$/.test(l) || /^\s*Office Listings\s*$/i.test(l),
    );
    const bioLines =
      officeAt > 0
        ? body.slice(0, officeAt)
        : body.slice(
            0,
            body.findIndex((l) => !l.trim()) > 0 ? body.findIndex((l) => !l.trim()) : body.length,
          );
    const bio = bioLines.join(" ").replace(/\s+/g, " ").trim();
    const rest = officeAt > 0 ? body.slice(officeAt + 1) : [];
    const website =
      rest.map((l) => /^\s*(https?:\/\/\S+)\s*$/.exec(l)?.[1] ?? null).find(Boolean) ?? null;
    const distAt = rest.findIndex((l) => /^\s*District Offices?\s*$/.test(l));
    const dcLines = (distAt >= 0 ? rest.slice(0, distAt) : rest).filter(
      (l) => !/^\s*https?:\/\//.test(l),
    );
    const dc = offices(dcLines);
    const district = distAt >= 0 ? offices(rest.slice(distAt + 1)) : [];
    const home =
      /^[^,]+,\s+(?:Republican|Democrat|Independent)(?: Delegate| Resident Commissioner)?,?\s+of\s+([^;]+);/
        .exec(bio)?.[1]
        ?.trim() ?? null;
    const key = (
      s.chamber === "Senate"
        ? `${s.state}-sen-${surname(s.name).toLowerCase()}`
        : `${s.state ?? "vp"}-${(s.district ?? "x").toLowerCase().replace(/\s+/g, "-")}`
    ).replace(/[^A-Za-z0-9-]/g, "");
    out.push({
      key,
      name: s.name,
      party: s.party,
      hometown: home,
      state: s.state,
      stateName: s.stateName,
      chamber: s.chamber,
      district: s.district,
      bio,
      sections: bioSections(bio),
      website,
      washington: dc[0] ?? null,
      districtOffices: district,
    });
  }
  return out;
}

/** The surname of a printed name: the last word before a suffix, without quotes ("JAMES C. JUSTICE, Jr." → JUSTICE). */
export function surname(name: string): string {
  const base = name
    .replace(/,\s*(Jr\.|Sr\.|II|III|IV)$/i, "")
    .replace(/"[^"]*"/g, " ")
    .trim();
  const words = base.split(/\s+/).filter(Boolean);
  return (words[words.length - 1] ?? base).replace(/[^A-Za-z'’-]/g, "");
}

export type RosterMember = {
  name: string;
  state: string;
  district: string | null;
  role: string | null;
  side: "majority" | "minority";
  order: number;
};
export type CdirCommittee = {
  key: string;
  chamber: "Senate" | "House" | "Joint";
  name: string;
  room: string | null;
  phones: string[];
  websites: string[];
  members: RosterMember[];
  subcommittees: { name: string; members: RosterMember[] }[];
};

const CELL = /^(.+?) \(([a-z]{2})(?:-(\d{1,2}|at))?\)(?:,?\s+(.+))?$/;

type RosterLine = {
  left?: RosterMember;
  right?: RosterMember;
  cont?: { side: "majority" | "minority"; text: string }[];
};

const ROSTER_MARK = /\([a-z]{2}(?:-[0-9a-z]{1,2})?\)/;
const ROLE_WORDS =
  /^(member|ranking|ranking member|minority member|chair|chairman|chairwoman|vice chair|vice chairman|vice chairwoman|co-chair|cochair)$/;

function parseRosterLine(
  line: string,
  col: number,
  order: { maj: number; min: number },
): RosterLine {
  if (/Room\s|\(ph\)|\(f\)|https?:/.test(line)) return {};
  // split at the first run of two or more spaces after the first cell's state mark; a line that starts in the right
  // column holds the minority side only
  let leftText: string;
  let rightText: string;
  const start = line.search(/\S/);
  const gap = /\s{2,}(?=\S)/g;
  gap.lastIndex = Math.max(0, start);
  const g = start >= 0 ? gap.exec(line) : null;
  if (start >= col - 4) {
    leftText = "";
    rightText = line.trim();
  } else if (g) {
    leftText = line.slice(0, g.index).trim();
    rightText = line.slice(g.index).trim();
  } else {
    leftText = line.trim();
    rightText = "";
  }
  const mk = (text: string, side: "majority" | "minority"): RosterMember | undefined => {
    if (!ROSTER_MARK.test(text)) return undefined;
    const m = CELL.exec(text);
    if (!m) return undefined;
    const n = side === "majority" ? ++order.maj : ++order.min;
    return {
      name: m[1]!.trim(),
      state: m[2]!.toUpperCase(),
      district: m[3] ? (m[3] === "at" ? "At large" : String(Number(m[3]))) : null,
      role: m[4]?.trim() || null,
      side,
      order: n,
    };
  };
  const out: RosterLine = {};
  const l = leftText ? mk(leftText, "majority") : undefined;
  const r = rightText ? mk(rightText, "minority") : undefined;
  if (l) out.left = l;
  if (r) out.right = r;
  // a role wrapped onto the next line ("ranking" / "member") sits in its column without a state mark
  const cont: { side: "majority" | "minority"; text: string }[] = [];
  if (!l && leftText && ROLE_WORDS.test(leftText)) cont.push({ side: "majority", text: leftText });
  if (!r && rightText && ROLE_WORDS.test(rightText))
    cont.push({ side: "minority", text: rightText });
  if (cont.length) out.cont = cont;
  return out;
}

/** The column where the minority side starts in a block of roster lines (the most common start of a second cell). */
function rosterColumn(lines: string[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const close = l.indexOf(")");
    if (close < 0) continue;
    const gap = /\s{2,}(?=\S)/g;
    gap.lastIndex = close + 1;
    const m = gap.exec(l);
    if (!m) continue;
    const at = m.index + m[0].length;
    if (l.indexOf("(", at) < 0) continue;
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  let best = 37;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best;
}

/** Committees of the Senate, House and joint committees with their rosters. */
export function parseCommittees(text: string): CdirCommittee[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const sections: { chamber: CdirCommittee["chamber"]; from: number; to: number }[] = [];
  const at = (re: RegExp, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
  const s0 = at(/^\s*STANDING COMMITTEES OF THE SENATE\s*$/, 20000 > lines.length ? 0 : 0);
  const sIdx: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*STANDING COMMITTEES OF THE SENATE\s*$/.test(l)) sIdx.push(i);
  });
  const senate = sIdx.length ? sIdx[sIdx.length - 1]! : s0;
  const hIdx: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*STANDING COMMITTEES OF THE HOUSE\s*$/.test(l)) hIdx.push(i);
  });
  const house = hIdx.length ? hIdx[hIdx.length - 1]! : -1;
  const jIdx: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*JOINT COMMITTEES\s*$/.test(l) && i > house) jIdx.push(i);
  });
  const joint = jIdx.length ? jIdx[0]! : -1;
  const after =
    joint >= 0
      ? at(
          /^\s*(CONGRESSIONAL ADVISORY|ASSIGNMENTS OF|OFFICERS AND OFFICIALS|BOARDS, COMMISSIONS)/i,
          joint + 1,
        )
      : -1;
  if (senate >= 0 && house > senate) sections.push({ chamber: "Senate", from: senate, to: house });
  if (house >= 0 && joint > house) sections.push({ chamber: "House", from: house, to: joint });
  if (joint >= 0)
    sections.push({
      chamber: "Joint",
      from: joint,
      to: after > joint ? after : Math.min(lines.length, joint + 2500),
    });
  const out: CdirCommittee[] = [];
  for (const sec of sections) {
    const block = lines.slice(sec.from, sec.to);
    // committee headings: a centred line followed within four lines by a "Room" (or "Majority:") line
    const heads: number[] = [];
    block.forEach((l, i) => {
      const t = l.trim();
      if (!t || /^[._\s-]+$/.test(t)) return;
      if (
        /^\[|^\(|Room|Majority:|Minority:|https?:|SUBCOMMITTEES|STANDING COMMITTEES|JOINT COMMITTEES/.test(
          t,
        )
      )
        return;
      if (l.search(/\S/) < 8) return;
      const ahead = block.slice(i + 1, i + 5);
      if (ahead.some((a) => /^\s+(Room\s|Majority:)/.test(a))) heads.push(i);
    });
    for (let h = 0; h < heads.length; h++) {
      const from = heads[h]!;
      const to = h + 1 < heads.length ? heads[h + 1]! : block.length;
      const body = block.slice(from + 1, to);
      const name = block[from]!.trim();
      const head = body.slice(0, 8);
      const room =
        head
          .map((l) => /Room\s+([A-Z0-9-]+(?:\s+[A-Z]{2,5})?)/.exec(l)?.[1] ?? null)
          .find(Boolean) ?? null;
      const phones = [
        ...new Set(
          head.flatMap((l) =>
            [...l.matchAll(/\(ph\)\s*\((\d{3})\)\s*(\d{3})-(\d{4})/g)].map(
              (m) => `(${m[1]}) ${m[2]}-${m[3]}`,
            ),
          ),
        ),
      ];
      const websites = [
        ...new Set(head.flatMap((l) => [...l.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]))),
      ];
      const subAt: { name: string; at: number }[] = [];
      let inSubs = false;
      body.forEach((l, i) => {
        const t = l.trim();
        if (/^SUBCOMMITTEES$/.test(t)) inSubs = true;
        if (!inSubs || !t || /^\[|^SUBCOMMITTEES$|ex officio|members of all/.test(t)) return;
        if (
          t === t.toUpperCase() &&
          /[A-Z]{3}/.test(t) &&
          !/\([a-z]{2}/.test(l) &&
          l.search(/\S/) >= 4
        )
          subAt.push({ name: t, at: i });
      });
      const firstSub = subAt.length ? subAt[0]!.at : body.length;
      const roster = (part: string[]) => {
        const rl = part.filter((l) => ROSTER_MARK.test(l) && !/Room\s|\(ph\)/.test(l));
        const col = rosterColumn(rl);
        const order = { maj: 0, min: 0 };
        const members: RosterMember[] = [];
        let last: Record<"majority" | "minority", RosterMember | null> = {
          majority: null,
          minority: null,
        };
        let note = false;
        for (const l of part) {
          if (/^\s*\[/.test(l)) note = true;
          if (note) {
            if (l.includes("]")) note = false;
            continue;
          }
          if (/^\s*(H or HT|S--|SD--|---|___)/.test(l)) continue;
          const r = parseRosterLine(l, col, order);
          if (r.left) {
            members.push(r.left);
            last.majority = r.left;
          }
          if (r.right) {
            members.push(r.right);
            last.minority = r.right;
          }
          for (const c of r.cont ?? []) {
            const m = last[c.side];
            if (m) m.role = `${m.role ? `${m.role} ` : ""}${c.text}`.trim();
          }
        }
        last = { majority: null, minority: null };
        return members.sort((a, b) =>
          a.side === b.side ? a.order - b.order : a.side === "majority" ? -1 : 1,
        );
      };
      const members = roster(body.slice(0, firstSub));
      const subcommittees = subAt
        .map((s, k) => ({
          name: s.name,
          members: roster(
            body.slice(s.at + 1, k + 1 < subAt.length ? subAt[k + 1]!.at : body.length),
          ),
        }))
        .filter((s) => s.members.length);
      if (!members.length && !subcommittees.length) continue;
      out.push({
        key: `${sec.chamber.toLowerCase()}-${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`.slice(0, 90),
        chamber: sec.chamber,
        name,
        room,
        phones,
        websites,
        members,
        subcommittees,
      });
    }
  }
  return out;
}

/** The directory's closing date ("Closing date for compilation of the Congressional Directory was October 1, 2025."). */
export function closingDate(text: string): string | null {
  const m =
    /Closing date for compilation of the Congressional\s+Directory was ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(
      text,
    );
  if (!m) return null;
  const d = new Date(`${m[1]} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function latestCdir(html: string): string | null {
  const found = [...html.matchAll(/CDIR-(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!);
  return found.length ? `CDIR-${found.sort().reverse()[0]}` : null;
}

type MemberLink = { bioguide: string; name: string };

/** Current congress_members keyed for exact seat matches: "IL-12" for House seats, "IL-sen-DURBIN" for Senators. */
export async function readMemberSeats(ctx: CollectContext): Promise<Map<string, MemberLink>> {
  const rows = await ctx.corpus.query(
    "corpus_records?select=id,c:item->cells&dataset=eq.congress_members&item->cells->>current=eq.yes&order=id.asc&limit=1000",
  );
  const seats = new Map<string, MemberLink[]>();
  const add = (k: string, v: MemberLink) => seats.set(k, [...(seats.get(k) ?? []), v]);
  for (const r of rows) {
    const c = (r["c"] ?? {}) as Record<string, unknown>;
    const st = typeof c["state_code"] === "string" ? c["state_code"] : null;
    const chamber = typeof c["chamber"] === "string" ? c["chamber"] : "";
    const name = typeof c["name"] === "string" ? c["name"] : "";
    const id = String(r["id"] ?? "");
    if (!st || !/^[A-Z]\d{6}$/.test(id)) continue;
    if (/Senate/i.test(chamber)) {
      const last = name.split(",")[0]?.trim().toUpperCase() ?? "";
      if (last) add(`${st}-sen-${last.toLowerCase()}`, { bioguide: id, name });
    } else {
      const d =
        typeof c["district"] === "string" || typeof c["district"] === "number"
          ? String(c["district"])
          : null;
      add(`${st}-${d && d !== "0" ? String(Number(d)) : "at-large"}`, { bioguide: id, name });
    }
  }
  const unique = new Map<string, MemberLink>();
  for (const [k, v] of seats) if (v.length === 1) unique.set(k, v[0]!);
  return unique;
}

function seatKey(m: CdirMember): string {
  if (m.chamber === "Senate") return `${m.state}-sen-${surname(m.name).toLowerCase()}`;
  if (
    m.district === "At large" ||
    m.chamber === "Delegate" ||
    m.chamber === "Resident Commissioner"
  )
    return `${m.state}-at-large`;
  return `${m.state}-${m.district}`;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s.'"’(-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`);

export function memberRow(
  m: CdirMember,
  pkg: string,
  closing: string | null,
  link: MemberLink | null,
): CorpusRow {
  const seat =
    m.chamber === "Senate"
      ? "Senator"
      : m.chamber === "House"
        ? m.district === "At large"
          ? "Representative, at large"
          : `Representative, district ${m.district}`
        : m.chamber;
  const display = titleCase(m.name);
  return corpusRecord(
    CDIR_MEMBERS,
    `cdir:${m.key}`,
    `${display} (${m.party}, ${m.state ?? "US"})`,
    {
      source_url: cdirPageUrl(pkg),
      subtitle: [
        seat,
        m.stateName ? titleCase(m.stateName) : null,
        `Congressional Directory ${pkg.replace(/^CDIR-/, "")}`,
      ]
        .filter(Boolean)
        .join(" · "),
      state: m.state ?? "",
      cells: {
        name: display,
        party: m.party,
        state: m.state,
        chamber: m.chamber,
        district: m.district,
        hometown: m.hometown,
        bioguide: link?.bioguide ?? null,
        washington_phone: m.washington?.phone ?? null,
        district_offices: m.districtOffices.length,
        website: m.website,
      },
      facts: [
        ["Name as printed", m.name],
        ["Party", m.party],
        ["Seat", seat],
        ...(m.hometown ? [["Of", m.hometown] as [string, string]] : []),
        ...Object.entries(m.sections)
          .slice(0, 8)
          .map(([k, v]) => [k[0]!.toUpperCase() + k.slice(1), v] as [string, string]),
        [
          "Washington office",
          m.washington
            ? `${m.washington.address}${m.washington.phone ? `, ${m.washington.phone}` : ""}`
            : "Not recorded",
        ],
        [
          "Directory",
          `Official Congressional Directory (${pkg}), members as of ${closing ?? "the closing date it states"}`,
        ],
        [
          "Profile link",
          link
            ? `congress_members ${link.bioguide} (exact seat match)`
            : "No unique exact seat match",
        ],
      ],
      text: `${m.name} ${m.party} ${m.stateName ?? ""} ${m.bio}`.slice(0, 8000),
      filters: {
        chamber: [m.chamber],
        party: [m.party],
        state: [m.state ?? "US"],
        ...(link ? { bioguide: [link.bioguide] } : {}),
      },
      links: [
        { label: "Congressional Directory on GovInfo", url: cdirPageUrl(pkg) },
        ...(m.website ? [{ label: "Official website", url: m.website }] : []),
        ...(link
          ? [{ label: "Member profile", url: `/records/congress_members/${link.bioguide}` }]
          : []),
      ],
      extra: {
        cdir: {
          package: pkg,
          closing_date: closing,
          name: m.name,
          party: m.party,
          hometown: m.hometown,
          state: m.state,
          chamber: m.chamber,
          district: m.district,
          bio: m.bio,
          sections: m.sections,
          website: m.website,
          washington: m.washington,
          district_offices: m.districtOffices,
          bioguide: link?.bioguide ?? null,
          link_basis: link
            ? m.chamber === "Senate"
              ? "state and surname, unique among current Senators"
              : "state and district seat"
            : null,
        } as unknown as JsonObject,
      },
    },
  );
}

export function committeeRow(c: CdirCommittee, pkg: string, closing: string | null): CorpusRow {
  const chair = c.members.find((m) => m.role && /^(chair|chairman|chairwoman)$/i.test(m.role));
  const ranking = c.members.find((m) => m.role && /ranking/i.test(m.role));
  return corpusRecord(
    CDIR_COMMITTEES,
    `cdir-committee:${c.key}`,
    `${c.chamber === "Joint" ? "Joint" : c.chamber} Committee: ${c.name}`,
    {
      source_url: cdirPageUrl(pkg),
      subtitle: `${c.members.length} members · ${c.subcommittees.length} subcommittees · Congressional Directory ${pkg.replace(/^CDIR-/, "")}`,
      cells: {
        committee: c.name,
        chamber: c.chamber,
        members: c.members.length,
        subcommittees: c.subcommittees.length,
        chair: chair ? `${chair.name} (${chair.state})` : null,
        ranking_member: ranking ? `${ranking.name} (${ranking.state})` : null,
        room: c.room,
      },
      facts: [
        ["Committee", c.name],
        ["Chamber", c.chamber],
        ["Room", c.room ?? "Not recorded"],
        ["Phone", c.phones.join("; ") || "Not recorded"],
        [
          "Roles",
          "As printed after each name; the columns are the directory's majority and minority sides.",
        ],
        [
          "Directory",
          `Official Congressional Directory (${pkg}), as of ${closing ?? "its closing date"}`,
        ],
      ],
      text: `${c.name} ${c.chamber} committee ${[...c.members, ...c.subcommittees.flatMap((s) => s.members)].map((m) => m.name).join(" ")} ${c.subcommittees.map((s) => s.name).join(" ")}`.slice(
        0,
        8000,
      ),
      filters: { chamber: [c.chamber] },
      links: [
        { label: "Congressional Directory on GovInfo", url: cdirPageUrl(pkg) },
        ...c.websites.map((w, i) => ({
          label: i === 0 ? "Committee website" : "Committee website (minority)",
          url: w,
        })),
      ],
      extra: {
        committee: {
          package: pkg,
          closing_date: closing,
          name: c.name,
          chamber: c.chamber,
          room: c.room,
          phones: c.phones,
          websites: c.websites,
          members: c.members,
          subcommittees: c.subcommittees,
        } as unknown as JsonObject,
      },
    },
  );
}

async function readDirectory(
  ctx: CollectContext,
  notes: JsonObject,
): Promise<{ pkg: string; text: string }> {
  let pkg = CDIR_DEFAULT;
  try {
    const page = await ctx.http.getText("https://www.govinfo.gov/app/collection/cdir");
    const found = page.status === 200 ? latestCdir(page.text) : null;
    if (found && found > pkg) pkg = found;
  } catch {
    notes["collection_page"] = "unreadable";
  }
  if (!ctx.http.getBytes) throw new Error("this run's HTTP client cannot read binary files");
  const res = await ctx.http.getBytes(cdirZipUrl(pkg));
  if (res.status !== 200) throw new Error(`Congressional Directory ZIP HTTP ${res.status}`);
  const t = await zipText(res.bytes, (n) => /\/text\/[^/]+\.txt$/i.test(n));
  if (!t) throw new Error("the directory package has no text file");
  notes["edition"] = pkg;
  return { pkg, text: t.text };
}

const dedupe = (rows: CorpusRow[], held: { key: string; reason: string }[]) => {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) {
      held.push({ key: r.id, reason: "same seat or committee printed twice" });
      return false;
    }
    seen.add(r.id);
    return true;
  });
};

export const cdirMembers: SourceAdapter = {
  source: "cdir_members",
  dataset: CDIR_MEMBERS,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-reference",
  limits: { maxRequests: 4, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    const notes: JsonObject = {};
    const { pkg, text } = await readDirectory(ctx, notes);
    const closing = closingDate(text);
    const members = parseMembers(text).filter((m) => m.chamber !== "Vice President");
    if (members.length < 400)
      throw new Error(`only ${members.length} members read from the directory`);
    const seats = await readMemberSeats(ctx);
    const held: { key: string; reason: string }[] = [];
    const rows = dedupe(
      members.map((m) => memberRow(m, pkg, closing, seats.get(seatKey(m)) ?? null)),
      held,
    );
    notes["members"] = members.length;
    notes["linked"] = rows.filter((r) => (r.filters as JsonObject)["bioguide"]).length;
    notes["closing_date"] = closing;
    return {
      rows,
      fetched: members.length,
      held,
      cursorAfter: { edition: pkg },
      complete: true,
      notes,
    };
  },
  comparable: (c: RowContent): Json => c as unknown as Json,
};

export const cdirCommittees: SourceAdapter = {
  source: "cdir_committees",
  dataset: CDIR_COMMITTEES,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-reference",
  limits: { maxRequests: 4, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    const notes: JsonObject = {};
    const { pkg, text } = await readDirectory(ctx, notes);
    const closing = closingDate(text);
    const committees = parseCommittees(text);
    if (committees.length < 30)
      throw new Error(`only ${committees.length} committees read from the directory`);
    const held: { key: string; reason: string }[] = [];
    const rows = dedupe(
      committees.map((c) => committeeRow(c, pkg, closing)),
      held,
    );
    notes["committees"] = committees.length;
    notes["by_chamber"] = committees.reduce<Record<string, number>>((m, c) => {
      m[c.chamber] = (m[c.chamber] ?? 0) + 1;
      return m;
    }, {}) as unknown as Json;
    return {
      rows,
      fetched: committees.length,
      held,
      cursorAfter: { edition: pkg },
      complete: true,
      notes,
    };
  },
  comparable: (c: RowContent): Json => c as unknown as Json,
};
