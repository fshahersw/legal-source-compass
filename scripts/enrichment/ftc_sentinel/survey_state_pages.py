"""Diagnostic: split a Data Book markdown into state pages and print the loss/count/rank tokens found on each.
Usage: python3 -I -B survey_state_pages.py MARKDOWN_TXT"""
import re
import sys

text = open(sys.argv[1]).read()
pages = text.split("\n---\n")
for page in pages:
    m = re.search(r"^#{2,6} ((?:[A-Z][a-z]+ ?)+|[A-Z][A-Za-z]+)$", page, re.M)
    if not m:
        continue
    name = m.group(1).strip()
    money = re.findall(r"^\$[\d,.]+[MBK]?$", page, re.M)
    counts = re.findall(r"^[\d,]{3,}$", page, re.M)
    ranks = re.findall(r"^(\d+)(?:st|nd|rd|th)$", page, re.M)
    labels = [l for l in ("TotalFraudLosses", "MedianFraudLoss", "TotalFraud&OtherRepor", "IdentityTheftReports") if l in page.replace(" ", "")]
    tables = len(re.findall(r"^\| Category", page, re.M))
    print(f"{name[:28]:28} money={money} counts={counts} ranks={ranks} tables={tables} labels={len(labels)}")
