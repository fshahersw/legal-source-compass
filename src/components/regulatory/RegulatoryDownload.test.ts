import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegulatoryDownload } from "./RegulatoryDownload";

const harness = vi.hoisted(() => ({
  index: 0,
  effectIndex: 0,
  dirty: false,
  states: [] as unknown[],
  dependencies: [] as unknown[][],
  effects: [] as Array<{ index: number; run: () => void | (() => void) }>,
  cleanups: [] as Array<(() => void) | undefined>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = harness.index++;
    if (!(i in harness.states)) harness.states[i] = initial;
    return [
      harness.states[i],
      (value: unknown) => {
        harness.states[i] = value;
        harness.dirty = true;
      },
    ];
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = harness.effectIndex++;
    if (
      !harness.dependencies[index] ||
      deps.some((value, i) => !Object.is(value, harness.dependencies[index]?.[i]))
    ) {
      harness.dependencies[index] = deps;
      harness.effects.push({ index, run });
    }
  },
}));
const create = vi.fn();
const revoke = vi.fn();
let props: Parameters<typeof RegulatoryDownload>[0];
function render(): ReactElement {
  let tree: ReactElement;
  let count = 0;
  do {
    if (++count > 10) throw new Error("Component did not settle");
    harness.index = harness.effectIndex = 0;
    harness.effects = [];
    harness.dirty = false;
    tree = RegulatoryDownload(props);
    harness.effects.forEach(({ index, run }) => {
      harness.cleanups[index]?.();
      const cleanup = run();
      harness.cleanups[index] = typeof cleanup === "function" ? cleanup : undefined;
    });
  } while (harness.dirty);
  return tree;
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"] as ReactNode)];
}
beforeEach(() => {
  harness.states = [];
  harness.dependencies = [];
  harness.cleanups = [];
  harness.effects = [];
  props = {
    text: '{"complete":"synthetic backup"}',
    filename: "regulatory-workspace-backup.json",
    label: "Download prepared backup",
  };
  create.mockReset().mockReturnValue("blob:synthetic-one");
  revoke.mockReset();
  vi.spyOn(URL, "createObjectURL").mockImplementation(create);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  vi.stubGlobal("navigator", {});
});
afterEach(() => {
  harness.cleanups.forEach((cleanup) => cleanup?.());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepared regulatory downloads", () => {
  it("retains a visible real download anchor and complete editable-selection fallback without claiming completion", () => {
    const tree = render();
    const anchor = elements(tree).find((element) => element.type === "a")!;
    expect(anchor.props["href"]).toBe("blob:synthetic-one");
    expect(anchor.props["download"]).toBe("regulatory-workspace-backup.json");
    expect(anchor.props["onClick"]).toBeUndefined();
    const field = elements(tree).find((element) => element.type === "textarea")!;
    expect(field.props["value"]).toBe(props.text);
    expect(field.props["readOnly"]).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Download prepared backup");
    expect(html).toContain("JSON copy and manual save");
    expect(html).not.toContain("Backup exported");
    expect(revoke).not.toHaveBeenCalled();
  });
  it("revokes the old object URL on replacement and the current URL on unmount", () => {
    render();
    create.mockReturnValue("blob:synthetic-two");
    props = { ...props, text: '{"complete":"replacement"}' };
    const tree = render();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-one");
    expect(elements(tree).find((element) => element.type === "a")?.props["href"]).toBe(
      "blob:synthetic-two",
    );
    harness.cleanups.forEach((cleanup) => cleanup?.());
    harness.cleanups = [];
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-two");
  });
  it("keeps the full JSON available if blob downloads are unavailable", () => {
    create.mockImplementation(() => {
      throw new Error("Synthetic unavailable URL API");
    });
    const tree = render();
    expect(elements(tree).some((element) => element.type === "a")).toBe(false);
    expect(elements(tree).find((element) => element.type === "textarea")?.props["value"]).toBe(
      props.text,
    );
    expect(renderToStaticMarkup(tree)).toContain("A file link could not be created");
  });
  it("does not claim a clipboard copy succeeded when permission is unavailable", async () => {
    const button = elements(render()).find((element) => element.type === "button")!;
    (button.props["onClick"] as () => void)();
    await Promise.resolve();
    const html = renderToStaticMarkup(render());
    expect(html).toContain("Select and copy the JSON field manually");
    expect(html).not.toContain("JSON copied.");
  });
});
