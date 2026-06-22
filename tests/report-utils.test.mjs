import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildCompactGraphAnalysisSentence, buildFunderDraftRecord, draftContainsLargeArtifacts, estimateJsonBytes, hasMeaningfulFunderReportDraft, parseNumberedObjectives, sanitizeAssessmentDocumentRefs, sanitizeCustomPhaseLines, sanitizeTrendVisibilityMap } from "../public/report-utils.js";

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
    assessmentDocuments: {
      assessmentGrid: [{
        fileId: "doc-1",
        originalFileName: "assessment.pdf",
        uploadedAt: "2026-06-20T12:00:00.000Z",
        fileSize: 4096,
        contentType: "application/pdf",
        storagePath: "uploads/client-ava/fba-assessment/doc-1.pdf",
        clientId: "client-ava",
        documentType: "fba-assessment"
      }]
    },
    customPhaseLines: {
      "skill:program-1": [{
        id: "phase-1",
        date: "2026-05-21",
        label: "Medication change",
        lineStyle: "solid",
        note: "Morning dose adjusted"
      }]
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
  assert.equal(draft.assessmentDocuments.assessmentGrid[0].fileId, "doc-1");
  assert.equal(draft.assessmentDocuments.assessmentGrid[0].contentType, "application/pdf");
  assert.equal(draft.customPhaseLines["skill:program-1"][0].phaseType, "environmentalChange");
  assert.equal(draft.customPhaseLines["skill:program-1"][0].lineStyle, "solid");
  assert.equal(draftContainsLargeArtifacts(draft), false);
});

test("assessment document refs stay lightweight and exclude base64 payloads", () => {
  const refs = sanitizeAssessmentDocumentRefs({
    assessmentGrid: [{
      id: "doc-7",
      fileName: "assessment-grid.pdf",
      createdAt: "2026-06-22T10:00:00.000Z",
      fileSize: "8192",
      mimeType: "application/pdf",
      relativePath: "uploads/client-ava/fba-assessment/doc-7.pdf",
      dataUrl: "data:application/pdf;base64,AAAA"
    }]
  });

  assert.deepEqual(refs.assessmentGrid[0], {
    fileId: "doc-7",
    originalFileName: "assessment-grid.pdf",
    uploadedAt: "2026-06-22T10:00:00.000Z",
    fileSize: 8192,
    contentType: "application/pdf",
    storagePath: "uploads/client-ava/fba-assessment/doc-7.pdf",
    objectKey: "",
    clientId: "",
    documentType: ""
  });
  assert.equal(JSON.stringify(refs).includes("base64"), false);
});

test("custom environmental phase lines are normalized with stable style and type", () => {
  const lines = sanitizeCustomPhaseLines({
    "behavior:aggression": [{
      date: "2026-05-21",
      label: "New RBT",
      lineStyle: "solid",
      note: "Coverage switch"
    }]
  });

  assert.deepEqual(lines["behavior:aggression"][0], {
    id: "behavior:aggression:2026-05-21:new rbt",
    date: "2026-05-21",
    label: "New RBT",
    lineStyle: "solid",
    note: "Coverage switch",
    phaseType: "environmentalChange"
  });
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

test("numbered discharge objectives parse into separate list items by domain field", () => {
  const communication = parseNumberedObjectives(`1. Will engage in simple reciprocal comments that involve internal states regarding a joint object or activity. 2. Will initiate appropriate social commentary regarding special events or personal information. 3. Will tolerate answering questions within a conversational context for 3-4 exchanges without engaging in problem behavior.`);

  assert.deepEqual(communication, [
    "Will engage in simple reciprocal comments that involve internal states regarding a joint object or activity.",
    "Will initiate appropriate social commentary regarding special events or personal information.",
    "Will tolerate answering questions within a conversational context for 3-4 exchanges without engaging in problem behavior."
  ]);
});

test("objective parsing preserves quotes and punctuation without concatenating numbered items", () => {
  const objectives = parseNumberedObjectives(`1. Will tolerate a FIRST/THEN contingency and respond to the cue "wait." 2. Will answer questions about "special events," personal information, and preferred activities.`);

  assert.deepEqual(objectives, [
    'Will tolerate a FIRST/THEN contingency and respond to the cue "wait."',
    'Will answer questions about "special events," personal information, and preferred activities.'
  ]);
});

test("non-numbered discharge text stays as a single objective item instead of being broken apart", () => {
  const objectives = parseNumberedObjectives("Will independently transition to classroom routines without engaging in problem behavior.");
  assert.deepEqual(objectives, ["Will independently transition to classroom routines without engaging in problem behavior."]);
});

test("report workflow source wires draft save, preview rendering, and compact analysis placement", () => {
  const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const cssSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

  assert.match(appSource, /saveFunderReportButton\?\s*\.addEventListener\("click", handleSaveFunderReportDraft\)/);
  assert.match(appSource, /resumeFunderReportButton\?\s*\.addEventListener\("click", resumeSavedFunderReportDraft\)/);
  assert.match(appSource, /function handleSaveFunderReportDraft\(/);
  assert.match(appSource, /function resumeSavedFunderReportDraft\(/);
  assert.match(appSource, /reportAssessmentDocuments/);
  assert.match(appSource, /reportCustomPhaseLines/);
  assert.match(appSource, /renderReportAssessmentDraftFiles/);
  assert.match(appSource, /handleReportAssessmentUpload/);
  assert.match(appSource, /data-remove-report-attachment/);
  assert.match(appSource, /renderCustomPhaseLineManager/);
  assert.match(appSource, /data-phase-line-form=/);
  assert.match(appSource, /phaseType:\s*"environmentalChange"/);
  assert.match(appSource, /Draft saved/);
  assert.match(appSource, /Saved report draft restored/);
  assert.match(appSource, /function renderFunderReportPreview\(/);
  assert.match(appSource, /if \(view === "report"\) renderFunderReportPreview\(\)/);
  assert.match(appSource, /renderReportGraphAnalysisMarkup/);
  assert.match(appSource, /parseNumberedObjectives/);
  assert.match(appSource, /discharge-objective-list/);
  assert.match(appSource, /Maladaptive Behaviors/);
  assert.match(appSource, /dischargeMaladaptiveBehaviors/);
  assert.match(appSource, /report-graph-analysis-line/);
  assert.match(appSource, /estimateJsonBytes/);
  assert.match(appSource, /window\.scrollTo\(\{ top: Math\.max\(window\.scrollY \+ delta, 0\), behavior: "auto" \}\)/);
  assert.match(htmlSource, /id="resume-funder-report"/);
  assert.match(htmlSource, />Export PDF</);
  assert.match(htmlSource, /name="dischargeMaladaptiveBehaviors"/);
  assert.match(htmlSource, /id="assessment-grid-draft-files"/);
  assert.match(htmlSource, /accept="application\/pdf,image\/\*"/);
  assert.match(cssSource, /\.discharge-objective-list/);
  assert.match(cssSource, /\.discharge-objective-group h4/);
  assert.match(cssSource, /\.report-upload-draft-item/);
  assert.match(cssSource, /\.graph-phase-line-panel/);
  assert.match(serverSource, /metadata:\s*\{/);
  assert.match(serverSource, /includedContent:\s*\{/);
  assert.match(serverSource, /graphPreferences:/);
  assert.match(serverSource, /assessmentDocuments/);
  assert.match(serverSource, /customPhaseLines/);
  assert.match(serverSource, /contentType:/);
  assert.match(serverSource, /fileSize:/);
  assert.doesNotMatch(serverSource, /pdfData|base64Pdf|renderedHtml|reportSnapshot/i);
  assert.match(serverSource, /parentTrainingSummary: textField\("parentTrainingSummary"\)/);
  assert.match(serverSource, /parentTrainingRecommendations: textField\("parentTrainingRecommendations"\)/);
  assert.match(serverSource, /dischargeMaladaptiveBehaviors: textField\("dischargeMaladaptiveBehaviors"\)/);
});
