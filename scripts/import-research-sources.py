"""Derive research views from unmodified public-source downloads (openpyxl required)."""
import csv
import hashlib
import json
import re
from pathlib import Path
import openpyxl

ROOT = Path('public/data/research')
RAW = ROOT / 'raw'
manifest = json.loads((ROOT / 'source-manifest.json').read_text(encoding='utf-8'))
as_of = max(s['fetchedAt'] for s in manifest['sources'])[:10]
geo_text = Path('src/lib/corpus/geo.ts').read_text(encoding='utf-8')
states = [{'fips': fips, 'code': code, 'name': name} for fips, code, name in re.findall(r'\["(\d{2})", "([A-Z]{2})", "([^"]+)"\]', geo_text)]
assert len(states) == 51
by_name = {s['name']: s for s in states}

def csv_rows(name):
    with (RAW / name).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))

def save(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

pop_rows = csv_rows('census-population-2025.csv')
populations = []
for row in pop_rows:
    if row['SUMLEV'] == '040' and row['NAME'] in by_name:
        state = by_name[row['NAME']]
        assert row['STATE'].zfill(2) == state['fips']
        populations.append({**state, 'population2024': int(row['POPESTIMATE2024']), 'population2025': int(row['POPESTIMATE2025'])})
national = next(row for row in pop_rows if row['SUMLEV'] == '010')
assert len(populations) == 51 and sum(s['population2025'] for s in populations) == int(national['POPESTIMATE2025'])

demographics = csv_rows('fjc-demographics.csv')
services = csv_rows('fjc-service.csv')
judges = {}
for row in demographics:
    identifier = row['nid']
    assert identifier not in judges
    name = ' '.join(row[key].strip() for key in ['First Name', 'Middle Name', 'Last Name', 'Suffix'] if row[key].strip())
    judges[identifier] = {'id': identifier, 'name': name, 'services': []}

fields = {'nominationDate': 'Nomination Date', 'confirmationDate': 'Confirmation Date', 'commissionDate': 'Commission Date', 'recessDate': 'Recess Appointment Date', 'seniorDate': 'Senior Status Date', 'terminationDate': 'Termination Date', 'terminationReason': 'Termination', 'chiefBegin': 'Service as Chief Judge, Begin', 'chiefEnd': 'Service as Chief Judge, End'}
seen_services = set()
for row in services:
    identifier = row['nid']
    key = (identifier, row['Sequence'])
    assert key not in seen_services and identifier in judges
    seen_services.add(key)
    court = row['Court Name']
    # A district court state is assigned only by an exact terminal state name.
    matches = [s for s in states if row['Court Type'] == 'U.S. District Court' and (court.endswith(' of ' + s['name']) or court.endswith(' for ' + s['name']) or court.endswith(' for the ' + s['name']))]
    assert len(matches) <= 1
    service = {'sequence': row['Sequence'], 'court': court, 'type': row['Court Type'], 'state': matches[0]['code'] if matches else None}
    service.update({key: row[column].strip() or None for key, column in fields.items()})
    judges[identifier]['services'].append(service)

workbook = openpyxl.load_workbook(RAW / 'uscourts-c5-2025.xlsx', data_only=True)
districts = []
total = None
notes = []
categories = ['all', 'noCourtAction', 'beforePretrial', 'duringAfterPretrial', 'duringTrial']
for row in workbook.active.values:
    label = row[0]
    if not isinstance(label, str):
        continue
    if label.startswith('NOTE:'):
        notes.append(label)
    if label == 'Total' or re.fullmatch(r'[A-Z]{2,3}(?:,[A-Z]+)?[^A-Za-z0-9]*', label):
        metrics = {}
        for index, category in enumerate(categories):
            count, months = row[index * 2 + 1], row[index * 2 + 2]
            if isinstance(count, str) and re.fullmatch(r'\d+', count):
                count = int(count)
            assert isinstance(count, (float, int)) and count == int(count)
            metrics[category] = {'cases': int(count), 'medianMonths': float(months) if isinstance(months, (int, float)) else None}
        assert sum(metrics[c]['cases'] for c in categories[1:]) == metrics['all']['cases']
        if label == 'Total':
            total = metrics
        else:
            districts.append({'label': label, 'state': label.split(',')[0].replace('\ufffd', ''), 'metrics': metrics})
assert total and len(districts) == 94
for category in categories:
    assert sum(d['metrics'][category]['cases'] for d in districts) == total[category]['cases']

save('population.json', {'sourceId': 'census-population', 'referenceDate': '2025-07-01', 'vintage': 2025, 'national2025': int(national['POPESTIMATE2025']), 'states': populations})
save('judicial-service.json', {'sourceIds': ['fjc-demographics', 'fjc-service'], 'asOf': as_of, 'scope': 'Article III federal judges, 1789–present; FJC export. Bankruptcy, magistrate and state judges are outside this directory.', 'judgeCount': len(judges), 'serviceCount': len(services), 'judges': sorted(judges.values(), key=lambda j: j['name'])})
save('court-duration.json', {'sourceId': 'uscourts-duration', 'periodEnd': '2025-09-30', 'national': total, 'districts': districts, 'notes': notes})

if (RAW / 'doj-resources.json').exists():
    crawl = json.loads((RAW / 'doj-resources.json').read_text(encoding='utf-8'))
    state_resources = []
    for page in crawl['pages']:
        markdown = page.get('markdown') or ''
        title = re.search(r'^# ([^\n]+)', markdown, re.M)
        if not title or title.group(1).strip() not in by_name:
            continue
        state = by_name[title.group(1).strip()]
        section = None
        subsection = None
        links = []
        for line in markdown.splitlines():
            if line.startswith('## '):
                section, subsection = line[3:].strip(), None
            elif line.startswith('### '):
                subsection = line[4:].strip()
            elif section and section not in ['Disclaimer', 'You are here']:
                for found in re.finditer(r'\[([^\]]+)\]\((https?://[^\s)]+)(?:[^)]*)\)', line):
                    label, url = found.groups()
                    if label.startswith('!') or 'Share on' in line or 'facebook.com/sharer' in url or 'twitter.com/intent' in url:
                        continue
                    label = re.sub(r'Links to other government.*$', '', label).strip()
                    if not label or url.startswith('https://www.justice.gov/jmd/ls/state#'):
                        continue
                    links.append({'label': label, 'url': url, 'section': section, 'subsection': subsection})
        state_resources.append({**state, 'sourceUrl': page['url'], 'publisherModifiedAt': page.get('modifiedAt'), 'retrievedAt': crawl['capturedAt'], 'links': links})
    assert len({s['code'] for s in state_resources}) == len(state_resources) == 51
    assert all(s['links'] for s in state_resources)
    save('state-resources.json', {'source': 'U.S. Department of Justice Library Staff', 'retrievedAt': crawl['capturedAt'], 'states': sorted(state_resources, key=lambda s: s['name'])})

for source in manifest['sources']:
    bytes_ = (RAW / source['file']).read_bytes()
    assert len(bytes_) == source['bytes'] and hashlib.sha256(bytes_).hexdigest() == source['sha256']
print(json.dumps({'states': len(populations), 'judges': len(judges), 'services': len(services), 'timingDistricts': len(districts), 'durationPopulation': total['all']['cases']}))
