import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { sources, metadata, tarGzip, filesIn } from './files.mjs';
import { generateNotices } from './licenses.mjs';

const sourceFiles = await sources(), meta = await metadata(sourceFiles);
const origin = meta.apiOrigin, parsed = new URL(origin);
if (parsed.origin !== origin || parsed.username || parsed.password || !(parsed.protocol === 'https:' || parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) throw new Error('Invalid JURY_API_ORIGIN');
const define = {__VERSION__:JSON.stringify(meta.version),__COMMIT__:JSON.stringify(meta.commit),__SOURCE_URL__:JSON.stringify(meta.sourceUrl),__API_ORIGIN__:JSON.stringify(origin)};
await rm('dist',{recursive:true,force:true}); await mkdir('dist/extension',{recursive:true});
await viteBuild({configFile:false,root:'.',publicDir:false,define,build:{outDir:'dist/extension',emptyOutDir:false,rollupOptions:{input:'extension/options.html'}}});
await cp('dist/extension/extension/options.html','dist/extension/options.html'); await rm('dist/extension/extension',{recursive:true});
await esbuild({entryPoints:['extension/content.ts'],outfile:'dist/extension/content.js',bundle:true,format:'iife',target:'chrome120',define,minify:true});
await esbuild({entryPoints:['extension/background.ts'],outfile:'dist/extension/background.js',bundle:true,format:'esm',target:'chrome120',define,minify:true});
const manifest = {manifest_version:3,name:'X 人机评审团',version:meta.version,description:'对照个人 Jev 判定与匿名人工评审，判断评论的主要写作者。',minimum_chrome_version:'120',
  permissions:['storage','alarms'],host_permissions:[`${origin}/*`],optional_host_permissions:['https://api.typesafe.ai/*'],
  content_scripts:[{matches:['https://x.com/*'],js:['content.js'],run_at:'document_idle',all_frames:false}],
  background:{service_worker:'background.js',type:'module'},options_ui:{page:'options.html',open_in_tab:true},action:{default_title:'X 人机评审团设置'},
  content_security_policy:{extension_pages:`default-src 'self'; script-src 'self'; object-src 'none'; style-src 'self'; connect-src 'self' ${origin} https://api.typesafe.ai; base-uri 'none'; form-action 'none'`}};
await writeFile('dist/extension/manifest.json',JSON.stringify(manifest,null,2));
await writeFile('dist/extension/source.tar.gz',tarGzip([...sourceFiles,['.source-build.json',new TextEncoder().encode(JSON.stringify(meta,null,2))]]));
await cp('LICENSE','dist/extension/LICENSE.txt');
await writeFile('dist/extension/build-info.json',JSON.stringify(meta,null,2));
await generateNotices();
const zipEntries={};
for(const path of await filesIn('dist/extension')) zipEntries[path.slice('dist/extension/'.length)]=[new Uint8Array(await readFile(path)),{mtime:new Date('1980-01-01T00:00:00Z')}];
await writeFile('dist/x-human-ai-jury.zip',zipSync(zipEntries,{level:9}));
console.log(`Built extension ${meta.version} (${meta.commit.slice(0,18)}). Source contains only files in release-files.json.`);
