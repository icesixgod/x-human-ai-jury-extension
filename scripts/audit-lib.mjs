import { gunzipSync, unzipSync } from 'fflate';
export const sensitivePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/,
  /\bjury_admin_[a-f0-9]{64}\b/,
  /(?:TYPESAFE_API_KEY|RATE_LIMIT_SECRET|ADMIN_TOKEN(?:_HASH)?)\s*[=:]\s*["']?[a-zA-Z0-9_-]{24,}/,
  /["'](?:key|token|apiKey|access_token|authorization)["']\s*:\s*["'][A-Za-z0-9_/-]{32,}["']/i,
  /https?:\/\/[^\s/]+:[^\s/]+@/,
  /(?:\/Users\/|\/home\/)[a-zA-Z0-9_.-]+\//,
];
export function safePath(path) {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p=>!p || p==='.' || p==='..') && !/[\x00-\x1f\x7f]/.test(path);
}
export function assertSourcePath(path, allowed, archived=false) {
  if(!safePath(path) || !(allowed.has(path) || archived && path==='.source-build.json'))throw new Error(`Unapproved source path: ${path}`);
  if(/(^|\/)(?:server|web|deploy|migrations|drizzle|db|\.git|\.openai|\.wrangler|\.sites-runtime|\.workspace-ledger|node_modules)(\/|$)/.test(path) || /(^|\/)(?:\.env|\.dev\.vars|\.npmrc)(\.|$)/.test(path) || /\.(?:pem|key|db|sqlite3?|sql)$/i.test(path))throw new Error(`Private path: ${path}`);
}
export function scanText(label, bytes) {
  if(bytes.length>5_000_000 || bytes.includes(0))throw new Error(`Unexpected binary/oversized text: ${label}`);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(sensitivePatterns.some(pattern=>pattern.test(text)))throw new Error(`Potential secret or private path (value redacted): ${label}`);
}
export function tarEntries(bytes) {
  const tar=gunzipSync(bytes),entries=[],decode=new TextDecoder();
  if(tar.length>25_000_000)throw new Error('Oversized source archive');
  const names=new Set();let pos=0;
  while(pos+512<=tar.length){
    const h=tar.slice(pos,pos+512), name=decode.decode(h.slice(0,100)).replace(/\0.*$/s,'');
    if(!name)break;
    const size=Number.parseInt(decode.decode(h.slice(124,136)).replace(/\0.*$/s,''),8);
    if(h.slice(345,500).some(b=>b!==0) || h[156]!==48 || !Number.isSafeInteger(size) || size<0 || pos+512+size>tar.length || names.has(name) || !safePath(name))throw new Error('Invalid archive entry');
    names.add(name);entries.push([name,tar.slice(pos+512,pos+512+size)]);pos+=512+Math.ceil(size/512)*512;
  }
  if(!entries.length)throw new Error('Empty source archive');
  return entries;
}
export function auditSourceArchive(label, bytes, allowed) {
  const entries=tarEntries(bytes);
  const expected=new Set([...allowed,'.source-build.json']);
  for(const [name,data]of entries){assertSourcePath(name,allowed,true);scanText(`${label}!${name}`,data);expected.delete(name);}
  if(expected.size)throw new Error('Source archive missing required files');
}
export function assertBundlePath(path) {
  if(!safePath(path) || !(/^(?:manifest\.json|background\.js|content\.js|options\.html|LICENSE\.txt|THIRD_PARTY_NOTICES\.txt|build-info\.json|source\.tar\.gz)$/.test(path) || /^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path)))throw new Error(`Unapproved bundle path: ${path}`);
}
export function auditBundleEntry(label,name,bytes,allowed) {
  assertBundlePath(name);
  if(name==='source.tar.gz')auditSourceArchive(label,bytes,allowed);else scanText(label,bytes);
}
export function auditZip(label,bytes,allowed) {
  const entries=Object.entries(unzipSync(bytes));
  const required=new Set(['manifest.json','background.js','content.js','options.html','LICENSE.txt','THIRD_PARTY_NOTICES.txt','build-info.json','source.tar.gz']);
  for(const [name,data]of entries){auditBundleEntry(`${label}!${name}`,name,data,allowed);required.delete(name);}
  if(required.size)throw new Error('Incomplete extension ZIP');
}
