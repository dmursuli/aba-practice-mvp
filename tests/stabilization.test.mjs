import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../public/api.js', import.meta.url), 'utf8');

function sourceBlock(functionName) {
  const start = appSource.indexOf(`function ${functionName}`);
  if (start === -1) return '';
  const next = appSource.indexOf('\nfunction ', start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

function asyncSourceBlock(functionName) {
  const start = appSource.indexOf(`async function ${functionName}`);
  if (start === -1) return '';
  const nextFunction = appSource.indexOf('\nfunction ', start + 1);
  const nextAsync = appSource.indexOf('\nasync function ', start + 1);
  const candidates = [nextFunction, nextAsync].filter((index) => index > -1);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

test('authenticated startup preserves the requested workspace route before app rendering can rewrite it', () => {
  const block = asyncSourceBlock('startAuthenticatedApp');
  const requestedIndex = block.indexOf('const requested = requestedWorkspaceState();');
  const showAppIndex = block.indexOf('showApp();');
  const refreshDataIndex = block.indexOf('await refreshData();');

  assert.ok(requestedIndex > -1, 'requested route should be captured');
  assert.ok(showAppIndex > -1, 'app should still be shown during startup');
  assert.ok(refreshDataIndex > -1, 'base data should still be refreshed');
  assert.ok(requestedIndex < showAppIndex, 'requested route must be captured before showApp/applyRoleAccess can sync the URL');
  assert.ok(requestedIndex < refreshDataIndex, 'requested route must be captured before slower startup work');
});

test('initial auth restore does not erase requested workspace URLs for unauthenticated users', () => {
  assert.ok(apiSource.includes('return parseResponse(response, { suppressAuthEvent: true });'));
  assert.match(apiSource, /async function parseResponse\(response, \{ suppressAuthEvent = false \} = \{\}\)/);
  assert.match(apiSource, /&& !suppressAuthEvent/);
});

test('base data refresh does not eagerly fetch admin users or audit log on every login', () => {
  const block = asyncSourceBlock('refreshData');

  assert.doesNotMatch(block, /await refreshUsers\(false\)/);
  assert.doesNotMatch(block, /await refreshAuditLog\(false\)/);
});

test('ordinary pageshow does not rerun authenticated bootstrap after login', () => {
  assert.match(appSource, /window\.addEventListener\("pageshow", \(event\) => \{/);
  assert.match(appSource, /if \(!event\.persisted\) \{\s*if \(!state\.currentUser && !state\.authChallenge\) showLogin\(\);\s*return;\s*\}/s);
});

test('graph resize redraws are throttled and limited to the active Graphs view', () => {
  const block = sourceBlock('scheduleGraphResizeRender');

  assert.match(appSource, /window\.addEventListener\("resize", scheduleGraphResizeRender\);/);
  assert.match(block, /if \(currentView\(\) !== "graphs"\) return;/);
  assert.match(block, /if \(state\.graphResizeFrameId\) return;/);
  assert.match(block, /window\.requestAnimationFrame/);
  assert.match(block, /renderCharts\(\);/);
});

test('session data hydration rerenders only the active session-backed view', () => {
  const block = sourceBlock('rerenderSessionBackedView');

  assert.match(block, /if \(view === "graphs"\) \{\s*renderGraphsSummary\(\);\s*renderCharts\(\);/s);
  assert.match(block, /if \(view === "report"\) \{\s*renderReportSummary\(\);\s*renderFunderReportPreview\(\);/s);
  assert.doesNotMatch(block, /renderSummary\(\);\s*renderGraphsSummary\(\);\s*renderHistoricalImport\(\);\s*renderReportSummary\(\);/s);
  assert.doesNotMatch(block, /renderSoapSummary\(\);\s*renderHistory\(\);\s*renderNote\(\);\s*renderParentSummary\(\);/s);
});
