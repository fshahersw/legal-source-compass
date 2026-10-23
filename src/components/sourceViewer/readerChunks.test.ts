import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { nextChunkCount, splitMarkdownChunks } from "./readerChunks";

const para = (n: number) => `Paragraph ${n} ${"word ".repeat(40)}`.trim();

/** The blocks AssistantMarkdown makes for a text, without its wrapper element. */
const blocks = (text: string) =>
  renderToStaticMarkup(createElement(AssistantMarkdown, { text })).replace(
    /^<div[^>]*>|<\/div>$/g,
    "",
  );

describe("progressive rendering", () => {
  it("renders the pieces of a page into exactly the blocks the whole page makes", () => {
    const md = [
      "# Heading",
      para(1),
      "- one\n- two\n- three",
      "1. first\n2. second",
      ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
      ["```", "code line", "", "still code", "```"].join("\n"),
      "> a quote\n> continued",
      "See [the rule](https://www.example.gov/rule) and **bold** and `code`.",
      ...Array.from({ length: 40 }, (_, i) => para(i + 2)),
    ].join("\n\n");
    const pieces = splitMarkdownChunks(md, 800);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.map(blocks).join("")).toBe(blocks(md));
  });
});

describe("splitMarkdownChunks", () => {
  it("keeps a short page as one piece", () => {
    expect(splitMarkdownChunks("# Title\n\nSome text.", 6000)).toEqual(["# Title\n\nSome text."]);
    expect(splitMarkdownChunks("", 100)).toEqual([]);
    expect(splitMarkdownChunks("\n\n  \n", 100)).toEqual([]);
  });

  it("cuts only at blank lines and loses no text", () => {
    const md = Array.from({ length: 60 }, (_, i) => para(i)).join("\n\n");
    const chunks = splitMarkdownChunks(md, 1000);
    expect(chunks.length).toBeGreaterThan(5);
    // Every piece starts and ends on a whole paragraph, and the words are the same as the input's.
    for (const c of chunks) expect(c).toMatch(/^Paragraph \d+ /);
    expect(chunks.join("\n\n").replace(/\s+/g, " ")).toBe(md.replace(/\s+/g, " "));
  });

  it("never cuts inside a code fence, even across blank lines", () => {
    const fence = ["```", "line one", "", "", "line after blanks", "```"].join("\n");
    const md = [para(1), fence, para(2)].join("\n\n");
    const chunks = splitMarkdownChunks(md, 10);
    const holder = chunks.filter((c) => c.includes("line one"));
    expect(holder).toHaveLength(1);
    expect(holder[0]).toContain("line after blanks");
    expect(holder[0]!.match(/^```/gm)).toHaveLength(2);
  });

  it("keeps tables and lists whole (they have no blank lines)", () => {
    const table = ["| a | b |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n");
    const list = ["- one", "- two", "- three"].join("\n");
    const chunks = splitMarkdownChunks([para(1), table, list, para(2)].join("\n\n"), 10);
    expect(chunks.some((c) => c === table)).toBe(true);
    expect(chunks.some((c) => c === list)).toBe(true);
  });

  it("leaves one very long block whole", () => {
    const long = Array.from({ length: 500 }, (_, i) => `row ${i}`).join("\n");
    expect(splitMarkdownChunks(long, 100)).toEqual([long]);
  });
});

describe("nextChunkCount", () => {
  it("renders one piece at once, then a few per slice up to the total", () => {
    expect(nextChunkCount(0, 10)).toBe(1);
    expect(nextChunkCount(1, 10)).toBe(4);
    expect(nextChunkCount(8, 10)).toBe(10);
    expect(nextChunkCount(0, 0)).toBe(0);
    expect(nextChunkCount(10, 10)).toBe(10);
  });
});
