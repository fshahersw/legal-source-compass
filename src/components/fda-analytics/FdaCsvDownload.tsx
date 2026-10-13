import { useEffect, useState } from "react";
import { actionClass, fieldClass } from "@/components/regulatory/RegulatoryPrimitives";

export function FdaCsvDownload({ text, filename }: { text: string; filename: string }) {
  const [file, setFile] = useState<{ text: string; filename: string; url: string } | null>(null);
  useEffect(() => {
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    } catch {
      setFile(null);
      return;
    }
    setFile({ text, filename, url });
    return () => URL.revokeObjectURL(url);
  }, [text, filename]);
  const current = file?.text === text && file.filename === filename ? file : null;
  return (
    <div className="space-y-2">
      {current && (
        <a className={actionClass} href={current.url} download={filename}>
          Download chart data CSV
        </a>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-primary underline">
          CSV copy and manual save
        </summary>
        <label className="mt-2 block text-xs">
          Prepared CSV · save as {filename}
          <textarea
            rows={5}
            readOnly
            value={text}
            className={`${fieldClass} mt-1 font-mono text-xs`}
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
          />
        </label>
      </details>
    </div>
  );
}
