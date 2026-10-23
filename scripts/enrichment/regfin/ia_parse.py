"""Parse the SEC "Information About Registered Investment Advisers and Exempt Reporting Advisers" monthly CSV reports.

The zips hold one CSV each (448 columns for registered advisers, 171 for exempt reporting advisers, from Form ADV).
The CSVs are single-byte (Windows-1252) text, not UTF-8. Column names are the SEC's own; the record keeps a documented
subset of columns under the SEC's names. Only deterministic conversions are applied: whitespace is collapsed, dates
MM/DD/YYYY become YYYY-MM-DD, dollar and count cells become numbers, blank cells become None ("Not recorded").
"""
import csv
import io
import re
import zipfile

csv.field_size_limit(10**9)

# Form ADV items whose Yes answers are listed on the record, in the SEC's column order. Names are the SEC's.
ITEM11_COLUMNS = [
    "11A(1)", "11A(2)", "11B(1)", "11B(2)", "11C(1)", "11C(2)", "11C(3)", "11C(4)", "11C(5)",
    "11D(1)", "11D(2)", "11D(3)", "11D(4)", "11D(5)", "11E(1)", "11E(2)", "11E(3)", "11E(4)",
    "11F", "11G", "11H(1)(a)", "11H(1)(b)", "11H(1)(c)", "11H(2)",
]
ID_COLUMNS = [
    "SEC Region", "Organization CRD#", "SEC#", "Firm Type", "CIK#", "Total number of CIK numbers", "Primary Business Name",
    "Legal Name", "SEC Current Status", "SEC Status Effective Date", "Latest ADV Filing Date", "Form Version",
    "Website Address",
]
ADDRESS_COLUMNS = {
    "main_office": [
        ("street1", "Main Office Street Address 1"), ("street2", "Main Office Street Address 2"), ("city", "Main Office City"),
        ("state", "Main Office State"), ("country", "Main Office Country"), ("postal", "Main Office Postal Code"),
        ("phone", "Main Office Telephone Number"),
    ],
    "mail_office": [
        ("street1", "Mail Office Street Address 1"), ("street2", "Mail Office Street Address 2"), ("city", "Mail Office City"),
        ("state", "Mail Office State"), ("country", "Mail Office Country"), ("postal", "Mail Office Postal Code"),
    ],
}
MONEY_COLUMNS = {
    "raum_discretionary_usd": "5F(2)(a)",
    "raum_non_discretionary_usd": "5F(2)(b)",
    "raum_total_usd": "5F(2)(c)",
    "private_fund_gross_assets_usd": "Total Gross Assets of Private Funds",
}
COUNT_COLUMNS = {
    "accounts_discretionary": "5F(2)(d)",
    "accounts_non_discretionary": "5F(2)(e)",
    "accounts_total": "5F(2)(f)",
    "employees_item_5a": "5A",
    "advisory_function_employees_item_5b1": "5B(1)",
    "private_funds_item_7b1": "Count of Private Funds - 7B(1)",
}


def clean(value):
    s = " ".join((value or "").split())
    return s or None


def iso_date(value):
    """MM/DD/YYYY -> YYYY-MM-DD; None for blank or anything that is not a real calendar date in that form."""
    s = (value or "").strip()
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", s)
    if not m:
        return None
    mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 1800 <= y <= 2100):
        return None
    from datetime import date

    try:
        date(y, mo, d)
    except ValueError:
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


def money(value):
    """'  150,000,000.00' -> 150000000.0; blank or non-numeric -> None."""
    s = (value or "").replace(",", "").replace("$", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def count(value):
    s = (value or "").replace(",", "").strip()
    return int(s) if re.fullmatch(r"\d+", s) else None


def read_zip(path):
    """(csv_name, header, rows) for the single CSV in a monthly zip. rows are lists of strings."""
    with zipfile.ZipFile(path) as archive:
        infos = [i for i in archive.infolist() if i.filename.lower().endswith(".csv")]
        if len(infos) != 1:
            raise ValueError(f"{path}: expected one CSV, found {[i.filename for i in archive.infolist()]}")
        text = archive.read(infos[0]).decode("cp1252")
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader)
    rows = [r for r in reader if r]
    for r in rows:
        if len(r) != len(header):
            raise ValueError(f"{path}: row with {len(r)} cells, header has {len(header)}")
    return infos[0].filename, header, rows


def record_from_row(header, row):
    """One adviser as a dict of the documented subset, keyed by structured names (SEC column names in `columns`)."""
    ix = {h: i for i, h in enumerate(header)}

    def cell(name):
        return row[ix[name]] if name in ix else ""

    rec = {
        "crd": clean(cell("Organization CRD#")),
        "sec_number": clean(cell("SEC#")),
        "firm_type": clean(cell("Firm Type")),
        "cik_published": clean(cell("CIK#")),
        "cik_count_published": count(cell("Total number of CIK numbers")),
        "sec_region": clean(cell("SEC Region")),
        "primary_business_name": clean(cell("Primary Business Name")),
        "legal_name": clean(cell("Legal Name")),
        "status": clean(cell("SEC Current Status")),
        "status_effective_date": iso_date(cell("SEC Status Effective Date")),
        "latest_adv_filing_date": iso_date(cell("Latest ADV Filing Date")),
        "form_version": clean(cell("Form Version")),
        "website": clean(cell("Website Address")),
        "organization_form": clean(cell("3A")),
    }
    for key, cols in ADDRESS_COLUMNS.items():
        rec[key] = {name: clean(cell(col)) for name, col in cols}
        flag = clean(cell("Main Office Private Residence Flag" if key == "main_office" else "Mail Office Private Residence Flag"))
        rec[key]["private_residence_flag"] = flag
        if flag == "Y":
            # The street address and telephone of an office the SEC flags as a private residence are not republished.
            for k in ("street1", "street2", "phone"):
                if k in rec[key]:
                    rec[key][k] = None
            rec[key]["address_withheld"] = True
    for key, col in MONEY_COLUMNS.items():
        rec[key] = money(cell(col)) if col in ix else None
    for key, col in COUNT_COLUMNS.items():
        rec[key] = count(cell(col)) if col in ix else None
    rec["disclosure_any"] = clean(cell("11")) if "11" in ix else None
    yes = []
    for col in ITEM11_COLUMNS:
        if col in ix and clean(cell(col)) == "Y":
            n = count(cell(f"Count of {col} disclosures")) if f"Count of {col} disclosures" in ix else None
            yes.append({"item": col, "count": n})
    rec["disclosure_yes_items"] = yes
    return rec
