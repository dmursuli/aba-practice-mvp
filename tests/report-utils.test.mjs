import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildCompactGraphAnalysisSentence, hasMeaningfulFunderReportDraft } from "../public/report-utils.js";

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

test("report workflow source wires draft save, preview rendering, and compact analysis placement", () => {
  const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

  assert.match(appSource, /saveFunderReportButton\?\s*\.addEventListener\("click", handleSaveFunderReportDraft\)/);
  assert.match(appSource, /function handleSaveFunderReportDraft\(/);
  assert.match(appSource, /Draft saved/);
  assert.match(appSource, /Saved report draft restored/);
  assert.match(appSource, /function renderFunderReportPreview\(/);
  assert.match(appSource, /if \(view === "report"\) renderFunderReportPreview\(\)/);
  assert.match(appSource, /renderReportGraphAnalysisMarkup/);
  assert.match(appSource, /report-graph-analysis-line/);
  assert.match(appSource, /window\.scrollTo\(\{ top: Math\.max\(window\.scrollY \+ delta, 0\), behavior: "auto" \}\)/);
  assert.match(serverSource, /parentTrainingSummary: textField\("parentTrainingSummary"\)/);
  assert.match(serverSource, /parentTrainingRecommendations: textField\("parentTrainingRecommendations"\)/);
});
