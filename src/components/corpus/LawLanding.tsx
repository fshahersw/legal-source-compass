import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Building2, Clock3, LibraryBig, MapPin } from "lucide-react";
import { AgencyMark } from "./EntityArtwork";

export function LawLanding() {
  return (
    <div className="space-y-7">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Link
          to="/law"
          search={{ scope: "federal" }}
          className="group relative overflow-hidden rounded-2xl border border-border bg-[#f1f4f0] p-6 sm:p-7"
        >
          <span className="inline-flex rounded-xl border border-white/80 bg-white/75 p-3 text-[#51695c]">
            <LibraryBig className="size-7" strokeWidth={1.5} />
          </span>
          <span className="mt-5 block text-[10px] font-semibold uppercase tracking-[0.17em] text-[#637769]">
            National jurisdiction
          </span>
          <span className="mt-2 block font-display text-2xl text-foreground">
            Federal law & regulation
          </span>
          <span className="mt-2 block max-w-md text-sm leading-relaxed text-muted-foreground">
            Move from statutes to regulations, notices and the agencies behind them.
          </span>
          <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold">
            Explore federal collections
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
        <div className="grid gap-3">
          <Link
            to="/"
            className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-5"
          >
            <span className="rounded-xl bg-[#eef3ef] p-3 text-[#566e60]">
              <MapPin className="size-6" strokeWidth={1.5} />
            </span>
            <span className="flex-1">
              <span className="block font-display text-xl">State law, in context</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                The source code, courts and judges for each state.
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            to="/law/codes"
            search={{ q: "" }}
            className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-5"
          >
            <span className="rounded-xl bg-[#f5f1e9] p-3 text-[#8c7043]">
              <BookOpen className="size-6" strokeWidth={1.5} />
            </span>
            <span className="flex-1">
              <span className="block font-display text-xl">Read state statutes</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                Browse captured chapters, sections and source versions.
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            to="/limitations"
            className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-5"
          >
            <span className="rounded-xl bg-muted p-3 text-primary">
              <Clock3 className="size-6" strokeWidth={1.5} />
            </span>
            <span className="flex-1">
              <span className="block font-display text-xl">Assess time limits</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                Guided facts, cited rules and case-specific review.
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl">
              <Building2 className="size-5 text-muted-foreground" />
              Regulatory agencies
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Explore the organizations behind the recorded rules and notices.
            </p>
          </div>
          <Link
            to="/agencies"
            className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
          >
            Agency directory
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { name: "Food and Drug Administration", label: "Food & drugs" },
            { name: "Environmental Protection Agency", label: "Environmental regulation" },
            { name: "Securities and Exchange Commission", label: "Securities & markets" },
            { name: "Consumer Product Safety Commission", label: "Consumer safety" },
          ].map((a) => (
            <Link
              key={a.name}
              to="/agencies"
              search={{ q: a.name }}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3 transition-colors hover:bg-muted/40"
            >
              <AgencyMark name={a.name} className="size-11" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{a.name}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">{a.label}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Collection availability and source currency are shown where you open a record.</span>
        <Link
          to="/law"
          search={{ view: "list" }}
          className="font-medium hover:text-foreground hover:underline"
        >
          Browse all law datasets →
        </Link>
      </div>
    </div>
  );
}
