import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = process.env.DB_PATH || join(await mkdtemp(join(tmpdir(), 'aba-auth-test-')), 'db.json');
process.env.SESSION_ABSOLUTE_TIMEOUT_SECONDS = '5';
process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS = '1';
process.env.MFA_PENDING_TIMEOUT_SECONDS = '30';
process.env.VERIFICATION_CODE_TTL_SECONDS = '2';
process.env.EMAIL_VERIFICATION_DEBUG_CODES = 'true';
process.env.ABA_DISABLE_AUTOSTART = '1';

const dbPath = process.env.DB_PATH;
await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');

const { createAppServer, drainVerificationDebugDeliveries, resetRuntimeState } = await import('../server.js');

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

async function loginForVerification(identifier = 'admin') {
  drainVerificationDebugDeliveries();
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username: identifier, password: 'admin123' }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.verificationRequired, true);
  const deliveries = drainVerificationDebugDeliveries();
  assert.equal(deliveries.length, 1);
  return { ...result, code: deliveries[0].code };
}

async function loginAndVerify() {
  const loginResult = await loginForVerification();
  const verifyResult = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: loginResult.code }
  });
  assert.equal(verifyResult.response.status, 200);
  return { loginResult, verifyResult, cookie: verifyResult.cookie };
}

async function forceAdminWithoutVerificationEmail() {
  await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  resetRuntimeState();
  const db = JSON.parse(await readFile(dbPath, 'utf8'));
  const admin = db.users.find((user) => user.username === 'admin');
  admin.email = '';
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

test('login page renders for unauthenticated users and includes auth assets', async () => {
  const pageResult = await request('/');
  assert.equal(pageResult.response.status, 200);
  assert.match(pageResult.text, /<h1>Sign in<\/h1>/);
  assert.match(pageResult.text, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(pageResult.text, /<link rel="stylesheet" href="\/styles\.css">/);
});

test('email verification is required after password login', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await loginForVerification();
  assert.equal(loginResult.json.deliveryMethod, 'email');
  assert.match(loginResult.json.destinationMask, /@/);
  const dataResult = await request('/api/data', { cookie: loginResult.cookie });
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'VERIFICATION_REQUIRED');
});

test('users without a verification email are prompted to set one after password login', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  await forceAdminWithoutVerificationEmail();
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  assert.equal(loginResult.response.status, 200);
  assert.equal(loginResult.json.verificationRequired, true);
  assert.equal(loginResult.json.setupRequired, true);
  assert.equal(loginResult.json.deliveryMethod, 'email');
  assert.match(loginResult.json.message, /sign-in verification/i);
});

test('users can set a verification email and continue the sign-in flow', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  await forceAdminWithoutVerificationEmail();
  drainVerificationDebugDeliveries();
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  const setupResult = await request('/api/auth/verify/setup-email', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { email: 'admin@example.com' }
  });
  assert.equal(setupResult.response.status, 200);
  assert.equal(setupResult.json.verificationRequired, true);
  const deliveries = drainVerificationDebugDeliveries();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].email, 'admin@example.com');
  const verifyResult = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: deliveries[0].code }
  });
  assert.equal(verifyResult.response.status, 200);
  assert.equal(verifyResult.json.user.email, 'admin@example.com');
});

test('verification email setup rejects addresses already assigned to another user', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  await forceAdminWithoutVerificationEmail();
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  const setupResult = await request('/api/auth/verify/setup-email', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { email: 'bcba@local.test' }
  });
  assert.equal(setupResult.response.status, 400);
  assert.equal(setupResult.json.code, 'VERIFICATION_EMAIL_TAKEN');
});

test('verification code expires', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await loginForVerification();
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const verifyResult = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: loginResult.code }
  });
  assert.equal(verifyResult.response.status, 401);
  assert.equal(verifyResult.json.code, 'VERIFICATION_CODE_EXPIRED');
});

test('verification code is single-use', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { loginResult, verifyResult } = await loginAndVerify();
  const reused = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: loginResult.code }
  });
  assert.equal(verifyResult.response.status, 200);
  assert.equal(reused.response.status, 401);
});

test('incorrect verification code is rejected', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await loginForVerification();
  const verifyResult = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: '000000' }
  });
  assert.equal(verifyResult.response.status, 401);
  assert.equal(verifyResult.json.code, 'VERIFICATION_CODE_INVALID');
});

test('too many verification attempts are rate-limited', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await loginForVerification();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request('/api/auth/verify', {
      method: 'POST',
      cookie: loginResult.cookie,
      body: { code: '000000' }
    });
  }
  const finalAttempt = await request('/api/auth/verify', {
    method: 'POST',
    cookie: loginResult.cookie,
    body: { code: '000000' }
  });
  assert.equal(finalAttempt.response.status, 429);
  assert.equal(finalAttempt.json.code, 'VERIFICATION_RATE_LIMITED');
});

test('user is signed out after inactivity timeout', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { cookie } = await loginAndVerify();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const dataResult = await request('/api/data', { cookie });
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'SESSION_TIMEOUT');
});

test('activity resets the inactivity timer through the auth ping endpoint', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { cookie } = await loginAndVerify();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const pingResult = await request('/api/auth/ping', { method: 'POST', cookie });
  assert.equal(pingResult.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const dataResult = await request('/api/data', { cookie });
  assert.equal(dataResult.response.status, 200);
});

test('recoverable drafts can be preserved server-side and restored after re-login', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { cookie } = await loginAndVerify();
  const preserveResult = await request('/api/auth/drafts', {
    method: 'POST',
    cookie,
    body: {
      intake: { 'client-1': { interviewDate: '2026-06-16' } },
      session: { 'client-1': { fields: { therapist: 'Tester' }, programs: [], behaviors: [] } }
    }
  });
  assert.equal(preserveResult.response.status, 200);
  const restoreResult = await request('/api/auth/drafts', { cookie });
  assert.equal(restoreResult.response.status, 200);
  assert.equal(restoreResult.json.intake['client-1'].interviewDate, '2026-06-16');
  assert.equal(restoreResult.json.session['client-1'].fields.therapist, 'Tester');
  const emptyResult = await request('/api/auth/drafts', { cookie });
  assert.deepEqual(emptyResult.json.intake, {});
  assert.deepEqual(emptyResult.json.session, {});
});

test('absolute session expiration requires re-login even with activity', async () => {
  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { cookie } = await loginAndVerify();
  for (let step = 0; step < 7; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await request('/api/auth/ping', { method: 'POST', cookie });
  }
  const dataResult = await request('/api/data', { cookie });
  assert.equal(dataResult.response.status, 401);
  assert.ok(['SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(dataResult.json.code));
});

test('protected routes redirect to login when no valid session exists', async () => {
  const dataResult = await request('/api/data');
  assert.equal(dataResult.response.status, 401);
  assert.equal(dataResult.json.code, 'AUTH_REQUIRED');
});

test('cache-control headers prevent caching of protected HTML and API responses', async () => {
  const pageResult = await request('/');
  assert.equal(pageResult.response.status, 200);

  resetRuntimeState();
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const { cookie } = await loginAndVerify();
  const dataResult = await request('/api/data', { cookie });
  assert.match(dataResult.response.headers.get('cache-control') || '', /no-store/);
});

test('login page does not blank if verification provider config is missing', async () => {
  resetRuntimeState();
  process.env.EMAIL_VERIFICATION_DEBUG_CODES = 'false';
  await writeFile(dbPath, `${JSON.stringify({ clients: [], sessions: [], auditLog: [], users: [] }, null, 2)}\n`, 'utf8');
  const loginResult = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  assert.equal(loginResult.response.status, 503);
  assert.ok(['AUTH_UNAVAILABLE', 'VERIFICATION_UNAVAILABLE'].includes(loginResult.json.code));
  process.env.EMAIL_VERIFICATION_DEBUG_CODES = 'true';
});

test('the browser app no longer stores clinical drafts in localStorage or sessionStorage', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.equal(appSource.includes('localStorage'), false);
  assert.equal(appSource.includes('sessionStorage'), false);
});

test('logout or timeout clears sensitive in-memory state and resets the browser URL', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.match(appSource, /state\.clients = \[\]/);
  assert.match(appSource, /state\.sessions = \[\]/);
  assert.match(appSource, /state\.draftCache = \{ intake: \{\}, session: \{\} \}/);
  assert.match(appSource, /window\.history\.replaceState\(\{\}, "", "\/"\)/);
});

test('warning appears shortly before inactivity timeout and activity listeners reset the timer', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.match(appSource, /Your session will expire soon due to inactivity\. Stay signed in\?/);
  assert.match(appSource, /const INACTIVITY_TIMEOUT_MS = 45 \* 60 \* 1000/);
  assert.match(appSource, /const INACTIVITY_WARNING_MS = 40 \* 60 \* 1000/);
  assert.match(appSource, /\[\"click\", \"keydown\", \"mousemove\", \"touchstart\", \"scroll\"\]/);
  assert.match(appSource, /touchSession\(\)/);
  assert.match(appSource, /preserveRecoverableDrafts\(\)/);
});

test('auth boot failures show a visible login error path instead of blanking the page', async () => {
  const appSource = await readFile(join(process.cwd(), 'public/app.js'), 'utf8');
  assert.match(appSource, /init\(\)\.catch\(handleBootstrapFailure\)/);
  assert.match(appSource, /Authentication is temporarily unavailable/);
  assert.match(appSource, /showLogin\("We couldn't load the sign-in experience/);
});
