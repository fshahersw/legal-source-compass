import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CalculatorsPage,
  calculatorTab,
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
    const amount = str(s["amount"]);
    return {
      // former ids (life, state-rates, sources) open the tab that now holds their content
      tab: calculatorTab(s["tab"]),
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
      "Federal post-judgment interest (28 U.S.C. § 1961) and cited state judgment rates, inflation by area, present value at Treasury yields, and damages inputs (wage percentiles, wage index, life tables), each with its official source.",
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
      description="Interest, inflation, present value and damages inputs from official series; every figure shows its source."
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
