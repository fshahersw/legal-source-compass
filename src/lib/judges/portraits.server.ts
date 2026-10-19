/** Judge portraits keyed by the linked CourtListener person. Server-only (written by scripts/visuals/acquire_judge_portraits.py). */
import data from "./portraits.server.json";

export type JudgePortrait = {
  assetPath: string;
  width: number;
  height: number;
  license: string;
  artist: string | null;
  dateCreated: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
};

type Stored = JudgePortrait & {
  sha256: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
};

const people = data.people as Record<string, Stored>;
const judges = data.judges as Record<string, number>;

/** The portrait of the CourtListener person this judge record is linked to by an exact-evidence crosswalk tier, if any. */
export function portraitForJudge(judgeId: string): JudgePortrait | null {
  const person = Object.hasOwn(judges, judgeId) ? judges[judgeId] : undefined;
  const stored = person === undefined ? undefined : people[String(person)];
  if (!stored) return null;
  return {
    assetPath: stored.assetPath,
    width: stored.width,
    height: stored.height,
    license: stored.license,
    artist: stored.artist,
    dateCreated: stored.dateCreated,
    sourceLabel: stored.sourceLabel,
    sourceUrl: stored.sourceUrl,
  };
}
