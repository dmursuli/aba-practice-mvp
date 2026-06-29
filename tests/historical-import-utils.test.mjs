import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoricalImportCsvTemplate,
  buildHistoricalImportDuplicateMap,
  parseHistoricalImportCsv,
  validateHistoricalImportRows
} from "../public/historical-import-utils.js";

const client = {
  id: "client-1",
  programs: [
    {
      id: "program-1",
      name: "Manding",
      domain: "Functional Communication",
      targets: [{ id: "target-1", name: "Request help", status: "active" }]
    }
  ],
  behaviors: [{ id: "behavior-1", name: "Aggression", status: "active" }],
  profile: {
    parentTrainingGoals: [
      { goalName: "Use visual schedule", targetName: "Prompt schedule before transitions" }
    ]
  }
};

test("csv parser reads simple Date,Value historical rows and preserves row numbers", () => {
  const csv = buildHistoricalImportCsvTemplate("skill");
  const rows = parseHistoricalImportCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].__rowNumber, 2);
  assert.equal(rows[0].date, "3/15/2024");
  assert.equal(rows[0].value, "80");
  assert.equal(rows[0].inferredMeasurementHeader, "value");
});

test("csv parser accepts Date,Aggression for behavior data", () => {
  const rows = parseHistoricalImportCsv("Date,Aggression\n3/15/2024,18\n3/16/2024,0\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "3/15/2024");
  assert.equal(rows[0].value, "18");
  assert.equal(rows[0].inferredMeasurementHeader, "aggression");
});

test("csv parser accepts Date,Frequency and Date,Value headers", () => {
  const frequencyRows = parseHistoricalImportCsv("Date,Frequency\n3/15/2024,18\n");
  const valueRows = parseHistoricalImportCsv("Date,Value\n3/15/2024,18\n");
  assert.equal(frequencyRows[0].value, "18");
  assert.equal(frequencyRows[0].inferredMeasurementHeader, "frequency");
  assert.equal(valueRows[0].value, "18");
  assert.equal(valueRows[0].inferredMeasurementHeader, "value");
});

test("csv parser treats the second column as the value when there are exactly two columns", () => {
  const rows = parseHistoricalImportCsv("Session Date,Aggression Count\n03/15/2024,18\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "03/15/2024");
  assert.equal(rows[0].value, "18");
  assert.equal(rows[0].inferredMeasurementHeader, "aggressioncount");
});

test("duplicate map only considers prior historical imports", () => {
  const sessions = [
    {
      id: "session-1",
      clientId: "client-1",
      date: "2026-01-15",
      source: "historical_import",
      programs: [{ programId: "program-1", targets: [{ targetId: "target-1", historicalImportMeasurementType: "percentage" }] }],
      behaviors: [],
      parentGoals: []
    },
    {
      id: "session-2",
      clientId: "client-1",
      date: "2026-01-15",
      programs: [{ programId: "program-1", targets: [{ targetId: "target-1" }] }],
      behaviors: [],
      parentGoals: []
    }
  ];
  const duplicates = buildHistoricalImportDuplicateMap("client-1", sessions);
  assert.equal(duplicates.size, 1);
  assert.equal(duplicates.values().next().value.sessionId, "session-1");
});

test("validator auto-assigns selected behavior to every row without manual mapping", () => {
  const preview = validateHistoricalImportRows({
    client,
    sessions: [],
    dataType: "behavior",
    measurementType: "frequency",
    selectedReference: { id: "behavior-1", label: "Aggression" },
    duplicateStrategy: "skip",
    rows: parseHistoricalImportCsv("Date,Aggression\n3/15/2024,18\n3/16/2024,0\n")
  });
  assert.equal(preview.summary.errorRows, 0);
  assert.equal(preview.summary.importableRows, 2);
  assert.equal(preview.rows[0].resolved.behaviorId, "behavior-1");
  assert.equal(preview.rows[1].resolved.behaviorId, "behavior-1");
  assert.equal(preview.rows[0].commitShape.behaviorId, "behavior-1");
});

test("validator auto-assigns the selected skill target to imported rows", () => {
  const preview = validateHistoricalImportRows({
    client,
    sessions: [],
    dataType: "skill",
    measurementType: "percentage",
    selectedReference: {
      id: "target-1",
      goal: "Manding",
      target: "Request help",
      domain: "Functional Communication",
      targetId: "target-1",
      programId: "program-1",
      programName: "Manding"
    },
    duplicateStrategy: "skip",
    rows: parseHistoricalImportCsv("Date,Value\n3/15/2024,80\n")
  });
  assert.equal(preview.summary.errorRows, 0);
  assert.equal(preview.rows[0].commitShape.programId, "program-1");
  assert.equal(preview.rows[0].commitShape.targetId, "target-1");
  assert.equal(preview.rows[0].commitShape.correct, 8);
});

test("validator accepts both US-style and ISO dates in simple behavior imports", () => {
  const preview = validateHistoricalImportRows({
    client,
    sessions: [],
    dataType: "behavior",
    measurementType: "frequency",
    selectedReference: { id: "behavior-1", label: "Aggression" },
    duplicateStrategy: "skip",
    rows: [
      ...parseHistoricalImportCsv("Date,Frequency\n3/15/2024,18\n"),
      ...parseHistoricalImportCsv("Date,Frequency\n2024-04-09,0\n")
    ]
  });
  assert.equal(preview.summary.errorRows, 0);
  assert.equal(preview.rows[0].raw.date, "2024-03-15");
  assert.equal(preview.rows[1].raw.date, "2024-04-09");
});

test("validator imports valid rows while flagging invalid rows individually", () => {
  const preview = validateHistoricalImportRows({
    client,
    sessions: [],
    dataType: "behavior",
    measurementType: "frequency",
    selectedReference: { id: "behavior-1", label: "Aggression", behaviorId: "behavior-1", behaviorName: "Aggression" },
    duplicateStrategy: "skip",
    rows: parseHistoricalImportCsv("Date,Frequency\n3/15/2024,18\n3/16/2024,\n3/17/2024,2\n")
  });
  assert.equal(preview.summary.totalRows, 3);
  assert.equal(preview.summary.errorRows, 1);
  assert.equal(preview.summary.importableRows, 2);
  assert.equal(preview.rows[1].errors[0], "Missing value.");
});

test("validator can cancel duplicate imports or replace them", () => {
  const sessions = [{
    id: "session-1",
    clientId: "client-1",
    date: "2024-03-15",
    source: "historical_import",
    programs: [],
    behaviors: [{ behaviorId: "behavior-1", historicalImportMeasurementType: "frequency" }],
    parentGoals: []
  }];
  const baseConfig = {
    client,
    sessions,
    dataType: "behavior",
    measurementType: "frequency",
    selectedReference: { id: "behavior-1", label: "Aggression", behaviorId: "behavior-1", behaviorName: "Aggression" },
    rows: parseHistoricalImportCsv("Date,Frequency\n3/15/2024,3\n")
  };
  const cancelPreview = validateHistoricalImportRows({ ...baseConfig, duplicateStrategy: "cancel" });
  const replacePreview = validateHistoricalImportRows({ ...baseConfig, duplicateStrategy: "replace" });
  assert.equal(cancelPreview.summary.importableRows, 0);
  assert.equal(cancelPreview.rows[0].commitAction, "cancel");
  assert.equal(replacePreview.summary.importableRows, 1);
  assert.equal(replacePreview.rows[0].commitAction, "update");
});
