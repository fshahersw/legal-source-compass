export type ReadAloudStatus = { speaking: boolean; message: string };
export type ReadAloudHost = {
  speechSynthesis?: Pick<SpeechSynthesis, "speak" | "cancel">;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
};

export function createReadAloudSession(
  host: ReadAloudHost,
  onStatus: (status: ReadAloudStatus) => void,
) {
  const synthesis = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  if (
    !synthesis ||
    typeof synthesis.speak !== "function" ||
    typeof synthesis.cancel !== "function" ||
    !Utterance
  )
    return null;
  let active: SpeechSynthesisUtterance | null = null;
  let generation = 0;
  const cancel = () => {
    const utterance = active;
    active = null;
    generation++;
    if (!utterance) return;
    utterance.onend = utterance.onerror = null;
    try {
      synthesis.cancel();
    } catch {
      /* An already-ended browser service may throw. */
    }
  };
  return {
    speak(text: string) {
      cancel();
      if (!text.trim()) return;
      try {
        const utterance = new Utterance(text.trim());
        active = utterance;
        const currentGeneration = ++generation;
        const isCurrent = () => active === utterance && generation === currentGeneration;
        utterance.lang = "en-US";
        utterance.onend = () => {
          if (!isCurrent()) return;
          active = null;
          utterance.onend = utterance.onerror = null;
          onStatus({ speaking: false, message: "Question playback ended." });
        };
        utterance.onerror = () => {
          if (!isCurrent()) return;
          cancel();
          onStatus({
            speaking: false,
            message: "Question playback is unavailable. The question is still shown above.",
          });
        };
        onStatus({ speaking: true, message: "Reading the current question…" });
        synthesis.speak(utterance);
      } catch {
        cancel();
        onStatus({
          speaking: false,
          message: "Question playback is unavailable. The question is still shown above.",
        });
      }
    },
    stop() {
      cancel();
      onStatus({ speaking: false, message: "Question playback stopped." });
    },
  };
}
