"""Type the facts of a settlement confirmed on its official page. Pure functions, no network, no corpus access.

amount roles (from the amount's own sentence, nearest wording wins):
  fund_total    the whole settlement fund or settlement amount ("a $359,925,000 Settlement Fund", "settle ... for
                $9,500,000 in cash", "agreed to pay $4.7 million into a Settlement Fund"); never below $10,000
  per_claimant  what one claimant, class member, share, product or vehicle can receive ("up to $350 for Recalled
                Vehicles", "$1.49 per share", "an alternative cash payment of $100")
  cap           an aggregate limit on part of the fund ("an aggregate cap of $300,000 for all Approved Claims")
  other         anything else, with `detail`: fees_costs (attorneys' fees, notice and administration), service_award,
                penalty (civil penalty, disgorgement), distribution (an agency round of refunds: "the FTC is sending
                ... payments totaling $X"), estimate (expert value, alleged loss), threshold ("paid ... more than $155"),
                or unclear (no wording near the figure)
The wording that decided the role is kept as `role_basis`, exactly as written on the page.

A settlement's headline is its largest fund_total; with no fund_total there is no headline (a per-claimant amount is
never shown as the settlement amount). A figure of PER_CLAIMANT_MAX_USD or more is per_claimant only with explicit
per-unit wording after it. When a row also types a penalty, a fund_total decided only by a payment verb ("Orders ... to
Pay $12.8 Million") is the whole order: other/order_total. An MDL is linked only when a case number in the federal MDL
docket form "<office>:<yy>-md|ml|mn-<number>" is that MDL's own master docket in the MDL registry (2:19-ml-02905 is
MDL 2905) and, when the page names a court by id, the MDL's transferee court is that court; captions, product names and
"MDL No." prose never link.
"""
import re
from datetime import date

FUND_MIN_USD = 10_000
# A figure this large is one claimant's amount only with explicit per-unit wording right after it ("$150,000 each",
# "per class member"); a nearby "payment of" alone never makes "$2,750,000 gross (the Settlement Amount)" a share.
PER_CLAIMANT_MAX_USD = 100_000
ROLES = ("fund_total", "per_claimant", "cap", "other")
ROLE_LABEL = {"fund_total": "Settlement fund total", "per_claimant": "Per claimant", "cap": "Aggregate cap", "other": "Other figure"}
OTHER_DETAIL_LABEL = {
    "fees_costs": "Fees, costs or administration", "service_award": "Service award", "penalty": "Penalty or disgorgement",
    "distribution": "Distribution round", "estimate": "Estimate or alleged loss", "threshold": "Eligibility threshold",
    "fund_addition": "Addition to a fund", "order_total": "Order total including a penalty",
    "unclear": "Role not stated near the figure",
}

_MONEYISH = r"(?:(?:more than|over|nearly|at least|approximately|about|up to|a maximum of|a total of|a minimum of) ?){0,2}"
# (role, detail, priority, pattern, side). side "before": the wording ends where the figure begins (only spaces,
# colons, dashes, quotes or an opening parenthesis between); "after": the wording starts where the figure ends;
# "near": anywhere in the window, scored by its distance to the figure. Lower priority wins a tie at the same distance.
_CUES = [
    # other: fees, awards, penalties, agency distributions, estimates, thresholds
    ("other", "service_award", 0, r"(?:service|incentive) awards?(?: to [^$;]{0,40})?(?: of| not to exceed| up to| in the aggregate of)?", "near"),
    ("other", "fees_costs", 0, r"attorneys?['’]? fees|fee and expense award|litigation costs(?: and expenses)?|(?:notice|claims administration|administration|administrative|settlement administration)(?: and administration)?(?: costs| expenses)|costs of (?:notice|administration)", "near"),
    ("other", "penalty", 0, r"civil (?:money )?penalt(?:y|ies)|disgorgement|prejudgment interest|forfeiture", "near"),
    ("other", "penalty", 0, r"\s*in (?:civil (?:money )?penalt(?:y|ies)|disgorgement|forfeiture)", "after"),
    ("other", "distribution", 1, r"(?:payments|checks|refunds|distributions?) totall?ing ?" + _MONEYISH, "before"),
    ("other", "distribution", 1, r"\b(?:sends?|sent|returns?|returned|refunding|allocated|resulted in) ?" + _MONEYISH, "before"),
    ("other", "distribution", 1, r"\s*in refunds\b", "after"),
    ("other", "estimate", 1, r"estimated by|total value of the settlement|compensable harm|\balleg(?:es|ed|ing)\b", "near"),
    ("other", "threshold", 0, r"\bpaid\b[^$.;]{0,80}?more than", "before"),
    # "will add approximately $1.33 million to the money available for distribution": part of a fund, not its total
    ("other", "fund_addition", 1, r"\badd(?:s|ed|ing)?(?: an additional| a further)? ?" + _MONEYISH, "before"),
    # per claimant ("per_unit": explicit per-unit wording right after the figure)
    ("per_claimant", "per_unit", 2, r"\s*(?:each\b|to each\b|for each\b|per (?:\w+[ -]){0,3}?(?:share|security|person|member|claimant|household|product|vehicle|day|hour|month|year|transaction|subscriber|unit|account|purchase|claim|policy|patient|employee|worker|class member)s?\b)", "after"),
    ("per_claimant", None, 2, r"\s*(?:cash )?(?:checks?|payments?|vouchers?)\b", "after"),
    ("per_claimant", None, 2, r"recovery per (?:\w+ ){0,3}?(?:share|security)\b|average (?:net |gross )?(?:recovery|distribution)\b", "near"),
    ("per_claimant", None, 3, r"(?:alternat(?:e|ive) )?(?:flat )?cash payments?|payments? (?:is|are|will be) (?:expected|estimated|anticipated)|residual distribution payments?|settlement (?:check|award)|\bchecks? of\b|\bvouchers?\b|reimbursement|unreimbursed|out-of-pocket|\bdocumented (?:losses|costs|expenses)|compensation for|pro rata share|\blosses\b|\bentitled to\b|eligible (?:to receive|for)|may (?:receive|claim|submit|be eligible)|\bwill receive\b|for (?:adults|minors)\b|a payment of|payments? of|\bpayments?\b", "near"),
    # cap
    ("cap", None, 2, r"aggregate cap|capped at|(?:will |shall )?make available up to|for all approved claims", "near"),
    # fund total
    ("fund_total", None, 1, r"(?:settle(?:d)?|settlement)\b[^$.;]{0,80}?\bfor(?: a (?:total )?(?:payment|sum) of)?(?: a total of)?", "before"),
    ("fund_total", None, 1, r"in exchange for a payment of|payment by (?:the )?defendants?['’]?s?(?: insurers)?(?: \([^)]*\))? of", "before"),
    ("fund_total", None, 2, r"(?:gross |cash |qualified |common |non-reversionary |distribution |disgorgement )?(?:settlement )?fund(?: in the amount)?(?: of| consists of| consisting of)(?: up to)?", "before"),
    ("fund_total", None, 2, r"(?:gross )?settlement amount(?: \([^)]*\))?(?: of)?|settlement in the amount of|total (?:aggregate )?(?:gross )?recovery of|(?:a )?total of|totall?ing ?" + _MONEYISH, "before"),
    ("fund_total", None, 2, r"(?:agreed to|will|shall|to|must) (?:pay|deposit|establish|provide|create) ?" + _MONEYISH + r"|\bpaid\b|settlement (?:of|making)|has settled[^$.;]{0,60}?for", "before"),
    ("fund_total", None, 2, r"(?:total |maximum |gross )*amount (?:to be )?paid[^$.;]{0,80}?\bis|to settle (?:the|this) (?:lawsuit|action|case|matter|claims?)(?: is)?", "before"),
    ("fund_total", None, 2, r"\s*(?:(?:gross|net|in cash),?\s*)?(?:\(\s*(?:the\s+)?[“\"]?\s*)?(?:settlement (?:fund|amount)|(?:gross|cash|qualified|common|non-reversionary|maximum|distribution) (?:settlement )?(?:fund|amount)|fund)\b", "after"),
    ("fund_total", None, 2, r"\s*(?:in )?(?:class action |proposed |cash |total )?settlements?\b|\s*(?:in cash|into (?:a|an|the) [^$.;]{0,40}?(?:fund|escrow)|in (?:consumer )?redress|(?:was|were|has been|will be) (?:paid|deposited) (?:to|into))", "after"),
]
_GAP = r"[\s:–—(“\"'-]*$"
_COMPILED = [(role, detail, prio, re.compile(f"(?:{pat}){_GAP}" if side == "before" else pat, re.I), side)
             for role, detail, prio, pat, side in _CUES]
_FIGURE = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|k|m|b)\b)?", re.I)
# "three million dollars ($3,000,000.00)": the words before the parenthesised figure are the figure itself
_SPELLED = re.compile(r"(?:\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                      r"sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|"
                      r"thousand|million|billion|and|dollars?|cents?)\b[\s-]*)+\(\s*$", re.I)
_WINDOW = 110


def _figure_spans(sentence):
    return [(m.start(), m.end()) for m in _FIGURE.finditer(sentence)]


def _locate(sentence, as_written):
    """(start, end) of the figure in its sentence: the exact page text first, then any figure with the same digits."""
    if not sentence or not as_written:
        return None
    i = sentence.find(as_written)
    if i >= 0:
        return i, i + len(as_written)
    digits = re.sub(r"\D", "", as_written)
    for a, b in _figure_spans(sentence):
        if digits and re.sub(r"\D", "", sentence[a:b]).startswith(digits):
            return a, b
    return None


def _candidates(sentence, start, end, lo, hi):
    """Every cue in sentence[lo:hi] with its distance to the figure at [start, end)."""
    before, after = sentence[lo:start], sentence[end:hi]
    spelled = _SPELLED.search(before)
    if spelled and re.search(r"dollar", spelled.group(0), re.I):
        before = before[:spelled.start()]
    out = []
    for role, detail, prio, rx, side in _COMPILED:
        if side == "before":
            m = rx.search(before)
            if m is not None:
                text = m.group(0)
                core = re.sub(_GAP, "", text)
                out.append((len(text) - len(core), prio, role, detail, core.strip()))
        elif side == "after":
            m = rx.match(after)
            if m is not None:
                out.append((len(m.group(0)) - len(m.group(0).lstrip()), prio, role, detail, m.group(0).strip(" (“\"")))
        else:
            for m in rx.finditer(before):
                out.append((len(before) - m.end(), prio, role, detail, m.group(0).strip()))
            for m in rx.finditer(after):
                out.append((m.start(), prio, role, detail, m.group(0).strip()))
    return out


def classify_amount(sentence, as_written, value_usd=None):
    """{'role', 'detail', 'role_basis'} for one figure from the wording around it in its own sentence."""
    span = _locate(sentence or "", as_written or "")
    if span is None:
        return {"role": "other", "detail": "unclear", "role_basis": None}
    start, end = span
    figures = _figure_spans(sentence)
    prev_end = max((b for a, b in figures if b <= start), default=0)
    next_start = min((a for a, b in figures if a >= end), default=len(sentence))
    passes = [
        (max(prev_end, start - _WINDOW), min(next_start, end + _WINDOW)),  # wording between this figure and its neighbours
        (max(0, start - _WINDOW - 50), min(len(sentence), end + _WINDOW + 50)),  # then the wider sentence
    ]
    for lo, hi in passes:
        found = sorted(_candidates(sentence, start, end, lo, hi), key=lambda c: (c[0], c[1]))
        for dist, _prio, role, detail, basis in found:
            if role == "fund_total" and value_usd is not None and value_usd < FUND_MIN_USD:
                continue  # a fund is never a few dollars; read the next nearest wording
            if role == "per_claimant" and detail != "per_unit" and value_usd is not None and value_usd >= PER_CLAIMANT_MAX_USD:
                continue  # one claimant's share this large needs explicit per-unit wording; read the next nearest wording
            if role == "per_claimant":
                detail = None
            out = {"role": role, "detail": detail, "role_basis": basis}
            if role == "fund_total" and _BARE_PAY.match(basis or "") and not any(
                    r == "fund_total" and not _BARE_PAY.match(b or "") for _d, _p, r, _x, b in found):
                out["bare_pay"] = True  # "to pay $12.8 million" with no fund, redress or settlement wording
            return out
    return {"role": "other", "detail": "unclear", "role_basis": None}


# a fund_total decided only by a payment verb ("Orders ... to Pay $12.8 Million"), with no fund, redress or settlement wording
_BARE_PAY = re.compile(r"^(?:agreed to|will|shall|to|must) (?:pay|provide)\b(?: ?(?:more than|over|nearly|at least|approximately|about|up to|a maximum of|a total of|a minimum of) ?){0,2}$|^paid$", re.I)


def type_amounts(amounts):
    """Each published amount with role, detail and role_basis added (input dicts are not changed).

    Row rule: when the same row types a penalty figure, a fund_total decided only by a payment verb is the whole order
    (redress plus penalty, as in "CFPB Orders ... to Pay $12.8 Million"), so it becomes other/order_total and the
    redress figure stays the headline."""
    typed = []
    for a in amounts or []:
        t = classify_amount(a.get("sentence"), a.get("page_as_written"), a.get("value_usd"))
        typed.append((a, t))
    has_penalty = any(t["role"] == "other" and t.get("detail") == "penalty" for _a, t in typed)
    out = []
    for a, t in typed:
        bare = t.pop("bare_pay", False)
        if bare and has_penalty:
            t = {**t, "role": "other", "detail": "order_total"}
        out.append({**a, **t})
    return out


def headline(typed):
    """The largest fund_total amount, or None. Never a per-claimant, cap or other figure."""
    funds = [a for a in typed if a.get("role") == "fund_total" and a.get("value_usd") is not None]
    return max(funds, key=lambda a: a["value_usd"]) if funds else None


def first_of(typed, role):
    return next((a for a in typed if a.get("role") == role), None)


_MDL_DOCKET = re.compile(r"^\s*(\d{1,2}):(\d{2})-(md|ml|mn)-0*(\d{1,5})\b", re.I)


def mdl_from_case_number(as_written):
    """MDL number from a case number in MDL docket form, else None. '2:19-ml-02905-JAK-JPR' -> 2905."""
    m = _MDL_DOCKET.match(as_written or "")
    if not m:
        return None
    n = int(m.group(4))
    return n if 1 <= n <= 99_999 else None


_MDL_DOCKET_TOKEN = re.compile(r"(?<![\w:-])(\d{1,2}):(\d{2})-(md|ml|mn)-0*(\d{1,5})(?![\d])", re.I)


def mdl_docket_tokens(text):
    """[(case number as written, MDL number)] for every MDL docket-form case number inside a longer text."""
    out = []
    for m in _MDL_DOCKET_TOKEN.finditer(text or ""):
        n = int(m.group(4))
        if 1 <= n <= 99_999:
            out.append((m.group(0), n))
    return out


def _docket_key(text):
    """(office, yy, md|ml|mn, number) of a case number in MDL docket form, else None."""
    m = _MDL_DOCKET.match(text or "")
    return (int(m.group(1)), m.group(2), m.group(3).lower(), int(m.group(4))) if m else None


def registry_index(registry_rows):
    """{mdl_number: {'master_docket', 'cl_court_id', 'court_name'}} from the mdls registry export rows."""
    return {int(r["mdl_number"]): r for r in registry_rows or [] if r.get("mdl_number") is not None}


def verified_mdl(case_number, registry, court_ids=()):
    """The MDL number when the case number in MDL docket form is that MDL's own master docket in the mdls registry
    (same office, year, md|ml|mn and number), and, when the page names a court by exact id, the MDL's transferee court
    is that court. Else None: a docket-form number alone never links."""
    key = _docket_key(case_number)
    if key is None:
        return None
    entry = (registry or {}).get(key[3])
    if not entry or _docket_key(entry.get("master_docket")) != key:
        return None
    ids = {c for c in court_ids or () if c}
    if ids and entry.get("cl_court_id") not in ids:
        return None
    return key[3]


def mdl_links(case_numbers, registry, court_ids=()):
    """[{'mdl', 'case_number', 'basis'}] for every case number that verified_mdl confirms, one per MDL number."""
    seen, out = set(), []
    for c in case_numbers or []:
        text = c.get("as_written") if isinstance(c, dict) else c
        n = verified_mdl(text, registry, court_ids)
        if n is not None and n not in seen:
            seen.add(n)
            out.append({"mdl": n, "case_number": text,
                        "basis": "case number on the official page is the MDL's master docket in the MDL registry"})
    return out


def deadline_state(iso, as_of):
    """'past' | 'within_30_days' | 'upcoming' | 'none' for a confirmed claim deadline against an as-of date."""
    if not iso:
        return "none"
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return "none"
    ref = as_of if isinstance(as_of, date) else date.fromisoformat(as_of)
    days = (d - ref).days
    if days < 0:
        return "past"
    return "within_30_days" if days <= 30 else "upcoming"


DEADLINE_STATE_LABEL = {"within_30_days": "Closes within 30 days", "upcoming": "Upcoming (more than 30 days)",
                        "past": "Past", "none": "No deadline confirmed"}


def money_label(value):
    if value is None:
        return None
    v = float(value)
    if v >= 1e9:
        return f"${v / 1e9:,.2f} billion"
    if v >= 1e6:
        return f"${v / 1e6:,.2f} million"
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"
