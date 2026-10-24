import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps the design system's text sizes next to a text colour", () => {
    expect(cn("flex text-meta text-muted-foreground")).toBe("flex text-meta text-muted-foreground");
    expect(cn("text-label text-foreground")).toBe("text-label text-foreground");
    expect(cn("text-kpi-sm tabular-nums text-foreground")).toBe(
      "text-kpi-sm tabular-nums text-foreground",
    );
    expect(cn("text-title font-semibold text-foreground")).toBe(
      "text-title font-semibold text-foreground",
    );
    expect(cn("text-foreground text-meta")).toBe("text-foreground text-meta");
  });

  it("lets a later size replace an earlier one, custom or built in", () => {
    expect(cn("text-meta", "text-sm")).toBe("text-sm");
    expect(cn("text-sm", "text-meta")).toBe("text-meta");
    expect(cn("text-[13px]", "text-label")).toBe("text-label");
    expect(cn("text-kpi", "text-kpi-sm")).toBe("text-kpi-sm");
  });

  it("still merges colours and ordinary utilities as before", () => {
    expect(cn("text-muted-foreground", "text-foreground")).toBe("text-foreground");
    expect(cn("px-3 py-2", "px-4")).toBe("py-2 px-4");
    const off = Boolean(0);
    expect(cn("p-2", off && "p-4", null, undefined, "m-1")).toBe("p-2 m-1");
    expect(cn("bg-card", "bg-muted/50")).toBe("bg-muted/50");
  });
});
