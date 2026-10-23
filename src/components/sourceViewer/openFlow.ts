/**
 * What happens, and in what order, between a click on an outside link and the first view: everything that does not depend on
 * the embeddability check starts at once (the check itself, the session-cookie refresh, and for an address that is plainly a
 * document the document view), so the first view waits only for what it truly needs. Kept free of React so the order is
 * tested.
 */
import type { CheckOutcome, SourceClient } from "./sourceClient";
import { looksLikeDocument } from "./sourceLinks";

export type OpenFlowDeps = {
  client: Pick<SourceClient, "check">;
  /** Refreshes the same-site session cookie (cheap when it is already fresh). */
  refreshSession: () => Promise<void>;
};

export type OpenFlowHandlers = {
  /** The address is plainly a document: start its view now; the check confirms or corrects it. */
  optimistic: (view: "document") => void;
  /** The check answered. Not called after cancel. */
  checked: (outcome: CheckOutcome) => void;
};

/** Starts the open sequence for an address and returns a function that cancels it. */
export function runOpenFlow(
  deps: OpenFlowDeps,
  url: string,
  handlers: OpenFlowHandlers,
): () => void {
  let live = true;
  const isDocument = looksLikeDocument(url);

  // All of these are independent of the check, so none waits for another.
  const outcome = deps.client.check(url);
  void deps.refreshSession();
  if (isDocument) handlers.optimistic("document");

  void outcome.then((result) => {
    if (!live) return;
    live = false;
    handlers.checked(result);
  });
  return () => {
    live = false;
  };
}
