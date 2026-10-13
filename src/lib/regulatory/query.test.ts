import { describe, expect, it } from "vitest";
import {
  datesInQuery,
  interpretGuidedQuery,
  regulatoryQueryInputSchema,
  relativeQueryWindow,
  validateQueryModel,
  type RegulatoryQueryInput,
} from "./query";
import { interpretRegulatoryQueryServer, regulatoryQueryCapability } from "./query.server";

const now = new Date("2026-10-12T18:00:00Z");
const input = (
  content: string,
  currentQuery: RegulatoryQueryInput["currentQuery"] = {},
): RegulatoryQueryInput => ({ turns: [{ role: "user", content }], currentQuery });
const candidate = (field: string, value: string | null, quote: string, turnIndex = 0) => ({
  field,
  value,
  quote,
  turnIndex,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("regulatory natural-language query planning", () => {
  it("retains changed source and text intent through an early date clarification", () => {
    const previous = {
      source: "fda_recall_notices" as const,
      q: "old term",
      dateBasis: "published" as const,
    };
    const firstRequest = input('CPSC records containing "charger" during 2025', previous);
    for (const first of [
      interpretGuidedQuery(firstRequest, now),
      validateQueryModel({ candidates: [], question: "none" }, firstRequest, now),
    ]) {
      expect(first.pendingQuestions).toEqual(["date_range", "source", "search_term"]);
      const datedRequest = {
        ...input("published from 2025-01-01 to 2025-12-31", first.query),
        pendingQuestions: first.pendingQuestions,
      };
      const dated = interpretGuidedQuery(datedRequest, now);
      const modelDated = validateQueryModel(
        {
          candidates: [
            candidate("from", "2025-01-01", "2025-01-01"),
            candidate("to", "2025-12-31", "2025-12-31"),
            candidate("dateBasis", "published", "published"),
          ],
          question: "none",
        },
        datedRequest,
        now,
      );
      for (const result of [dated, modelDated]) {
        expect(result.status).toBe("clarification");
        expect(result.pendingQuestions).toEqual(["source", "search_term"]);
        const resolved = interpretGuidedQuery(
          {
            ...input('CPSC containing "charger"', result.query),
            pendingQuestions: result.pendingQuestions,
          },
          now,
        );
        expect(resolved.status).toBe("ready");
        expect(resolved.query).toMatchObject({
          source: "cpsc_recalls",
          q: "charger",
          from: "2025-01-01",
          to: "2025-12-31",
        });
      }
    }
    expect(
      interpretGuidedQuery(input("Records from EPA during 2025", previous), now).pendingQuestions,
    ).toContain("source");
  });
  it("holds out-of-range and malformed numeric day windows instead of ignoring them", () => {
    for (const duration of ["0", "367", "1000", "0007", "-1", "1.5", "1,000"]) {
      const request = input(`FDA published in the past ${duration} days`);
      expect(interpretGuidedQuery(request, now).pendingQuestions, duration).toContain("date_range");
      expect(
        validateQueryModel({ candidates: [], question: "none" }, request, now).pendingQuestions,
        duration,
      ).toContain("date_range");
    }
    expect(interpretGuidedQuery(input("FDA published in the past 366 days"), now).status).toBe(
      "ready",
    );
  });
  it("clarifies exclusive wording instead of treating after or before as inclusive", () => {
    const previous = { from: "2026-01-01", to: "2026-12-31", dateBasis: "published" as const };
    for (const phrase of ["FDA published after 2026-03-01", "FDA published before March 1, 2026"]) {
      for (const result of [
        interpretGuidedQuery(input(phrase, previous), now),
        validateQueryModel({ candidates: [], question: "none" }, input(phrase, previous), now),
      ]) {
        expect(result.status).toBe("clarification");
        expect(result.pendingQuestions).toContain("date_range");
        expect(result.question).toContain("Bounds include both dates");
        expect(result.query).toEqual({ ...previous, offset: 0 });
      }
    }
  });
  it("rejects wrong-end, collapsed-range and incomplete single-day model bounds", () => {
    const previous = { from: "2026-01-01", to: "2026-12-31", dateBasis: "published" as const };
    const cases = [
      {
        phrase: "FDA published since 2026-03-01",
        candidates: [candidate("to", "2026-03-01", "2026-03-01")],
      },
      {
        phrase: "FDA published through 2026-03-01",
        candidates: [candidate("from", "2026-03-01", "2026-03-01")],
      },
      {
        phrase: "FDA published from 2026-03-01 to 2026-03-31",
        candidates: [
          candidate("from", "2026-03-01", "2026-03-01"),
          candidate("to", "2026-03-01", "2026-03-01"),
        ],
      },
      {
        phrase: "FDA published on 2026-03-01",
        candidates: [candidate("from", "2026-03-01", "2026-03-01")],
      },
      {
        phrase: "FDA published since 2026-03-01",
        candidates: [
          candidate("from", "2026-03-01", "2026-03-01"),
          candidate("to", "2026-03-01", "2026-03-01"),
        ],
      },
    ];
    for (const item of cases) {
      const result = validateQueryModel(
        { candidates: item.candidates, question: "none" },
        input(item.phrase, previous),
        now,
      );
      expect(result.status, item.phrase).toBe("clarification");
      expect(result.pendingQuestions).toContain("date_range");
      expect(result.query, item.phrase).toEqual({ ...previous, offset: 0 });
    }
  });
  it("matches exact inclusive date intent in guided and model proposals", () => {
    const previous = { from: "2026-01-01", to: "2026-12-31", dateBasis: "published" as const };
    for (const prefix of ["since", "from", "starting on"]) {
      const request = input(`FDA published ${prefix} 2026-03-01`, previous);
      expect(interpretGuidedQuery(request, now).query).toMatchObject({
        from: "2026-03-01",
        to: previous.to,
      });
      expect(
        validateQueryModel(
          {
            candidates: [
              candidate("from", "2026-03-01", "2026-03-01"),
              candidate("dateBasis", "published", "published"),
            ],
            question: "none",
          },
          request,
          now,
        ).status,
      ).toBe("ready");
    }
    for (const prefix of ["until", "through", "ending on"]) {
      const request = input(`FDA published ${prefix} 2026-03-01`, previous);
      expect(interpretGuidedQuery(request, now).query).toMatchObject({
        from: previous.from,
        to: "2026-03-01",
      });
      expect(
        validateQueryModel(
          {
            candidates: [
              candidate("to", "2026-03-01", "2026-03-01"),
              candidate("dateBasis", "published", "published"),
            ],
            question: "none",
          },
          request,
          now,
        ).status,
      ).toBe("ready");
    }
    const request = input("Records from FDA published on 2026-03-01", previous);
    expect(interpretGuidedQuery(request, now).query).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-01",
    });
    expect(
      validateQueryModel(
        {
          candidates: [
            candidate("from", "2026-03-01", "2026-03-01"),
            candidate("to", "2026-03-01", "2026-03-01"),
            candidate("dateBasis", "published", "published"),
          ],
          question: "none",
        },
        request,
        now,
      ).status,
    ).toBe("ready");
  });
  it("holds unsupported date clauses even when the model omits them or chooses one window", () => {
    const previous = {
      sourceFamily: "cpsc" as const,
      from: "2026-09-01",
      to: "2026-09-30",
      dateBasis: "published" as const,
    };
    for (const phrase of [
      "FDA records published on 2026-01-01, 2026-02-01 and 2026-03-01",
      "FDA records published during 2025",
      "FDA records published during 2025-2026",
      'FDA records published during "2025"',
      "FDA records published in the fiscal year 2025",
      "FDA published from January 1, 2026 to January 31, 2026 or from March 1, 2026 to March 31, 2026",
      "FDA published last month or today",
      "FDA published in the past 7 days or on 2026-01-01",
      "FDA published on 2026-01-01 or 2026-03-01",
      "FDA published on January 1, 2026 and March 1, 2026",
    ]) {
      const request = input(phrase, previous);
      for (const result of [
        interpretGuidedQuery(request, now),
        validateQueryModel({ candidates: [], question: "none" }, request, now),
        validateQueryModel(
          { candidates: [candidate("sourceFamily", "fda", "FDA")], question: "none" },
          request,
          now,
        ),
      ]) {
        expect(result.status, phrase).toBe("clarification");
        expect(result.pendingQuestions, phrase).toContain("date_range");
        expect(result.query, phrase).toEqual({ ...previous, offset: 0 });
      }
    }
  });
  it("holds model proposals that omit an explicit requested date or part of a window", () => {
    const previous = { from: "2026-09-01", to: "2026-09-30", dateBasis: "published" as const };
    for (const phrase of [
      "FDA published on 2026-01-01",
      "FDA published from 2026-01-01 to 2026-01-31",
      "FDA published in the past 7 days",
    ]) {
      const result = validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA")], question: "none" },
        input(phrase, previous),
        now,
      );
      expect(result.status).toBe("clarification");
      expect(result.pendingQuestions).toContain("date_range");
    }
    expect(
      validateQueryModel(
        { candidates: [candidate("from", "2026-01-01", "2026-01-01")], question: "none" },
        input("FDA published from 2026-01-01 to 2026-01-31", previous),
        now,
      ).pendingQuestions,
    ).toContain("date_range");
  });
  it("allows one contiguous explicit range and one complete relative window", () => {
    for (const phrase of [
      "FDA published between January 1, 2026 and January 31, 2026",
      "FDA published from 2026-01-01 to 2026-01-31",
    ])
      expect(interpretGuidedQuery(input(phrase), now).status).toBe("ready");
    const result = validateQueryModel(
      {
        candidates: [
          candidate("from", "2026-10-06", "past 7 days"),
          candidate("to", "2026-10-12", "past 7 days"),
          candidate("dateBasis", "published", "published"),
        ],
        question: "none",
      },
      input("FDA published in the past 7 days"),
      now,
    );
    expect(result.status).toBe("ready");
    expect(result.query).toMatchObject({ from: "2026-10-06", to: "2026-10-12" });
  });
  it("keeps date clarification pending until an exact supported range is supplied", () => {
    const first = interpretGuidedQuery(input("FDA published during 2025"), now);
    const unrelated = {
      ...input("FDA", first.query),
      pendingQuestions: first.pendingQuestions,
    };
    expect(interpretGuidedQuery(unrelated, now).pendingQuestions).toContain("date_range");
    expect(
      validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA")], question: "none" },
        unrelated,
        now,
      ).pendingQuestions,
    ).toContain("date_range");
    const resolved = interpretGuidedQuery(
      {
        ...input("FDA published from 2025-01-01 through 2025-12-31", first.query),
        pendingQuestions: first.pendingQuestions,
      },
      now,
    );
    expect(resolved.status).toBe("ready");
    expect(resolved.query).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("retains quoted years as search text without treating them as date clauses", () => {
    for (const [quote, term] of [
      ['"2025"', "2025"],
      ["“2025”", "2025"],
      ['"during 2025"', "during 2025"],
    ]) {
      const request = input(`FDA records containing ${quote}`);
      const guided = interpretGuidedQuery(request, now);
      const model = validateQueryModel(
        { candidates: [candidate("q", term!, quote!)], question: "none" },
        request,
        now,
      );
      for (const result of [guided, model]) {
        expect(result.status).toBe("ready");
        expect(result.query?.q).toBe(term);
        expect(result.query?.from).toBeUndefined();
        expect(result.query?.to).toBeUndefined();
      }
    }
    expect(interpretGuidedQuery(input("FDA search for 2026-12345"), now).status).toBe("ready");
  });
  it("does not silently omit a missing year or an unsupported calendar window", () => {
    for (const phrase of [
      "FDA published October 12",
      "FDA since 2026-2-01",
      "FDA March 2026",
      "FDA last quarter",
      "FDA past 3 months",
    ]) {
      expect(interpretGuidedQuery(input(phrase), now).status).toBe("clarification");
      expect(
        validateQueryModel({ candidates: [], question: "none" }, input(phrase), now).status,
      ).toBe("clarification");
    }
  });
  it("does not let model output silently discard source exclusions or alternative sources", () => {
    const excluded = validateQueryModel(
      { candidates: [], question: "none" },
      input("all sources except FDA"),
      now,
    );
    expect(excluded.status).toBe("clarification");
    const narrowed = validateQueryModel(
      { candidates: [candidate("sourceFamily", "fda", "FDA")], question: "none" },
      input("FDA and NHTSA"),
      now,
    );
    expect(narrowed.status).toBe("clarification");
    expect(narrowed.query?.sourceFamily).toBeUndefined();
  });
  it("retains every unresolved ambiguity across guided and model follow-ups", () => {
    const first = interpretGuidedQuery(
      input('FDA and NHTSA about "contamination" in the past 7 days'),
      now,
    );
    expect(first.pendingQuestions).toEqual(["source", "date_basis"]);
    const dated = interpretGuidedQuery(
      { ...input("publication date", first.query), pendingQuestions: first.pendingQuestions },
      now,
    );
    expect(dated.status).toBe("clarification");
    expect(dated.pendingQuestions).toEqual(["source"]);
    const resolved = interpretGuidedQuery(
      { ...input("FDA", dated.query), pendingQuestions: dated.pendingQuestions },
      now,
    );
    expect(resolved.status).toBe("ready");
    expect(resolved.query).toMatchObject({
      sourceFamily: "fda",
      dateBasis: "published",
      q: "contamination",
    });
    const modelDated = validateQueryModel(
      { candidates: [candidate("dateBasis", "published", "publication")], question: "none" },
      { ...input("publication", first.query), pendingQuestions: first.pendingQuestions },
      now,
    );
    expect(modelDated.status).toBe("clarification");
    expect(modelDated.pendingQuestions).toEqual(["source"]);
  });
  it("proposes exact supported filters and clears pagination", () => {
    const result = interpretGuidedQuery(
      input('FDA warning letters containing "sterility", published in the past 30 days', {
        offset: 50,
      }),
      now,
    );
    expect(result.status).toBe("ready");
    expect(result.query).toEqual({
      source: "fda_warning_letters",
      q: "sterility",
      from: "2026-09-13",
      to: "2026-10-12",
      dateBasis: "published",
      offset: 0,
    });
    expect(result.summary).toContain("publication");
  });
  it("clarifies date meaning and retains proposed selections for a follow-up", () => {
    const first = interpretGuidedQuery(input("FDA about contamination in the past 7 days"), now);
    expect(first.status).toBe("clarification");
    expect(first.question).toContain("publication");
    const next = interpretGuidedQuery(input("publication date", first.query), now);
    expect(next.status).toBe("ready");
    expect(next.query).toMatchObject({
      sourceFamily: "fda",
      q: "contamination",
      dateBasis: "published",
      from: "2026-10-06",
    });
  });
  it("does not turn a broad FDA query into an arbitrary single feed", () => {
    expect(interpretGuidedQuery(input("FDA"), now).query).toMatchObject({ sourceFamily: "fda" });
    expect(interpretGuidedQuery(input("FDA and NHTSA"), now).status).toBe("clarification");
  });
  it("does not merge multiple phrases into an unsupported boolean search", () => {
    const result = interpretGuidedQuery(
      input('FDA containing "sterility" or "contamination"'),
      now,
    );
    expect(result.status).toBe("clarification");
    expect(result.query?.q).toBeUndefined();
  });
  it("resolves calendar windows explicitly and rejects invalid dates", () => {
    expect(relativeQueryWindow("last month", now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(relativeQueryWindow("past 0 days", now)).toBeNull();
    expect(datesInQuery("2026-02-30 and February 28, 2026")).toEqual(["2026-02-28"]);
    expect(interpretGuidedQuery(input("NHTSA from 01/02/2026"), now).status).toBe("clarification");
    expect(
      interpretGuidedQuery(input("FDA published from 2026-10-12 to 2026-10-01"), now).status,
    ).toBe("clarification");
  });
  it("clears only filters explicitly requested and preserves exact entity context", () => {
    const result = interpretGuidedQuery(
      input("all sources", {
        source: "cpsc_recalls",
        q: "charger",
        entityNamespace: "cpsc-recall",
        entityId: "123",
      }),
      now,
    );
    expect(result.query).toEqual({
      q: "charger",
      entityNamespace: "cpsc-recall",
      entityId: "123",
      offset: 0,
    });
  });
  it("refuses to label incidence or causation as a supported search answer", () => {
    const result = interpretGuidedQuery(
      input("Calculate the injury incidence caused by this device"),
      now,
    );
    expect(result.status).toBe("clarification");
    expect(result.question).toContain("additional review");
  });
  it("validates literal user support for all model-proposed values", () => {
    const value = input('FDA containing "sterility", published from 2026-10-01 to 2026-10-12');
    const result = validateQueryModel(
      {
        candidates: [
          candidate("sourceFamily", "fda", "FDA"),
          candidate("q", "sterility", '"sterility"'),
          candidate("dateBasis", "published", "published"),
          candidate("from", "2026-10-01", "2026-10-01"),
          candidate("to", "2026-10-12", "2026-10-12"),
        ],
        question: "none",
      },
      value,
      now,
    );
    expect(result.status).toBe("ready");
    expect(result.query).toMatchObject({
      sourceFamily: "fda",
      q: "sterility",
      dateBasis: "published",
      from: "2026-10-01",
      to: "2026-10-12",
    });
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("q", "proven negligence", "FDA")], question: "none" },
        value,
        now,
      ),
    ).toThrow("Unsupported query value");
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("source", "nhtsa_recalls", "FDA")], question: "none" },
        value,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("from", "2027-01-01", "2026-10-01")], question: "none" },
        value,
        now,
      ),
    ).toThrow();
  });
  it("rejects assistant evidence, invented quotes, ungrounded clears and conflicting assignments", () => {
    const value: RegulatoryQueryInput = {
      turns: [
        { role: "assistant", content: "FDA" },
        { role: "user", content: "CPSC" },
      ],
      currentQuery: {},
    };
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA", 0)], question: "none" },
        value,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA", 1)], question: "none" },
        value,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("q", null, "CPSC", 1)], question: "none" },
        value,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateQueryModel(
        {
          candidates: [
            candidate("sourceFamily", "cpsc", "CPSC", 1),
            candidate("sourceFamily", "cpsc", "CPSC", 1),
          ],
          question: "none",
        },
        value,
        now,
      ),
    ).toThrow();
  });
  it("rejects arbitrary query fields, overlong conversations and malformed entity filters", () => {
    expect(
      regulatoryQueryInputSchema.safeParse({
        ...input("FDA"),
        currentQuery: { sql: "select secret" },
      }).success,
    ).toBe(false);
    expect(regulatoryQueryInputSchema.safeParse(input("x".repeat(2001))).success).toBe(false);
    expect(regulatoryQueryInputSchema.safeParse(input("FDA", { entityId: "123" })).success).toBe(
      false,
    );
  });
  it("does not include a negated source or replay a superseded request", () => {
    expect(interpretGuidedQuery(input("not FDA"), now).query?.sourceFamily).toBeUndefined();
    expect(interpretGuidedQuery(input("not FDA"), now).status).toBe("clarification");
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA")], question: "none" },
        input("not FDA"),
        now,
      ),
    ).toThrow();
    const turns: RegulatoryQueryInput = {
      turns: [
        { role: "user", content: "FDA" },
        { role: "user", content: "NHTSA instead" },
      ],
      currentQuery: { sourceFamily: "fda" },
    };
    expect(() =>
      validateQueryModel(
        { candidates: [candidate("sourceFamily", "fda", "FDA", 0)], question: "none" },
        turns,
        now,
      ),
    ).toThrow();
    expect(
      regulatoryQueryInputSchema.safeParse(
        input("FDA", { sourceFamily: "fda", source: "nhtsa_recalls" }),
      ).success,
    ).toBe(false);
  });
  it("does not let a clearing phrase override an exclusion elsewhere in the turn", () => {
    const previous = {
      q: "synthetic subject",
      from: "2026-01-01",
      dateBasis: "published" as const,
    };
    for (const text of [
      "all sources except FDA",
      "remove dates, not FDA",
      "all records without NHTSA",
      "no FDA",
    ]) {
      const result = interpretGuidedQuery(input(text, previous), now);
      expect(result.status).toBe("clarification");
      expect(result.query).toEqual({ ...previous, offset: 0 });
      expect(result.limitations.join(" ")).toContain("no inclusion filter was inferred");
    }
    const clear = interpretGuidedQuery(
      input("without text filter", { ...previous, sourceFamily: "fda" }),
      now,
    );
    expect(clear.status).toBe("ready");
    expect(clear.query).toEqual({
      from: previous.from,
      dateBasis: "published",
      sourceFamily: "fda",
      offset: 0,
    });
  });
  it("requires model clearing evidence specific to the field and not a negated instruction", () => {
    for (const [field, phrase] of [
      ["q", "all sources"],
      ["from", "all records"],
      ["to", "clear source"],
      ["sourceFamily", "not all sources"],
    ]) {
      expect(() =>
        validateQueryModel(
          { candidates: [candidate(field!, null, phrase!)], question: "none" },
          input(phrase!, { q: "synthetic", from: "2026-01-01", sourceFamily: "fda" }),
          now,
        ),
      ).toThrow("Unsupported clearing operation");
    }
    const result = validateQueryModel(
      { candidates: [candidate("q", null, "no text filter")], question: "none" },
      input("no text filter", {
        q: "synthetic",
        sourceFamily: "fda",
        from: "2026-01-01",
        dateBasis: "published",
      }),
      now,
    );
    expect(result.query).toEqual({
      sourceFamily: "fda",
      from: "2026-01-01",
      dateBasis: "published",
      offset: 0,
    });
  });
  it("clarifies an invalid or ambiguous date even when another valid date is present", () => {
    for (const text of [
      "FDA published from 2026-02-30 to 2026-03-03",
      "FDA published from February 30, 2026 to March 3, 2026",
      "FDA published from 01/02/2026 to 2026-03-03",
    ]) {
      const previous = { sourceFamily: "cpsc" as const, dateBasis: "published" as const };
      const guided = interpretGuidedQuery(input(text, previous), now);
      expect(guided.status).toBe("clarification");
      expect(guided.question).toContain("exact date range");
      expect(guided.query).toEqual({ ...previous, offset: 0 });
      const model = validateQueryModel(
        { candidates: [candidate("from", "2026-03-03", "2026-03-03")], question: "none" },
        input(text, previous),
        now,
      );
      expect(model.status).toBe("clarification");
      expect(model.query).toEqual({ ...previous, offset: 0 });
    }
  });
  it("preserves textual date order when named and ISO forms are mixed", () => {
    expect(
      interpretGuidedQuery(input("FDA published from January 1, 2026 to 2026-02-01"), now).query,
    ).toMatchObject({ from: "2026-01-01", to: "2026-02-01" });
    expect(
      interpretGuidedQuery(input("FDA published from 2026-02-01 to January 1, 2026"), now).status,
    ).toBe("clarification");
  });
  it("requires a fresh explicit date basis for changed bounds rather than inheriting the UI default", () => {
    const initial = { dateBasis: "detected" as const, sourceFamily: "fda" as const };
    const first = interpretGuidedQuery(input("past 7 days", initial), now);
    expect(first.status).toBe("clarification");
    expect(first.query?.dateBasis).toBeUndefined();
    expect(first.query).toMatchObject({ from: "2026-10-06", to: "2026-10-12" });
    const answered = interpretGuidedQuery(input("publication date", first.query), now);
    expect(answered.status).toBe("ready");
    expect(answered.query?.dateBasis).toBe("published");
    const model = validateQueryModel(
      { candidates: [candidate("from", "2026-10-01", "2026-10-01")], question: "none" },
      input("from 2026-10-01", initial),
      now,
    );
    expect(model.status).toBe("clarification");
    expect(model.query?.dateBasis).toBeUndefined();
    const explicit = interpretGuidedQuery(input("published in the past 7 days", initial), now);
    expect(explicit.status).toBe("ready");
    expect(explicit.query?.dateBasis).toBe("published");
  });
});

describe("regulatory language-service boundary", () => {
  it("provides an honest guided fallback without sending text to an ambient API key", async () => {
    const env = { GEMINI_API_KEY: "synthetic-key" };
    expect(regulatoryQueryCapability(env).mode).toBe("guided");
    const result = await interpretRegulatoryQueryServer(input("FDA"), {
      env,
      now: () => now,
      fetch: () => {
        throw new Error("must not fetch");
      },
    });
    expect(result.status).toBe("ready");
    expect(result.query?.sourceFamily).toBe("fda");
  });
  it("supports configured structured extraction without tools, redirects, or model claims", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await interpretRegulatoryQueryServer(input("FDA"), {
      env: { REGULATORY_AI_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-key" },
      now: () => now,
      fetch: async (_url, init) => {
        expect(init?.redirect).toBe("manual");
        requestBody = JSON.parse(String(init?.body));
        return json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      candidates: [candidate("sourceFamily", "fda", "FDA")],
                      question: "none",
                    }),
                  },
                ],
              },
            },
          ],
        });
      },
    });
    expect(result.query?.sourceFamily).toBe("fda");
    expect(requestBody?.["tools"]).toBeUndefined();
    expect(result.summary).not.toContain("synthetic-key");
  });
  it("fails closed on provider errors, overlarge bodies, tool calls and unsupported output", async () => {
    const responses = [
      () => new Response("credential contents", { status: 401 }),
      () => new Response("x".repeat(48_001), { headers: { "content-type": "application/json" } }),
      () =>
        json({
          choices: [
            { finish_reason: "stop", message: { content: "{}", tool_calls: [{ name: "write" }] } },
          ],
        }),
      () =>
        json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  candidates: [candidate("sourceFamily", "nhtsa", "FDA")],
                  question: "none",
                }),
              },
            },
          ],
        }),
    ];
    for (const make of responses) {
      const result = await interpretRegulatoryQueryServer(input("FDA"), {
        env: { REGULATORY_AI_PROVIDER: "lovable", LOVABLE_API_KEY: "synthetic-key" },
        fetch: async () => make(),
      });
      expect(result.status).toBe("unavailable");
      expect(result.query).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("credential contents");
    }
  });
  it("bounds capacity and validates input before provider calls", async () => {
    const env = { REGULATORY_AI_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-key" };
    expect(
      (await interpretRegulatoryQueryServer(input("FDA"), { env, acquire: () => null })).status,
    ).toBe("unavailable");
    expect(
      (await interpretRegulatoryQueryServer({ turns: [], currentQuery: {} }, { env })).status,
    ).toBe("invalid_input");
  });
  it("ends a stalled provider request and releases capacity", async () => {
    let released = false;
    const result = await interpretRegulatoryQueryServer(input("FDA"), {
      env: { REGULATORY_AI_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-key" },
      timeoutMs: 5,
      fetch: () => new Promise<Response>(() => {}),
      acquire: () => () => {
        released = true;
      },
    });
    expect(result.status).toBe("unavailable");
    expect(released).toBe(true);
  });
});
