import { fetchBundleSnapshot } from "@/lib/private-data/client";

const ROOT = "state-codes/tx/browse-v1/";
const TEXT_ROOT = "state-codes/tx/text/";
const SHA256 = /^[a-f0-9]{64}$/;

export type TexasBrowseCode = {
  code: string;
  code_name: string;
  chapter_count: number;
  section_count: number;
  file: string;
  sha256: string;
  bytes: number;
};

export type TexasBrowseCodes = {
  schema_version: "texas-code-browse-release/1";
  jurisdiction: "TX";
  source_system: "texas-legislature-code";
  parser: string;
  scope_note: string;
  publisher_coverage_claim: string;
  codes: TexasBrowseCode[];
};

export type TexasChapter = {
  id: string;
  title: string;
  publisher_member: string;
  captured_at: string;
  source_url: string;
  legacy_filename_variant?: true;
  text: { file: string; sha256: string; bytes: number };
  section_count: number;
  section_shards: Array<{ file: string; sha256: string; bytes: number; count: number }>;
};

export type TexasCodeIndex = {
  schema_version: "texas-code-browse-release/1";
  jurisdiction: "TX";
  code: string;
  code_name: string;
  captured_content_note: string;
  chapters: TexasChapter[];
};

export type TexasSection = {
  chapter_id: string;
  id: string;
  title: string;
  citation: string | null;
  occurrence: number;
  hierarchy: Record<string, string> | null;
  text_span: { start: number; end: number; unit: "unicode_code_points" };
  text_sha256: string;
  source_url: string;
  captured_at: string;
  payload_sha256: string;
};

function validMetadataPath(file: string): boolean {
  return (
    file.startsWith(ROOT) &&
    file.endsWith(".json") &&
    !file.split("/").some((part) => part === ".." || part === ".")
  );
}

async function readSnapshot(
  file: string,
  expected?: { sha256: string; bytes: number },
): Promise<Uint8Array> {
  const response = await fetchBundleSnapshot(`/data/${file}`);
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "The Texas text browser is not available yet."
        : `Texas text request failed (${response.status}).`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expected && (bytes.length !== expected.bytes || (await sha256(bytes)) !== expected.sha256)) {
    throw new Error("Texas source index failed its pinned hash check.");
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const result = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson<T>(file: string, expected?: { sha256: string; bytes: number }): Promise<T> {
  if (!validMetadataPath(file)) throw new Error("Invalid Texas index reference.");
  const bytes = await readSnapshot(file, expected);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error("Texas source index is not valid UTF-8 JSON.");
  }
}

export async function loadTexasBrowseCodes(): Promise<TexasBrowseCodes> {
  const root = await readJson<TexasBrowseCodes>(`${ROOT}codes.json`);
  if (
    root.schema_version !== "texas-code-browse-release/1" ||
    root.jurisdiction !== "TX" ||
    typeof root.publisher_coverage_claim !== "string" ||
    !Array.isArray(root.codes)
  ) {
    throw new Error("Texas source index has an unsupported format.");
  }
  const seen = new Set<string>();
  for (const row of root.codes) {
    if (
      !/^[A-Z0-9]{2}$/.test(row.code) ||
      seen.has(row.code) ||
      !validMetadataPath(row.file) ||
      !SHA256.test(row.sha256) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1
    ) {
      throw new Error("Texas code listing contains an invalid source reference.");
    }
    seen.add(row.code);
  }
  return root;
}

export async function loadTexasCode(code: string, ref: TexasBrowseCode): Promise<TexasCodeIndex> {
  if (!/^[A-Z0-9]{2}$/.test(code) || ref.code !== code || !validMetadataPath(ref.file))
    throw new Error("Invalid Texas code selection.");
  const data = await readJson<TexasCodeIndex>(ref.file, { sha256: ref.sha256, bytes: ref.bytes });
  if (
    data.schema_version !== "texas-code-browse-release/1" ||
    data.jurisdiction !== "TX" ||
    data.code !== code ||
    !Array.isArray(data.chapters) ||
    data.chapters.length !== ref.chapter_count
  ) {
    throw new Error("Texas chapter listing failed its identity check.");
  }
  const ids = new Set<string>();
  for (const chapter of data.chapters) {
    if (
      typeof chapter.id !== "string" ||
      !chapter.id.startsWith(`${code}:`) ||
      ids.has(chapter.id) ||
      !SHA256.test(chapter.text.sha256) ||
      !Number.isSafeInteger(chapter.text.bytes) ||
      chapter.text.bytes < 1 ||
      chapter.text.bytes > 16 * 1024 * 1024 ||
      chapter.text.file !== `${TEXT_ROOT}${chapter.text.sha256}.txt` ||
      !chapter.source_url.startsWith("https://tcss.legis.texas.gov/resources/Zips/") ||
      !Array.isArray(chapter.section_shards)
    ) {
      throw new Error("Texas chapter row failed its native identity or source check.");
    }
    ids.add(chapter.id);
  }
  return data;
}

export async function loadTexasChapterContents(
  chapter: TexasChapter,
): Promise<{ text: string; sections: TexasSection[] }> {
  const rawText = await readSnapshot(chapter.text.file, {
    sha256: chapter.text.sha256,
    bytes: chapter.text.bytes,
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawText);
  const shards = await Promise.all(
    chapter.section_shards.map(async (ref) => {
      if (
        !validMetadataPath(ref.file) ||
        !ref.file.startsWith(`${ROOT}sections/`) ||
        !SHA256.test(ref.sha256) ||
        !Number.isSafeInteger(ref.bytes) ||
        !Number.isSafeInteger(ref.count) ||
        ref.count < 1
      ) {
        throw new Error("Invalid Texas section shard reference.");
      }
      const data = await readJson<{
        schema_version: string;
        jurisdiction: string;
        code: string;
        sections: TexasSection[];
      }>(ref.file, { sha256: ref.sha256, bytes: ref.bytes });
      if (
        data.schema_version !== "texas-code-browse-release/1" ||
        data.jurisdiction !== "TX" ||
        data.code !== chapter.id.split(":", 1)[0] ||
        !Array.isArray(data.sections)
      ) {
        throw new Error("Texas section shard failed its identity check.");
      }
      const rows = data.sections.filter((row) => row.chapter_id === chapter.id);
      if (rows.length !== ref.count)
        throw new Error("Texas section shard count does not match its chapter reference.");
      return rows;
    }),
  );
  const sections = shards.flat();
  if (sections.length !== chapter.section_count)
    throw new Error("Texas section occurrence count mismatch.");
  const ids = new Set<string>();
  for (const row of sections) {
    let sourceMatches = false;
    if (row.source_url === chapter.source_url) {
      sourceMatches = true;
    } else {
      try {
        const source = new URL(row.source_url);
        const nativeAnchor = row.id.slice(chapter.id.length + 1).split(":")[0];
        sourceMatches =
          source.protocol === "https:" &&
          source.hostname === "statutes.capitol.texas.gov" &&
          source.pathname.startsWith(`/Docs/${chapter.id.split(":", 1)[0]}/htm/`) &&
          source.hash === `#${nativeAnchor}`;
      } catch {
        sourceMatches = false;
      }
    }
    if (
      row.chapter_id !== chapter.id ||
      !row.id.startsWith(`${chapter.id}:`) ||
      ids.has(row.id) ||
      !SHA256.test(row.text_sha256) ||
      !sourceMatches ||
      row.text_span.unit !== "unicode_code_points" ||
      !Number.isSafeInteger(row.text_span.start) ||
      !Number.isSafeInteger(row.text_span.end) ||
      row.text_span.start < 0 ||
      row.text_span.end <= row.text_span.start
    ) {
      throw new Error("Texas section row failed its exact chapter/span validation.");
    }
    ids.add(row.id);
  }
  return { text, sections };
}

export function sliceCodePoints(text: string, start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw new Error("Invalid code-point span.");
  }
  let points = 0;
  let startOffset = -1;
  let endOffset = -1;
  for (let offset = 0; offset < text.length;) {
    if (points === start) startOffset = offset;
    if (points === end) {
      endOffset = offset;
      break;
    }
    const code = text.codePointAt(offset)!;
    offset += code > 0xffff ? 2 : 1;
    points += 1;
  }
  if (points === end && endOffset < 0) endOffset = text.length;
  if (startOffset < 0 || endOffset < 0 || end > points)
    throw new Error("Code-point span is outside the chapter text.");
  return text.slice(startOffset, endOffset);
}

export async function verifiedSectionExcerpt(text: string, section: TexasSection): Promise<string> {
  const excerpt = sliceCodePoints(text, section.text_span.start, section.text_span.end);
  if ((await sha256(new TextEncoder().encode(excerpt))) !== section.text_sha256) {
    throw new Error("Section span does not match its captured text hash.");
  }
  return excerpt;
}
