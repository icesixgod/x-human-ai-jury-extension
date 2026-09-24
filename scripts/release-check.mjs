import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { git, metadata, sources } from './files.mjs';
const meta=JSON.parse(await readFile('dist/extension/build-info.json','utf8'));
const expected=await metadata(await sources()), problems=[];
if(git(['status','--porcelain']))problems.push('Commit reviewed source before release.');
if(!/^[a-f0-9]{40}$/.test(meta.commit) || meta.commit!==git(['rev-parse','HEAD']))problems.push('Build must match the current clean commit.');
if(JSON.stringify(meta)!==JSON.stringify(expected))problems.push('Build metadata does not match source/configuration.');
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(meta.sourceUrl!==`${pkg.homepage}/tree/${meta.commit}`)problems.push('Source URL must identify this repository and exact commit.');
const manifest=JSON.parse(await readFile('dist/extension/manifest.json','utf8'));
if(JSON.stringify(manifest.host_permissions)!==JSON.stringify(['https://x.aileetcode.com/*']))problems.push('Official release must use the official HTTPS backend.');
if(manifest.manifest_version!==3 || JSON.stringify(manifest.permissions)!=='["storage","alarms"]' || manifest.externally_connectable || manifest.web_accessible_resources || manifest.update_url)problems.push('Unexpected extension permissions or external access.');
if(manifest.content_security_policy.extension_pages.includes('unsafe-'))problems.push('Unsafe extension CSP.');
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
execFileSync(process.execPath,['scripts/scan.mjs'],{stdio:'inherit'});
console.log('Release gate passed: clean commit, source fingerprint, exact source URL and minimal production permissions.');
