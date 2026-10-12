type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
export type DictationRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => DictationRecognition;
export type RecognitionHost = {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};
export type DictationStatus = {
  state: "idle" | "starting" | "listening" | "stopping" | "error";
  message: string;
};

export function dictationConstructor(host: RecognitionHost): RecognitionConstructor | null {
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function errorMessage(error: string): string {
  if (["not-allowed", "service-not-allowed", "NotAllowedError", "SecurityError"].includes(error)) {
    return "Microphone access was not allowed. You can continue typing.";
  }
  if (error === "network") return "The browser's dictation service is unavailable. Try typing.";
  if (error === "audio-capture") return "No microphone is available. You can continue typing.";
  if (error === "no-speech") return "No speech was detected. Try again or continue typing.";
  return "Dictation stopped. Try again or continue typing.";
}

// Kept independent of the browser so lifecycle and late-event behavior can be tested without a mic.
export function createDictationSession(
  makeRecognition: () => DictationRecognition,
  onTranscript: (text: string) => void,
  onStatus: (status: DictationStatus) => void,
) {
  let active: DictationRecognition | null = null;
  let generation = 0;
  const detach = (recognition: DictationRecognition) => {
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
  };
  const cancel = () => {
    const recognition = active;
    active = null;
    generation++;
    if (!recognition) return;
    detach(recognition);
    try {
      recognition.abort();
    } catch {
      // Already-ended implementations may throw. The session is still invalidated.
    }
  };
  const fail = (error: string) => {
    cancel();
    onStatus({ state: "error", message: errorMessage(error) });
  };
  return {
    start() {
      if (active) return;
      try {
        const recognition = makeRecognition();
        active = recognition;
        const currentGeneration = ++generation;
        const isCurrent = () => active === recognition && generation === currentGeneration;
        const delivered = new Set<number>();
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onstart = () => {
          if (isCurrent()) onStatus({ state: "listening", message: "Listening…" });
        };
        recognition.onresult = (event) => {
          if (!isCurrent()) return;
          for (let index = event.resultIndex; index < event.results.length; index++) {
            const result = event.results[index];
            if (!result?.isFinal || delivered.has(index)) continue;
            delivered.add(index);
            const text = result[0]?.transcript.trim();
            if (text) onTranscript(text);
          }
        };
        recognition.onerror = (event) => {
          if (isCurrent()) fail(event.error);
        };
        recognition.onend = () => {
          if (!isCurrent()) return;
          active = null;
          detach(recognition);
          onStatus({ state: "idle", message: "Dictation ended. Review the draft before sending." });
        };
        onStatus({ state: "starting", message: "Starting microphone…" });
        recognition.start();
      } catch (error) {
        fail(error instanceof Error ? error.name : "unknown");
      }
    },
    stop() {
      if (!active) return;
      onStatus({ state: "stopping", message: "Finishing dictation…" });
      try {
        active.stop();
      } catch {
        fail("unknown");
      }
    },
    abort() {
      cancel();
      onStatus({ state: "idle", message: "Dictation stopped." });
    },
  };
}
