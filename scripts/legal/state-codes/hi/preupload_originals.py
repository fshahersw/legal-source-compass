"""Owner-executed storage-only preupload of a reviewed raw-original plan.

Defaults to offline validation. --execute uses environment credentials through
the existing non-upsert put_object helper. Never calls an RPC, registers a
manifest, creates a corpus run, or publishes data. Object receipts use the final
lander's checkpoint format; every storage creation is journaled before readback.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
from email.utils import parsedate_to_datetime
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import threading
import time

from stage_hrs import digest,discovery,exact_capture

BUCKET='corpus-originals'


def now():return datetime.now(timezone.utc).isoformat()
def object_key(sha):return 'state-codes/sha256/'+sha[:2]+'/'+sha


def retry_after(value,clock=time.time):
    if not value:return 0
    try:
        seconds=float(value)
        return max(0,seconds)if math.isfinite(seconds)else 0
    except (TypeError,ValueError):
        try:return max(0,parsedate_to_datetime(value).timestamp()-clock())
        except (TypeError,ValueError,OverflowError):return 0


class Cooldown:
    def __init__(self):self.lock=threading.Lock();self.until=0.0;self.paused=False
    def defer(self,seconds):
        with self.lock:self.until=max(self.until,time.monotonic()+seconds)
    def wait(self):
        while True:
            with self.lock:
                if self.paused:raise RuntimeError('Storage acquisition paused for a publisher-requested cooldown; inspect private journal before resuming')
                left=self.until-time.monotonic()
            if left<=0:return
            time.sleep(min(left,1))
    def pause(self):
        with self.lock:self.paused=True


class Journal:
    def __init__(self,path):
        self.path=Path(path);self.lock=threading.Lock()
    def append(self,row):
        with self.lock,self.path.open('a',encoding='utf8',newline='\n')as stream:
            stream.write(json.dumps(row,separators=(',',':'))+'\n');stream.flush();os.fsync(stream.fileno())


def validate_plan(capture,plan_directory):
    capture=Path(capture);directory=Path(plan_directory)
    report=json.loads((directory/'plan.json').read_text('utf8'));body=(directory/'objects.jsonl').read_bytes()
    if (report.get('schema')!='hi-raw-original-upload-plan/1'or report.get('objects_file_sha256')!=digest(body)
            or any(report.get(key)is not False for key in ['source_interpretation_reviewed','private_intake_allowed','publication_allowed',
                'current_law_verified','calculation_activation_allowed'])):raise ValueError('Raw-only plan identity or gates differ')
    inventory,directories,missing=discovery(capture)
    if missing or report['directory_inventory_sha256']!=digest((capture/'directory-inventory.json').read_bytes()):
        raise ValueError('Retained discovery differs from raw plan')
    urls=set(directories)|set(inventory['pages']);rows=[];seen=set();source_count=0
    raw_root=(capture/'raw').resolve()
    for line in body.decode('utf8').splitlines():
        if not line.strip():continue
        row=json.loads(line);sha=row.get('sha256','')
        if (not re.fullmatch(r'[a-f0-9]{64}',sha)or sha in seen or row.get('kind')!='publisher_original'
                or type(row.get('bytes'))is not int or not 0<row['bytes']<=10*1024*1024
                or Path(row.get('path','')).resolve()!=raw_root/sha or not row.get('sources')):
            raise ValueError('Only exact bounded raw originals may be preuploaded')
        for source in row['sources']:
            if source.get('source_url')not in urls:raise ValueError('Source URL absent from exact directory discovery')
            captured=exact_capture(capture,source['source_url'])
            if captured is None:raise ValueError('Original receipt missing')
            receipt,raw=captured
            if (receipt['sha256']!=sha or len(raw)!=row['bytes']or
                    source!={key:receipt[key]for key in ['source_url','retrieved_at','http_status','retrieval_method','proxy']}):
                raise ValueError('Raw plan source differs from retained receipt')
            source_count+=1
        seen.add(sha);rows.append(row)
    if len(rows)!=report['objects']or sum(row['bytes']for row in rows)!=report['bytes']:
        raise ValueError('Raw plan totals differ')
    if source_count!=report['captured_pages']+report['discovery_pages']:raise ValueError('Raw plan source count differs')
    return report,rows


def valid_receipt(row,receipt):
    if (not isinstance(receipt,dict)or receipt.get('bucket')!=BUCKET or receipt.get('object_key')!=object_key(row['sha256'])
            or receipt.get('readback_sha256')!=row['sha256']or receipt.get('bytes')!=row['bytes']
            or receipt.get('readback_bytes')!=row['bytes']or receipt.get('http_status')!=200
            or receipt.get('verification_method')!='authenticated-whole-object-get-sha256'):
        raise ValueError('Object checkpoint does not prove this exact private original')
    try:date=datetime.fromisoformat(receipt['verified_at'].replace('Z','+00:00'))
    except (KeyError,TypeError,ValueError):raise ValueError('Object checkpoint has no valid verification time')from None
    if date.tzinfo is None:raise ValueError('Object checkpoint time requires timezone')


def load_checkpoint(path,objects):
    by_sha={row['sha256']:row for row in objects};receipts={}
    if not Path(path).exists():return receipts
    for line in Path(path).read_text('utf8').splitlines():
        if not line.strip():continue
        record=json.loads(line);sha=record.get('sha256')
        if sha not in by_sha:raise ValueError('Checkpoint contains an object outside this raw plan')
        valid_receipt(by_sha[sha],record.get('receipt'));receipts[sha]=record['receipt']
    return receipts


def cloud_type(codec,cooldown,journal):
    class StorageOnlyCloud(codec.Cloud):
        def __init__(self):super().__init__();self.created={};self.preexisting={}
        def rpc(self,*args,**kwargs):raise RuntimeError('Raw preupload cannot call a corpus RPC')
        def _retry(self,call):
            for attempt in range(4):
                cooldown.wait()
                try:response=call()
                except codec.requests.RequestException:
                    if attempt==3:raise RuntimeError('Storage transport failed after bounded retries')from None
                    cooldown.defer(2**(attempt+1));continue
                if response.status_code in(429,500,502,503,504,520,521,522,524):
                    delay=max(retry_after(response.headers.get('Retry-After')),2**(attempt+1))
                    if delay>60:
                        cooldown.pause()
                        journal.append(dict(event='retry_after_pause',http_status=response.status_code,
                            resume_after_seconds=delay,recorded_at=now()))
                        response.close();raise RuntimeError('Storage requested a cooldown over 60 seconds; resume later using the private journal')
                    cooldown.defer(delay)
                    journal.append(dict(event='shared_cooldown',http_status=response.status_code,seconds=delay,recorded_at=now()))
                    response.close()
                    if attempt==3:raise RuntimeError('Storage remained unavailable after bounded retries')
                    continue
                return response
        def assert_private_bucket(self):
            response=self._retry(lambda:self.s.get(self.url+'/storage/v1/bucket/'+BUCKET,headers=self.h,timeout=120))
            try:
                if response.status_code!=200:raise RuntimeError('Private bucket metadata could not be verified')
                metadata=response.json()
                if metadata.get('id')!=BUCKET or metadata.get('public')is not False:raise RuntimeError('Target bucket is not confirmed private')
            finally:response.close()
            journal.append(dict(event='private_bucket_verified',bucket=BUCKET,recorded_at=now()))
        def readback(self,key):
            for attempt in range(4):
                response=self._retry(lambda:self.s.get(self.url+'/storage/v1/object/authenticated/'+BUCKET+'/'+key,
                    headers=self.h,timeout=180,stream=True))
                try:
                    status=response.status_code
                    if status in(401,403):raise RuntimeError('Authenticated storage read was denied')
                    if status!=200:
                        missing=status==404
                        if status==400:
                            try:missing=str(response.json().get('statusCode'))=='404'
                            except (ValueError,AttributeError):missing=False
                        if not missing:raise RuntimeError('Storage object presence could not be established')
                        self.preexisting.setdefault(key,False);return status,None
                    body=codec.Digest()
                    for block in response.iter_content(1<<20):body.update(block)
                    self.preexisting.setdefault(key,True);return 200,body
                except codec.requests.RequestException:
                    if attempt==3:raise RuntimeError('Storage readback stream failed after bounded retries')from None
                    cooldown.defer(2**(attempt+1))
                finally:response.close()
        def upload(self,key,data,ctype):
            journal.append(dict(event='upload_attempt',bucket=BUCKET,object_key=key,sha256=digest(data),bytes=len(data),
                verified=False,created=None,recorded_at=now()))
            response=self._retry(lambda:self.s.post(self.url+'/storage/v1/object/'+BUCKET+'/'+key,data=data,timeout=180,
                headers={**self.h,'x-upsert':'false','Content-Type':ctype}))
            try:
                status=response.status_code
                # Preserve only known conflict categories; never print server bodies.
                message=next((word for word in ['LockTimeout','already exists','Duplicate']if word in response.text),'Storage upload failed')
                if status in(200,201):
                    self.created[key]=True
                    journal.append(dict(event='object_created',bucket=BUCKET,object_key=key,sha256=digest(data),bytes=len(data),
                        verified=False,created=True,recorded_at=now()))
                return status,message
            finally:response.close()
    return StorageOnlyCloud


def execute(capture,plan,checkpoint,workers):
    if not 1<=workers<=16:raise ValueError('Use 1..16 bounded storage workers')
    report,objects=validate_plan(capture,plan)
    checkpoint=Path(checkpoint);checkpoint.parent.mkdir(parents=True,exist_ok=True)
    receipts_path=Path(str(checkpoint)+'.objects.jsonl');receipts=load_checkpoint(receipts_path,objects)
    journal=Journal(str(checkpoint)+'.original-upload-journal.jsonl');receipt_log=Journal(receipts_path)
    journal.append(dict(event='raw_plan_verified',objects_file_sha256=report['objects_file_sha256'],objects=len(objects),recorded_at=now()))
    path=Path(__file__).resolve().parents[1]/'common/land_publisher_code_v2.py'
    spec=importlib.util.spec_from_file_location('hi_storage_only_codec',path);codec=importlib.util.module_from_spec(spec);spec.loader.exec_module(codec)
    Cloud=cloud_type(codec,Cooldown(),journal);control=Cloud()
    try:control.assert_private_bucket()
    finally:control.s.close()
    local=threading.local();sessions=[];lock=threading.Lock();stop=threading.Event()
    def put(row):
        if stop.is_set():return None
        if not hasattr(local,'cloud'):
            local.cloud=Cloud()
            with lock:sessions.append(local.cloud.s)
        try:
            receipt=codec.put_object(local.cloud,row);valid_receipt(row,receipt)
            record=dict(sha256=row['sha256'],receipt=receipt)
            receipt_log.append(record)
            key=receipt['object_key'];existed=local.cloud.preexisting.get(key)
            journal.append(dict(event='object_verified',sha256=row['sha256'],object_key=receipt['object_key'],bucket=BUCKET,
                created=True if local.cloud.created.get(key)else False if existed else None,preexisting=existed,
                verified=True,recorded_at=now()))
            return row['sha256'],receipt
        except Exception:stop.set();raise
    try:
        todo=[row for row in objects if row['sha256']not in receipts]
        with ThreadPoolExecutor(max_workers=workers)as pool:
            futures=[pool.submit(put,row)for row in todo]
            for future in as_completed(futures):
                value=future.result()
                if value is not None:
                    receipts[value[0]]=value[1]
                    if len(receipts)%500==0:print(json.dumps(dict(originals_verified=len(receipts),of=len(objects))),flush=True)
    finally:
        for session in sessions:session.close()
    result=dict(schema='hi-raw-original-preupload/1',objects_file_sha256=report['objects_file_sha256'],objects=len(objects),
        verified=len(receipts),private_intake_allowed=False,publication_allowed=False,finished_at=now())
    journal.append(dict(event='raw_preupload_completed',**result));return result


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--plan',type=Path,required=True);cli.add_argument('--checkpoint',type=Path)
    cli.add_argument('--workers',type=int,default=8);cli.add_argument('--execute',action='store_true');args=cli.parse_args()
    if args.execute and not args.checkpoint:cli.error('--execute requires a private --checkpoint path')
    try:
        if args.execute:result=execute(args.capture,args.plan,args.checkpoint,args.workers)
        else:
            report,objects=validate_plan(args.capture,args.plan)
            result=dict(objects=len(objects),bytes=report['bytes'],objects_file_sha256=report['objects_file_sha256'],
                storage_writes=False,private_intake_allowed=False,publication_allowed=False)
        print(json.dumps(result),flush=True)
    except Exception as error:
        # Request exceptions may include endpoint details; omit their text and all credentials.
        print(json.dumps(dict(error=type(error).__name__,message=str(error)if isinstance(error,(ValueError,RuntimeError))else'Raw preupload failed; inspect the private journal')),flush=True)
        raise SystemExit(1)from None
