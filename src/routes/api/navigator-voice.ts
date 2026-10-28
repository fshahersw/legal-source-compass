import { createFileRoute } from "@tanstack/react-router";

const MAX_SDP = 64 * 1024;

/**
 * Starts a voice session for the navigator. The browser posts its WebRTC SDP offer (and its current style profile in
 * the x-voice-style header); the server adds the session configuration (persona, style, tools, voice, turn detection)
 * and exchanges the offer for an answer with the realtime voice service using the server's key, which never reaches
 * the browser. The answer comes back as plain SDP.
 */
export const Route = createFileRoute("/api/navigator-voice")({
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
        const { allow, clientKey, crossSiteRequest } =
          await import("@/lib/assistant/limits.server");
        if (crossSiteRequest(request))
          return Response.json(
            { error: "Requests from other sites are not accepted." },
            { status: 403 },
          );
        if (!allow(`voice:${clientKey(request)}`, 12, 10 * 60 * 1000))
          return Response.json(
            { error: "Too many voice sessions in a short time. Wait a few minutes." },
            { status: 429 },
          );
        const key = process.env["OPENAI_API_KEY"]?.trim();
        if (!key)
          return Response.json(
            { error: "Voice is not configured on this server." },
            { status: 503 },
          );
        const type = request.headers.get("content-type") ?? "";
        if (!/^application\/sdp\b/.test(type))
          return Response.json({ error: "Expected an SDP offer." }, { status: 415 });
        const sdp = await request.text();
        if (!sdp.trim() || sdp.length > MAX_SDP || !sdp.startsWith("v=0"))
          return Response.json({ error: "The SDP offer was not valid." }, { status: 400 });
        const { parseVoiceStyle, voiceInstructions, voiceSiteGuide, VOICE_TOOLS } =
          await import("@/lib/navigator/voiceStyle");
        const { PAGE_GUIDES } = await import("@/lib/navigator/pageGuides");
        let styleRaw: unknown = null;
        try {
          const header = request.headers.get("x-voice-style");
          styleRaw = header ? JSON.parse(decodeURIComponent(header).slice(0, 2000)) : null;
        } catch {
          styleRaw = null;
        }
        const style = parseVoiceStyle(styleRaw);
        const session = {
          type: "realtime",
          model: process.env["VOICE_MODEL"]?.trim() || "gpt-realtime-2.1",
          instructions: voiceInstructions(style, voiceSiteGuide(PAGE_GUIDES)),
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: { model: "gpt-4o-transcribe" },
              turn_detection: { type: "semantic_vad" },
            },
            output: { voice: process.env["VOICE_NAME"]?.trim() || "marin" },
          },
          tools: VOICE_TOOLS,
          tool_choice: "auto",
        };
        const form = new FormData();
        form.set("sdp", sdp);
        form.set("session", JSON.stringify(session));
        // a stable, privacy-preserving identifier for abuse monitoring: a hash of the client address, never the address
        const id = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(`voice|${clientKey(request)}`),
            ),
          ),
        ]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 32);
        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "OpenAI-Safety-Identifier": id },
            body: form,
            signal: AbortSignal.timeout(20000),
          });
        } catch {
          return Response.json(
            { error: "The voice service could not be reached." },
            { status: 502 },
          );
        }
        if (!res.ok) {
          console.error(
            "navigator-voice",
            res.status,
            (await res.text().catch(() => "")).slice(0, 300),
          );
          return Response.json(
            {
              error:
                res.status === 429
                  ? "Voice is busy. Try again in a moment."
                  : "The voice session could not start.",
            },
            { status: 502 },
          );
        }
        const answer = await res.text();
        return new Response(answer, {
          status: 200,
          headers: { "content-type": "application/sdp", "cache-control": "no-store" },
        });
      },
    },
  },
});
