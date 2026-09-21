import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should exist after ${startMarker}`);
  return app.slice(start, end);
}

test("active Parent Training goals retain data collection and an explicit mastery action", () => {
  const template = html.slice(html.indexOf('id="parent-goal-template"'), html.indexOf('</template>', html.indexOf('id="parent-goal-template"')));
  assert.match(template, /data-field="opportunities"/);
  assert.match(template, /data-field="independent"/);
  assert.match(template, /data-field="prompted"/);
  assert.match(template, /data-field="promptLevel"/);
  assert.match(template, /data-mark-parent-goal-mastered[^>]*>Mark mastered/);
  assert.match(app, /dataset\.parentGoalEditable = "true"/);
});

test("mastered goals use a dedicated read-only card with optional authoritative date", () => {
  const addRow = sourceBetween("function addParentGoalRow", "function preloadParentRows");
  assert.match(addRow, /parent-goal-mastered-row/);
  assert.match(addRow, /Mastered parent-training goal/);
  assert.match(addRow, /parent-goal-mastered-target/);
  assert.match(addRow, /parentTrainingGoalMasteryDate/);
  assert.doesNotMatch(addRow.slice(addRow.indexOf('if (parentGoalLifecycle'), addRow.indexOf('const node =')), /data-field=|Opportunities|Independent|Prompted|Prompt level/);
  assert.match(css, /\.parent-goal-mastered-row/);
});

test("Active and Mastered tabs count and filter the same row lifecycle without forced redirects", () => {
  const tabs = sourceBetween("function renderParentGoalTabs", "function applyParentGoalFilter");
  const filter = sourceBetween("function applyParentGoalFilter", "function updateProgramIndependence");
  assert.match(tabs, /row\.dataset\.parentGoalState === "mastered"/);
  assert.match(filter, /row\.dataset\.parentGoalState === "mastered"/);
  assert.match(tabs, /Active.*counts\[tab\]/s);
  assert.doesNotMatch(tabs, /counts\.active \? "active" : "mastered"/);
  assert.match(filter, /No mastered parent-training goals/);
  assert.match(filter, /No active parent-training goals/);
});

test("mastery requires confirmation, preserves the goal object, and updates through the authorized profile pathway", () => {
  const handler = sourceBetween("async function handleMarkParentGoalMastered", "function renderParentGoalTabs");
  assert.ok(handler.indexOf("window.confirm") < handler.indexOf("updateClientProfile"));
  assert.match(handler, /Mark this parent-training goal as mastered/);
  assert.match(handler, /\.\.\.goal,[\s\S]*status: "mastered",[\s\S]*masteredDate:/);
  assert.match(handler, /currentClientProfilePayload\(client\)/);
  assert.match(handler, /preloadParentRows\(\)/);
  assert.doesNotMatch(handler, /programs|behaviors|sessions\s*=/);
});

test("mastered goals are excluded from new 97156 collection while retained in the profile bank", () => {
  const payload = sourceBetween("function buildParentTrainingPayload", "function normalizeParentGoal");
  const submit = sourceBetween("async function handleParentTrainingSubmit", "function buildParentTrainingPayload");
  assert.match(payload, /data-parent-goal-editable="true"/);
  assert.match(submit, /parentTrainingGoals: parentTrainingGoalsFromRows\(\)/);
  assert.match(app, /readDataRow\(row\), status: "active"/);
  assert.match(app, /function generateParentTrainingNote/);
});
