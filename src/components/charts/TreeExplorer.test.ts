import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flattenTree, TreeExplorer, type TreeChildren, type TreeItem } from "./TreeExplorer";

const html = (n: ReactNode) => renderToStaticMarkup(n as never);
const item = (id: string, value: number | null, hasChildren = false): TreeItem => ({
  id,
  label: id.toUpperCase(),
  hasChildren,
  metric: { value, text: value === null ? "Not recorded" : String(value) },
});

const roots = [item("a", 10, true), item("b", null, true)];
const kids: Record<string, TreeChildren> = {
  a: { status: "ready", items: [item("a1", 4), item("a2", 8)] },
  b: { status: "loading" },
};
const get = (id: string): TreeChildren => kids[id] ?? { status: "idle" };

describe("flattenTree", () => {
  it("lists visible rows with level, position and the sibling maximum", () => {
    const rows = flattenTree(roots, new Set(["a", "b"]), get);
    expect(
      rows.map((r) =>
        r.kind === "item"
          ? `${r.item.id}@${r.level}:${r.pos}/${r.setSize}`
          : `status:${r.parent.id}`,
      ),
    ).toEqual(["a@1:1/2", "a1@2:1/2", "a2@2:2/2", "b@1:2/2", "status:b"]);
    const a2 = rows[2];
    expect(a2?.kind === "item" ? a2.max : null).toBe(8);
    expect(flattenTree(roots, new Set(), get)).toHaveLength(2);
  });

  it("shows an empty level and an error in place", () => {
    const rows = flattenTree([item("x", 1, true)], new Set(["x"]), () => ({
      status: "ready",
      items: [],
    }));
    expect(rows[1]?.kind).toBe("status");
  });
});

describe("TreeExplorer", () => {
  it("renders an ARIA tree with one tab stop, expanded state, levels, bars and not-recorded stubs", () => {
    const out = html(
      createElement(TreeExplorer, {
        roots,
        getChildren: get,
        onExpand: () => {},
        renderLabel: (i: TreeItem) => createElement("span", null, i.label),
        ariaLabel: "Courts",
        metricLabel: "Civil cases pending",
        defaultExpanded: ["a", "b"],
      }),
    );
    expect(out).toContain('role="tree"');
    expect((out.match(/role="treeitem"/g) ?? []).length).toBe(4);
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-level="2"');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain("Loading B");
    expect(out).toContain("Not recorded");
    expect(out).toMatch(/fill="url\(#[^"]+\)"/);
    expect(out).toContain("Civil cases pending");
  });
});
