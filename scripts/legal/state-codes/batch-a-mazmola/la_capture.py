"""Louisiana Revised Statutes capture from legis.la.gov.

1. Title tables of contents (ASP.NET postbacks from Laws_Toc.aspx?folder=75, the site's own navigation).
2. One LawPrint.aspx?d=<doc id> page per listed section.
Direct fetches only, >=1 s per host, resumable. Raw bodies: /tmp/sc/LA.
"""
import hashlib
import html as htmllib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast_fetcher import FastFetcher as Fetcher  # noqa: E402
from provenance_fetch import now_iso  # noqa: E402

ROOT = '/tmp/sc/LA'
BASE = 'https://legis.la.gov/legis/'
RS_TOC = BASE + 'Laws_Toc.aspx?folder=75&level=Parent'
F = Fetcher('LA', ROOT, min_interval=1.0, timeout=120)


def hidden(h):
    return {m.group(1): htmllib.unescape(m.group(2))
            for m in re.finditer(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', h)}


def post_toc(target, label):
    """POST one postback; store body content-addressed and append a receipt (label identifies the title)."""
    base = F.get(RS_TOC, label='rs-toc', force=True)
    fields = hidden(F.read(base).decode('utf8', 'replace'))
    fields['__EVENTTARGET'] = target
    fields['__EVENTARGUMENT'] = ''
    F._pace('legis.la.gov')
    started = now_iso()
    resp = F.session.post(RS_TOC, data=fields, timeout=120)
    body = resp.content
    sha = hashlib.sha256(body).hexdigest()
    dest = F.path_for(sha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(body)
    receipt = {'state': 'LA', 'url': RS_TOC, 'label': label, 'retrieved_at': started,
               'retrieval_method': 'direct', 'http_method': 'POST', 'postback_target': target,
               'status': resp.status_code, 'bytes': len(body), 'sha256': sha, 'ok': resp.status_code == 200,
               'stored_path': str(dest.relative_to(F.root)), 'user_agent': F.user_agent}
    F._append(receipt)
    return body.decode('utf8', 'replace')


def main():
    toc_path = ROOT + '/titles.json'
    if os.path.exists(toc_path):
        titles = json.load(open(toc_path))
    else:
        base = F.get(RS_TOC, label='rs-toc', force=True)
        h = F.read(base).decode('utf8', 'replace')
        targets = re.findall(r'id="[^"]*ListViewTOC1_ctrl\d+_LinkButton1a" href="javascript:__doPostBack\(&#39;([^&]+)&#39;', h)
        names = re.findall(r'ListViewTOC1_ctrl\d+_LinkButton1a"[^>]*>([^<]+)</a></td>\s*<td[^>]*><a[^>]*>([^<]+)</a>', h)
        print('titles', len(targets), len(names), flush=True)
        titles = []
        for t, (num, name) in zip(targets, names):
            body = post_toc(t, 'title-toc:' + num.strip())
            docs = []
            seen = set()
            for m in re.finditer(r'href="Law\.aspx\?d=(\d+)"', body):
                if m.group(1) not in seen:
                    seen.add(m.group(1))
                    docs.append(m.group(1))
            titles.append({'target': t, 'title': num.strip(), 'name': htmllib.unescape(name.strip()), 'docs': docs})
            print(num, len(docs), flush=True)
        json.dump(titles, open(toc_path, 'w'))
    all_docs = [d for t in titles for d in t['docs']]
    print('docs', len(all_docs), len(set(all_docs)), flush=True)
    bad = 0
    for i, d in enumerate(all_docs):
        r = F.get('%sLawPrint.aspx?d=%s' % (BASE, d), label='section')
        if not r.get('ok'):
            bad += 1
            print('FAIL', d, r.get('status'), r.get('error'), flush=True)
        if i % 500 == 0:
            print('doc', i, 'of', len(all_docs), 'bad', bad, flush=True)
    print('done', len(all_docs), 'bad', bad, flush=True)


if __name__ == '__main__':
    main()
