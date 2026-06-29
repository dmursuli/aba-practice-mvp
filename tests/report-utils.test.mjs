import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildCompactGraphAnalysisSentence, buildEditableSkillAcquisitionSummary, buildFunderDraftRecord, draftContainsLargeArtifacts, estimateJsonBytes, hasMeaningfulFunderReportDraft, isLegacyGeneratedSkillAcquisitionSummary, parseNumberedObjectives, sanitizeAssessmentDocumentRefs, sanitizeCustomPhaseLines, sanitizeTrendVisibilityMap, skillAcquisitionGoalIdentity, skillAcquisitionTargetIdentity, summarizeSkillAcquisitionReport } from "../public/report-utils.js";

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
    generatedSectionAutofill: {
      skillAcquisitionSummary: "Status Summary:\n- Goals mastered during authorization period: 2"
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
  assert.deepEqual(draft.metadata.generatedSectionAutofill, {
    skillAcquisitionSummary: "Status Summary:\n- Goals mastered during authorization period: 2"
  });
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

test("skill acquisition summary groups targets by status and deduplicates mastered goals by program id", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Functional Communication: Manding",
        domain: "Communication",
        objective: "Will request help independently.",
        status: "mastered",
        targets: [
          { id: "target-1", name: "Request help", status: "mastered" },
          { id: "target-1", name: "Request help", status: "mastered" }
        ]
      },
      {
        id: "program-2",
        name: "Reciprocal play",
        domain: "Socialization",
        objective: "Will engage in shared play.",
        status: "active",
        targets: [
          { id: "target-2", name: "Take turns", status: "active" },
          { id: "target-3", name: "Share toys", status: "paused" }
        ]
      }
    ],
    planChangeLog: [
      { type: "program-status-changed", programId: "program-1", programName: "Functional Communication: Manding", domain: "Communication", objective: "Will request help independently.", toStatus: "mastered", date: "2026-06-10" },
      { type: "program-status-changed", programId: "program-1", programName: "Functional Communication: Manding", domain: "Communication", objective: "Will request help independently.", toStatus: "mastered", date: "2026-06-10" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredGoalsDuringPeriod.length, 1);
  assert.equal(model.masteredGoalsDuringPeriod[0].programId, "program-1");
  assert.equal(model.totals.masteredGoals, model.masteredGoalsDuringPeriod.length);
  assert.deepEqual(model.debug.deduplicatedMasteredGoalIds, ["program-1"]);
  assert.deepEqual(model.masteredTargets.map((item) => item.targetId), ["target-1"]);
  assert.deepEqual(model.onHoldTargets.map((item) => item.targetId), ["target-3"]);
  assert.deepEqual(model.activeTargets.map((item) => item.targetId), ["target-2"]);
  assert.deepEqual(model.totals, {
    masteredGoals: 1,
    masteredTargets: 1,
    onHoldTargets: 1,
    activeTargets: 1,
    totalTargets: 3
  });
});

test("skill acquisition summary falls back to current mastered program status when change dates are unavailable", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-legacy",
        name: "Answer wh- questions",
        domain: "Communication",
        objective: "Will answer simple wh- questions.",
        status: "mastered",
        targets: [{ id: "target-legacy", name: "Answer who questions", status: "mastered" }]
      }
    ],
    planChangeLog: [],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredGoalsDuringPeriod.length, 1);
  assert.equal(model.masteredGoalsDuringPeriod[0].assumption, "current-status-fallback");
});

test("multiple mastered targets within the same goal count as one mastered goal when using target-mastery fallback", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Functional Communication: Manding",
        domain: "Communication",
        objective: "Will request help independently.",
        status: "active",
        targets: [
          { id: "target-1", name: "Request help", status: "mastered" },
          { id: "target-2", name: "Request break", status: "mastered" }
        ]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Functional Communication: Manding", domain: "Communication", targetId: "target-1", targetName: "Request help", toStatus: "mastered", date: "2026-06-10" },
      { type: "target-status-changed", programId: "program-1", programName: "Functional Communication: Manding", domain: "Communication", targetId: "target-2", targetName: "Request break", toStatus: "mastered", date: "2026-06-12" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredTargets.length, 2);
  assert.equal(model.masteredGoalsDuringPeriod.length, 1);
  assert.equal(model.masteredGoalsDuringPeriod[0].programId, "program-1");
  assert.equal(model.masteredGoalsDuringPeriod[0].assumption, "target-mastery-fallback");
  assert.equal(model.totals.masteredGoals, model.masteredGoalsDuringPeriod.length);
});

test("multiple goals with mastered targets count as multiple mastered goals", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Communication",
        objective: "Goal one objective",
        status: "active",
        targets: [{ id: "target-1", name: "Target one", status: "mastered" }]
      },
      {
        id: "program-2",
        name: "Goal Two",
        domain: "Socialization",
        objective: "Goal two objective",
        status: "active",
        targets: [{ id: "target-2", name: "Target two", status: "mastered" }]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-1", targetName: "Target one", toStatus: "mastered", date: "2026-06-10" },
      { type: "target-status-changed", programId: "program-2", programName: "Goal Two", domain: "Socialization", targetId: "target-2", targetName: "Target two", toStatus: "mastered", date: "2026-06-11" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredGoalsDuringPeriod.length, 2);
  assert.deepEqual(model.masteredGoalsDuringPeriod.map((goal) => goal.programId), ["program-1", "program-2"]);
  assert.equal(model.totals.masteredGoals, model.masteredGoalsDuringPeriod.length);
});

test("domain breakdown renders per skill acquisition domain with deduplicated goal and target counts", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Communication",
        objective: "Goal one objective",
        status: "active",
        targets: [
          { id: "target-1", name: "Target one", status: "mastered" },
          { id: "target-1", name: "Target one", status: "mastered" },
          { id: "target-2", name: "Target two", status: "active" }
        ]
      },
      {
        id: "program-2",
        name: "Goal Two",
        domain: "Communication",
        objective: "Goal two objective",
        status: "paused",
        targets: [{ id: "target-3", name: "Target three", status: "paused" }]
      },
      {
        id: "program-3",
        name: "Goal Three",
        domain: "Socialization",
        objective: "Goal three objective",
        status: "active",
        targets: [{ id: "target-4", name: "Target four", status: "mastered" }]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-1", targetName: "Target one", toStatus: "mastered", date: "2026-06-10" },
      { type: "target-status-changed", programId: "program-3", programName: "Goal Three", domain: "Socialization", targetId: "target-4", targetName: "Target four", toStatus: "mastered", date: "2026-06-11" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.deepEqual(model.domainBreakdown, [
    {
      domain: "Communication",
      activeGoals: 1,
      masteredGoals: 1,
      onHoldGoals: 1,
      percentGoalsMastered: "33%",
      activeTargets: 1,
      masteredTargets: 1,
      onHoldTargets: 1,
      percentTargetsMastered: "33%"
    },
    {
      domain: "Socialization",
      activeGoals: 1,
      masteredGoals: 1,
      onHoldGoals: 0,
      percentGoalsMastered: "50%",
      activeTargets: 0,
      masteredTargets: 1,
      onHoldTargets: 0,
      percentTargetsMastered: "100%"
    }
  ]);
});

test("active and on-hold targets do not count as mastered goals in fallback mode", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Communication",
        objective: "Goal one objective",
        status: "active",
        targets: [
          { id: "target-1", name: "Target one", status: "active" },
          { id: "target-2", name: "Target two", status: "paused" }
        ]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-1", targetName: "Target one", toStatus: "mastered", date: "2026-06-10" },
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-2", targetName: "Target two", toStatus: "mastered", date: "2026-06-11" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredTargets.length, 0);
  assert.equal(model.masteredGoalsDuringPeriod.length, 0);
});

test("authorization period filtering applies to mastered goal fallback and target counts", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Communication",
        objective: "Goal one objective",
        status: "mastered",
        targets: [{ id: "target-1", name: "Target one", status: "mastered" }]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-1", targetName: "Target one", toStatus: "mastered", date: "2026-05-01" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.equal(model.masteredTargets.length, 1);
  assert.equal(model.masteredGoalsDuringPeriod.length, 0);
  assert.equal(model.masteredTargetsDuringPeriod.length, 0);
});

test("domain breakdown shows zero mastered percentages when no mastered goals or targets exist", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Daily Living Skills",
        objective: "Goal one objective",
        status: "active",
        targets: [{ id: "target-1", name: "Target one", status: "active" }]
      }
    ],
    planChangeLog: [],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });

  assert.deepEqual(model.domainBreakdown, [
    {
      domain: "Daily Living Skills",
      activeGoals: 1,
      masteredGoals: 0,
      onHoldGoals: 0,
      percentGoalsMastered: "0%",
      activeTargets: 1,
      masteredTargets: 0,
      onHoldTargets: 0,
      percentTargetsMastered: "0%"
    }
  ]);
});

test("editable skill acquisition summary keeps mastered goal count aligned with list length", () => {
  const model = summarizeSkillAcquisitionReport({
    programs: [
      {
        id: "program-1",
        name: "Goal One",
        domain: "Communication",
        objective: "Goal one objective",
        status: "active",
        targets: [{ id: "target-1", name: "Target one", status: "mastered" }]
      },
      {
        id: "program-2",
        name: "Goal Two",
        domain: "Socialization",
        objective: "Goal two objective",
        status: "active",
        targets: [{ id: "target-2", name: "Target two", status: "mastered" }]
      }
    ],
    planChangeLog: [
      { type: "target-status-changed", programId: "program-1", programName: "Goal One", domain: "Communication", targetId: "target-1", targetName: "Target one", toStatus: "mastered", date: "2026-06-10" },
      { type: "target-status-changed", programId: "program-2", programName: "Goal Two", domain: "Socialization", targetId: "target-2", targetName: "Target two", toStatus: "mastered", date: "2026-06-11" }
    ],
    startDate: "2026-06-01",
    endDate: "2026-06-30"
  });
  const text = buildEditableSkillAcquisitionSummary(model);
  const listedGoals = (text.match(/^- (Communication|Socialization): /gm) || []).length;

  assert.equal(model.totals.masteredGoals, 2);
  assert.equal(model.masteredGoalsDuringPeriod.length, 2);
  assert.equal(listedGoals, 2);
  assert.match(text, /- Goals mastered during authorization period: 2/);
  assert.match(text, /- Mastered skill acquisition targets: 2/);
});

test("editable skill acquisition summary shows mastered goals, grouped targets, and clean empty states", () => {
  const text = buildEditableSkillAcquisitionSummary({
    totals: {
      masteredGoals: 1,
      masteredTargets: 1,
      onHoldTargets: 0,
      activeTargets: 1,
      totalTargets: 2
    },
    masteredGoalsDuringPeriod: [
      { programId: "program-1", domain: "Communication", objective: "Will request help independently." }
    ],
    masteredTargets: [
      { targetId: "target-1", programName: "Functional Communication: Manding", domain: "Communication", targetName: "Request help" }
    ],
    onHoldTargets: [],
    activeTargets: [
      { targetId: "target-2", programName: "Reciprocal play", domain: "Socialization", targetName: "Take turns" }
    ],
    domainBreakdown: [
      {
        domain: "Communication",
        activeGoals: 0,
        masteredGoals: 1,
        onHoldGoals: 0,
        percentGoalsMastered: "100%",
        activeTargets: 0,
        masteredTargets: 1,
        onHoldTargets: 0,
        percentTargetsMastered: "100%"
      },
      {
        domain: "Socialization",
        activeGoals: 1,
        masteredGoals: 0,
        onHoldGoals: 0,
        percentGoalsMastered: "0%",
        activeTargets: 1,
        masteredTargets: 0,
        onHoldTargets: 0,
        percentTargetsMastered: "0%"
      }
    ]
  });

  assert.match(text, /Status Summary:/);
  assert.match(text, /- Goals mastered during authorization period: 1/);
  assert.match(text, /- Mastered skill acquisition targets: 1/);
  assert.match(text, /- Active skill acquisition targets: 1/);
  assert.match(text, /- Skill acquisition targets on hold: 0/);
  assert.match(text, /- Total skill acquisition targets reviewed: 2/);
  assert.match(text, /Domain Breakdown:/);
  assert.match(text, /\| Domain \| Active Goals \| Mastered Goals \| On-Hold Goals \| % Goals Mastered \| Active Targets \| Mastered Targets \| On-Hold Targets \| % Targets Mastered \|/);
  assert.match(text, /\| Communication \| 0 \| 1 \| 0 \| 100% \| 0 \| 1 \| 0 \| 100% \|/);
  assert.match(text, /\| Socialization \| 1 \| 0 \| 0 \| 0% \| 1 \| 0 \| 0 \| 0% \|/);
  assert.match(text, /Goals Mastered During Authorization Period:/);
  assert.match(text, /- Communication: Will request help independently\./);
  assert.match(text, /Mastered Skill Acquisition Targets:/);
  assert.match(text, /- Functional Communication: Manding \/ Communication: Request help/);
  assert.match(text, /On Hold Skill Acquisition Targets:/);
  assert.match(text, /No skill acquisition targets are currently on hold\./);
  assert.doesNotMatch(text, /Active Skill Acquisition Targets:/);
  assert.doesNotMatch(text, /Reciprocal play \/ Socialization: Take turns/);
  assert.match(text, /Narrative summary:/);
});

test("skill acquisition status summary shows zero counts when categories are empty", () => {
  const text = buildEditableSkillAcquisitionSummary({
    masteredGoalsDuringPeriod: [],
    masteredTargets: [],
    onHoldTargets: [],
    activeTargets: []
  });

  assert.match(text, /- Goals mastered during authorization period: 0/);
  assert.match(text, /- Mastered skill acquisition targets: 0/);
  assert.match(text, /- Active skill acquisition targets: 0/);
  assert.match(text, /- Skill acquisition targets on hold: 0/);
  assert.match(text, /- Total skill acquisition targets reviewed: 0/);
});

test("skill acquisition identities prefer stable ids before normalized text", () => {
  assert.equal(skillAcquisitionGoalIdentity({ programId: "program-1", programName: "A", objective: "B" }), "program-1");
  assert.equal(skillAcquisitionTargetIdentity({ targetId: "target-1", targetName: "T" }), "target-1");
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

test("legacy generated skill acquisition summaries are detected for backward-compatible refresh", () => {
  assert.equal(isLegacyGeneratedSkillAcquisitionSummary(`Status Summary:
- Goals mastered during authorization period: 8
- Mastered skill acquisition targets: 25
- Active skill acquisition targets: 10
- Skill acquisition targets on hold: 4
- Total skill acquisition targets reviewed: 39

Goals Mastered During Authorization Period:
- Communication: Goal one

Mastered Skill Acquisition Targets:
- Goal one / Target one

On Hold Skill Acquisition Targets:
No skill acquisition targets are currently on hold.

Narrative summary:
During this authorization period, the client mastered 8 skill acquisition goals.`), true);
  assert.equal(isLegacyGeneratedSkillAcquisitionSummary("Custom manually written note"), false);
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
  assert.match(appSource, /generatedSectionAutofill/);
  assert.match(appSource, /isLegacyGeneratedSkillAcquisitionSummary/);
  assert.match(appSource, /isLegacyGeneratedParentTrainingSummary/);
  assert.match(appSource, /report-breakdown-table/);
  assert.match(appSource, /reportAssessmentDocumentRefsFromClient/);
  assert.match(appSource, /safeReportFilePreview\("assessmentGrid", "Assessment grid"\)/);
  assert.match(appSource, /safeReportFilePreview\("standardizedAssessmentGrid", "Standardized assessment grid"\)/);
  assert.match(appSource, /function assessmentDocumentCanRenderInline\(/);
  assert.match(appSource, /<figure class="report-upload-preview">/);
  assert.match(appSource, /<img src="\$\{escapeHtml\(document\.url\)\}" alt="\$\{fileName\}">/);
  assert.match(appSource, /One uploaded assessment document could not be loaded\./);
  assert.match(appSource, /data-remove-report-attachment/);
  assert.match(appSource, /renderCustomPhaseLineManager/);
  assert.match(appSource, /data-phase-line-form=/);
  assert.match(appSource, /phaseType:\s*"environmentalChange"/);
  assert.match(appSource, /syncSkillAcquisitionSummaryField/);
  assert.match(appSource, /skillAcquisitionSummary/);
  assert.match(appSource, /Skill Acquisition Goal and Target Summary/);
  assert.doesNotMatch(appSource, /<h4>Active Skill Acquisition Targets<\/h4>/);
  assert.match(appSource, /Draft saved/);
  assert.match(appSource, /Saved report draft restored/);
  assert.match(appSource, /function renderFunderReportPreview\(/);
  assert.match(appSource, /Funder report preview render failed/);
  assert.match(appSource, /Funder report chart render failed/);
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
  assert.match(htmlSource, /name="skillAcquisitionSummary"/);
  assert.match(cssSource, /\.discharge-objective-list/);
  assert.match(cssSource, /\.discharge-objective-group h4/);
  assert.match(cssSource, /\.report-upload-draft-item/);
  assert.match(cssSource, /\.report-breakdown-table/);
  assert.match(cssSource, /\.graph-phase-line-panel/);
  assert.match(serverSource, /metadata:\s*\{/);
  assert.match(serverSource, /includedContent:\s*\{/);
  assert.match(serverSource, /graphPreferences:/);
  assert.match(serverSource, /assessmentDocuments/);
  assert.match(serverSource, /customPhaseLines/);
  assert.match(serverSource, /contentType:/);
  assert.match(serverSource, /fileSize:/);
  assert.match(serverSource, /skillAcquisitionSummary: textField\("skillAcquisitionSummary"\)/);
  assert.doesNotMatch(serverSource, /pdfData|base64Pdf|renderedHtml|reportSnapshot/i);
  assert.match(serverSource, /parentTrainingSummary: textField\("parentTrainingSummary"\)/);
  assert.match(serverSource, /parentTrainingRecommendations: textField\("parentTrainingRecommendations"\)/);
  assert.match(serverSource, /dischargeMaladaptiveBehaviors: textField\("dischargeMaladaptiveBehaviors"\)/);
});
