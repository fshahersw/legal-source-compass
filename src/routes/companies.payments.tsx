import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  PaymentsDashboard,
  paymentsDashboardQuery,
  type PaymentsSearch,
} from "@/components/companies/PaymentsDashboard";
import { pageHead } from "@/lib/corpus/head";

const SORTS = new Set(["value", "change", "device"]);
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
/** The router JSON-parses search values, so numeric ids and years can arrive as numbers. */
const digits = (v: unknown, pattern: RegExp) => {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  return typeof s === "string" && pattern.test(s) ? s : undefined;
};

export const Route = createFileRoute("/companies/payments")({
  validateSearch: (s: Record<string, unknown>): PaymentsSearch => ({
    year: digits(s["year"], /^\d{4}$/),
    metric: s["metric"] === "research" ? "research" : undefined,
    q: text(s["q"], 80),
    m: digits(s["m"], /^\d{1,15}$/),
    sort:
      typeof s["sort"] === "string" && SORTS.has(s["sort"])
        ? (s["sort"] as PaymentsSearch["sort"])
        : undefined,
    st: typeof s["st"] === "string" && /^[A-Z]{2}$/.test(s["st"]) ? s["st"] : undefined,
    name: text(s["name"], 120),
  }),
  loader: ({ context }) => context.queryClient.prefetchQuery(paymentsDashboardQuery),
  head: () =>
    pageHead(
      "Industry payments to clinicians",
      "CMS Open Payments general and research payments by manufacturer, nature of payment and recipient state, 2017–2025, with MAUDE device report volume.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/companies/payments" });
  return (
    <AppShell
      title="Industry payments to clinicians"
      description="CMS Open Payments: what drug and device manufacturers paid physicians, practitioners and teaching hospitals, program years 2017–2025."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Companies", to: "/companies" },
        { label: "Industry payments" },
      ]}
    >
      <PaymentsDashboard
        search={search}
        onSearch={(patch) =>
          void navigate({
            search: (prev: PaymentsSearch) => ({ ...prev, ...patch }),
            replace: true,
            resetScroll: false,
          })
        }
      />
    </AppShell>
  );
}
