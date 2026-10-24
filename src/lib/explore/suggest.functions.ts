/**
 * Suggests a field mapping (x, y, colour) for the chart explorer from a plain-language request. It returns only keys
 * of the fields it was given; it never sees or produces figures.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  prompt: z.string().trim().min(2).max(300),
  fields: z
    .array(z.object({ key: z.string().max(80), label: z.string().max(120), type: z.enum(["temporal", "quantitative", "nominal"]) }))
    .min(1)
    .max(40),
});

export const suggestEncoding = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok: false as const, message: "AI suggestions are not available right now." };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions:
          "Map the user's chart request onto the given fields. x is the axis, y must be a quantitative field, color is optional (empty string if none). Use only the given keys.",
        input: `Fields: ${JSON.stringify(data.fields)}\nRequest: ${data.prompt}`,
        text: {
          format: {
            type: "json_schema",
            name: "encoding",
            strict: true,
            schema: {
              type: "object",
              properties: { x: { type: "string" }, y: { type: "string" }, color: { type: "string" } },
              required: ["x", "y", "color"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (res.status === 429) return { ok: false as const, message: "Too many requests; try again shortly." };
    if (res.status === 402) return { ok: false as const, message: "AI credits are used up." };
    if (!res.ok || !res.body) return { ok: false as const, message: "The suggestion could not be made." };
    let text = "";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5)) as { type?: string; delta?: string };
          if (ev.type === "response.output_text.delta" && ev.delta) text += ev.delta;
        } catch {
          /* keep-alive or partial line */
        }
      }
    }
    try {
      const args = JSON.parse(text || "{}") as Record<string, unknown>;
      const keys = new Set(data.fields.map((f) => f.key));
      const pick = (v: unknown) => (typeof v === "string" && keys.has(v) ? v : undefined);
      const x = pick(args["x"]);
      const y = pick(args["y"]);
      if (!x || !y) return { ok: false as const, message: "No matching fields for that request." };
      return { ok: true as const, x, y, color: pick(args["color"]) };
    } catch {
      return { ok: false as const, message: "The suggestion could not be read." };
    }
  });
