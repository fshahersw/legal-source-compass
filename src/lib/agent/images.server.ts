/**
 * Image generation for the agent: diagrams, illustrations and visual explainers from a written prompt. The image comes
 * back as PNG bytes and is saved to the user's agent folder. The key is read only from the server environment and the
 * provider is never named to the user. Server-only.
 */
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export function imagesConfigured(): boolean {
  return !!process.env["OPENAI_API_KEY"]?.trim();
}

/** Requests the agent may not make: photoreal depictions of real, named people and fake official documents. */
const REFUSED =
  /\b(photo(graph)?|photoreal(istic)?|realistic|portrait|headshot)\b[^.]{0,80}\b(judge|senator|president|ceo|attorney|lawyer|plaintiff|defendant|mr\.?|ms\.?|mrs\.?|dr\.?)\b|\b(fake|forged|counterfeit)\b[^.]{0,40}\b(seal|order|subpoena|letterhead|signature|id|passport|license)\b/i;

export function refusedImagePrompt(prompt: string): boolean {
  return REFUSED.test(prompt);
}

export async function generateImage(
  prompt: string,
  size: ImageSize,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; revised: string | null }> {
  const key = process.env["OPENAI_API_KEY"]?.trim();
  if (!key) throw new Error("Image generation is not configured on this server.");
  const model = process.env["IMAGE_MODEL"]?.trim() || "gpt-image-1";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: signal ?? null,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt: prompt.slice(0, 3800), size, quality: "medium", n: 1 }),
  });
  if (!res.ok) {
    const status = res.status;
    if (status === 400)
      throw new Error(
        "The image request was declined. Rephrase it as a diagram or an illustration.",
      );
    throw new Error(`The image could not be made (${status}).`);
  }
  const body = (await res.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image could not be made.");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, revised: body.data?.[0]?.revised_prompt ?? null };
}
