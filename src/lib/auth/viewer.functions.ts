import { createServerFn } from "@tanstack/react-start";

/**
 * What the current viewer may see. `admin` is true only for a session the auth provider verifies whose email is on the server's
 * ADMIN_EMAILS list; without a session, or with the list unset, it is false. Nothing about the list reaches the browser.
 */
export const getViewerAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { verifiedRequestUser } = await import("./access.server");
  const { isAdminUser } = await import("./accessPolicy");
  const user = await verifiedRequestUser(getRequest());
  return { signedIn: user !== null, admin: isAdminUser(user) };
});
