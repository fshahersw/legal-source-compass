import fs from 'node:fs';
import path from 'node:path';
const workspace = path.resolve(process.argv[2] ?? '..');
const cache = path.resolve(process.argv[3]);
const metadata = path.join(workspace, 'audit/2026-10-02/metadata');
const normalized = path.join(metadata, 'normalized');
const support_files = ['courthouses','people-db-positions','people-db-educations','courts'].map(k => path.join(normalized,k+'.jsonl'));
const files = ['courts','people-db-people'].map(k => path.join(normalized,k+'.jsonl'));
for (const directory of ['live-normalized','citation-normalized']) {
  for(const kind of ['dockets','clusters']) { const file=path.join(metadata,directory,kind+'.jsonl');if(fs.existsSync(file))support_files.push(file); }
  for(const kind of ['dockets','opinions','docket-entries','parties','attorneys']) { const file=path.join(metadata,directory,kind+'.jsonl');if(fs.existsSync(file))files.push(file); }
}
const fr = path.resolve(process.argv[4]);
if(fs.existsSync(fr))files.push(fr);
fs.mkdirSync(cache,{recursive:true});
const config={schema_version:'legal-atlas/3.1',database:path.join(cache,'stage.sqlite'),output:path.join(cache,'reports'),end_year:2026,support_files,files};
fs.writeFileSync(path.join(cache,'config.json'),JSON.stringify(config,null,2));
console.log(JSON.stringify({files:files.length,support_files:support_files.length,config:path.join(cache,'config.json')}));
