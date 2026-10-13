import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { actionClass, fieldClass } from "./RegulatoryPrimitives";

/** Retain an explicit user-activated file link; preparing bytes never claims a download succeeded. */
export function RegulatoryDownload({
  text,
  filename,
  label,
}: {
  text: string;
  filename: string;
  label: string;
}) {
  const [file, setFile] = useState<{ text: string; filename: string; url: string } | null>(null);
  const [linkError, setLinkError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setCopyStatus("");
    setLinkError("");
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      setFile({ text, filename, url });
    } catch {
      setFile(null);
      setLinkError(
        "A file link could not be created. Copy the JSON below and save it as the named file.",
      );
      return;
    }
    return () => URL.revokeObjectURL(url);
  }, [text, filename]);
  const current = file && file.text === text && file.filename === filename ? file : null;
  async function copy() {
    setCopyStatus("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyStatus("JSON copied. Save it as the named file.");
    } catch {
      setCopyStatus("Clipboard access is unavailable. Select and copy the JSON field manually.");
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {current && (
        <a className={actionClass} href={current.url} download={filename}>
          <Download className="size-3.5" aria-hidden />
          {label}
        </a>
      )}
      {linkError && (
        <p role="status" className="text-xs">
          {linkError}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-primary underline">
          JSON copy and manual save
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Save this complete JSON as <span className="font-medium">{filename}</span>. It contains
          your browser-saved work and evidence.
        </p>
        <button className={`${actionClass} my-2`} type="button" onClick={() => void copy()}>
          <Copy className="size-3.5" aria-hidden />
          Copy JSON
        </button>
        <label className="block text-xs font-medium">
          Prepared JSON
          <textarea
            className={`${fieldClass} mt-1 font-mono text-xs`}
            rows={6}
            readOnly
            value={text}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        {copyStatus && (
          <p role="status" className="mt-2 text-xs">
            {copyStatus}
          </p>
        )}
      </details>
    </div>
  );
}
