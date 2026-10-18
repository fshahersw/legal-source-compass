"""List CourtListener bulk-data files for financial disclosures (public S3 bucket) and print the latest of each kind."""
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BUCKET = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/"
UA = "SeegerWeiss Research firasshaher99@gmail.com"
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}


def list_keys(prefix):
    keys, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            params["continuation-token"] = token
        req = urllib.request.Request(BUCKET + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            root = ET.fromstring(r.read())
        for c in root.findall("s:Contents", NS):
            keys.append((c.find("s:Key", NS).text, int(c.find("s:Size", NS).text), c.find("s:LastModified", NS).text))
        if root.find("s:IsTruncated", NS).text != "true":
            return keys
        token = root.find("s:NextContinuationToken", NS).text


def main():
    prefixes = sys.argv[1:] or ["bulk-data/financial", "bulk-data/people-db-people"]
    for prefix in prefixes:
        latest = {}
        for key, size, modified in list_keys(prefix):
            kind = re.sub(r"-\d{4}-\d{2}-\d{2}.*$", "", key)
            if kind not in latest or key > latest[kind][0]:
                latest[kind] = (key, size, modified)
        for kind, (key, size, modified) in sorted(latest.items()):
            print(f"{key}\t{size}\t{modified}")


if __name__ == "__main__":
    main()
