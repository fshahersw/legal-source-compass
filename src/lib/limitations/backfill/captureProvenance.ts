import type { CaptureMeta } from "./entries";

/** Browser DOM receipts can omit network status; ordinary responses still require HTTP 200. */
export function captureResponseAccepted(meta: CaptureMeta): boolean {
  return (
    meta.status === 200 ||
    (meta.status === null && meta.rendered === true && meta.representation === "browser_dom")
  );
}

export function captureReceiptDetails(meta: CaptureMeta): { method: string; httpStatus?: number } {
  const method = meta.intermediary
    ? `Text obtained through an extraction intermediary (${meta.extraction ?? "unspecified"}); not a direct HTTP response`
    : meta.representation === "browser_dom"
      ? "Official page captured from an authorized browser session; retained bytes are rendered DOM HTML, not the original HTTP response; plain text is the observed document body"
      : meta.rendered
        ? "Official page rendered in a browser; DOM text extracted; authentication and terms-acceptance state not recorded"
        : "Direct HTTPS GET of the official page; HTML block text extraction (scripts/styles/head omitted) or PDF text extraction; no OCR";
  return { method, ...(meta.status === null ? {} : { httpStatus: meta.status }) };
}
