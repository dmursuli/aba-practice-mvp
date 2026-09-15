import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../public/api.js', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

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

test('bootstrap carries session summaries but not eager historical import batches', () => {
  const block = sourceBlock('refreshData');
  const bootstrapBlockStart = serverSource.indexOf('function bootstrapDb');
  const bootstrapBlock = serverSource.slice(bootstrapBlockStart, serverSource.indexOf('\nfunction practiceBackupPayload', bootstrapBlockStart));

  assert.match(bootstrapBlock, /clientSessionSummaries: visibleSessionSummaries\(db, user\)/);
  assert.match(bootstrapBlock, /historicalImportBatches: \[\]/);
  assert.match(block, /clientSessionSummaries: data\.clientSessionSummaries \|\| \{\}/);
  assert.match(block, /historicalImportBatches: \[\]/);
});

test('graphs load sessions by selected date range and include range-loaded sessions in current client data', () => {
  const ensureBlock = asyncSourceBlock('ensureSessionDataForView');
  const currentSessionsBlock = sourceBlock('currentSessions');
  const controlsBlock = sourceBlock('renderBehaviorGraphControls');

  assert.match(appSource, /async function ensureGraphSessionsLoaded/);
  assert.match(ensureBlock, /if \(view === "graphs"\) \{\s*await ensureGraphSessionsLoaded\(clientId, \{ force \}\);/s);
  assert.match(currentSessionsBlock, /state\.sessionsLoadedScope === "clientRange"/);
  assert.match(controlsBlock, /reloadGraphSessionsForCurrentRange\(\);/);
  assert.doesNotMatch(controlsBlock, /state\.behaviorGraphRangePreset = event\.target\.value;\s*renderCharts\(\);/);
});

test('session and report views hydrate scoped session windows instead of full client history by default', () => {
  const ensureBlock = asyncSourceBlock('ensureSessionDataForView');
  const reportChangeBlock = asyncSourceBlock('handleReportFormChange');

  assert.match(appSource, /async function ensureRecentClientSessionsLoaded/);
  assert.match(appSource, /async function ensureReportSessionsLoaded/);
  assert.match(ensureBlock, /if \(view === "report"\) \{\s*await ensureReportSessionsLoaded\(clientId, \{ force \}\);/s);
  assert.match(ensureBlock, /if \(view === "session"\) \{\s*await ensureRecentClientSessionsLoaded\(clientId, \{ force \}\);/s);
  assert.match(reportChangeBlock, /event\?\.target\?\.name === "startDate" \|\| event\?\.target\?\.name === "endDate"/);
  assert.match(reportChangeBlock, /await ensureReportSessionsLoaded\(state\.activeClientId, \{ force: true \}\);/);
});

test('report assessment attachments are metadata-first and load binaries only on expand or export', () => {
  const previewBlock = sourceBlock('reportFilePreview');
  const prepBlock = asyncSourceBlock('prepareFunderReportForExport');

  assert.match(previewBlock, /data-report-attachment-preview/);
  assert.match(previewBlock, /data-report-attachment-src/);
  assert.doesNotMatch(previewBlock, /<img src="\$\{escapeHtml\(document\.url\)\}"/);
  assert.match(appSource, /reportPreview\?\.addEventListener\("toggle", handleReportPreviewToggle, true\);/);
  assert.match(prepBlock, /loadDeferredReportAttachmentImages\(reportDocument, \{ forceAll: true \}\)/);
});

test('funder report graphs are lazy-rendered for screen view and force-rendered for export', () => {
  const markupBlock = sourceBlock('buildFunderReportPreviewMarkup');
  const drawBlock = sourceBlock('drawFunderReportCharts');
  const prepBlock = asyncSourceBlock('prepareFunderReportForExport');

  assert.match(markupBlock, /data-report-lazy-chart="behavior-overview"/);
  assert.match(markupBlock, /data-report-lazy-chart="skills"/);
  assert.match(markupBlock, /data-report-lazy-chart="parent-training"/);
  assert.match(drawBlock, /new IntersectionObserver/);
  assert.match(drawBlock, /renderReportChartSection\(container, sessions, spec\.kind\)/);
  assert.match(prepBlock, /drawFunderReportCharts\(filteredReportSessions\(\)\.slice\(\)\.reverse\(\), \{ force: true \}\)/);
});

test('SOAP history uses paged session loading instead of full client history', () => {
  const ensureBlock = asyncSourceBlock('ensureSessionDataForView');
  const soapBlock = asyncSourceBlock('ensureSoapSessionsLoaded');
  const historyBlock = sourceBlock('renderHistory');

  assert.match(appSource, /const SOAP_SESSION_PAGE_SIZE = 40/);
  assert.match(ensureBlock, /if \(view === "soap"\) \{\s*await ensureSoapSessionsLoaded\(clientId, \{ force \}\);/s);
  assert.match(soapBlock, /limit: SOAP_SESSION_PAGE_SIZE/);
  assert.match(soapBlock, /sort: "desc"/);
  assert.match(historyBlock, /data-soap-history-show-more/);
  assert.match(appSource, /async function loadMoreSoapSessions/);
});

test('historical import preview uses lightweight duplicate metadata instead of full sessions', () => {
  const previewBlock = asyncSourceBlock('handlePreviewHistoricalImport');
  const commitBlock = asyncSourceBlock('handleCommitHistoricalImport');
  const switchBlock = asyncSourceBlock('switchView');

  assert.match(apiSource, /getHistoricalImportDuplicateMetadata/);
  assert.match(serverSource, /historical-import-duplicates/);
  assert.match(previewBlock, /await refreshHistoricalImportDuplicateMetadata\(\)/);
  assert.match(previewBlock, /sessions: state\.historicalImportDuplicateSessions/);
  assert.match(commitBlock, /sessions: state\.historicalImportDuplicateSessions/);
  assert.match(switchBlock, /refreshHistoricalImportDuplicateMetadata\(\)/);
});

test('Data Health renders issues in a window while exports still include all issues', () => {
  const runBlock = sourceBlock('runDataHealthCheck');
  const renderBlock = sourceBlock('renderDataHealth');
  const exportBlock = sourceBlock('exportHealthReport');

  assert.match(runBlock, /state\.healthVisibleLimit = 100/);
  assert.match(renderBlock, /const visibleIssues = issues\.slice\(0, visibleLimit\)/);
  assert.match(renderBlock, /data-health-show-more/);
  assert.match(appSource, /function handleDataHealthClick/);
  assert.match(exportBlock, /const issues = state\.healthIssues\.length \? state\.healthIssues : buildDataHealthIssues\(\)/);
});
