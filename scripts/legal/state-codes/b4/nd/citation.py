"""Canonical ND Century Code section citation for TOC/PDF comparison."""


def canon_citation(citation: str) -> str:
    """Normalize title/chapter padding; preserve section suffix (e.g. 10.1)."""
    parts = citation.strip().split("-")
    if len(parts) != 3:
        return citation.strip()
    title, chapter, section = parts
    return f"{int(title)}-{int(chapter):02d}-{section}"


def citations_equal_lists(toc_cits: list[str], pdf_cits: list[str]) -> bool:
    return [canon_citation(c) for c in toc_cits] == [canon_citation(c) for c in pdf_cits]
