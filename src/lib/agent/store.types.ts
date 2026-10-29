/** Shapes of the agent workspace records, shared by the server store and the folder UI. */
export type MemoryKind = "fact" | "preference" | "procedure";
export type Memory = {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string[];
  uses: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};
export type FileKind = "document" | "image" | "figure" | "note" | "data" | "report";
export type AgentFile = {
  id: string;
  kind: FileKind;
  title: string;
  mime: string;
  bytes: number;
  source: string | null;
  meta: Record<string, unknown>;
  unread: boolean;
  pinned: boolean;
  created_at: string;
  stored?: boolean;
  snippet?: string | null;
  text_body?: string | null;
  storage_path?: string | null;
};
export type Episode = {
  id: string;
  task: string;
  summary: string;
  pages: string[];
  created_at: string;
};
export type Schedule = {
  id: string;
  owner?: string;
  title: string;
  task: string;
  cadence: "once" | "hourly" | "daily" | "weekdays" | "weekly" | "monthly";
  at_time: string;
  weekday: number | null;
  monthday: number | null;
  tz: string;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_file: string | null;
  runs: number;
  created_at: string;
};
