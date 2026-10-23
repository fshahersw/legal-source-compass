import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const candidates = process.env.PYTHON
  ? [{ command: process.env.PYTHON, args: [] }]
  : [
      { command: "python3", args: [] },
      { command: "python", args: [] },
      { command: "py", args: ["-3"] },
    ];
const python = candidates.find(({ command, args }) => {
  const probe = spawnSync(
    command,
    [...args, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"],
    { encoding: "utf8", timeout: 10_000 },
  );
  return !probe.error && probe.status === 0;
});
if (!python)
  throw new Error("Python 3.10+ is required; install Python or set PYTHON to its executable.");

// Explicit reviewed offline suites: synthetic source bytes, temporary files and pinned conformance.
// Do not discover acquisition scripts or run their CLI entry points.
for (const suite of [
  { directory: "scripts/ingest/regulatory", modules: ["test_nhtsa_bulk", "test_cpsc_rss"] },
  {
    directory: "scripts/enrichment",
    modules: [
      "test_court_resources",
      "test_court_resource_bundle",
      "test_law_id_crosswalk",
      "test_safety_insights",
    ],
  },
  { directory: "scripts/enrichment/court_stats", modules: ["test_court_stats"] },
  { directory: "scripts/enrichment/enforcement", modules: ["test_parsing"] },
  { directory: "scripts/enrichment/judges_cross", modules: ["test_judges_cross"] },
  { directory: "scripts/enrichment/judge_xwalk", modules: ["test_judge_xwalk"] },
  { directory: "scripts/enrichment/firm_intel", modules: ["test_firm_intel"] },
  { directory: "scripts/enrichment/scac", modules: ["test_scac"] },
  { directory: "scripts/enrichment/court_locations", modules: ["test_court_locations"] },
  { directory: "scripts/enrichment/matter_xanalysis", modules: ["test_xstats"] },
  { directory: "scripts/enrichment/courts_db", modules: ["test_courts_db"] },
  { directory: "scripts/enrichment/recall_patterns", modules: ["test_recall_lib"] },
  { directory: "scripts/enrichment/mdl_intel", modules: ["test_parsers"] },
  { directory: "scripts/enrichment/open_payments", modules: ["test_open_payments"] },
  { directory: "scripts/enrichment/cfpb", modules: ["test_cfpb"] },
  { directory: "scripts/enrichment/fda_adverse_events", modules: ["test_fda_adverse_events"] },
  { directory: "scripts/enrichment/epa_echo", modules: ["test_epa_echo"] },
  { directory: "scripts/enrichment/npdb", modules: ["test_npdb"] },
  { directory: "scripts/enrichment/osha", modules: ["test_osha"] },
  { directory: "scripts/enrichment/third_party_data", modules: ["test_third_party_data"] },
  {
    directory: "scripts/enrichment/sec",
    modules: [
      "test_evidence",
      "test_financials",
      "test_statements",
      "test_segments",
      "test_ir_docs",
    ],
  },
  { directory: "scripts/enrichment/state_metrics", modules: ["test_parsers"] },
  { directory: "scripts/enrichment/state_analysis", modules: ["test_state_analysis"] },
  { directory: "scripts/enrichment/agencies_fr", modules: ["test_agencies_fr"] },
  { directory: "scripts/enrichment/courtlistener_rest", modules: ["test_courtlistener_rest"] },
  { directory: "scripts/enrichment/court_rules", modules: ["test_court_rules"] },
  { directory: "scripts/enrichment/caselaw", modules: ["test_caselaw", "test_caselaw_read"] },
  { directory: "scripts/enrichment/ecfr_full", modules: ["test_ecfr_full"] },
  { directory: "scripts/enrichment/judiciary", modules: ["test_judiciary"] },
  { directory: "scripts/enrichment/enforcement_actions", modules: ["test_enforcement_actions"] },
  { directory: "scripts/enrichment/uscode", modules: ["test_uscode"] },
  { directory: "scripts/enrichment/enforcement_extra", modules: ["test_enforcement_extra"] },
  { directory: "scripts/enrichment/legislation", modules: ["test_legislation"] },
  { directory: "scripts/enrichment/state_statutes", modules: ["test_state_statutes"] },
  {
    directory: "scripts/limitations/backfill",
    modules: ["test_capture", "test_capture_browser_dom"],
  },
  { directory: "scripts/legal/state-codes/b4/ks", modules: ["test_revalidate"] },
  { directory: "scripts/legal/state-codes/hi", modules: ["test_parse_hrs"] },
  { directory: "scripts/legal/state-codes/ga", modules: ["test_stage_release"] },
  {
    directory: "scripts/legal/state-codes/historical-cic",
    modules: ["test_parse_cic_rtf", "test_capture_originals", "test_stage_historical"],
  },
  { directory: "scripts/legal/state-codes/common", modules: ["test_land_publisher_code_v2"] },
  {
    directory: "scripts/legal/state-codes",
    modules: [
      "test_ca_caml_parser",
      "test_ca_packet_v4",
      "test_ca_hierarchy",
      "test_nj_parse_bulk",
      "test_nj_stage_bulk",
      "test_nj_reconcile_toc",
    ],
  },
]) {
  const result = spawnSync(
    python.command,
    [...python.args, "-B", "-X", "utf8", "-m", "unittest", "-v", ...suite.modules],
    { cwd: resolve(root, suite.directory), stdio: "inherit", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
