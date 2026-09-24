import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function generateNotices() {
  const lock=JSON.parse(await readFile('package-lock.json','utf8'));
  const notices=['THIRD-PARTY SOFTWARE NOTICES\nBundled production dependencies retain their original licenses. Build/test dependencies are recorded in the SBOM and npm lockfile.\n'];
  const components=[];
  for(const [path,info] of Object.entries(lock.packages).sort()) {
    if(!path)continue;
    const name=path.split('node_modules/').at(-1);
    components.push({type:'library',name,version:info.version,licenses:[{license:{name:info.license||'SEE LICENSE IN PACKAGE'}}],purl:`pkg:npm/${name}@${info.version}`});
    if(info.dev)continue;
    const pkg=JSON.parse(await readFile(`${path}/package.json`,'utf8'));
    notices.push(`\n===== ${pkg.name}@${pkg.version} (${pkg.license||'SEE LICENSE'}) =====\n`);
    const files=(await readdir(path)).filter(name=>/^(license|copying|notice)(\.|$)/i.test(name)).sort();
    if(!files.length)throw new Error(`Missing dependency license: ${name}`);
    for(const file of files)notices.push(await readFile(`${path}/${file}`,'utf8'));
  }
  await mkdir('dist/extension',{recursive:true});
  await writeFile('dist/extension/THIRD_PARTY_NOTICES.txt',notices.join('\n'));
  await mkdir('reports',{recursive:true});
  await writeFile('reports/sbom.cdx.json',JSON.stringify({bomFormat:'CycloneDX',specVersion:'1.5',version:1,components},null,2));
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await generateNotices();
