import { createFileRoute } from "@tanstack/react-router";
import { useCorpus } from "@/lib/corpus/store";
import { stateByUsps } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/$state/$county")({
  head: ({ params }) => pageHead(`County ${params.county}`, `County detail within ${stateByUsps.get(params.state.toUpperCase())?.name ?? params.state}.`),
  component: CountyDetail,
});

function CountyDetail() {
  const { state, county } = Route.useParams();
  const { geo } = useCorpus();
  const c = geo?.counties.find((x) => x.id === county);
  const st = stateByUsps.get(state.toUpperCase());
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/50 p-3 text-[13px]" data-testid="county-detail">
      <div className="eyebrow">County · FIPS {county}</div>
      <div className="mt-0.5 font-display text-lg">{c ? `${c.name} County, ${st?.name ?? state}` : "Unknown county"}</div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Neither loaded dataset records county-level locations: V2.2A sources carry state names only, and saved case rows carry a court and state code. County registries, filings and ordinances from the full corpussite archive are not imported yet, so no county count is shown rather than a guessed one.
      </p>
    </div>
  );
}
