import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { snapshotReleasePaths, summarizeBrowseRoot, type BrowseSchema } from "./stateCodeContract";

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
  schema_version: BrowseSchema;
  jurisdiction: string;
  source_system: string;
  parser: string;
  scope_note: string;
  publisher_coverage_claim: string;
  codes: TexasBrowseCode[];
};

export type LoadedBrowseCodes = TexasBrowseCodes & {
  state: string;
  root: string;
  textRoot: string;
};

export type TexasChapter = {
  id: string;
  title: string;
  publisher_member?: string;
  captured_at?: string;
  source_url: string;
  legacy_filename_variant?: true;
  text: { file: string; sha256: string; bytes: number };
  section_count: number;
  section_shards: Array<{ file: string; sha256: string; bytes: number; count: number }>;
};

export type TexasCodeIndex = {
  schema_version: BrowseSchema;
  jurisdiction: string;
  code: string;
  code_name: string;
  captured_content_note?: string;
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
  captured_at?: string;
  payload_sha256?: string;
  history?: string | null;
  source_note?: string | null;
};

function validMetadataPath(file: string, root: string): boolean {
  return (
    file.startsWith(root) &&
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
        ? "This state's code text is not available yet."
        : `State code text request failed (${response.status}).`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expected && (bytes.length !== expected.bytes || (await sha256(bytes)) !== expected.sha256)) {
    throw new Error("State code index failed its pinned hash check.");
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const result = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson<T>(
  file: string,
  root: string,
  expected?: { sha256: string; bytes: number },
): Promise<T> {
  if (!validMetadataPath(file, root)) throw new Error("Invalid state code index reference.");
  const bytes = await readSnapshot(file, expected);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error("State code index is not valid UTF-8 JSON.");
  }
}

export async function loadBrowseCodes(state: string): Promise<LoadedBrowseCodes> {
  const paths = snapshotReleasePaths(state);
  const root = await readJson<
    TexasBrowseCodes & { text_root?: string; edition?: string; currency?: string }
  >(`${paths.root}codes.json`, paths.root);
  const summary = summarizeBrowseRoot(root, state);
  if (!summary) throw new Error("State code index has an unsupported format.");
  const seen = new Set<string>();
  for (const row of root.codes) {
    if (
      seen.has(row.code) ||
      !validMetadataPath(row.file, paths.root) ||
      !SHA256.test(row.sha256) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1
    ) {
      throw new Error("State code listing contains an invalid source reference.");
    }
    seen.add(row.code);
  }
  const loaded: LoadedBrowseCodes = {
    ...root,
    state,
    root: paths.root,
    textRoot: summary.textRoot ?? paths.textRoot,
  };
  if (!loaded.publisher_coverage_claim) loaded.publisher_coverage_claim = summary.note ?? "";
  return loaded;
}

export async function loadTexasBrowseCodes(): Promise<LoadedBrowseCodes> {
  return loadBrowseCodes("TX");
}

export async function loadBrowseCode(
  state: string,
  ref: TexasBrowseCode,
  release: { root: string; textRoot: string },
): Promise<TexasCodeIndex> {
  if (!/^[A-Z0-9][A-Z0-9_-]{0,32}$/.test(ref.code) || !validMetadataPath(ref.file, release.root))
    throw new Error("Invalid state code selection.");
  const data = await readJson<TexasCodeIndex>(ref.file, release.root, {
    sha256: ref.sha256,
    bytes: ref.bytes,
  });
  const summary = summarizeBrowseRoot(
    { schema_version: data.schema_version, jurisdiction: data.jurisdiction, codes: [ref] },
    state,
  );
  if (
    !summary ||
    data.code !== ref.code ||
    !Array.isArray(data.chapters) ||
    data.chapters.length !== ref.chapter_count
  ) {
    throw new Error("State code chapter listing failed its identity check.");
  }
  const ids = new Set<string>();
  for (const chapter of data.chapters) {
    const texas = data.schema_version === "texas-code-browse-release/1";
    if (
      typeof chapter.id !== "string" ||
      !chapter.id.startsWith(`${ref.code}:`) ||
      ids.has(chapter.id) ||
      !SHA256.test(chapter.text.sha256) ||
      !Number.isSafeInteger(chapter.text.bytes) ||
      chapter.text.bytes < 1 ||
      chapter.text.bytes > 16 * 1024 * 1024 ||
      chapter.text.file !== `${release.textRoot}${chapter.text.sha256}.txt` ||
      (texas && !chapter.source_url.startsWith("https://tcss.legis.texas.gov/resources/Zips/")) ||
      (!texas && !chapter.source_url.startsWith("https://")) ||
      (texas && typeof chapter.publisher_member !== "string") ||
      !Array.isArray(chapter.section_shards)
    ) {
      throw new Error("State code chapter row failed its native identity or source check.");
    }
    ids.add(chapter.id);
  }
  return data;
}

export async function loadTexasCode(code: string, ref: TexasBrowseCode): Promise<TexasCodeIndex> {
  const paths = snapshotReleasePaths("TX");
  if (ref.code !== code) throw new Error("Invalid Texas code selection.");
  return loadBrowseCode("TX", ref, paths);
}

function sectionSourceOk(schema: BrowseSchema, row: TexasSection, chapter: TexasChapter): boolean {
  if (schema !== "texas-code-browse-release/1") {
    return row.source_url.startsWith("https://");
  }
  if (row.source_url === chapter.source_url) return true;
  try {
    const source = new URL(row.source_url);
    const nativeAnchor = row.id.slice(chapter.id.length + 1).split(":")[0];
    return (
      source.protocol === "https:" &&
      source.hostname === "statutes.capitol.texas.gov" &&
      source.pathname.startsWith(`/Docs/${chapter.id.split(":", 1)[0]}/htm/`) &&
      source.hash === `#${nativeAnchor}`
    );
  } catch {
    return false;
  }
}

export async function loadBrowseChapter(
  chapter: TexasChapter,
  release: { root: string; schema: BrowseSchema; state: string },
): Promise<{ text: string; sections: TexasSection[] }> {
  const rawText = await readSnapshot(chapter.text.file, {
    sha256: chapter.text.sha256,
    bytes: chapter.text.bytes,
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawText);
  const shards = await Promise.all(
    chapter.section_shards.map(async (ref) => {
      if (
        !validMetadataPath(ref.file, release.root) ||
        !ref.file.startsWith(`${release.root}sections/`) ||
        !SHA256.test(ref.sha256) ||
        !Number.isSafeInteger(ref.bytes) ||
        !Number.isSafeInteger(ref.count) ||
        ref.count < 1
      ) {
        throw new Error("Invalid state code section shard reference.");
      }
      const data = await readJson<{
        schema_version: BrowseSchema;
        jurisdiction: string;
        code: string;
        sections: TexasSection[];
      }>(ref.file, release.root, { sha256: ref.sha256, bytes: ref.bytes });
      if (
        data.schema_version !== release.schema ||
        data.jurisdiction !== release.state ||
        data.code !== chapter.id.split(":", 1)[0] ||
        !Array.isArray(data.sections)
      ) {
        throw new Error("State code section shard failed its identity check.");
      }
      const rows = data.sections.filter((row) => row.chapter_id === chapter.id);
      if (rows.length !== ref.count)
        throw new Error("State code section shard count does not match its chapter reference.");
      return rows;
    }),
  );
  const sections = shards.flat();
  if (sections.length !== chapter.section_count)
    throw new Error("State code section occurrence count mismatch.");
  const ids = new Set<string>();
  for (const row of sections) {
    const historyOk = row.history == null || typeof row.history === "string";
    const noteOk = row.source_note == null || typeof row.source_note === "string";
    if (
      row.chapter_id !== chapter.id ||
      !row.id.startsWith(`${chapter.id}:`) ||
      ids.has(row.id) ||
      !SHA256.test(row.text_sha256) ||
      !sectionSourceOk(release.schema, row, chapter) ||
      !historyOk ||
      !noteOk ||
      row.text_span.unit !== "unicode_code_points" ||
      !Number.isSafeInteger(row.text_span.start) ||
      !Number.isSafeInteger(row.text_span.end) ||
      row.text_span.start < 0 ||
      row.text_span.end <= row.text_span.start
    ) {
      throw new Error("State code section row failed its exact chapter/span validation.");
    }
    ids.add(row.id);
  }
  return { text, sections };
}

export async function loadTexasChapterContents(
  chapter: TexasChapter,
): Promise<{ text: string; sections: TexasSection[] }> {
  const paths = snapshotReleasePaths("TX");
  return loadBrowseChapter(chapter, {
    root: paths.root,
    schema: "texas-code-browse-release/1",
    state: "TX",
  });
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
