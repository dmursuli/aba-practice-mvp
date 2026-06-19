import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildCompactGraphAnalysisSentence, buildFunderDraftRecord, draftContainsLargeArtifacts, estimateJsonBytes, hasMeaningfulFunderReportDraft, sanitizeTrendVisibilityMap } from "../public/report-utils.js";

test("compact graph analysis sentence keeps report analysis concise and readable", () => {
  const sentence = buildCompactGraphAnalysisSentence({
    baselineLevel: 20,
    treatmentLevel: 65,
    difference: 45,
    percentChange: "225%",
    trendDirection: "ascending",
    interpretation: "Improving with limited data."
  }, "skill");

  assert.match(sentence, /^Baseline: 20%\. Treatment: 65%\. Change: 45% \(225%\)\. Trend: ascending\./);
  assert.match(sentence, /Improving with limited data\./);
});

test("funder report draft detection ignores empty payloads and recognizes saved content", () => {
  assert.equal(hasMeaningfulFunderReportDraft({ progressSummary: "", fadePlanRows: [], serviceHours: [] }), false);
  assert.equal(hasMeaningfulFunderReportDraft({ progressSummary: "Editable summary", fadePlanRows: [], serviceHours: [] }), true);
  assert.equal(hasMeaningfulFunderReportDraft({ progressSummary: "", fadePlanRows: [{ phase: "1" }], serviceHours: [] }), true);
});

test("structured funder draft record stores editable sections and settings but no rendered PDF artifacts", () => {
  const draft = buildFunderDraftRecord({
    clientId: "client-ava",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    sections: {
      progressSummary: "Editable summary",
      parentTrainingSummary: "Coaching progress"
    },
    fadePlanRows: [{ phase: "1", actionStep: "Fade supervision" }],
    serviceHours: [{ serviceCode: "97153", hours: "20" }],
    graphPreferences: { "skill:program-1": true, "behavior:overview": false },
    includedContent: {
      programIds: ["program-1"],
      targetIds: ["target-1", "target-2"],
      behaviorIds: ["behavior-1"],
      parentTrainingGoalIds: ["goal-1"]
    },
    displaySettings: { compactGraphAnalysis: true },
    now: "2026-06-19T12:00:00.000Z"
  });

  assert.equal(draft.metadata.clientId, "client-ava");
  assert.equal(draft.metadata.draftStatus, "draft");
  assert.equal(draft.metadata.lastSavedAt, "2026-06-19T12:00:00.000Z");
  assert.equal(draft.progressSummary, "Editable summary");
  assert.deepEqual(draft.settings.graphPreferences, { "behavior:overview": false, "skill:program-1": true });
  assert.equal(draft.settings.displaySettings.compactGraphAnalysis, true);
  assert.equal(draftContainsLargeArtifacts(draft), false);
});

test("draft payload stays lightweight compared with rendered report artifacts", () => {
  const draft = buildFunderDraftRecord({
    clientId: "client-ava",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    sections: {
      background: "Short clinical background",
      progressSummary: "Concise editable summary"
    },
    graphPreferences: { "skill:program-1": true }
  });

  assert.ok(estimateJsonBytes(draft) < 16 * 1024);
});

test("trend visibility preferences are filtered to allowed report graph keys", () => {
  const filtered = sanitizeTrendVisibilityMap({
    "skill:program-1": true,
    "skill:program-2": false,
    "random:key": true
  }, ["skill:program-1", "skill:program-2"]);

  assert.deepEqual(filtered, {
    "skill:program-1": true,
    "skill:program-2": false
  });
});

test("report workflow source wires draft save, preview rendering, and compact analysis placement", () => {
  const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

  assert.match(appSource, /saveFunderReportButton\?\s*\.addEventListener\("click", handleSaveFunderReportDraft\)/);
  assert.match(appSource, /resumeFunderReportButton\?\s*\.addEventListener\("click", resumeSavedFunderReportDraft\)/);
  assert.match(appSource, /function handleSaveFunderReportDraft\(/);
  assert.match(appSource, /function resumeSavedFunderReportDraft\(/);
  assert.match(appSource, /Draft saved/);
  assert.match(appSource, /Saved report draft restored/);
  assert.match(appSource, /function renderFunderReportPreview\(/);
  assert.match(appSource, /if \(view === "report"\) renderFunderReportPreview\(\)/);
  assert.match(appSource, /renderReportGraphAnalysisMarkup/);
  assert.match(appSource, /report-graph-analysis-line/);
  assert.match(appSource, /estimateJsonBytes/);
  assert.match(appSource, /window\.scrollTo\(\{ top: Math\.max\(window\.scrollY \+ delta, 0\), behavior: "auto" \}\)/);
  assert.match(htmlSource, /id="resume-funder-report"/);
  assert.match(htmlSource, />Export PDF</);
  assert.match(serverSource, /metadata:\s*\{/);
  assert.match(serverSource, /includedContent:\s*\{/);
  assert.match(serverSource, /graphPreferences:/);
  assert.doesNotMatch(serverSource, /pdfData|base64Pdf|renderedHtml|reportSnapshot/i);
  assert.match(serverSource, /parentTrainingSummary: textField\("parentTrainingSummary"\)/);
  assert.match(serverSource, /parentTrainingRecommendations: textField\("parentTrainingRecommendations"\)/);
});
