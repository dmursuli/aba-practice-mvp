import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as OTPAuth from 'otpauth';

process.env.DB_PATH = process.env.DB_PATH || join(await mkdtemp(join(tmpdir(), 'aba-auth-test-')), 'db.json');
process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS = '5';
process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS = '1';
process.env.MFA_PENDING_TIMEOUT_SECONDS = '30';
process.env.MFA_ENCRYPTION_KEY = 'test-mfa-encryption-key';

const dbPath = process.env.DB_PATH;
await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');

const { createAppServer, resetRuntimeState } = await import('../server.js');

let server;
let baseUrl = '';

before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  resetRuntimeState();
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  return {
    response,
    text,
    json,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie || ''
  };
}

async function loginAndCompleteMfa() {
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  assert.equal(loginResult.response.status, 200);
  assert.equal(loginResult.json.mfaRequired, true);
  assert.equal(loginResult.json.setupRequired, true);
  const totp = new OTPAuth.TOTP({
    issuer: 'Triumph Workspace',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(loginResult.json.manualEntryKey)
  });
  const code = totp.generate();
  const mfaResult = await request('/api/auth/mfa/setup/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code }
  });
  assert.equal(mfaResult.response.status, 200);
  assert.ok(Array.isArray(mfaResult.json.recoveryCodes));
  return mfaResult.cookie;
}

test('user must complete MFA before protected API access is allowed', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });

  assert.equal(loginResult.response.status, 200);
  assert.equal(loginResult.json.mfaRequired, true);
  assert.equal(loginResult.json.setupRequired, true);

  const dataResult = await request('/api/data', { cookie: loginResult.cookie });
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'MFA_SETUP_REQUIRED');
});

test('direct session restoration still requires MFA completion before protected access', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });

  const meResult = await request('/api/auth/me', { cookie: loginResult.cookie });
  assert.equal(meResult.response.status, 401);
  assert.equal(meResult.json.code, 'MFA_SETUP_REQUIRED');
  assert.equal(meResult.json.mfaRequired, true);
  assert.equal(meResult.json.setupRequired, true);
});

test('protected routes redirect to login when no valid session exists', async () => {
  const dataResult = await request('/api/data');
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'AUTH_REQUIRED');
});

test('authenticated session can access protected data only after MFA setup', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const cookie = await loginAndCompleteMfa();
  const meResult = await request('/api/auth/me', { cookie });
  assert.equal(meResult.response.status, 200);
  assert.equal(meResult.json.user.mfaEnabled, true);
  const dataResult = await request('/api/data', { cookie });
  assert.equal(dataResult.response.status, 200);
});

test('logout clears the auth cookie', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const cookie = await loginAndCompleteMfa();
  const logoutResult = await request('/api/auth/logout', {
    method: 'POST',
    cookie
  });
  assert.equal(logoutResult.response.status, 200);
  assert.match(logoutResult.response.headers.get('set-cookie') || '', /Max-Age=0/);
});

test('expired sessions are rejected after inactivity timeout', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const cookie = await loginAndCompleteMfa();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const dataResult = await request('/api/data', { cookie });
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'SESSION_TIMEOUT');
});

test('cache-control headers prevent caching of protected HTML and API responses', async () => {
  const pageResult = await request('/');
  assert.match(pageResult.response.headers.get('cache-control') || '', /no-store/);

  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const cookie = await loginAndCompleteMfa();
  const dataResult = await request('/api/data', { cookie });
  assert.match(dataResult.response.headers.get('cache-control') || '', /no-store/);
});

test('the browser app no longer stores clinical drafts in localStorage or sessionStorage', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.equal(appSource.includes('localStorage'), false);
  assert.equal(appSource.includes('sessionStorage'), false);
});

test('logout flow clears sensitive in-memory state and resets the browser URL', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.match(appSource, /state\.clients = \[\]/);
  assert.match(appSource, /state\.sessions = \[\]/);
  assert.match(appSource, /state\.draftCache = \{ intake: \{\}, session: \{\} \}/);
  assert.match(appSource, /window\.history\.replaceState\(\{\}, "", "\/"\)/);
});
