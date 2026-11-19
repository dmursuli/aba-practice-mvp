import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const script = join(repo, 'scripts/netlify-ignore.sh');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'netlify-ignore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (path, content = 'changed\n') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  write('website/index.html', 'original\n');
  write('netlify.toml', '[build]\n');
  write('scripts/netlify-ignore.sh', 'original\n');
  write('server.js', 'original\n');
  const base = commit();
  const run = (previous = base, current = git('rev-parse', 'HEAD'), cwd = dir, extraEnv = {}) => {
    const result = spawnSync('bash', [script], {
      cwd, encoding: 'utf8',
      env: { ...process.env, CACHED_COMMIT_REF: previous, COMMIT_REF: current, ...extraEnv },
    });
    assert.ifError(result.error);
    return result;
  };
  return { dir, git, write, commit, base, run };
}

for (const path of ['website/index.html', 'website/styles.css', 'website/script.js',
  'website/assets/new image.png', 'website/_redirects', 'website/_headers',
  'website/netlify.toml', 'netlify.toml', 'scripts/netlify-ignore.sh']) {
  test(`deploys for ${path}`, t => {
    const f = fixture(t); f.write(path); f.commit();
    assert.equal(f.run().status, 1);
  });
}
for (const path of ['server.js', 'public/app.js', 'lib/clinical.js',
  'tests/clinical.test.mjs', 'README.md', 'DEPLOY_AWS_LIGHTSAIL.md',
  'deploy/lightsail/Caddyfile', 'package.json', 'package-lock.json']) {
  test(`skips unrelated change to ${path}`, t => {
    const f = fixture(t); f.write(path); f.commit();
    assert.equal(f.run().status, 0);
  });
}
test('deploys for website deletion and moves across the website boundary', t => {
  const f = fixture(t);
  rmSync(join(f.dir, 'website/index.html')); f.commit();
  assert.equal(f.run().status, 1);
  f.write('website/moved.html'); const beforeMove = f.commit();
  renameSync(join(f.dir, 'website/moved.html'), join(f.dir, 'moved.html')); f.commit();
  assert.equal(f.run(beforeMove).status, 1);
  const beforeReturn = f.git('rev-parse', 'HEAD');
  renameSync(join(f.dir, 'moved.html'), join(f.dir, 'website/moved.html')); f.commit();
  assert.equal(f.run(beforeReturn).status, 1);
});
test('compares the entire range since the last build, including mixed changes', t => {
  const f = fixture(t); f.write('website/index.html'); f.commit();
  f.write('server.js'); f.commit();
  assert.equal(f.run().status, 1);
});
test('skips multiple clinical-only commits and handles a subdirectory cwd', t => {
  const f = fixture(t); f.write('server.js'); f.commit();
  f.write('tests/clinical.test.mjs'); f.commit();
  assert.equal(f.run().status, 0);
  assert.equal(f.run(f.base, f.git('rev-parse', 'HEAD'), join(f.dir, 'website')).status, 0);
});
test('deploys for missing, malformed, unavailable, or identical refs', t => {
  const f = fixture(t); f.write('server.js'); const head = f.commit();
  for (const [previous, current] of [
    ['', head], [f.base, ''], ['HEAD^', head], [f.base, '--help'],
    ['0'.repeat(40), head], [f.base, '0'.repeat(40)], [head, head],
  ]) assert.equal(f.run(previous, current).status, 1, `${previous} -> ${current}`);
});
test('deploys for a mismatched checkout or diverged history', t => {
  const f = fixture(t); f.write('server.js'); const old = f.commit();
  assert.equal(f.run(old, f.base).status, 1);
  f.git('checkout', '-q', '--detach', f.base);
  f.write('README.md'); f.commit();
  assert.equal(f.run(old).status, 1);
});
test('deploys when shallow history lacks the cached commit', t => {
  const f = fixture(t); f.write('server.js'); f.commit();
  const shallow = join(f.dir, 'shallow');
  f.git('clone', '-q', '--depth=1', `file://${f.dir}`, shallow);
  assert.equal(f.run(f.base, f.git('rev-parse', 'HEAD'), shallow).status, 1);
});
test('deploys outside a Git checkout', t => {
  const f = fixture(t); f.write('server.js'); const head = f.commit();
  const empty = mkdtempSync(join(tmpdir(), 'netlify-no-git-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(f.run(f.base, head, empty).status, 1);
});
test('deploys if git diff fails', t => {
  const f = fixture(t); f.write('server.js'); f.commit();
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = join(f.dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/bash\nif [[ $1 == diff ]]; then exit 128; fi\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const result = f.run(f.base, f.git('rev-parse', 'HEAD'), f.dir, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Git diff failed/);
});
test('Netlify uses the guard and retains the static build and consultation form', () => {
  const config = readFileSync(join(repo, 'netlify.toml'), 'utf8');
  assert.match(config, /ignore = "bash \.\/scripts\/netlify-ignore\.sh"/);
  assert.match(config, /publish = "website"/);
  assert.match(config, /command = "echo 'Static site: no build required'"/);
  const html = readFileSync(join(repo, 'website/index.html'), 'utf8');
  assert.match(html, /<form[^>]*name="consultation"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
  assert.match(html, /name="form-name" value="consultation"/);
});
