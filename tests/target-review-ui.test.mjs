import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");

function sourceBlock(functionName, asyncFunction = false) {
  const prefix = asyncFunction ? `async function ${functionName}` : `function ${functionName}`;
  const start = appSource.indexOf(prefix);
  if (start === -1) return "";
  const candidates = [
    appSource.indexOf("\nfunction ", start + 1),
    appSource.indexOf("\nasync function ", start + 1)
  ].filter((index) => index > -1);
  return appSource.slice(start, candidates.length ? Math.min(...candidates) : appSource.length);
}

test("Treatment Planning uses compact target reviews and remains excluded from full session hydration", () => {
  const needsSessions = sourceBlock("viewNeedsClientSessions");
  const switchView = sourceBlock("switchView", true);
  const loader = sourceBlock("ensureTargetReviewsLoaded", true);

  assert.doesNotMatch(needsSessions, /"plan"/);
  assert.match(switchView, /if \(view === "plan"\) \{[\s\S]*ensureTargetReviewsLoaded\(state\.activeClientId, \{ force: true \}\)/);
  assert.match(loader, /await getClientTargetReviews\(clientId\)/);
  assert.doesNotMatch(loader, /getClientSessions|ensureClientSessionsLoaded|state\.sessions/);
  assert.match(apiSource, /fetchWithTimeout\(`\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/target-reviews`, timeoutMs\)/);
});

test("target-review loading protects client boundaries and rerenders only Treatment Planning", () => {
  const loader = sourceBlock("ensureTargetReviewsLoaded", true);

  assert.match(loader, /targetReviewCacheEntry\(clientId\)\?\.requestId !== requestId/);
  assert.match(loader, /snapshot\.clientId !== clientId/);
  assert.match(loader, /currentView\(\) === "plan" && state\.activeClientId === clientId/);
  assert.match(loader, /renderPlanReview\(\)/);
  assert.doesNotMatch(loader, /render\(\)|renderCharts\(|renderSummary\(|renderHistory\(/);
});

test("counts, filtering, colors, and hints consume the same cached classification snapshot", () => {
  const classifier = sourceBlock("masteryReviewForTarget");
  const counts = sourceBlock("masteryReviewCounts");
  const filter = sourceBlock("targetMatchesPlanReviewFilter");
  const color = sourceBlock("masteryReviewClass");
  const hint = sourceBlock("renderMasteryReviewHint");

  assert.match(classifier, /targetReviewCacheEntry\(\)\?\.snapshot/);
  assert.match(classifier, /review\?\.classification \|\| "none"/);
  assert.match(counts, /targetReviewCacheEntry\(\)\?\.snapshot\?\.counts/);
  assert.match(filter, /masteryReviewForTarget\(program\.id, target\.id\)\.state/);
  assert.match(color, /masteryReviewForTarget\(program\.id, target\.id\)/);
  assert.match(hint, /masteryReviewForTarget\(program\.id, target\.id\)/);
});

test("target-review badges hide final counts while loading and preserve toggle-off behavior", () => {
  const renderer = sourceBlock("renderPlanReview");
  const jump = sourceBlock("jumpToReviewState");

  assert.match(renderer, /targetReviewsReady \? masteryCounts\.close : "…"/);
  assert.match(renderer, /targetReviewsReady \? "" : "disabled"/);
  assert.match(jump, /state\.activePlanReviewFilter = state\.activePlanReviewFilter === stateValue \? "" : stateValue/);
});
