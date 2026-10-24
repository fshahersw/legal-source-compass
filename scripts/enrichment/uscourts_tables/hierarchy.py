"""Resolve the row hierarchy of a category table from the sums the table itself prints.

Some category tables print the same label under several blocks without indenting the block rows (Judicial Business B-1A prints
"Civil Rights" under "U.S. Plaintiff", "U.S. Defendant" and "Federal Question"; BAP-2 prints "Total Business / Chapter 7" under
every circuit; C-4 prints its nature-of-suit rows once per basis of jurisdiction), so indentation cannot say which block a row
belongs to. The table's printed totals can: a block row equals, in every count column, the sum of the rows printed under it.

resolve() reads the rows in order and makes a row the parent of the rows that follow it when, and only when, those rows (each
itself a leaf or a parent of the rows after it) add up to it exactly in every usable count column; otherwise the row is a leaf.
Usable columns are count columns where every figure row has a figure (a printed dash counts as no cases). At least
MIN_COLUMNS such columns are required, so a coincidental match would need the same coincidence in every column at once. A parent
needs at least two children, and a parent whose figures are all zero is never inferred. Nothing is guessed: if the rows cannot
be read as such a tree the result is None and the table keeps its indentation paths (and its gate).

The result is, for each figure row, the chain of figure-row ancestors; section rows (headings without figures) still give the
path element of the indented rows under them, inside the arithmetic parent (normalize.py).
"""
import sys

MIN_COLUMNS = 3
sys.setrecursionlimit(10000)


def is_heading(r, positions):
    """A row that carries no figure and no dash in any candidate column (a section heading, or a heading row whose figures are only
    in other columns): it is a path element for the rows under it, not a term of any sum."""
    if r.get("section") or r.get("values") is None:
        return True
    flags = r.get("flags") or []
    for p in positions:
        v = r["values"][p] if p < len(r["values"]) else None
        if v is not None or (p < len(flags) and flags[p] == "dash"):
            return False
    return True


def vectors(rows, positions):
    """Per row: tuple of ints over the positions (a dash is 0), or None when the row is a section or has an unknown figure there."""
    out = []
    for r in rows:
        if is_heading(r, positions):
            out.append(None)
            continue
        vec = []
        for p in positions:
            values = r["values"]
            v = values[p] if p < len(values) else None
            flag = (r.get("flags") or [None] * (p + 1))[p] if p < len(r.get("flags") or []) else None
            if v is None:
                if flag == "dash":
                    vec.append(0)
                    continue
                vec = None
                break
            if isinstance(v, float):
                if not v.is_integer():
                    vec = None
                    break
                v = int(v)
            vec.append(v)
        out.append(tuple(vec) if vec is not None else None)
    return out


def usable_positions(rows, positions):
    """The count positions where every figure row has a figure or a dash."""
    keep = []
    for p in positions:
        ok = True
        any_row = False
        for r in rows:
            if is_heading(r, positions):
                continue
            any_row = True
            v = r["values"][p] if p < len(r["values"]) else None
            flag = (r.get("flags") or [None] * (p + 1))[p] if p < len(r.get("flags") or []) else None
            if v is None and flag != "dash":
                ok = False
                break
            if isinstance(v, float) and not v.is_integer():
                ok = False
                break
        if ok and any_row:
            keep.append(p)
    return keep


def resolve(rows, positions):
    """{row index: [ancestor row indexes, outermost first]} for every figure row, or None when the sums do not form a tree.

    rows: the table's rows in order (dicts with section, values, flags); positions: candidate count column positions."""
    use = usable_positions(rows, positions)
    if len(use) < MIN_COLUMNS:
        return None
    vecs = vectors(rows, use)
    figure = [i for i, v in enumerate(vecs) if v is not None]
    if len(figure) < 3:
        return None
    width = len(use)
    zero = (0,) * width
    memo = {}
    budget = [200000]  # steps; a table whose sums need more search than this is not resolved (None), never half-resolved

    class Exhausted(Exception):
        pass

    def children(target, start):
        """(end position in `figure`, [(child idx, subtree)]) for the first reading of figure[start:] whose top-level rows add up to
        target exactly, each row being a parent (of >= 2 children) or a leaf; None when there is none."""
        key = (target, start)
        if key in memo:
            return memo[key]
        memo[key] = None  # guards against re-entry while computing
        result = _children(target, start)
        memo[key] = result
        return result

    def _children(target, start):
        def walk(k, acc, kids):
            budget[0] -= 1
            if budget[0] < 0:
                raise Exhausted()
            if acc == target and kids:
                return k, kids
            if k >= len(figure):
                return None
            i = figure[k]
            v = vecs[i]
            new = tuple(a + b for a, b in zip(acc, v))
            if any(n > t for n, t in zip(new, target)):
                return None
            # this row as a parent of the rows after it, then as a leaf
            if v != zero:
                sub = children(v, k + 1)
                if sub is not None and len(sub[1]) >= 2:
                    got = walk(sub[0], new, kids + [(i, sub[1])])
                    if got is not None:
                        return got
            return walk(k + 1, new, kids + [(i, [])])

        return walk(start, zero, [])

    parents = {}

    def assign(tree, chain):
        for idx, sub in tree:
            parents[idx] = list(chain)
            if sub:
                assign(sub, chain + [idx])

    k = 0
    found_parent = False
    try:
        while k < len(figure):
            i = figure[k]
            v = vecs[i]
            sub = children(v, k + 1) if v != zero else None
            if sub is not None and len(sub[1]) >= 2:
                parents[i] = []
                assign(sub[1], [i])
                k = sub[0]
                found_parent = True
            else:
                parents[i] = []
                k += 1
    except (Exhausted, RecursionError):
        return None
    return parents if found_parent else None


def paths(rows, parents):
    """Label paths for the rows of a table read with resolve(): the figure-row ancestors, then the section headings printed inside
    the row's arithmetic parent with a smaller indentation than the row, then the row's own label. Section rows get no path."""
    out = {}
    sections = []  # (indent, label, position)
    following = {}
    nxt = None
    for i in range(len(rows) - 1, -1, -1):
        following[i] = nxt
        if i in parents:
            nxt = i
    for i, r in enumerate(rows):
        indent = r.get("indent") or 0
        while sections and sections[-1][0] >= indent:
            sections.pop()
        if r.get("section"):
            sections.append((indent, r["label"], i))
            continue
        if i not in parents:
            # a row with figures in some columns but not in every summed column ("Social Security Laws" over its indented kinds):
            # it heads the indented rows under it like a section and sits in the block of the next row the sums place
            j = following.get(i)
            chain = parents[j] if j is not None else []
            start = chain[-1] if chain else -1
            out[i] = [rows[a]["label"] for a in chain] + [label for ind, label, pos in sections if pos > start] + [r["label"]]
            sections.append((indent, r["label"], i))
            continue
        chain = parents[i]
        start = chain[-1] if chain else -1
        heads = [label for ind, label, pos in sections if pos > start]
        out[i] = [rows[a]["label"] for a in chain] + heads + [r["label"]]
    return out
