import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'fflate';
export const publicFiles = JSON.parse(await readFile(new URL('../release-files.json', import.meta.url), 'utf8'));
export async function filesIn(dir) {
  const out = [];
  try {
    for (const item of await readdir(dir,{withFileTypes:true})) {
      if (item.isSymbolicLink()) throw new Error(`Symlink not allowed in distribution: ${dir}/${item.name}`);
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) out.push(...await filesIn(path)); else if(item.isFile()) out.push(path);
    }
  } catch(e) { if(e.code !== 'ENOENT') throw e; }
  return out;
}
export async function sources() {
  const entries=[];
  for(const path of [...publicFiles].sort()) {
    const parts=path.split('/');
    for(let i=1;i<=parts.length;i++)if((await lstat(parts.slice(0,i).join('/'))).isSymbolicLink())throw new Error(`Symlink not allowed: ${path}`);
    entries.push([path,new Uint8Array(await readFile(path))]);
  }
  return entries;
}
export const hash = data => createHash('sha256').update(data).digest('hex');
export function git(args,fallback='') { try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return fallback;} }
export async function metadata(entries) {
  const contentHash=hash(Buffer.concat(entries.flatMap(([name,data])=>[Buffer.from(name+'\0'),Buffer.from(data)])));
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  let archived, hasGit=false;
  try{hasGit=(await lstat('.git')).isDirectory() || (await lstat('.git')).isFile();}catch{}
  try{archived=JSON.parse(await readFile('.source-build.json','utf8'));}catch{}
  let commit=hasGit ? git(['rev-parse','HEAD'],'development') : archived?.commit || 'development';
  if(hasGit ? git(['status','--porcelain']) : archived && archived.contentHash!==contentHash)commit+='-dirty';
  const sourceUrl=`${pkg.homepage}/tree/${commit.replace(/-dirty$/, '')}`;
  const apiOrigin=process.env.JURY_API_ORIGIN || archived?.apiOrigin || 'https://x.aileetcode.com';
  return {version:pkg.version,commit,contentHash,sourceUrl,apiOrigin,scope:'extension-only',license:'AGPL-3.0-only'};
}
export function tarGzip(entries) {
  const chunks = [];
  const encoder = new TextEncoder();
  for(const [name,data] of entries) {
    if(encoder.encode(name).length>100) throw new Error(`Source path too long: ${name}`);
    const h = new Uint8Array(512);
    const field=(value,offset,length)=>h.set(encoder.encode(value).slice(0,length),offset);
    field(name,0,100);field('0000644\0',100,8);field('0000000\0',108,8);field('0000000\0',116,8);
    field(data.length.toString(8).padStart(11,'0')+'\0',124,12);field('00000000000\0',136,12);field('        ',148,8);field('0',156,1);field('ustar\0',257,6);field('00',263,2);
    const sum=h.reduce((a,b)=>a+b,0);field(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
    chunks.push(h,data,new Uint8Array((512-data.length%512)%512));
  }
  chunks.push(new Uint8Array(1024));
  return gzipSync(new Uint8Array(Buffer.concat(chunks)),{mtime:0,level:9});
}
