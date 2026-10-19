import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import data from "./portraits.server.json";
import { portraitForJudge } from "./portraits.server";

const people = data.people as Record<
  string,
  {
    assetPath: string;
    sha256: string;
    license: string;
    sourceLabel: string;
    sourceUrl: string | null;
  }
>;
const judges = data.judges as Record<string, number>;

describe("judge portraits", () => {
  it("keeps only government-work portraits with a checksum-verified local copy", () => {
    expect(Object.keys(people).length).toBeGreaterThan(10);
    for (const [person, entry] of Object.entries(people)) {
      expect(["Work of Federal Government", "Work of State Government"]).toContain(entry.license);
      expect(entry.assetPath).toBe(`/judge-portraits/${person}.jpeg`);
      const bytes = readFileSync(resolve(process.cwd(), "public", entry.assetPath.slice(1)));
      expect(createHash("sha256").update(bytes).digest("hex"), person).toBe(entry.sha256);
      expect(entry.sourceLabel.length).toBeGreaterThan(0);
      if (entry.sourceUrl) expect(entry.sourceUrl).toMatch(/^https?:\/\//);
      expect(entry.sourceUrl ?? "").not.toMatch(/github\.com/);
    }
  });

  it("maps a judge record only to its linked person and never by name", () => {
    for (const person of Object.values(judges)) expect(people[String(person)]).toBeDefined();
    const [judgeId, person] = Object.entries(judges)[0]!;
    expect(portraitForJudge(judgeId)?.assetPath).toBe(`/judge-portraits/${person}.jpeg`);
    expect(
      portraitForJudge(judgeId.toUpperCase() === judgeId ? `${judgeId}x` : judgeId.toUpperCase()),
    ).toBeNull();
    expect(portraitForJudge("constructor")).toBeNull();
    expect(portraitForJudge("__proto__")).toBeNull();
    expect(portraitForJudge("")).toBeNull();
  });
});
