import { useState, type AnchorHTMLAttributes } from "react";
import { toast } from "sonner";
import { downloadBundleSnapshot } from "@/lib/private-data/client";

export function PrivateDataLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const [loading, setLoading] = useState(false);
  return <a {...props} href="#" aria-busy={loading} onClick={async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try { await downloadBundleSnapshot(href); }
    catch (error) { toast.error(error instanceof Error ? error.message : "The download failed."); }
    finally { setLoading(false); }
  }}>{children}</a>;
}
