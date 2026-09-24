import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { filesIn, hash } from './files.mjs';

// Rebuild only the distributable source, with a fresh install of its lockfile.
// No .git, .dev.vars, D1 database or workspace-only file is copied.
const temporary = await mkdtemp(join(tmpdir(), 'jury-source-check-'));
try {
  execFileSync('tar', ['-xzf', resolve('dist/extension/source.tar.gz'), '-C', temporary]);
  const environment = Object.fromEntries(['PATH','HOME','TMPDIR','JURY_API_ORIGIN'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
  execFileSync('npm', ['ci','--ignore-scripts','--no-audit','--no-fund'], { cwd: temporary, env: environment, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: temporary, env: environment, stdio: 'inherit' });
  const expected = (await filesIn('dist')).sort();
  const actual = (await filesIn(join(temporary,'dist'))).map(file => file.slice(temporary.length + 1)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Rebuilt file set differs');
  for (const path of expected) {
    if (hash(await readFile(path)) !== hash(await readFile(join(temporary,path)))) throw new Error(`Rebuilt bytes differ: ${path}`);
  }
  console.log(`Independent source rebuild verified: ${expected.length} identical output files.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
