import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mdlPacket } from "@/lib/legal/packets";

export const getLegalMdlPacket = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ id: z.string().regex(/^(?:MDL[:-])?0*[1-9]\d{0,5}$/i) }).parse(data))
  .handler(async ({ data }) => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("@/lib/auth/access.server");
    await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    const id = `MDL-${Number(data.id.replace(/^MDL[:-]/i, ""))}`;
    const { rpcPost } = await import("@/lib/external/rest.server");
    const source = await rpcPost<unknown>("corpus_legal_mdl_v3", { p_id: id });
    if (source === null) return { json: null };
    return { json: JSON.stringify(mdlPacket.parse(source)) };
  });
