"""Convert CourtListener's PostgreSQL COPY CSV snapshots without losing null/blank.

Quoted blank is empty string; unquoted blank is null. Raw CSV values stay strings;
canonical typing belongs to the schema-aware importer. Originals remain untouched.
"""
import bz2, hashlib, json, pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '../audit/2026-10-02/metadata').resolve()
captures = json.loads((root/'bulk-captures.json').read_text(encoding='utf-8'))

def rows(text):
    row, value, quoted, in_quote, i = [], [], False, False, 0
    while i < len(text):
        c = text[i]
        if in_quote:
            if c == '\\' and i+1 < len(text) and text[i+1] in ('"','\\'):
                i += 1; value.append(text[i])
            elif c == '"':
                if i+1 < len(text) and text[i+1] == '"':
                    i += 1; value.append('"')
                else: in_quote = False
            else: value.append(c)
        elif c == '"' and not value:
            quoted = True; in_quote = True
        elif c == ',' or c == '\n':
            v = ''.join(value)
            row.append(v if quoted or v else None)
            value, quoted = [], False
            if c == '\n': yield row; row=[]
        elif c != '\r': value.append(c)
        i += 1
    if in_quote: raise ValueError('Unclosed CSV quote')
    if value or quoted or row:
        v=''.join(value); row.append(v if quoted or v else None); yield row

summaries=[]
out=root/'normalized';out.mkdir(exist_ok=True)
for capture in captures:
    src=pathlib.Path(capture['path'])
    if not src.name.endswith('.csv.bz2'): continue
    content=bz2.decompress(src.read_bytes())
    parsed=iter(rows(content.decode('utf-8'))); header=next(parsed)
    dest=out/(capture['type']+'.jsonl'); count=0;seen=set()
    with dest.open('w',encoding='utf-8',newline='\n') as target:
        for line in parsed:
            if len(line)!=len(header): raise ValueError(f'{src.name} column mismatch at row {count+2}: {len(line)} vs {len(header)}')
            data=dict(zip(header,line)); native=str(data.get('id',''))
            if not native: raise ValueError(f'{src.name} missing native id')
            if native in seen: raise ValueError(f'{src.name} duplicate native id {native}')
            seen.add(native)
            record={'schema_version':'courtlistener-bulk/1','source_system':'courtlistener','entity_type':capture['type'],'native_id':native,'data':data,'provenance':{'source_url':capture['url'],'source_as_of':capture['snapshot'],'retrieved_at':capture['retrievedAt'],'source_sha256':capture['sha256'],'http_status':200,'record_sha256':hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()}}
            target.write(json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n');count+=1
    summary={'entity_type':capture['type'],'records':count,'columns':header,'path':str(dest),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'csv_sha256':hashlib.sha256(content).hexdigest(),'snapshot':capture['snapshot']}
    summaries.append(summary);print(json.dumps({'entity_type':capture['type'],'records':count}))
(root/'bulk-normalized-manifest.json').write_text(json.dumps(summaries,indent=2),encoding='utf-8')
print(json.dumps({'files':len(summaries),'total_records':sum(s['records'] for s in summaries)}))
