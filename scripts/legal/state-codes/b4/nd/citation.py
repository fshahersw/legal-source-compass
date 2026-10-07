"""Canonical ND Century Code section citation for TOC/PDF comparison."""

from collections import Counter


def canon_citation(citation: str) -> str:
    """Normalize title/chapter padding; preserve section suffix (e.g. 10.1)."""
    parts = citation.strip().split("-")
    if len(parts) != 3:
        return citation.strip()
    title, chapter, section = parts
    return f"{int(title)}-{int(chapter):02d}-{section}"


def citations_equal_lists(toc_cits: list[str], pdf_cits: list[str]) -> bool:
    return [canon_citation(c) for c in toc_cits] == [canon_citation(c) for c in pdf_cits]


def citations_equal_multisets(toc_cits: list[str], pdf_cits: list[str]) -> bool:
    return Counter(canon_citation(c) for c in toc_cits) == Counter(canon_citation(c) for c in pdf_cits)


def filter_sections_to_official_toc(pdf_sections: list[dict], toc_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep PDF sections only when the official HTML chapter TOC lists that citation (respecting multiplicity)."""
    allowed = Counter(canon_citation(r["citation"]) for r in toc_rows)
    kept: list[dict] = []
    dropped: list[dict] = []
    seen: Counter[str] = Counter()
    for sec in pdf_sections:
        c = canon_citation(sec["citation"])
        if seen[c] < allowed.get(c, 0):
            kept.append(sec)
            seen[c] += 1
        else:
            dropped.append(
                {
                    "citation": sec["citation"],
                    "canon": c,
                    "reason": "absent_from_official_html_toc",
                }
            )
    return kept, dropped
