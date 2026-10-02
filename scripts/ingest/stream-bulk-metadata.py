"""Stream CourtListener snapshots; retain originals and emit bounded scoped JSONL.

The fast CSV reader scans all rows. A selected row is reparsed with quote tracking
so PostgreSQL COPY null/blank distinctions survive normalized observations.
No full decompression or PDF fetch is performed. Full counting/scoped extraction
is resumable at the file level; rerunning reuses the already downloaded snapshot.
"""
import argparse, bz2, collections, csv, hashlib, io, json, pathlib, re, sys, time

parser=argparse.ArgumentParser()
parser.add_argument('types', nargs='*', default=['fjc-integrated-database','dockets','citations','citation-map'])
parser.add_argument('--cache',default='C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30')
parser.add_argument('--output',default='../audit/2026-10-02/metadata/large-normalized')
parser.add_argument('--emit-all',action='store_true',help='Emit every metadata row rather than a reviewed scoped selection; output can be very large.')
parser.add_argument('--parallel',type=int,default=1,help='Optional indexed_bzip2 decompression workers; 1 uses standard-library bz2.')
parser.add_argument('--python-deps',help='Optional private dependency directory containing indexed_bzip2; no repository dependency mutation.')
parser.add_argument('--additional-mdl-numbers',default='',help='Comma-separated explicit MDL numbers independently confirmed by official sources.')
parser.add_argument('--mdl-number-scope',help='Replace the uploaded number selection with this explicit independently verified comma-separated scope.')
args=parser.parse_args()
if args.python_deps:sys.path.insert(0,args.python_deps)
def open_csv(filename):
    if args.parallel<=1:return bz2.open(filename,'rt',encoding='utf-8',newline='')
    import indexed_bzip2
    return io.TextIOWrapper(io.BufferedReader(indexed_bzip2.open(str(filename),parallelization=args.parallel),buffer_size=512*1024),encoding='utf-8',newline='')
cache=pathlib.Path(args.cache).resolve();out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
captures={x['type']:x for x in json.loads((cache/'download-manifest.json').read_text())['captures'] if x['status']=='downloaded'}
cases=json.loads(pathlib.Path('public/data/catalog-matters.json').read_text(encoding='utf-8'))
masters=json.loads(pathlib.Path('public/data/mdl-documents/master-dockets.json').read_text(encoding='utf-8'))
saved_ids={str(x['docket_id']) for x in cases}|set(masters)
known_mdls={str(int(x)) for x in masters.values()}
known_mdls.update(str(int(value)) for value in args.additional_mdl_numbers.split(',') if value.strip())
if args.mdl_number_scope is not None:known_mdls={str(int(value)) for value in args.mdl_number_scope.split(',') if value.strip()}
originating_ids=set()
exact_dockets=out/'dockets-exact-native-or-idb.jsonl'
if exact_dockets.exists():
    for line in exact_dockets.open(encoding='utf-8'):
        row=json.loads(line);saved_ids.add(row['native_id'])
        native_origin=row['data'].get('originating_court_information_id')
        if native_origin:originating_ids.add(str(native_origin))
target_clusters=set()
api_dir=pathlib.Path('../audit/2026-10-02/metadata/live-normalized')
if (api_dir/'dockets.jsonl').exists():
    for line in (api_dir/'dockets.jsonl').open(encoding='utf-8'):
        record=json.loads(line)
        for cluster in record['data'].get('clusters',[]):
            match=re.search(r'/clusters/(\d+)/',str(cluster))
            if match: target_clusters.add(match.group(1))
identity_dir=api_dir.parent/'identity-normalized'
if identity_dir.exists():
    for identity_file in identity_dir.glob('*.jsonl'):
        for line in identity_file.open(encoding='utf-8'):
            record=json.loads(line)
            if record['entity_type']!='dockets':continue
            for cluster in record['data'].get('clusters',[]):
                match=re.search(r'/clusters/(\d+)/',str(cluster))
                if match:target_clusters.add(match.group(1))
target_opinions=set()
cluster_index_path=out/'cluster-native-docket-index.json'
cluster_index=json.loads(cluster_index_path.read_text()) if cluster_index_path.exists() else {}
target_clusters.update(cluster_index)
for cluster_header_file in [api_dir/'clusters.jsonl',api_dir.parent/'citation-normalized'/'clusters.jsonl']:
  if cluster_header_file.exists():
    for line in cluster_header_file.open(encoding='utf-8'):
        row=json.loads(line)
        target_clusters.add(row['native_id'])
        for opinion in row['data'].get('sub_opinions',[]):
            match=re.search(r'/opinions/(\d+)/',str(opinion))
            if match:target_opinions.add(match.group(1))
fjc_mdls={}
fjc_map_path=out/'fjc-mdl-index.json'
if fjc_map_path.exists(): fjc_mdls=json.loads(fjc_map_path.read_text())

class CaptureLines:
    def __init__(self, stream): self.stream=stream; self.parts=[]
    def __iter__(self): return self
    def __next__(self):
        line=next(self.stream);self.parts.append(line);return line
    def take(self):
        text=''.join(self.parts);self.parts=[];return text

copy_field=re.compile(r'(?:("(?:[^"\\]|\\.|"")*")|([^,\r\n]*))(,|\r?\n|$)',re.S)
copy_escape=re.compile(r'\\(["\\])|""')
def exact_row(text):
    row=[];offset=0
    while offset<len(text):
        match=copy_field.match(text,offset)
        if not match:raise ValueError('Invalid PostgreSQL COPY CSV field')
        quoted,plain,end=match.groups()
        if quoted is not None:row.append(copy_escape.sub(lambda m:m.group(1) or '"',quoted[1:-1]))
        else:row.append(plain if plain else None)
        offset=match.end()
        if end!=',':
            if text[offset:].strip():raise ValueError('Unexpected second CSV record')
            return row
        if offset==len(text):row.append(None)
    return row

def mdl_number(value):
    match=re.fullmatch(r'(?:MDL[\s-]*)?0*(\d{1,5})',value.strip(),re.I)
    return str(int(match.group(1))) if match else None

csv.field_size_limit(2**31-1)
report_path=out/'stream-manifest.json'
reports=json.loads(report_path.read_text()) if report_path.exists() else {}
for kind in args.types:
    if kind not in captures:
        print(json.dumps({'event':'not_yet_downloaded','type':kind}),flush=True);continue
    capture=captures[kind];src=pathlib.Path(capture['path']);dest=out/(kind+'.jsonl');tmp=dest.with_suffix('.jsonl.part')
    total,selected,byte_count=0,0,0;began=time.monotonic();last=began
    values=collections.Counter();missing_saved=set(saved_ids) if kind=='dockets' else set()
    entity_type={'citation-map':'opinions-cited','opinion-clusters':'clusters'}.get(kind,kind)
    with open_csv(src) as stream, tmp.open('w',encoding='utf-8',newline='\n') as target:
        lines=CaptureLines(stream);reader=csv.reader(lines,escapechar='\\',doublequote=True)
        header=next(reader);lines.take();index={name:i for i,name in enumerate(header)}
        for row in reader:
            raw=lines.take();total+=1
            if len(row)!=len(header):raise ValueError(f'{kind} invalid column count at row {total+1}')
            get=lambda name: row[index[name]] if name in index else ''
            reasons=[]
            if args.emit_all:reasons.append('all_upstream_metadata')
            if kind=='fjc-integrated-database':
                value=get('multidistrict_litigation_docket_number');number=mdl_number(value) if value else None
                if value:values[value]+=1
                if number in known_mdls:
                    fjc_mdls[get('id')]={'mdl_number':number,'native_mdl_value':value};reasons.append('explicit_fjc_mdl_number')
            elif kind=='dockets':
                native_id=get('id');missing_saved.discard(native_id)
                if native_id in saved_ids:reasons.append('saved_native_docket_id')
                if get('idb_data_id') in fjc_mdls:reasons.append('native_idb_fk_with_explicit_mdl_number')
                if get('mdl_status'):values[get('mdl_status')]+=1;reasons.append('publisher_mdl_status')
                if get('federal_dn_case_type').lower()=='md':reasons.append('native_case_type_md_candidate')
            elif kind=='citations':
                if get('cluster_id') in target_clusters:reasons.append('native_target_cluster_id')
                values[get('type')]+=1
            elif kind=='citation-map':
                if get('cited_opinion_id') in target_opinions or get('citing_opinion_id') in target_opinions:reasons.append('native_target_opinion_id')
            elif kind=='opinion-clusters':
                if get('docket_id') in saved_ids:
                    reasons.append('native_target_docket_id');cluster_index[get('id')]=get('docket_id')
            elif kind=='originating-court-information':
                if get('id') in originating_ids:reasons.append('native_originating_court_information_fk')
            elif kind in ('search_opinioncluster_panel','search_opinioncluster_non_participating_judges'):
                if get('opinioncluster_id') in target_clusters:reasons.append('native_target_opinion_cluster_id')
            elif kind=='search_opinion_joined_by':
                if get('opinion_id') in target_opinions:reasons.append('native_target_opinion_id')
            elif kind=='parentheticals':
                if get('describing_opinion_id') in target_opinions or get('described_opinion_id') in target_opinions:reasons.append('native_target_opinion_id')
            elif kind=='unmatched-citations':
                if get('citing_opinion_id') in target_opinions:reasons.append('native_target_opinion_id')
            if reasons:
                exact=exact_row(raw)
                if len(exact)!=len(header):raise ValueError(f'{kind} selected quote parser mismatch at {total}')
                data=dict(zip(header,exact));native_id=data.get('id')
                if not native_id:raise ValueError('Missing native ID')
                compact=json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
                record={'schema_version':'courtlistener-bulk/1','source_system':'courtlistener','entity_type':entity_type,'native_id':str(native_id),'data':data,'provenance':{'source_url':capture['url'],'source_as_of':capture['snapshot'],'retrieved_at':capture['retrievedAt'],'source_sha256':capture['sha256'],'record_sha256':hashlib.sha256(compact).hexdigest(),'http_status':200,'selection_reasons':reasons}}
                encoded=json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n';target.write(encoded);byte_count+=len(encoded.encode());selected+=1
            now=time.monotonic()
            if now-last>20:
                last=now;print(json.dumps({'event':'scan_progress','type':kind,'rows_scanned':total,'selected':selected,'elapsed_seconds':round(now-began)}),flush=True)
    tmp.replace(dest)
    with dest.open('rb') as source:
        digest=hashlib.file_digest(source,'sha256').hexdigest()
    report={'type':kind,'entity_type':entity_type,'source_records':total,'selected_records':selected,'scope':'all_upstream_metadata' if args.emit_all else 'source_fk_and_review_candidates','columns':header,'selection_value_counts':dict(values),'source_url':capture['url'],'source_as_of':capture['snapshot'],'source_sha256':capture['sha256'],'output_path':str(dest),'output_sha256':digest,'output_bytes':byte_count,'elapsed_seconds':round(time.monotonic()-began),'decompression_workers':args.parallel,'pdf_downloads':0}
    if kind=='dockets':report['saved_native_ids_missing_from_snapshot']=sorted(missing_saved)
    (out/(kind+'.manifest.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    reports=json.loads(report_path.read_text()) if report_path.exists() else {}
    reports[kind]=report;report_path.write_text(json.dumps(reports,indent=2),encoding='utf-8')
    if kind=='fjc-integrated-database':fjc_map_path.write_text(json.dumps(fjc_mdls),encoding='utf-8')
    if kind=='opinion-clusters':cluster_index_path.write_text(json.dumps(cluster_index),encoding='utf-8');target_clusters.update(cluster_index)
    print(json.dumps({'event':'scan_complete','type':kind,'source_records':total,'selected_records':selected,'output_bytes':byte_count,'sha256':digest}),flush=True)
