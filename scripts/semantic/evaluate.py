"""Retrieval check for the semantic index: recall@k of labeled queries against the embedded vectors, cosine in numpy.

    cd <repo>
    python3 -I -B scripts/semantic/evaluate.py run [--queries scripts/semantic/eval_queries.json] [--k 10]

Each labeled query names the record(s) whose stored text answers it (written from that text, see eval_queries.json). A query is
a hit when any expected record is among the top-k records, where a record's score is its best passage. Queries are embedded as
"query"; the corpus vectors are the shards under private/build/semantic/. Results (per query rank of the first expected record, the
top titles, summary recall@k and MRR, overall, per dataset, and restricted to the expected dataset) go to
private/build/semantic/eval_results.json. The labels are a small sample for catching regressions in retrieval; they are not a
benchmark of legal research quality.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import embed as em  # noqa: E402
import sources as src  # noqa: E402
import voyage as vg  # noqa: E402


def top_records(sims: np.ndarray, records: list[str], k: int) -> list[str]:
    """Record ids of the k best-scoring records, a record scoring as its best passage."""
    best: dict[str, float] = {}
    for s, r in zip(sims.tolist(), records):
        if r not in best or s > best[r]:
            best[r] = s
    return [r for r, _ in sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def reciprocal_rank(ranked: list[str], expected: set[str]) -> float:
    for i, r in enumerate(ranked, 1):
        if r in expected:
            return 1.0 / i
    return 0.0


def recall_at_k(ranked: dict[str, list[str]], expected: dict[str, set[str]], k: int) -> dict:
    hits, misses = 0, []
    for qid, exp in expected.items():
        if any(r in exp for r in ranked.get(qid, [])[:k]):
            hits += 1
        else:
            misses.append(qid)
    n = len(expected)
    return {"k": k, "hits": hits, "queries": n, "recall": hits / n if n else 0.0, "misses": misses}


def normalize(text: str) -> str:
    return " ".join(ck.clean_for_embedding(text).lower().split())


def verify_labels(spec: dict, docs_for=None) -> list[str]:
    """Problems with the labels: an expected record that does not exist, or an evidence phrase that is not in the text the index
    embeds for it (heading path plus stored or composed text). Empty list = every label is supported by the stored text."""
    docs_for = docs_for or (lambda ds: src.ITERATORS[ds]())
    wanted: dict[str, dict[str, set[str]]] = {}
    for q in spec["queries"]:
        for e in q["expected"]:
            wanted.setdefault(e["dataset"], {}).setdefault(e["record_id"], set()).add(e["evidence"])
    problems: list[str] = []
    for ds, targets in wanted.items():
        found: dict[str, str] = {}
        for doc in docs_for(ds):
            if doc.record_id in targets:
                found[doc.record_id] = normalize(f"{doc.heading}\n{doc.text}")
                if len(found) == len(targets):
                    break
        for rid, phrases in targets.items():
            if rid not in found:
                problems.append(f"{ds}/{rid}: record not found among the documents the index embeds")
                continue
            for phrase in sorted(phrases):
                if normalize(phrase) not in found[rid]:
                    problems.append(f"{ds}/{rid}: evidence phrase not in the embedded text: {phrase!r}")
    return problems


def load_corpus(datasets: list[str] | None = None):
    """(matrix float16 list of arrays, keys 'dataset/record_id', passage titles) for every stored shard."""
    blocks, keys, titles = [], [], []
    for ds in sorted(os.listdir(em.OUT)):
        mp = os.path.join(em.OUT, ds, "manifest.json")
        if not os.path.exists(mp) or (datasets and ds not in datasets):
            continue
        manifest = json.load(open(mp))
        for s in manifest["shards"]:
            vec_path, meta_path = em.shard_paths(os.path.join(em.OUT, ds), int(s["name"].split("-")[1]))
            metas = em.read_meta(meta_path)
            blocks.append(np.memmap(vec_path, dtype="<f2", mode="r").reshape(-1, vg.DIMENSIONS))
            keys.extend(f"{m['dataset']}/{m['record_id']}" for m in metas)
            titles.extend(m["title"] for m in metas)
    return blocks, keys, titles


def score_all(blocks, q: np.ndarray) -> np.ndarray:
    """Cosine similarity of each query row with every stored passage: (queries, passages) float32."""
    qn = q / np.linalg.norm(q, axis=1, keepdims=True)
    out = []
    for b in blocks:
        for i in range(0, len(b), 50_000):
            m = np.asarray(b[i : i + 50_000], dtype=np.float32)
            out.append((qn @ m.T) / np.linalg.norm(m, axis=1)[None, :])
    return np.concatenate(out, axis=1)


def run(queries_path: str, k: int) -> dict:
    spec = json.load(open(queries_path, encoding="utf-8"))
    queries = spec["queries"]
    client = vg.VoyageClient()
    qv = np.zeros((len(queries), vg.DIMENSIONS), dtype=np.float32)
    tokens = 0
    for i in range(0, len(queries), 64):
        v, t = client.embed([q["query"] for q in queries[i : i + 64]], "query")
        qv[i : i + 64] = v.astype(np.float32)
        tokens += t
    usage = em.Usage(os.path.join(em.OUT, "usage.json"), em.TOTAL_BUDGET)
    usage.add("evaluation_queries", tokens, requests=(len(queries) + 63) // 64)
    usage.save()
    blocks, keys, titles = load_corpus()
    sims = score_all(blocks, qv)
    ranked_all: dict[str, list[str]] = {}
    ranked_in: dict[str, list[str]] = {}
    expected: dict[str, set[str]] = {}
    detail = []
    ds_of = np.array([x.split("/", 1)[0] for x in keys])
    for qi, q in enumerate(queries):
        exp = {f"{e['dataset']}/{e['record_id']}" for e in q["expected"]}
        expected[q["id"]] = exp
        ranked_all[q["id"]] = top_records(sims[qi], keys, k)
        wanted = {e["dataset"] for e in q["expected"]}
        mask = np.isin(ds_of, list(wanted))
        sub_keys = [x for x, m in zip(keys, mask) if m]
        ranked_in[q["id"]] = top_records(sims[qi][mask], sub_keys, k)
        full = top_records(sims[qi], keys, 10_000)
        rank = next((i for i, r in enumerate(full, 1) if r in exp), None)
        detail.append({"id": q["id"], "query": q["query"], "expected": sorted(exp), "first_expected_rank": rank, "top": ranked_all[q["id"]][:5]})
    by_ds: dict[str, dict] = {}
    for ds in sorted({e["dataset"] for q in queries for e in q["expected"]}):
        ids = [q["id"] for q in queries if q["expected"][0]["dataset"] == ds]
        by_ds[ds] = recall_at_k({i: ranked_all[i] for i in ids}, {i: expected[i] for i in ids}, k)
    present = set(keys)
    evaluable = {i: e for i, e in expected.items() if e & present}
    not_embedded = sorted(set(expected) - set(evaluable))
    result = {
        "k": k,
        "queries_whose_expected_records_are_not_embedded": not_embedded,
        "overall_evaluable_queries": recall_at_k({i: ranked_all[i] for i in evaluable}, evaluable, k),
        "overall_within_expected_dataset_evaluable": recall_at_k({i: ranked_in[i] for i in evaluable}, evaluable, k),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "passages_scored": len(keys),
        "datasets_loaded": sorted(set(ds_of.tolist())),
        "query_tokens": tokens,
        "overall_all_datasets": recall_at_k(ranked_all, expected, k),
        "overall_within_expected_dataset": recall_at_k(ranked_in, expected, k),
        "mrr_all_datasets": sum(reciprocal_rank(ranked_all[i], expected[i]) for i in expected) / max(1, len(expected)),
        "by_dataset": by_ds,
        "queries": detail,
    }
    em.atomic_write(os.path.join(em.OUT, "eval_results.json"), json.dumps(result, indent=1, ensure_ascii=False).encode())
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify-labels")
    v.add_argument("--queries", default=os.path.join(HERE, "eval_queries.json"))
    r = sub.add_parser("run")
    r.add_argument("--queries", default=os.path.join(HERE, "eval_queries.json"))
    r.add_argument("--k", type=int, default=10)
    args = p.parse_args(argv)
    if args.cmd == "verify-labels":
        spec = json.load(open(args.queries, encoding="utf-8"))
        problems = verify_labels(spec)
        print(f"{len(spec['queries'])} queries, {sum(len(q['expected']) for q in spec['queries'])} expected records, {len(problems)} problems")
        for line in problems:
            print("  -", line)
        return 1 if problems else 0
    res = run(args.queries, args.k)
    a, b = res["overall_all_datasets"], res["overall_within_expected_dataset"]
    print(f"recall@{res['k']} over all loaded datasets: {a['hits']}/{a['queries']} = {a['recall']:.3f}; within the expected dataset: {b['hits']}/{b['queries']} = {b['recall']:.3f}; MRR {res['mrr_all_datasets']:.3f}")
    for ds, v in res["by_dataset"].items():
        print(f"  {ds}: {v['hits']}/{v['queries']}")
    e, ei = res["overall_evaluable_queries"], res["overall_within_expected_dataset_evaluable"]
    print(f"queries whose expected record is embedded: {e['queries']} of {a['queries']}; recall@{res['k']} over all datasets {e['hits']}/{e['queries']} = {e['recall']:.3f}; within the expected dataset {ei['hits']}/{ei['queries']} = {ei['recall']:.3f}")
    print("not embedded (excluded from the line above):", ", ".join(res["queries_whose_expected_records_are_not_embedded"]) or "none")
    print("misses (all datasets):", ", ".join(a["misses"]) or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
