import { createServerFn } from "@tanstack/react-start";
import type {
  ConversationCapability,
  ConversationExtractionResult,
} from "./conversationExtraction";

export const getConversationCapability = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConversationCapability> => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("@/lib/auth/access.server");
    await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    const { conversationCapability } = await import("./conversation.server");
    return conversationCapability();
  },
);

/** POST keeps the narrative out of URLs/history/referrers. Invalid input returns fixed text only. */
export const extractConversationFacts = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => value)
  .handler(async ({ data }): Promise<ConversationExtractionResult> => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("@/lib/auth/access.server");
    await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    const length = Number(getRequest().headers.get("content-length"));
    if (length > 200_000)
      return {
        status: "invalid_input",
        message: "The conversation exceeds the message limit. Start a new conversation.",
      };
    const { extractConversation } = await import("./conversation.server");
    return extractConversation(data);
  });
