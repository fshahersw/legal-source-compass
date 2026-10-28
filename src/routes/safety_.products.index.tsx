import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ProductsIndex } from "@/components/safety/products/ProductsIndex";
import type { ProductsView } from "@/components/safety/products/ProductsIndex";
import { pageHead } from "@/lib/corpus/head";

type S = { view?: ProductsView | undefined; q?: string | undefined; page?: number | undefined };
// the watch is the default (no ?view); the lists keep their former addresses (?view=drugs, ?view=devices) and the
// MDL list, formerly the default, is ?view=mdl
const VIEWS: readonly ProductsView[] = ["watch", "mdl", "drugs", "devices"];

export const Route = createFileRoute("/safety_/products/")({
  validateSearch: (s: Record<string, unknown>): S => ({
    view:
      VIEWS.includes(s["view"] as ProductsView) && s["view"] !== "watch"
        ? (s["view"] as ProductsView)
        : undefined,
    q:
      typeof s["q"] === "string" && s["q"].length <= 100 && s["q"].trim()
        ? s["q"].trim()
        : undefined,
    page:
      Number.isInteger(Number(s["page"])) && Number(s["page"]) > 1 && Number(s["page"]) <= 2000
        ? Number(s["page"])
        : undefined,
  }),
  head: () =>
    pageHead(
      "Products & devices",
      "Drugs, devices and MDL-named products with monthly FDA adverse-event and device reports, reactions, problems, recalls and complaints.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "watch";
  return (
    <AppShell
      title="Products & devices"
      description="Monthly FDA adverse-event and device reports, reactions and device problems, recalls and vehicle complaints, by product. Reports are not proof that a product caused an event."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: "Products & devices" },
      ]}
    >
      <ProductsIndex
        view={view}
        q={search.q ?? ""}
        page={search.page ?? 1}
        onChange={(next) =>
          void navigate({
            search: (prev: S) => {
              const v = next.view ?? prev.view ?? "watch";
              const q = next.q !== undefined ? next.q : prev.q;
              const p = next.page ?? prev.page ?? 1;
              return {
                view: v === "watch" ? undefined : v,
                q: q || undefined,
                page: p > 1 ? p : undefined,
              };
            },
          })
        }
      />
    </AppShell>
  );
}
