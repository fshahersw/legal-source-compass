import { createFileRoute } from "@tanstack/react-router";

const MAX_AUDIO = 10 * 1024 * 1024;
const TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)(;.*)?$/;

/** Dictation fallback for browsers without built-in speech recognition: the recorded audio is transcribed on the server. */
export const Route = createFileRoute("/api/assistant-transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireCorpusAccess, corpusAccessErrorResponse } =
          await import("@/lib/auth/access.server");
        try {
          await requireCorpusAccess(request);
        } catch (error) {
          return corpusAccessErrorResponse(error);
        }
        const { allow, clientKey } = await import("@/lib/assistant/limits.server");
        if (!allow(`transcribe:${clientKey(request)}`, 40, 10 * 60 * 1000))
          return Response.json({ error: "Too many recordings in a short time." }, { status: 429 });
        const type = request.headers.get("content-type") ?? "";
        if (!TYPES.test(type))
          return Response.json({ error: "Unsupported audio format." }, { status: 415 });
        const key = process.env["OPENAI_API_KEY"]?.trim();
        if (!key)
          return Response.json(
            { error: "Dictation is not configured on this server." },
            { status: 503 },
          );
        const audio = await request.arrayBuffer();
        if (!audio.byteLength || audio.byteLength > MAX_AUDIO)
          return Response.json({ error: "The recording is empty or too long." }, { status: 413 });
        const ext = type.includes("ogg")
          ? "ogg"
          : type.includes("mp4") || type.includes("m4a")
            ? "m4a"
            : type.includes("wav")
              ? "wav"
              : type.includes("mpeg") || type.includes("mp3")
                ? "mp3"
                : "webm";
        const form = new FormData();
        form.append("file", new Blob([audio], { type: type.split(";")[0]! }), `dictation.${ext}`);
        form.append("model", "gpt-4o-transcribe");
        form.append("response_format", "json");
        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok)
          return Response.json(
            { error: "The recording could not be transcribed." },
            { status: 502 },
          );
        const body = (await res.json()) as { text?: string };
        return Response.json(
          { text: (body.text ?? "").slice(0, 8000) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
