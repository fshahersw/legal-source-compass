/**
 * The navigator's code interpreter: Python 3 with numpy, pandas and matplotlib, running in a Web Worker in the
 * user's browser (Pyodide, loaded on first use). The worker has no access to the page, cookies or the site's APIs; the
 * page's chart tables are passed in as data. State persists between calls until the worker is reset (a timeout or an
 * error that kills it). Browser-only.
 */
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
export const PY_TIMEOUT_MS = 90_000;

const SETUP = String.raw`
import sys, io, json, base64, ast, traceback, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
plt.rcParams.update({
  "figure.figsize": (9, 5), "figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False,
  "axes.grid": True, "grid.alpha": 0.25, "axes.titleweight": "bold", "axes.titlesize": 13,
  "font.size": 10.5, "axes.prop_cycle": matplotlib.cycler(color=["#2a78d6","#e0613a","#2f9e6e","#8a5cc7","#c99a1c","#4a5568"]),
})
pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 30)
_ns = {"pd": pd, "np": np, "plt": plt}
_NUM = re.compile(r"^[\s$€£]*[-−+]?[\d,]*\.?\d+\s*(%|[kKmMbB]|×)?\s*$")
def _num(v):
  if v is None: return None
  s = str(v).strip()
  if s in ("", "Not recorded", "—", "-", "n/a", "N/A"): return None
  if not _NUM.match(s): raise ValueError(s)
  s = s.replace("−", "-").replace(",", "").replace("$", "").replace("€", "").replace("£", "").replace("×", "").strip()
  mult = 1
  if s.endswith("%"): s = s[:-1]
  elif s[-1:] in "kK": mult, s = 1e3, s[:-1]
  elif s[-1:] in "mM": mult, s = 1e6, s[:-1]
  elif s[-1:] in "bB": mult, s = 1e9, s[:-1]
  return float(s) * mult
def _frames(raw):
  out = []
  for c in json.loads(raw):
    cols = [str(x) or f"col{i}" for i, x in enumerate(c.get("columns") or [])]
    rows = c.get("rows") or []
    width = max([len(cols)] + [len(r) for r in rows]) if rows else len(cols)
    while len(cols) < width: cols.append(f"col{len(cols)}")
    df = pd.DataFrame([list(r) + [None] * (width - len(r)) for r in rows], columns=cols)
    for col in df.columns:
      try:
        conv = [_num(v) for v in df[col]]
        if any(v is not None for v in conv): df[col] = pd.to_numeric(pd.Series(conv), errors="coerce")
      except Exception:
        pass
    df.attrs["title"] = c.get("title", "")
    df.attrs["subtitle"] = c.get("subtitle", "")
    df.attrs["sources"] = c.get("sources", [])
    df.attrs["period"] = c.get("period", "")
    out.append(df)
  return out
def _data(text):
  if not isinstance(text, str) or text == "": return None
  try:
    return json.loads(text)
  except Exception:
    pass
  if "," in text or "\t" in text:
    try:
      return pd.read_csv(io.StringIO(text), sep=None, engine="python")
    except Exception:
      pass
  return text
def _show(v):
  if v is None: return None
  if isinstance(v, (pd.DataFrame, pd.Series)): return v.to_string(max_rows=80, max_cols=30)
  r = repr(v)
  return r[:20000]
def _run(code, charts_json, data_text):
  _ns["charts"] = _frames(charts_json)
  if isinstance(data_text, str): _ns["data"] = _data(data_text)
  buf = io.StringIO()
  old = sys.stdout, sys.stderr
  sys.stdout = sys.stderr = buf
  result, error = None, None
  try:
    tree = ast.parse(code)
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
      last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, "<analysis>", "exec"), _ns)
    if last is not None:
      result = _show(eval(compile(last, "<analysis>", "eval"), _ns))
  except BaseException:
    error = traceback.format_exc(limit=4)[-4000:]
  finally:
    sys.stdout, sys.stderr = old
  figs = []
  for n in plt.get_fignums():
    fig = plt.figure(n)
    title = fig._suptitle.get_text() if getattr(fig, "_suptitle", None) else ""
    if not title:
      for ax in fig.axes:
        if ax.get_title(): title = ax.get_title(); break
    b = io.BytesIO()
    fig.savefig(b, format="png", dpi=144, bbox_inches="tight", facecolor="white")
    figs.append({"title": title, "png": base64.b64encode(b.getvalue()).decode("ascii")})
  plt.close("all")
  out = buf.getvalue()
  return json.dumps({"stdout": out[-20000:], "result": result, "error": error, "figures": figs[:6]})
`;

const WORKER_SOURCE = `
const BASE = ${JSON.stringify(PYODIDE_BASE)};
const SETUP = ${JSON.stringify(SETUP)};
let ready = null;
async function boot() {
  importScripts(BASE + "pyodide.js");
  const py = await loadPyodide({ indexURL: BASE });
  await py.loadPackage(["numpy", "pandas", "matplotlib"]);
  py.runPython(SETUP);
  return py;
}
self.onmessage = async (e) => {
  const { id, code, charts, data } = e.data;
  try {
    ready = ready || boot();
    const py = await ready;
    const run = py.globals.get("_run");
    const out = run(code, charts, typeof data === "string" ? data : undefined);
    run.destroy();
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    ready = null;
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err).slice(0, 2000) });
  }
};
`;

export type PyFigure = { title: string; png: string };
export type PyOutput = {
  stdout: string;
  result: string | null;
  error: string | null;
  figures: PyFigure[];
};
export type PyChart = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  sources: string[];
  period: string;
};

let worker: Worker | null = null;
let booted = false;
let seq = 0;
const waiting = new Map<number, { resolve: (v: PyOutput) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; out?: string; error?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (!e.data.ok) return p.reject(new Error(e.data.error || "Python failed to start."));
    try {
      p.resolve(JSON.parse(e.data.out ?? "{}") as PyOutput);
    } catch {
      p.reject(new Error("Python returned an unreadable result."));
    }
  };
  w.onerror = () => {
    for (const [, p] of waiting) p.reject(new Error("The Python sandbox stopped."));
    waiting.clear();
    resetPython();
  };
  worker = w;
  return w;
}

export function resetPython(): void {
  worker?.terminate();
  worker = null;
  booted = false;
}

export function pythonLoaded(): boolean {
  return worker !== null;
}

export async function runPython(
  code: string,
  charts: PyChart[],
  data: string | undefined,
  signal?: AbortSignal,
): Promise<PyOutput> {
  const w = getWorker();
  const id = ++seq;
  return await new Promise<PyOutput>((resolve, reject) => {
    const stop = (why: string) => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      resetPython(); // a running computation cannot be interrupted; start a fresh sandbox
      reject(new Error(why));
    };
    // the first call also downloads the sandbox and its libraries
    const limit = booted ? PY_TIMEOUT_MS : PY_TIMEOUT_MS * 2;
    const timer = setTimeout(
      () => stop(`The code ran longer than ${Math.round(limit / 1000)} seconds and was stopped.`),
      limit,
    );
    signal?.addEventListener("abort", () => stop("Stopped."));
    waiting.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        booted = true;
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.postMessage({ id, code, charts: JSON.stringify(charts), data });
  });
}
