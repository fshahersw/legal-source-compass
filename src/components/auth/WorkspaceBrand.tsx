import { BRAND_ASSETS, WORKSPACE_DESCRIPTOR } from "@/lib/branding";

export function WorkspaceBrand() {
  return (
    <div>
      <img
        src={BRAND_ASSETS.wordmarkLight}
        alt="Seeger Weiss LLP"
        width={1531}
        height={391}
        className="h-auto w-56 max-w-full"
      />
      <p className="mt-2 text-xs font-medium text-muted-foreground">{WORKSPACE_DESCRIPTOR}</p>
    </div>
  );
}
