import { describe, expect, it } from 'vitest';
// @ts-expect-error Build helpers are executable ESM rather than app TypeScript.
import { assertSourcePath, auditSourceArchive, auditZip, scanText } from '../scripts/audit-lib.mjs';
// @ts-expect-error Same build helper boundary.
import { tarGzip } from '../scripts/files.mjs';
import { zipSync } from 'fflate';
const bytes=(text:string)=>new TextEncoder().encode(text);
describe('publication boundary',()=>{
  it('blocks secrets even when a filename is in the source allowlist',()=>{
    expect(()=>scanText('fixture.ts',bytes('key='+['ghp','a'.repeat(36)].join('_')))).toThrow(/redacted/);
  });
  it('blocks private and traversing files even when mistakenly allowlisted',()=>{
    for(const path of ['server/index.ts','.env.production','.openai/hosting.json','db/schema.ts','../README.md','x\\secret.ts','local.sqlite'])expect(()=>assertSourcePath(path,new Set([path]))).toThrow();
  });
  it('inspects nested source archives rather than just the outer ZIP names',()=>{
    const source=tarGzip([['README.md',bytes('ok')],['server/index.ts',bytes('private server implementation')]]);
    const zip=zipSync({'source.tar.gz':source});
    expect(()=>auditZip('fixture.zip',zip,new Set(['README.md']))).toThrow(/source path/);
  });
  it('rejects missing source and unexpected extension bundle entries',()=>{
    expect(()=>auditSourceArchive('source',tarGzip([['README.md',bytes('ok')]]),new Set(['README.md','package.json']))).toThrow(/missing/);
    expect(()=>auditZip('fixture',zipSync({'background.js.map':bytes('{}')}),new Set())).toThrow(/bundle path/);
  });
});
