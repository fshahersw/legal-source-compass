import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const captureScript = join(repoRoot, "scripts", "limitations", "backfill", "capture.py");

/** Run capture.py's markdown_to_text on one string through the interpreter it ships for. */
function plain(markdown: string): string {
  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import importlib.util, sys",
        `spec = importlib.util.spec_from_file_location("cap", ${JSON.stringify(captureScript)})`,
        "cap = importlib.util.module_from_spec(spec); spec.loader.exec_module(cap)",
        "sys.stdout.write(cap.markdown_to_text(sys.stdin.read()))",
      ].join("\n"),
    ],
    { input: markdown, encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

// The stored capture text is what every quoted statute passage is checked against, so a proxy's markdown
// rendering must come out as the statute's own words: no link syntax, emphasis marks or escape backslashes.
describe("capture.py markdown_to_text", () => {
  it("drops link syntax around a statutory cross-reference and keeps the section number", () => {
    const text = plain(
      "(B) Except as provided in section [2305.115](https://codes.ohio.gov/ohio-revised-code/section-2305.115) of the Revised Code, an action for assault or battery shall be brought within one year after the cause of the action accrues.",
    );
    expect(text).toContain("Except as provided in section 2305.115 of the Revised Code, an action for assault");
    expect(text).not.toContain("](");
    expect(text).not.toContain("https://");
  });

  it("drops a script-style section link whose href carries spaces and nested parentheses", () => {
    // leginfo.legislature.ca.gov prints every section number as [340.](javascript:submitCodesValues('340.', ...))
    const text = plain(
      "[340.](javascript:submitCodesValues('340.','5.2.3','1872','','', 'id_8e983e95-291e-11d9-8231-adff999f5ee6'))\n\nWithin one year:\n\n(a) An action upon a statute for a penalty or forfeiture.",
    );
    expect(text.replace(/\s+/g, " ")).toContain("340. Within one year: (a) An action upon a statute");
    expect(text).not.toContain("javascript:");
  });

  it("drops single-asterisk emphasis around a one-line history note but keeps asterisks inside words", () => {
    const text = plain("*(Added by Stats. 2002, Ch. 448, Sec. 2. Effective January 1, 2003.)*\n\nSee 2*3 footnote.");
    expect(text).toContain("(Added by Stats. 2002, Ch. 448, Sec. 2. Effective January 1, 2003.)");
    expect(text).not.toContain("*(");
    expect(text).toContain("2*3");
  });


  it("removes emphasis marks and escape backslashes without touching the words", () => {
    const text = plain("**§ 5524\\.  Two year limitation.**\n\nThe following actions and proceedings must be commenced within two years:");
    expect(text).toContain("§ 5524. Two year limitation.");
    expect(text).toContain("must be commenced within two years:");
    expect(text).not.toContain("**");
    expect(text).not.toContain("\\.");
  });

  it("keeps a bare asterisk or bracket that is part of the page text", () => {
    const text = plain("Repealed by Acts 1987, c. 123 [see note].\n5 * 4 = 20");
    expect(text).toContain("Repealed by Acts 1987, c. 123 [see note].");
    expect(text).toContain("5 * 4 = 20");
  });

  it("strips heading markers and HTML entities and normalises runs of spaces", () => {
    const text = plain("## Section 657-4\n\nAll actions for libel or slander &amp;  seduction  shall be commenced within two&nbsp;years");
    expect(text.startsWith("Section 657-4")).toBe(true);
    expect(text).toContain("All actions for libel or slander & seduction shall be commenced within two years");
  });
});
