/**
 * Parity of the TypeScript chunker and source builders with the Python ones (scripts/semantic/chunking.py, sources.py,
 * refresh_rows.py) on the golden fixture written by scripts/semantic/make_chunk_fixtures.py: identical spans, passages,
 * embed strings (by sha256), embed keys, snippets, Doc fields, links, Python character classes and float16 vector text.
 */
import { describe, expect, it } from "vitest";
import golden from "./fixtures/chunk-golden.json";
import sampleRows from "./fixtures/semantic-rows.json";
import {
  CHUNKER_VERSION,
  MAX_CHARS,
  MAX_EMBED_CHARS,
  SNIPPET_CHARS,
  bodyLimit,
  chunkDoc,
  chunkEmbedText,
  cleanForEmbedding,
  embedKey,
  embeddingText,
  estimateTokens,
  isPySpaceCode,
  lineLevel,
  pyDigitRanges,
  sha256Hex,
  snippetOf,
  splitSpans,
  type Chunk,
  type Doc,
} from "./chunking";
import {
  buildDoc,
  encodeHref,
  isSourceDataset,
  oneLine,
  pyStr,
  type SourceRow,
} from "../../../supabase/functions/semantic-refresh/sources";
import {
  EMBEDDING_INPUT_TYPE,
  EMBEDDING_MODEL,
  formatG5,
  toHalf,
} from "../../../supabase/functions/semantic-refresh/embed";

type ChunkExpect = {
  chunk_no: number;
  chunk_total: number;
  start: number;
  end: number;
  text_sha256: string;
  embed_text_sha256: string;
  embed_key: string;
  snippet: string;
};
type G = {
  meta: Record<string, string | number>;
  python_space: number[];
  python_digit_ranges: [number, number][];
  line_levels: [string, number][];
  hrefs: [string, string][];
  one_line: [string, string][];
  py_str: [unknown, string][];
  clean: [string, string, string][];
  vectors: { f32_hex: string; f16_text: string[] };
  docs: {
    name: string;
    heading: string;
    text: string;
    max_chunks: number;
    body_limit: number;
    estimate_tokens: number;
    cases: { max_chars: number; spans: [number, number][] }[];
    chunks: ChunkExpect[];
  }[];
  rows: {
    dataset: string;
    id: string;
    rule: string;
    pruned: SourceRow;
    pruned_has_text: boolean;
    doc: (Omit<Doc, "text"> & { text_sha256: string; text_chars: number }) | null;
    chunks: ChunkExpect[];
  }[];
};
const G = golden as unknown as G;
const ROWS = (sampleRows as unknown as { rows: SourceRow[] }).rows;

async function expectChunks(chunks: Chunk[], want: ChunkExpect[]) {
  const got: ChunkExpect[] = [];
  for (const c of chunks) {
    const embedText = chunkEmbedText(c);
    got.push({
      chunk_no: c.chunk_no,
      chunk_total: c.chunk_total,
      start: c.start,
      end: c.end,
      text_sha256: await sha256Hex(c.body),
      embed_text_sha256: await sha256Hex(embedText),
      embed_key: await embedKey(embedText, EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE),
      snippet: snippetOf(c.body),
    });
  }
  expect(got).toEqual(want);
}

describe("chunker constants and Python character classes", () => {
  it("uses the same version and limits", () => {
    expect(G.meta["chunker_version"]).toBe(CHUNKER_VERSION);
    expect(G.meta["max_chars"]).toBe(MAX_CHARS);
    expect(G.meta["max_embed_chars"]).toBe(MAX_EMBED_CHARS);
    expect(G.meta["snippet_chars"]).toBe(SNIPPET_CHARS);
    expect(G.meta["input_type"]).toBe(EMBEDDING_INPUT_TYPE);
  });

  it("whitespace is exactly Python's str.isspace() set", () => {
    const ours: number[] = [];
    for (let c = 0; c < 0x10000; c++) if (isPySpaceCode(c)) ours.push(c);
    expect(ours).toEqual(G.python_space);
  });

  it("digits are exactly Python's re \\d set", () => {
    expect(pyDigitRanges()).toEqual(G.python_digit_ranges);
  });

  it("line levels match", () => {
    for (const [line, level] of G.line_levels)
      expect([line, lineLevel(line)]).toEqual([line, level]);
  });
});

describe("text helpers", () => {
  it("cleaning and snippets match", () => {
    for (const [input, clean, snippet] of G.clean) {
      expect(cleanForEmbedding(input)).toBe(clean);
      expect(snippetOf(input)).toBe(snippet);
    }
  });
  it("one-line, str() and links match", () => {
    for (const [input, out] of G.one_line) expect(oneLine(input)).toBe(out);
    for (const [input, out] of G.py_str) expect(pyStr(input as never)).toBe(out);
    for (const [input, out] of G.hrefs) {
      expect(encodeHref(input)).toBe(out);
      expect(encodeHref(out)).toBe(out); // idempotent, as load.py relies on
    }
  });
});

describe("synthetic documents", () => {
  for (const d of G.docs) {
    it(`${d.name}: spans at every limit, passages, embed strings, keys and snippets`, async () => {
      for (const c of d.cases)
        expect(splitSpans(d.text, c.max_chars).map((s) => [s.start, s.end])).toEqual(c.spans);
      expect(bodyLimit(d.heading)).toBe(d.body_limit);
      expect(estimateTokens(embeddingText(d.heading, d.text))).toBe(d.estimate_tokens);
      const doc: Doc = {
        dataset: "synthetic",
        record_id: d.name,
        title: d.name,
        heading: d.heading,
        text: d.text,
        href: `/x/${d.name}`,
        source_url: null,
        max_chunks: d.max_chunks,
      };
      await expectChunks(chunkDoc(doc), d.chunks);
    });
  }
});

describe("real rows of every collection", () => {
  const titles = (sampleRows as unknown as { us_code_titles: unknown[] }).us_code_titles;
  it("covers every collection the refresh rebuilds", () => {
    expect(new Set(G.rows.map((r) => r.dataset)).size).toBe(7);
    expect(titles.length).toBeGreaterThan(50);
  });
  for (const r of G.rows) {
    it(`${r.dataset} ${r.id} (${r.rule}): Doc and passages from the pruned row`, async () => {
      expect(isSourceDataset(r.dataset)).toBe(true);
      const input = ROWS.find((x) => x["dataset"] === r.dataset && x["id"] === r.id)!;
      const pruned: SourceRow = r.pruned_has_text
        ? { ...r.pruned, text: input["text"] ?? null }
        : r.pruned;
      const doc = buildDoc(r.dataset as never, pruned);
      if (r.doc === null) {
        expect(doc).toBeNull();
        return;
      }
      expect(doc).not.toBeNull();
      const { text, ...fields } = doc!;
      expect({
        ...fields,
        text_sha256: await sha256Hex(text),
        text_chars: Array.from(text).length,
      }).toEqual(r.doc);
      await expectChunks(chunkDoc(doc!), r.chunks);
    });
  }
});

describe("float16 vector text", () => {
  it("rounds float32 to float16 and formats like numpy + format(x, '.5g')", () => {
    const hex = G.vectors.f32_hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const view = new DataView(bytes.buffer);
    const got: string[] = [];
    for (let i = 0; i < bytes.length / 4; i++)
      got.push(formatG5(toHalf(view.getFloat32(i * 4, true))));
    expect(got).toEqual(G.vectors.f16_text);
  });
});
