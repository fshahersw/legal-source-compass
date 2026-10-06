#!/usr/bin/env python3
"""Maryland Code (public general laws) capture from the Maryland General Assembly.

Phases (all direct, polite, receipted via common/provenance_fetch.Fetcher):
  index     landing page, About page, article lists, per-article section lists, PDF links
            (both editions: enactments=true -> "in effect as of October 1", enactments=false -> "January 1")
  pdf       one official full-article PDF per article per edition
  sections  per-section StatuteText HTML for one edition (shuffled with a fixed seed so any
            prefix is a uniform random sample); resumable
Inventory (article list + section list) is captured independently of the bodies.
"""
import argparse
import json
import pathlib
import random
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'common'))
from provenance_fetch import Fetcher, verify_store  # noqa: E402

BASE = 'https://mgaleg.maryland.gov/mgawebsite'
EDITIONS = {'true': 'oct1', 'false': 'jan1'}


def url_articles(enact):
    return '%s/api/Laws/GetArticles?enactments=%s' % (BASE, enact)


def url_sections(article, enact):
    return '%s/api/Laws/GetSections?articleCode=%s&enactments=%s' % (BASE, article, enact)


def url_article_link(article, enact):
    return '%s/api/Laws/GetArticleLink?articleCode=%s&enactments=%s' % (BASE, article, enact)


def url_statute_text(article, section, enact):
    return '%s/Laws/StatuteText?article=%s&section=%s&enactments=%s' % (
        BASE, urllib.parse.quote(article), urllib.parse.quote(section, safe=''), enact)


def jget(fetcher, url, label):
    rec = fetcher.get(url, label=label)
    if not rec.get('ok'):
        raise SystemExit('failed %s: %s %s' % (url, rec.get('status'), rec.get('error')))
    return rec, json.loads(fetcher.read(rec).decode('utf8'))


def phase_index(fetcher, out):
    for label, url in (('landing', BASE + '/Laws/Statutes'), ('about', BASE + '/Laws/About'),
                       ('publications', BASE + '/Laws/Publications'),
                       ('constitution-publication-links', BASE + '/Laws/RelatedLinks')):
        rec = fetcher.get(url, label='page:' + label)
        print(label, rec.get('status'), rec.get('bytes'))
    inventory = []
    for enact, edition in EDITIONS.items():
        rec, articles = jget(fetcher, url_articles(enact), 'articles:' + edition)
        for art in articles:
            code = art['Value']
            lrec, link = jget(fetcher, url_article_link(code, enact), 'article-link:%s:%s' % (edition, code))
            srec, secs = jget(fetcher, url_sections(code, enact), 'sections:%s:%s' % (edition, code))
            inventory.append({'edition_key': edition, 'enactments': enact, 'article_code': code,
                              'article_display': art['DisplayText'], 'pdf_url': link,
                              'article_link_receipt': lrec['sha256'], 'sections_receipt': srec['sha256'],
                              'sections': [{'display': s['DisplayText'], 'value': s['Value']} for s in secs]})
            print(edition, code, len(secs))
    with open(out / 'index-capture.json', 'w', encoding='utf8') as handle:
        json.dump(inventory, handle, indent=1)
    return inventory


def phase_pdf(fetcher, out, editions):
    inv = json.load(open(out / 'index-capture.json', encoding='utf8'))
    for row in inv:
        if row['edition_key'] not in editions or not row['pdf_url']:
            continue
        rec = fetcher.get(row['pdf_url'], label='pdf:%s:%s' % (row['edition_key'], row['article_code']),
                          force=False)
        print(row['edition_key'], row['article_code'], rec.get('status'), rec.get('bytes'), rec.get('error'))


def phase_sections(fetcher, out, edition_key, limit):
    enact = [k for k, v in EDITIONS.items() if v == edition_key][0]
    inv = json.load(open(out / 'index-capture.json', encoding='utf8'))
    jobs = []
    for row in inv:
        if row['edition_key'] != edition_key:
            continue
        for sec in row['sections']:
            jobs.append((row['article_code'], sec['display']))
    random.Random(20261006).shuffle(jobs)
    done = {r['url'] for r in fetcher.receipts() if r.get('ok') and r.get('retrieval_method') == 'direct'}
    todo = [(a, s) for a, s in jobs if url_statute_text(a, s, enact) not in done]
    print('jobs', len(jobs), 'todo', len(todo), flush=True)
    for n, (art, sec) in enumerate(todo):
        if limit and n >= limit:
            break
        rec = fetcher.get(url_statute_text(art, sec, enact), label='section:%s:%s:%s' % (edition_key, art, sec),
                          force=True)
        if not rec.get('ok'):
            print('FAIL', art, sec, rec.get('status'), rec.get('error'), flush=True)
        if n % 500 == 0:
            print(n, art, sec, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('phase', choices=['index', 'pdf', 'sections', 'verify'])
    ap.add_argument('--root', default='/tmp/sc/MD')
    ap.add_argument('--edition', default='oct1')
    ap.add_argument('--editions', default='oct1,jan1')
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    out = root / 'extract'
    out.mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher('MD', root, min_interval=1.0)
    if args.phase == 'index':
        phase_index(fetcher, out)
    elif args.phase == 'pdf':
        phase_pdf(fetcher, out, args.editions.split(','))
    elif args.phase == 'sections':
        phase_sections(fetcher, out, args.edition, args.limit)
    else:
        checked, problems = verify_store(root)
        print('verified', checked, 'problems', problems)


if __name__ == '__main__':
    main()
