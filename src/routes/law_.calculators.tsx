import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CALCULATOR_TABS,
  CalculatorsPage,
  type CalculatorTab,
} from "@/components/calculators/CalculatorsPage";
import { pageHead } from "@/lib/corpus/head";
import { isIsoDate, isMonthKey } from "@/lib/calculators/dates";

type S = {
  tab?: CalculatorTab | undefined;
  amount?: string | undefined;
  judgment?: string | undefined;
  payment?: string | undefined;
  basis?: "365" | "actual" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  series?: string | undefined;
};

const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : undefined;

export const Route = createFileRoute("/law_/calculators")({
  validateSearch: (s: Record<string, unknown>): S => {
    const tab = str(s["tab"]);
    const amount = str(s["amount"]);
    return {
      tab: CALCULATOR_TABS.some((t) => t.id === tab) ? (tab as CalculatorTab) : undefined,
      amount: amount && /^[\d,.]{1,20}$/.test(amount) ? amount : undefined,
      judgment: isIsoDate(s["judgment"]) ? (s["judgment"] as string) : undefined,
      payment: isIsoDate(s["payment"]) ? (s["payment"] as string) : undefined,
      basis: s["basis"] === "actual" ? "actual" : s["basis"] === "365" ? "365" : undefined,
      from: isMonthKey(s["from"]) ? (s["from"] as string) : undefined,
      to: isMonthKey(s["to"]) ? (s["to"] as string) : undefined,
      series:
        typeof s["series"] === "string" && /^[A-Z0-9]{2,30}$/.test(s["series"])
          ? s["series"]
          : undefined,
    };
  },
  head: () =>
    pageHead(
      "Litigation calculators",
      "Federal post-judgment interest (28 U.S.C. § 1961), inflation adjustment, present value at Treasury yields, life expectancy and cited state judgment rates, each showing the official values and method used.",
    ),
  component: Page,
});

function Page() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = s.tab ?? "interest";
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & government", to: "/law" },
        { label: "Calculators" },
      ]}
      title="Litigation calculators"
      description="Interest, inflation, present value and life expectancy from official published series; every result shows its inputs, the values used and the method."
    >
      <CalculatorsPage
        tab={tab}
        onTab={(next) =>
          void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
        }
        pji={{
          ...(s.amount ? { amount: s.amount } : {}),
          ...(s.judgment ? { judgment: s.judgment } : {}),
          ...(s.payment ? { payment: s.payment } : {}),
          ...(s.basis ? { basis: s.basis } : {}),
        }}
        inflation={{
          ...(s.amount ? { amount: s.amount } : {}),
          ...(s.from ? { from: s.from } : {}),
          ...(s.to ? { to: s.to } : {}),
          ...(s.series ? { series: s.series } : {}),
        }}
      />
    </AppShell>
  );
}
