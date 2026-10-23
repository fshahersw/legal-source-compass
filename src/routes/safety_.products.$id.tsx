import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { ProductProfile, type ProfileTab } from "@/components/safety/products/ProductProfile";
import { subjectQuery } from "@/components/safety/products/queries";
import type { Grain } from "@/components/safety/products/productModel";
import { pageHead } from "@/lib/corpus/head";

type S = { tab?: ProfileTab | undefined; grain?: Grain | undefined; group?: string | undefined };
const TABS: readonly ProfileTab[] = ["overview", "terms", "records", "sources"];
const ID = /^[a-z][a-z0-9_]{1,20}:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const parse = (raw: string) => {
  const id = decodeURIComponent(raw);
  return ID.test(id) ? id : null;
};

export const Route = createFileRoute("/safety_/products/$id")({
  validateSearch: (s: Record<string, unknown>): S => ({
    tab:
      TABS.includes(s["tab"] as ProfileTab) && s["tab"] !== "overview"
        ? (s["tab"] as ProfileTab)
        : undefined,
    grain: s["grain"] === "month" ? "month" : undefined,
    group:
      typeof s["group"] === "string" && /^[a-z]{2,12}$/.test(s["group"]) ? s["group"] : undefined,
  }),
  loader: ({ context, params }) => {
    const id = parse(params.id);
    return id ? context.queryClient.prefetchQuery(subjectQuery(id)) : undefined;
  },
  head: ({ params }) =>
    pageHead(
      `Product signals: ${decodeURIComponent(params.id)}`,
      "Monthly FDA adverse-event and device reports, reactions or device problems, recalls, complaints and MDL links for one product.",
    ),
  component: Page,
});

function Page() {
  const { id: raw } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const id = parse(raw);
  // the loader prefetched this query: the title is the subject's label once known, else its id
  const subject = useQuery({ ...subjectQuery(id ?? "none:none"), enabled: id != null });
  const title = subject.data?.subject.label ?? id ?? raw;
  return (
    <AppShell
      title={title}
      description="Reports, outcomes, reactions or device problems, recalls and complaints for this product, each with the exact source query. Reports are voluntary and do not establish that the product caused an event."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: "Products & devices", to: "/safety/products" },
        { label: title },
      ]}
    >
      {id ? (
        <ProductProfile
          id={id}
          tab={search.tab ?? "overview"}
          grain={search.grain ?? "year"}
          group={search.group}
          onChange={(next) =>
            void navigate({
              search: (prev: S) => {
                const tab = next.tab ?? prev.tab ?? "overview";
                const grain = next.grain ?? prev.grain ?? "year";
                const group = next.group ?? prev.group;
                return {
                  tab: tab === "overview" ? undefined : tab,
                  grain: grain === "month" ? "month" : undefined,
                  group,
                };
              },
              replace: true,
            })
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">“{raw}” is not a product id.</p>
      )}
    </AppShell>
  );
}
