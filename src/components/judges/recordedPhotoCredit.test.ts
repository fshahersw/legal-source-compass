import { describe, expect, it } from "vitest";
import { recordedPhotoCredit } from "./JudgeHeadshot";

describe("recordedPhotoCredit", () => {
  it("passes the recorded credit, URL source and label through unchanged", () => {
    expect(
      recordedPhotoCredit({
        photo_credit: "Portrait: Free Law Project judicial portrait collection; licence not recorded.",
        photo_source: null,
        photo_source_label: "Alabama Court Website",
      }),
    ).toEqual({
      credit: "Portrait: Free Law Project judicial portrait collection; licence not recorded.",
      source: null,
      sourceLabel: "Alabama Court Website",
    });
    expect(
      recordedPhotoCredit({
        photo_credit: "Portrait: recorded as a work of federal government.",
        photo_source: "https://en.wikipedia.org/wiki/File:Judge_Kearney.jpg",
      }),
    ).toEqual({
      credit: "Portrait: recorded as a work of federal government.",
      source: "https://en.wikipedia.org/wiki/File:Judge_Kearney.jpg",
      sourceLabel: null,
    });
  });

  it("treats a non-URL source as a label and never invents a credit", () => {
    expect(recordedPhotoCredit({ photo_source: "Provided by the court" })).toEqual({
      credit: null,
      source: null,
      sourceLabel: "Provided by the court",
    });
    expect(recordedPhotoCredit(null)).toEqual({ credit: null, source: null, sourceLabel: null });
  });
});
