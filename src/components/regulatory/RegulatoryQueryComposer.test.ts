import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegulatoryQuery } from "@/lib/regulatory/types";
import { RegulatoryQueryComposer } from "./RegulatoryQueryComposer";

const harness = vi.hoisted(() => ({
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  dirty: false,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  dependencies: [] as Array<unknown[] | undefined>,
  effects: [] as Array<() => unknown>,
  interpret: vi.fn(),
  available: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = harness.stateIndex++;
    if (!(i in harness.states)) harness.states[i] = initial;
    return [
      harness.states[i],
      (value: unknown) => {
        harness.states[i] = typeof value === "function" ? value(harness.states[i]) : value;
        harness.dirty = true;
      },
    ];
  },
  useRef: (initial: unknown) => (harness.refs[harness.refIndex++] ??= { current: initial }),
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const i = harness.effectIndex++;
    const previous = harness.dependencies[i];
    if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous[index]))) {
      harness.dependencies[i] = deps;
      harness.effects.push(effect);
    }
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { available: harness.available, mode: "guided", message: "Test capability" },
    isError: false,
  }),
}));
vi.mock("@/lib/regulatory/regulatory-query.functions", () => ({
  interpretRegulatoryQuery: harness.interpret,
  getRegulatoryQueryCapability: vi.fn(),
}));

let query: RegulatoryQuery;
const apply = vi.fn();
function render(): ReactElement {
  let tree: ReactElement;
  let count = 0;
  do {
    if (++count > 10) throw new Error("Component did not settle");
    harness.dirty = false;
    harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
    harness.effects = [];
    tree = RegulatoryQueryComposer({ query, onApply: apply });
    harness.effects.forEach((effect) => effect());
  } while (harness.dirty);
  return tree;
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"] as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node)
    ? text(node.props["children"] as ReactNode)
    : "";
}
function button(label: string) {
  return elements(render()).find(
    (element) => element.type === "button" && text(element).includes(label),
  );
}
async function send(value: string) {
  const input = elements(render()).find((element) => element.type === "textarea")!;
  (input.props["onChange"] as (event: { target: { value: string } }) => void)({
    target: { value },
  });
  const form = elements(render()).find((element) => element.type === "form")!;
  (form.props["onSubmit"] as (event: { preventDefault: () => void }) => void)({
    preventDefault() {},
  });
  await Promise.resolve();
  await Promise.resolve();
}
const ready = (next: RegulatoryQuery) => ({
  status: "ready",
  query: next,
  summary: "Proposed filters",
  limitations: [],
});

beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.dependencies = [];
  harness.effects = [];
  harness.available = true;
  harness.interpret.mockReset();
  apply.mockReset();
  query = { dateBasis: "detected", limit: 25, offset: 0 };
});

describe("regulatory question interaction", () => {
  it("retains a clarification proposal and requires explicit application after the answer", async () => {
    const proposed = {
      sourceFamily: "fda" as const,
      q: "synthetic subject",
      from: "2026-01-01",
      to: "2026-01-31",
    };
    harness.interpret.mockResolvedValueOnce({
      status: "clarification",
      query: proposed,
      summary: "Source and subject recognized",
      question: "Publisher or detection date?",
      limitations: [],
    });
    await send("FDA synthetic subject in January 2026");
    expect(apply).not.toHaveBeenCalled();
    expect(button("Apply these filters")).toBeUndefined();
    harness.interpret.mockResolvedValueOnce(ready({ ...proposed, dateBasis: "published" }));
    await send("Publisher date");
    expect(harness.interpret.mock.calls[1]?.[0].data.currentQuery).toEqual(proposed);
    expect(
      harness.interpret.mock.calls[1]?.[0].data.turns.map((turn: { role: string }) => turn.role),
    ).toEqual(["user", "assistant", "user"]);
    expect(apply).not.toHaveBeenCalled();
    (button("Apply these filters")!.props["onClick"] as () => void)();
    expect(apply).toHaveBeenCalledWith({ ...proposed, dateBasis: "published" });
  });

  it("withdraws an in-flight answer when structured filters change", async () => {
    let resolve!: (value: ReturnType<typeof ready>) => void;
    harness.interpret.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await send("Synthetic old subject");
    query = { sourceFamily: "cpsc", dateBasis: "published" };
    render();
    resolve(ready({ q: "Synthetic old subject" }));
    await Promise.resolve();
    expect(button("Apply these filters")).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("clear conversation invalidates a pending interpretation", async () => {
    let resolve!: (value: ReturnType<typeof ready>) => void;
    harness.interpret.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await send("Synthetic question");
    (button("Clear conversation")!.props["onClick"] as () => void)();
    resolve(ready({ q: "Synthetic question" }));
    await Promise.resolve();
    expect(button("Apply these filters")).toBeUndefined();
    expect(text(render())).not.toContain("Synthetic question");
  });

  it("bounds requests to the server context limit while retaining recent turns", async () => {
    harness.interpret.mockResolvedValue({
      status: "clarification",
      summary: "s".repeat(1900),
      question: "Date?",
      limitations: [],
    });
    for (let i = 0; i < 7; i++) await send(`${i}: ${"q".repeat(1890)}`);
    const turns = harness.interpret.mock.lastCall?.[0].data.turns as Array<{ content: string }>;
    expect(turns.length).toBeLessThanOrEqual(9);
    expect(turns.every((turn) => turn.content.length <= 2000)).toBe(true);
    expect(turns.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(16000);
    expect(turns.at(-1)?.content).toMatch(/^6:/);
  });

  it("keeps failures explicit without applying a query or inventing results", async () => {
    harness.interpret.mockRejectedValue(new Error("Synthetic transport failure"));
    await send("Synthetic question");
    expect(renderToStaticMarkup(render())).toContain("The question could not be interpreted");
    expect(button("Apply these filters")).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("retains pending clarification context through a failed reply without enabling Apply", async () => {
    const proposed = { sourceFamily: "fda" as const, from: "2026-01-01", to: "2026-01-31" };
    harness.interpret.mockResolvedValueOnce({
      status: "clarification",
      query: proposed,
      summary: "FDA January",
      question: "Publisher or detection date?",
      pendingQuestions: ["date_basis"],
      limitations: [],
    });
    await send("FDA in January 2026");
    harness.interpret.mockRejectedValueOnce(new Error("Synthetic transport failure"));
    await send("Publisher date");
    expect(button("Apply these filters")).toBeUndefined();
    harness.interpret.mockResolvedValueOnce(ready({ ...proposed, dateBasis: "published" }));
    await send("Publisher date");
    expect(harness.interpret.mock.calls[2]?.[0].data.currentQuery).toEqual(proposed);
    expect(harness.interpret.mock.calls[2]?.[0].data.pendingQuestions).toEqual(["date_basis"]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not call interpretation when capability is unavailable", async () => {
    harness.available = false;
    await send("Synthetic question");
    expect(harness.interpret).not.toHaveBeenCalled();
    expect(text(render())).toContain("Structured filters remain available");
  });
});
