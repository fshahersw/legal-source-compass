import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities } from "./entities";

describe("entity decoding", () => {
  it("decodes the XML predefined entities and numeric references", () => {
    expect(decodeEntities("Food &amp; Drugs")).toBe("Food & Drugs");
    expect(decodeEntities("&lt;Reserved&gt; &quot;A&quot; &apos;B&apos;")).toBe(
      "<Reserved> \"A\" 'B'",
    );
    expect(decodeEntities("Part 74&#8212;Color additives")).toBe("Part 74—Color additives");
    expect(decodeEntities("&#x2014; &#X2014;")).toBe("— —");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodes once and keeps anything it does not know exactly as stored", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeEntities("&sect; 1.1")).toBe("&sect; 1.1");
    expect(decodeEntities("AT&T and R&D")).toBe("AT&T and R&D");
    expect(decodeEntities("&#0; &#xD800; &#99999999;")).toBe("&#0; &#xD800; &#99999999;");
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });

  it("cleans a title for display without changing what it says", () => {
    expect(cleanText("  Part 21 \n —  Protection   of &amp; privacy\t")).toBe(
      "Part 21 — Protection of & privacy",
    );
    expect(cleanText("")).toBe("");
    expect(cleanText("   ")).toBe("");
  });
});
