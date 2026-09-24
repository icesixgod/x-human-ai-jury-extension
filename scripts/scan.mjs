import { readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { filesIn, sources, publicFiles, git } from './files.mjs';
import { assertSourcePath, scanText, auditZip, auditSourceArchive, auditBundleEntry } from './audit-lib.mjs';
const allowed=new Set(publicFiles);
if(allowed.size!==publicFiles.length)throw new Error('Duplicate release paths');
for(const path of publicFiles)assertSourcePath(path,allowed);
for(const [name,data]of await sources()){assertSourcePath(name,allowed);scanText(name,data);}
const hasGit=await lstat('.git').then(()=>true,()=>false);
let commits=[];
if(hasGit){
  for(const path of git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean)){
    assertSourcePath(path,allowed);
    if(!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())throw new Error(`Not a regular file: ${path}`);
    scanText(path,new Uint8Array(await readFile(path)));
  }
  commits=git(['rev-list','--all']).split('\n').filter(Boolean);
  const checked=new Set();
  for(const commit of commits){
    scanText('commit metadata',new Uint8Array(execFileSync('git',['cat-file','commit',commit])));
    for(const row of execFileSync('git',['ls-tree','-rz',commit],{encoding:'utf8'}).split('\0').filter(Boolean)){
      const match=row.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
      if(!match || match[1]!=='100644' || match[2]!=='blob')throw new Error('Nonregular file in history');
      const [, , ,oid,path]=match;assertSourcePath(path,allowed);
      if(!checked.has(oid)){scanText(`history:${path}`,new Uint8Array(execFileSync('git',['cat-file','blob',oid],{maxBuffer:6_000_000})));checked.add(oid);}
    }
  }
  // --no-index makes these probes effective even if someone forcibly tracks a secret.
  for(const path of ['.env','.env.production','.dev.vars','.npmrc','private.key','state.sqlite','token.txt','dist/background.js','node_modules/pkg/index.js','server/index.ts','web/main.tsx','.openai/hosting.json','deploy/worker.ts','db/schema.ts','reports/private.json','release/old.zip']){
    execFileSync('git',['check-ignore','--no-index',path],{stdio:'ignore'});
  }
}
for(const path of await filesIn('dist')){
  const bytes=new Uint8Array(await readFile(path));
  if(path==='dist/x-human-ai-jury.zip')auditZip(path,bytes,allowed);
  else if(path.startsWith('dist/extension/'))auditBundleEntry(path,path.slice('dist/extension/'.length),bytes,allowed);
  else throw new Error(`Unexpected build output: ${path}`);
}
for(const path of await filesIn('release')){
  const bytes=new Uint8Array(await readFile(path)),name=path.slice(8);
  if(/^x-human-ai-jury-\d+\.\d+\.\d+\.zip$/.test(name))auditZip(path,bytes,allowed);
  else if(name==='source.tar.gz')auditSourceArchive(path,bytes,allowed);
  else if(['sbom.cdx.json','build-info.json','SHA256SUMS'].includes(name))scanText(path,bytes);
  else throw new Error(`Unexpected release file: ${path}`);
}
console.log(`Release scan passed: ${allowed.size} approved source files, ${commits.length} reachable commits, ignore probes and all present build/release archives.`);
