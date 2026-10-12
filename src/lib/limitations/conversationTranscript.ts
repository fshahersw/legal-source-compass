import type { ConversationMessage } from "./conversationState";

export const WITHDRAWN_ASSESSMENT_MESSAGE =
  "[Earlier assessment withdrawn after facts or source evidence changed.]";

/** Use the same projection for rendering, extraction history and user-requested exports.
 * Tag every generated assessment at creation; ordinary fact questions and user words stay intact.
 * Withhold the whole assessment message because reasons can also contain computed dates.
 */
export function projectConversationTranscript(
  messages: readonly ConversationMessage[],
  assessmentBindings: Readonly<Record<string, string>>,
  currentBinding: string,
  sourceRefreshFailed = false,
): ConversationMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !Object.hasOwn(assessmentBindings, message.id)) {
      return { ...message };
    }
    const recordedBinding = assessmentBindings[message.id];
    const current = !sourceRefreshFailed && !!recordedBinding && recordedBinding === currentBinding;
    return {
      ...message,
      content: current ? message.content : WITHDRAWN_ASSESSMENT_MESSAGE,
    };
  });
}
