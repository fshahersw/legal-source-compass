import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { RegulationIndexV1 } from "@/components/law/regulations/RegulationIndexV1";
import {
  ContentsPanel,
  RegTabs,
  RegisterPanel,
  RuleReader,
  SearchPanel,
  SourcePanel,
  SourceStrip,
} from "@/components/law/regulations/StateRegulations";
import type { RegTab } from "@/components/law/regulations/labels";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { listRegulationCodes } from "@/lib/external/courtRulesLaw.functions";
import { NODE_ID, RULE_ID, listStateRegCodes } from "@/lib/external/stateRegs.functions";

const TABS: RegTab[] = ["search", "register", "source"];

type RegSearchParams = {
  q: string;
  level: string | undefined;
  tab?: RegTab;
  node?: string;
  rule?: string;
};

export const Route = createFileRoute("/law_/regulations/$state")({
  validateSearch: (search: Record<string, unknown>): RegSearchParams => {
    const out: RegSearchParams = {
      q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
      level:
        typeof search["level"] === "string" && /^[a-z ]{2,30}$/.test(search["level"])
          ? search["level"]
          : undefined,
    };
    if (TABS.includes(search["tab"] as RegTab)) out.tab = search["tab"] as RegTab;
    if (typeof search["node"] === "string" && NODE_ID.test(search["node"]))
      out.node = search["node"];
    if (typeof search["rule"] === "string" && RULE_ID.test(search["rule"]))
      out.rule = search["rule"];
    return out;
  },
  head: ({ params }) => {
    const name = stateByUsps.get(params.state.toUpperCase())?.name ?? params.state;
    return pageHead(
      `${name} administrative code`,
      `The ${name} administrative code from its official publisher: table of contents, rule text, search and the state register.`,
    );
  },
  component: StateRegulationsPage,
});

function StateRegulationsPage() {
  const { state: raw } = Route.useParams();
  const state = raw.toUpperCase();
  const { q, level, tab, node, rule } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/regulations/$state" });
  const v2Fn = useServerFn(listStateRegCodes);
  const v1Fn = useServerFn(listRegulationCodes);
  const v2 = useQuery({
    queryKey: ["state-reg-codes-v2"],
    queryFn: () => v2Fn(),
    staleTime: 10 * 60 * 1000,
  });
  const v1 = useQuery({
    queryKey: ["state-regulation-codes"],
    queryFn: () => v1Fn(),
    staleTime: 10 * 60 * 1000,
  });
  const name = stateByUsps.get(state)?.name ?? state;
  const code = v2.data?.find((c) => c.state === state) ?? null;
  const v1code = v1.data?.find((c) => c.state === state) ?? null;
  const active: RegTab = tab ?? "contents";
  const loading = v2.isLoading || (v2.data === null && v1.isLoading);
  const v1Filter = (next: { q: string; level: string | undefined }) =>
    void navigate({ search: { q: next.q, level: next.level, ...(tab ? { tab } : {}) } });

  let body: React.ReactNode = null;
  if (code) {
    let panel: React.ReactNode;
    if (rule) panel = <RuleReader id={rule} />;
    else if (active === "source") panel = <SourcePanel code={code} />;
    else if (active === "register") panel = <RegisterPanel code={code} />;
    else if (active === "search")
      panel =
        code.textRules > 0 ? (
          <SearchPanel
            state={state}
            q={q}
            onSearch={(next) =>
              void navigate({ search: { q: next, level: undefined, tab: "search" } })
            }
          />
        ) : v1code ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              No rule text is held for this state yet; this filters the table of contents.
            </p>
            <RegulationIndexV1 code={v1code} q={q} level={level} onFilter={v1Filter} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No rule text or table of contents is held for this state yet.
          </p>
        );
    else
      panel =
        code.indexNodes > 0 ? (
          <ContentsPanel state={state} node={node} />
        ) : v1code ? (
          <RegulationIndexV1 code={v1code} q={q} level={level} onFilter={v1Filter} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No table of contents is loaded for {name} yet. Read the code on the publisher's site
            (link above).
          </p>
        );
    body = (
      <>
        <SourceStrip code={code} />
        <RegTabs state={state} active={rule ? "contents" : active} />
        {panel}
      </>
    );
  } else if (v2.data === null || (v2.data && !code)) {
    // the v2 contract is not applied yet (or this state is missing from it): the v1 index, as before
    body = v1code ? (
      <RegulationIndexV1 code={v1code} q={q} level={level} onFilter={v1Filter} />
    ) : v1.data ? (
      <p className="text-sm text-muted-foreground">
        No administrative code index is recorded for {name}.{" "}
        <Link to="/law/regulations" search={{ q: "" }} className="text-primary underline">
          All states
        </Link>
      </p>
    ) : null;
  }
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "State administrative codes", to: "/law/regulations" },
        { label: name },
      ]}
      title={code?.codeName ?? v1code?.code ?? `${name} administrative code`}
      {...((code?.publisher ?? v1code?.publisher)
        ? { description: (code?.publisher ?? v1code?.publisher)! }
        : {})}
    >
      {v2.error ? <ExternalError error={v2.error} /> : null}
      {v1.error && !code ? <ExternalError error={v1.error} /> : null}
      {loading ? (
        <div
          className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : null}
      {body}
    </AppShell>
  );
}
