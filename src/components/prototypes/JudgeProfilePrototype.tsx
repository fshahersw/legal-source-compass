import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowUpDown,
  Briefcase,
  CalendarDays,
  ExternalLink,
  Gavel,
  GraduationCap,
  Landmark,
  Scale,
} from "lucide-react";

type FjcService = {
  court: string;
  court_id: string | null;
  title: string;
  president: string;
  party: string;
  aba_rating: string | null;
  nomination: string | null;
  confirmation: string | null;
  vote: string | null;
  commission: string | null;
  chief_begin: string | null;
  chief_end: string | null;
  senior_status: string | null;
  termination: string | null;
  termination_date: string | null;
};

type FjcProfile = {
  nid: string;
  name: string;
  birth_year: number | null;
  birth_place: string | null;
  services: FjcService[];
  current_court_id: string | null;
  status: string;
  education: { school: string; degree: string | null; year: string | null }[];
  career: string | null;
  other_federal_service: string[];
  years_service: number | null;
  age: number | null;
  mdls: { mdl: number; title: string; pending: number; type: string | null }[];
  court_workload: Record<string, number | null> | null;
  judge_profile_id: string | null;
  cl_person_id: string | null;
};

type Props = { profile: FjcProfile; fjcUrl: string };

const NR = "Not recorded";

function text(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return NR;
  const s = String(v).trim();
  return s === "" ? NR : s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: string | null): string {
  if (!d) return NR;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
  return d;
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(s: string, n = 30): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const nf = new Intl.NumberFormat("en-US");

function statusTone(status: string): { dot: string; badge: string } {
  const s = status.toLowerCase();
  if (s.includes("senior")) return { dot: "bg-secondary", badge: "bg-muted text-warning" };
  if (s.includes("active")) return { dot: "bg-primary", badge: "bg-muted text-success" };
  return { dot: "bg-muted", badge: "bg-muted text-muted-foreground" };
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-card shadow-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
          <span className="text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        {action}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5 shadow-card">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function JudgeProfilePrototype({ profile, fjcUrl }: Props) {
  const tone = statusTone(profile.status);

  const totalPending = useMemo(
    () => profile.mdls.reduce((sum, m) => sum + (typeof m.pending === "number" ? m.pending : 0), 0),
    [profile.mdls],
  );

  const appointment = useMemo(() => {
    const cur = profile.services.find((s) => s.court_id && s.court_id === profile.current_court_id);
    return cur ?? profile.services[0] ?? null;
  }, [profile.services, profile.current_court_id]);

  const careerEntries = useMemo(
    () =>
      (profile.career ?? "")
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    [profile.career],
  );

  // Mixed units (counts, months, percentages) cannot share one axis; show the measures that describe workload.
  const workload = useMemo(() => {
    const w = profile.court_workload;
    if (!w) return [];
    const rows: { key: string; label: string; value: string }[] = [];
    const add = (key: string, label: string, format: (v: number) => string) => {
      const v = w[key];
      if (typeof v === "number") rows.push({ key, label, value: format(v) });
    };
    add("per_judge_weighted_filings", "Weighted filings per judgeship", (v) => nf.format(v));
    add("per_judge_pending", "Pending cases per judgeship", (v) => nf.format(v));
    add("median_months_civil", "Median months, civil filing to disposition", (v) => v.toFixed(1));
    add("median_months_civil_to_trial", "Median months, civil filing to trial", (v) =>
      v.toFixed(1),
    );
    add("civil_over_3y_pct", "Civil cases over three years old", (v) => `${v.toFixed(1)}%`);
    return rows;
  }, [profile.court_workload]);

  const [mdlSort, setMdlSort] = useState<"pending" | "title">("pending");
  const sortedMdls = useMemo(() => {
    const rows = [...profile.mdls];
    if (mdlSort === "pending") rows.sort((a, b) => b.pending - a.pending);
    else rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows;
  }, [profile.mdls, mdlSort]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 font-sans text-foreground lg:px-8">
      {/* Identity header */}
      <header aria-label="Judge identity" className="border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {profile.name}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${tone.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-md ${tone.dot}`} aria-hidden="true" />
                {text(profile.status)}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {profile.birth_year ? `Born ${profile.birth_year}` : "Birth year not recorded"}
              {profile.birth_place ? ` · ${profile.birth_place}` : ""}
              {" · "}FJC No. <span className="font-mono tabular-nums">{profile.nid}</span>
            </p>
          </div>
          <a
            href={fjcUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            FJC Biographical Directory
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label="Age" value={profile.age === null ? NR : nf.format(profile.age)} />
          <Stat
            label="Years of Service"
            value={profile.years_service === null ? NR : nf.format(profile.years_service)}
          />
          <Stat
            label="Open MDL Proceedings"
            value={nf.format(profile.mdls.length)}
            sub="assigned to this judge"
          />
          <Stat label="Pending MDL Actions" value={nf.format(totalPending)} sub="across all MDLs" />
          <Stat
            label="Appointing President"
            value={appointment ? text(appointment.president) : NR}
            sub={appointment ? text(appointment.party) : undefined}
          />
        </div>
      </header>

      {/* Main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-7">
          <Section title="Judicial Service" icon={<CalendarDays className="h-4 w-4" />}>
            {profile.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <ol className="space-y-0">
                {profile.services.map((s, i) => {
                  const ongoing = !s.termination_date;
                  const range = `${fmtDate(s.commission)} — ${ongoing ? "Present" : fmtDate(s.termination_date)}`;
                  return (
                    <li
                      key={`${s.court}-${i}`}
                      className="relative border-l border-border-strong pb-6 pl-5 last:pb-0"
                    >
                      <span
                        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-md border border-border-strong ${
                          ongoing ? "bg-primary" : "bg-muted"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {text(s.title)}
                          {s.court.trim() !== "" && (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              {s.court_id ? (
                                <Link
                                  to="/courts/$id"
                                  params={{ id: s.court_id }}
                                  className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {s.court}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">{s.court}</span>
                              )}
                            </>
                          )}
                        </p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {range}
                        </p>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        {(s.chief_begin || s.chief_end) && (
                          <li>
                            Chief Judge, {fmtDate(s.chief_begin)} —{" "}
                            {s.chief_end ? fmtDate(s.chief_end) : "Present"}
                          </li>
                        )}
                        {s.senior_status && (
                          <li>Senior status assumed {fmtDate(s.senior_status)}</li>
                        )}
                        {s.termination && (
                          <li>
                            Service terminated: {s.termination}
                            {s.termination_date ? ` (${fmtDate(s.termination_date)})` : ""}
                          </li>
                        )}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title="Education" icon={<GraduationCap className="h-4 w-4" />}>
            {profile.education.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <ul className="divide-y divide-border">
                {profile.education.map((e, i) => (
                  <li
                    key={`${e.school}-${i}`}
                    className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="text-sm font-medium text-foreground">{e.school}</span>
                    <span className="text-right text-xs text-muted-foreground">
                      {text(e.degree)}
                      {e.year ? <span className="font-mono tabular-nums"> · {e.year}</span> : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Professional Career" icon={<Briefcase className="h-4 w-4" />}>
            {careerEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <ol className="space-y-2">
                {careerEntries.map((entry, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-border pl-3 text-sm leading-relaxed text-foreground"
                  >
                    {entry}
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Other Federal Service
              </p>
              {profile.other_federal_service.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{NR}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {profile.other_federal_service.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-6 lg:col-span-5">
          <Section title="Appointment Record" icon={<Landmark className="h-4 w-4" />}>
            {appointment === null ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  {appointment.court_id ? (
                    <Link
                      to="/courts/$id"
                      params={{ id: appointment.court_id }}
                      className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {appointment.court}
                    </Link>
                  ) : (
                    appointment.court
                  )}
                </p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Field label="Nominated By" value={text(appointment.president)} />
                  <Field label="Party" value={text(appointment.party)} />
                  <Field label="ABA Rating" value={text(appointment.aba_rating)} />
                  <Field label="Nomination" value={fmtDate(appointment.nomination)} mono />
                  <Field label="Confirmation" value={fmtDate(appointment.confirmation)} mono />
                  <Field label="Senate Vote" value={text(appointment.vote)} mono />
                  <Field label="Commission" value={fmtDate(appointment.commission)} mono />
                </dl>
              </>
            )}
          </Section>

          <Section
            title="Pending MDL Docket"
            icon={<Gavel className="h-4 w-4" />}
            action={
              profile.mdls.length > 1 ? (
                <div
                  className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5"
                  role="group"
                  aria-label="Sort MDL docket"
                >
                  <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  {(
                    [
                      { key: "pending", label: "By pending" },
                      { key: "title", label: "By title" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      aria-pressed={mdlSort === opt.key}
                      onClick={() => setMdlSort(opt.key)}
                      className={`rounded-md px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        mdlSort === opt.key
                          ? "bg-card text-foreground shadow-card"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          >
            {profile.mdls.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th
                        scope="col"
                        className="pb-2 pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        MDL No.
                      </th>
                      <th
                        scope="col"
                        className="pb-2 pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Proceeding
                      </th>
                      <th
                        scope="col"
                        className="pb-2 pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Pending
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedMdls.map((m) => (
                      <tr key={m.mdl}>
                        <td className="py-2 pr-3 align-top font-mono text-xs tabular-nums">
                          <Link
                            to="/records/$dataset/$id"
                            params={{ dataset: "mdl_analytics", id: String(m.mdl) }}
                            className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {m.mdl}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 align-top text-foreground">{m.title}</td>
                        <td className="py-2 pr-3 align-top text-xs text-muted-foreground">
                          {text(m.type)}
                        </td>
                        <td className="py-2 text-right align-top font-mono tabular-nums text-foreground">
                          {nf.format(m.pending)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-strong">
                      <td
                        colSpan={3}
                        className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Total pending actions
                      </td>
                      <td className="pt-2 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                        {nf.format(totalPending)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          <Section title="Court Workload Context" icon={<Scale className="h-4 w-4" />}>
            {workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">{NR}</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  12 months ending June 30, 2026 · the judge&apos;s current district court
                </p>
                <dl className="divide-y divide-border text-sm">
                  {workload.map((w) => (
                    <div key={w.key} className="flex items-baseline justify-between gap-3 py-1.5">
                      <dt className="text-muted-foreground">{w.label}</dt>
                      <dd className="font-medium tabular-nums">{w.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Section>
        </div>
      </div>

      {/* Identifiers */}
      <footer
        aria-label="Record identifiers"
        className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground"
      >
        <span>
          Judge Profile ID{" "}
          <span className="font-mono tabular-nums text-foreground">
            {text(profile.judge_profile_id)}
          </span>
        </span>
        <span>
          CourtListener Person ID{" "}
          <span className="font-mono tabular-nums text-foreground">
            {text(profile.cl_person_id)}
          </span>
        </span>
        <span>
          Current Court ID{" "}
          <span className="font-mono tabular-nums text-foreground">
            {text(profile.current_court_id)}
          </span>
        </span>
      </footer>
    </div>
  );
}
