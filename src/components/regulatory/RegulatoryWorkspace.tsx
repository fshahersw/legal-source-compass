import type { RegulatoryWorkspaceState } from "./useRegulatoryWorkspace";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import {
  saveLocalRegulatoryInvestigation,
  saveLocalRegulatoryWatchlist,
  saveLocalRegulatoryReview,
  saveLocalRegulatoryBrief,
  getLocalRegulatoryBrief,
  exportLocalRegulatoryWorkspace,
  importLocalRegulatoryWorkspace,
  MAX_REGULATORY_BACKUP_BYTES,
  recheckLocalRegulatoryReviews,
} from "@/lib/regulatory/localWorkspace";
import {
  REGULATORY_REVIEW_STATUSES,
  type RegulatoryEvent,
  type RegulatoryQuery,
  type RegulatoryReview,
} from "@/lib/regulatory/types";
import {
  actionClass,
  Empty,
  fieldClass,
  LoadError,
  panelClass,
  Pending,
  SourceLink,
} from "./RegulatoryPrimitives";
import { queryLabels } from "./monitoringView";
import { reviewCurrencyLabel, reviewsForSourceRecord } from "./workspaceView";
import { RegulatoryDownload } from "./RegulatoryDownload";

type WorkspaceBrief = NonNullable<RegulatoryWorkspaceState["data"]>["briefs"][number];

function WorkspaceBackup({ workspace }: { workspace: RegulatoryWorkspaceState }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<string | null>(null);
  async function transfer(file?: File) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    setPrepared(null);
    try {
      if (file) {
        if (file.size > MAX_REGULATORY_BACKUP_BYTES)
          throw new Error("Backup exceeds the supported size.");
        await importLocalRegulatoryWorkspace(await file.text(), { mode: "merge" });
        await workspace.work.refetch();
        setMessage(
          "Backup merged. Imported evidence is labeled unverified until checked against the source again.",
        );
      } else {
        setPrepared(await exportLocalRegulatoryWorkspace());
        setMessage("Backup prepared. Download it below.");
      }
    } catch {
      setError(
        file
          ? `Backup was not imported. Use a valid workspace backup of ${MAX_REGULATORY_BACKUP_BYTES / 1_000_000} MB or less; existing work is retained.`
          : "Backup could not be exported. Retry after checking browser storage.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionClass}
          disabled={busy}
          onClick={() => void transfer()}
        >
          <Download className="size-3.5" aria-hidden />
          Export backup
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-3.5" aria-hidden />
          Import &amp; merge backup
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Workspace backup file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void transfer(file);
          }}
        />
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {prepared !== null && (
        <RegulatoryDownload
          text={prepared}
          filename="regulatory-workspace-backup.json"
          label="Download prepared backup"
        />
      )}
    </div>
  );
}

function StorageNotice({ workspace }: { workspace: RegulatoryWorkspaceState }) {
  if (workspace.work.isError)
    return (
      <LoadError retry={() => void workspace.work.refetch()}>
        Browser storage could not be opened. Retry with storage enabled to save work on this device.
      </LoadError>
    );
  return <Pending>Opening browser-saved work…</Pending>;
}

function SourceRecheck({
  workspace,
  record,
}: {
  workspace: RegulatoryWorkspaceState;
  record?: { source: string; nativeId: string };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function recheck() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await recheckLocalRegulatoryReviews(record ?? {});
      await workspace.work.refetch();
      const checked = record ? reviewsForSourceRecord(updated.reviews, record) : updated.reviews;
      setMessage(
        checked.some((review) => review.sourceCheckStatus === "unavailable")
          ? "Some source statuses remain unavailable. Prior evidence is retained; see each review’s dated check status."
          : "Source check batch finished. Review decisions and notes are unchanged; see each dated status.",
      );
    } catch {
      setError("Source recheck did not complete. Prior checks and review notes are retained.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className={actionClass} disabled={busy} onClick={() => void recheck()}>
        {busy
          ? "Checking source…"
          : record
            ? "Recheck this source record"
            : "Recheck up to 100 source events"}
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        Each pass checks up to 100 source events, starting with the oldest or unchecked evidence.
      </p>
      {message && (
        <p role="status" className="mt-1 text-xs">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewCurrency({ review }: { review: RegulatoryReview }) {
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p>{reviewCurrencyLabel(review)}</p>
      <p>
        Last successful source check: {review.sourceCheckedAt ?? "Not recorded"}. This is a
        point-in-time check.
      </p>
      <p className="break-all">
        {review.source} / {review.nativeId} · reviewed version {review.payloadSha256}
      </p>
    </div>
  );
}

function InvestigationSelect({
  workspace,
  value,
  onChange,
}: {
  workspace: RegulatoryWorkspaceState;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium">
      Investigation association
      <select
        className={`${fieldClass} mt-1`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No investigation association</option>
        {workspace.data?.investigations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RegulatoryReviewEditor({
  workspace,
  event,
}: {
  workspace: RegulatoryWorkspaceState;
  event: RegulatoryEvent;
}) {
  if (!workspace.data) return <StorageNotice workspace={workspace} />;
  return <ReviewEditor key={event.id} workspace={workspace} event={event} />;
}
function ReviewEditor({
  workspace,
  event,
}: {
  workspace: RegulatoryWorkspaceState;
  event: RegulatoryEvent;
}) {
  const [status, setStatus] =
    useState<(typeof REGULATORY_REVIEW_STATUSES)[number]>("needs_evidence");
  const [note, setNote] = useState("");
  const [investigation, setInvestigation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const existing = reviewsForSourceRecord(workspace.data?.reviews ?? [], event);
  async function save() {
    if (!workspace.canWrite || !note.trim() || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveLocalRegulatoryReview({
        event,
        status,
        note: note.trim(),
        investigationId: investigation || null,
      });
      setMessage("Review saved in this browser against the verified source version.");
      setNote("");
      await workspace.work.refetch();
    } catch {
      setError(
        "Review was not saved. Source verification or browser storage failed; your draft remains here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-sans text-sm font-semibold">Review this evidence</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Saved in this browser. Your note stays on this device; the public source version is
          verified before saving.
        </p>
      </div>
      {existing.length > 0 && (
        <SourceRecheck
          workspace={workspace}
          record={{ source: event.source, nativeId: event.nativeId }}
        />
      )}
      {existing.map((review) => (
        <article key={review.id} className="border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">
            {review.status.replaceAll("_", " ")}
            {review.payloadSha256 !== event.payloadSha256
              ? " · another retained version"
              : " · displayed source version"}
            {review.sourceVerification === "imported_unverified"
              ? " · imported evidence, not reverified"
              : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words">{review.note}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {review.createdAt} · reviewer {review.reviewedBy}
          </p>
          <ReviewCurrency review={review} />
        </article>
      ))}
      {workspace.canWrite && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block text-xs font-medium">
            Review decision
            <select
              className={`${fieldClass} mt-1`}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              {REGULATORY_REVIEW_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <InvestigationSelect
            workspace={workspace}
            value={investigation}
            onChange={setInvestigation}
          />
          <label className="block text-xs font-medium">
            Basis and next question
            <textarea
              className={`${fieldClass} mt-1`}
              rows={3}
              maxLength={10000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
            />
          </label>
          <button className={actionClass} type="submit" disabled={busy || !note.trim()}>
            {busy ? "Saving…" : "Save review"}
          </button>
        </form>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function BriefCard({
  workspace,
  brief,
}: {
  workspace: RegulatoryWorkspaceState;
  brief: WorkspaceBrief;
}) {
  const [open, setOpen] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [prepared, setPrepared] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["regulatory-browser-workspace", "brief", brief.id],
    queryFn: () => getLocalRegulatoryBrief(brief.id),
    enabled: open && !!workspace.data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  async function download() {
    setDownloadError("");
    setPrepared(null);
    const response = await result.refetch();
    if (response.isError || !response.data?.manifest) {
      setDownloadError("The saved brief could not be loaded from browser storage.");
      return;
    }
    setPrepared(JSON.stringify(response.data, null, 2));
  }
  const manifest = !result.isError && !result.isFetching ? result.data?.manifest : null;
  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="min-h-9 text-left text-sm font-semibold text-primary underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {brief.title}
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={result.isFetching}
          onClick={() => void download()}
        >
          <Download className="size-3.5" aria-hidden />
          Prepare manifest download
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {brief.createdAt} · retained evidence manifest
        {brief.sourceVerification === "imported_unverified"
          ? " · imported evidence, not reverified"
          : brief.sourceVerification === "server_snapshot"
            ? " · server-verified at save"
            : " · verification not recorded"}
      </p>
      {downloadError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {downloadError}
        </p>
      )}
      {prepared !== null && (
        <div>
          <p role="status" className="mt-2 text-xs">
            Manifest prepared. Download it below.
          </p>
          <RegulatoryDownload
            text={prepared}
            filename={`regulatory-brief-${brief.id}.json`}
            label="Download prepared manifest"
          />
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {result.isPending || result.isFetching ? (
            <Pending>Loading pinned brief…</Pending>
          ) : result.isError ? (
            <LoadError retry={() => void result.refetch()} />
          ) : manifest ? (
            <>
              <p className="break-all text-xs">Manifest SHA-256: {result.data?.manifestSha256}</p>
              <p className="text-xs">
                {manifest.events.length} pinned source-version events ·{" "}
                {queryLabels(manifest.query).join(" · ")}
              </p>
              <ul className="space-y-3">
                {manifest.events.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm font-medium">{event.record.title}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {event.source} · {event.nativeId} · version {event.payloadSha256}
                    </p>
                    <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm">
                      {event.record.evidence_excerpt || "No excerpt recorded."}
                    </blockquote>
                    <SourceLink url={event.record.source_url}>Recorded source page</SourceLink>
                  </li>
                ))}
              </ul>
              <ul className="list-disc pl-4 text-xs">
                {manifest.qualifications.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">The pinned manifest is unavailable.</p>
          )}
        </div>
      )}
    </li>
  );
}

export function RegulatoryWorkspacePanel({
  workspace,
  query,
  selectedEvents,
  onApply,
  onOpen,
}: {
  workspace: RegulatoryWorkspaceState;
  query: RegulatoryQuery;
  selectedEvents: RegulatoryEvent[];
  onApply: (query: RegulatoryQuery) => void;
  onOpen: (event: RegulatoryEvent) => void;
}) {
  if (!workspace.data)
    return (
      <section className={panelClass}>
        <StorageNotice workspace={workspace} />
      </section>
    );
  return (
    <WorkspaceContent
      workspace={workspace}
      query={query}
      selectedEvents={selectedEvents}
      onApply={onApply}
      onOpen={onOpen}
    />
  );
}

function WorkspaceContent({
  workspace,
  query,
  selectedEvents,
  onApply,
  onOpen,
}: {
  workspace: RegulatoryWorkspaceState;
  query: RegulatoryQuery;
  selectedEvents: RegulatoryEvent[];
  onApply: (query: RegulatoryQuery) => void;
  onOpen: (event: RegulatoryEvent) => void;
}) {
  const data = workspace.data!;
  const [editingInvestigation, setEditingInvestigation] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [inquiryName, setInquiryName] = useState("");
  const [briefTitle, setBriefTitle] = useState("");
  const [investigation, setInvestigation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function mutate(kind: "investigation" | "inquiry" | "brief") {
    if (!workspace.canWrite || busy) return;
    setBusy(kind);
    setMessage("");
    setError("");
    const { limit: _limit, offset: _offset, ...scope } = query;
    try {
      if (kind === "investigation") {
        await saveLocalRegulatoryInvestigation({
          ...(editingInvestigation ? { id: editingInvestigation } : {}),
          title,
          description,
        });
        setEditingInvestigation(null);
        setTitle("");
        setDescription("");
      }
      if (kind === "inquiry") {
        await saveLocalRegulatoryWatchlist({
          name: inquiryName,
          query: scope,
          investigationId: investigation || null,
        });
        setInquiryName("");
      }
      if (kind === "brief") {
        await saveLocalRegulatoryBrief({
          title: briefTitle,
          investigationId: investigation || null,
          eventIds: selectedEvents.map((event) => event.id),
          query: scope,
        });
        setBriefTitle("");
      }
      setMessage(
        kind === "brief"
          ? "Pinned evidence brief saved. Open it below to inspect the source manifest."
          : kind === "inquiry"
            ? "Inquiry saved. This does not enable email or scheduled notifications."
            : "Investigation saved.",
      );
      await workspace.work.refetch();
    } catch {
      setError(
        "The change could not be saved. Browser storage or source verification failed; your draft remains available.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      <section className={`${panelClass} p-3`}>
        <h2 className="font-sans text-base font-semibold">Investigations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Saved in this browser. Notes and titles stay on this device; export a backup to keep or
          transfer your work.
        </p>
        <WorkspaceBackup workspace={workspace} />
      </section>
      {message && (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <section className={panelClass}>
          <div className="border-b border-border p-3">
            <h3 className="font-sans text-sm font-semibold">Investigations</h3>
          </div>
          {data.investigations.length ? (
            <ul className="divide-y divide-border">
              {data.investigations.map((item) => (
                <li key={item.id} className="p-3">
                  <h4 className="text-sm font-semibold">{item.title}</h4>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {item.description || "No hypothesis recorded."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Updated {item.updatedAt}</p>
                  <button
                    type="button"
                    className="mt-1 min-h-9 text-xs text-primary underline"
                    onClick={() => {
                      setEditingInvestigation(item.id);
                      setTitle(item.title);
                      setDescription(item.description);
                    }}
                  >
                    Edit investigation
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No investigations saved">
              Start with a scoped hypothesis and record what would support or weaken it.
            </Empty>
          )}
          {workspace.canWrite && (
            <form
              className="space-y-3 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate("investigation");
              }}
            >
              <label className="block text-xs font-medium">
                Investigation title
                <input
                  className={`${fieldClass} mt-1`}
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>
              <label className="block text-xs font-medium">
                Hypothesis, contrary evidence and next questions
                <textarea
                  className={`${fieldClass} mt-1`}
                  rows={3}
                  maxLength={10000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button className={actionClass} disabled={!!busy || !title.trim()} type="submit">
                {busy === "investigation"
                  ? "Saving…"
                  : editingInvestigation
                    ? "Save investigation changes"
                    : "Create investigation"}
              </button>
              {editingInvestigation && (
                <button
                  type="button"
                  className={`${actionClass} ml-2`}
                  disabled={!!busy}
                  onClick={() => {
                    setEditingInvestigation(null);
                    setTitle("");
                    setDescription("");
                  }}
                >
                  Cancel edit
                </button>
              )}
            </form>
          )}
        </section>
        <section className={panelClass}>
          <div className="border-b border-border p-3">
            <h3 className="font-sans text-sm font-semibold">Saved inquiries</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Stored filters; no notification delivery is enabled by saving an inquiry.
            </p>
          </div>
          {data.watchlists.length ? (
            <ul className="divide-y divide-border">
              {data.watchlists.map((item) => (
                <li key={item.id} className="p-3">
                  <button
                    className="min-h-10 text-left text-sm font-semibold text-primary underline sm:min-h-8"
                    onClick={() => onApply(item.query)}
                  >
                    {item.name}
                  </button>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {queryLabels(item.query).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No inquiries saved">
              Save a reproducible set of public-source filters in this browser.
            </Empty>
          )}
          {workspace.canWrite && (
            <form
              className="space-y-3 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate("inquiry");
              }}
            >
              <p className="text-xs text-muted-foreground">
                Current scope: {queryLabels(query).join(" · ")}
              </p>
              <InvestigationSelect
                workspace={workspace}
                value={investigation}
                onChange={setInvestigation}
              />
              <label className="block text-xs font-medium">
                Inquiry name
                <input
                  className={`${fieldClass} mt-1`}
                  value={inquiryName}
                  maxLength={200}
                  onChange={(e) => setInquiryName(e.target.value)}
                  required
                />
              </label>
              <button
                className={actionClass}
                disabled={!!busy || !inquiryName.trim()}
                type="submit"
              >
                {busy === "inquiry" ? "Saving…" : "Save current inquiry"}
              </button>
            </form>
          )}
        </section>
      </div>
      <section className={panelClass}>
        <div className="border-b border-border p-3">
          <h3 className="font-sans text-sm font-semibold">Pinned evidence briefs</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Public evidence is verified by the server, then saved in this browser with your title. A
            brief is an evidence packet, not a legal conclusion.
          </p>
        </div>
        {workspace.canWrite && (
          <form
            className="space-y-3 border-b border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("brief");
            }}
          >
            <p className="text-sm">
              {selectedEvents.length} events selected from the Signals queue.
            </p>
            {selectedEvents.length > 0 && (
              <ul className="list-disc pl-4 text-xs">
                {selectedEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="min-h-8 text-left text-primary underline"
                      onClick={() => onOpen(event)}
                    >
                      {event.record.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <InvestigationSelect
              workspace={workspace}
              value={investigation}
              onChange={setInvestigation}
            />
            <label className="block text-xs font-medium">
              Brief title
              <input
                className={`${fieldClass} mt-1`}
                value={briefTitle}
                maxLength={200}
                onChange={(e) => setBriefTitle(e.target.value)}
                required
              />
            </label>
            <button
              className={actionClass}
              type="submit"
              disabled={!!busy || !briefTitle.trim() || selectedEvents.length === 0}
            >
              {busy === "brief" ? "Generating…" : "Save evidence brief"}
            </button>
          </form>
        )}
        {data.briefs.length ? (
          <ul className="divide-y divide-border">
            {data.briefs.map((brief) => (
              <BriefCard key={brief.id} workspace={workspace} brief={brief} />
            ))}
          </ul>
        ) : (
          <Empty title="No briefs saved">
            Select evidence in Signals, then generate a pinned brief here.
          </Empty>
        )}
      </section>
      <section className={panelClass}>
        <div className="border-b border-border p-3">
          <h3 className="font-sans text-sm font-semibold">Review history</h3>
          {data.reviews.length > 0 && (
            <div className="mt-2">
              <SourceRecheck workspace={workspace} />
            </div>
          )}
        </div>
        {data.reviews.length ? (
          <ul className="divide-y divide-border">
            {data.reviews.map((review) => (
              <li key={review.id} className="p-3 text-sm">
                <p className="font-medium">
                  {review.status.replaceAll("_", " ")} · {review.source} / {review.nativeId}
                </p>
                <ReviewCurrency review={review} />
                <p className="mt-1 whitespace-pre-wrap break-words">{review.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {review.createdAt} · reviewer {review.reviewedBy}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No reviews recorded">
            Open a source event and record its relevance, uncertainty or dismissal basis.
          </Empty>
        )}
      </section>
    </div>
  );
}
