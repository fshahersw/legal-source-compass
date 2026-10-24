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
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Map the user's chart request onto the given fields. x is the axis, y must be a quantitative field, color is optional. Use only the given keys.",
          },
          { role: "user", content: `Fields: ${JSON.stringify(data.fields)}\nRequest: ${data.prompt}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "encode",
              parameters: {
                type: "object",
                properties: { x: { type: "string" }, y: { type: "string" }, color: { type: "string" } },
                required: ["x", "y"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "encode" } },
      }),
    });
    if (res.status === 429) return { ok: false as const, message: "Too many requests; try again shortly." };
    if (!res.ok) return { ok: false as const, message: "The suggestion could not be made." };
    const body = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    try {
      const args = JSON.parse(body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}") as Record<string, unknown>;
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
