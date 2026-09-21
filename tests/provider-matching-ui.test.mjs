import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

function functionSource(name, { async = false } = {}) {
  const marker = `${async ? "async " : ""}function ${name}(`;
  const start = app.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = app.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`Unable to read ${name}`);
}

test("Staffing tab provides matching criteria and an explicit staffing confirmation", () => {
  const panel = html.slice(html.indexOf('id="schedule-subview-staffing"'), html.indexOf('id="schedule-subview-availability"'));
  for (const id of ["staffing-match-form", "staffing-client", "staffing-service", "staffing-location", "staffing-date", "staffing-start-time", "staffing-end-time", "staffing-find-providers", "staffing-results"]) {
    assert.match(panel, new RegExp(`id="${id}"`));
  }
  assert.match(panel, /Find providers for a service/);
  assert.match(panel, /do not assign anyone automatically or create appointments/);
  assert.doesNotMatch(panel, /<button[^>]*>\s*(?:Create appointment|Create recurring|Schedule)/i);
  for (const id of ["staffing-confirmation-modal", "staffing-confirmation-title", "staffing-confirmation-content", "staffing-confirmation-submit"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["staffing-schedule-modal", "staffing-schedule-title", "staffing-schedule-content", "staffing-schedule-submit"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test("Staffing follows the selected client's active structured service locations", () => {
  const locations = functionSource("staffingActiveLocations");
  const options = functionSource("renderStaffingFormOptions");
  assert.match(locations, /client\?\.profile\?\.serviceLocations/);
  assert.match(locations, /location\.isActive !== false/);
  assert.match(options, /No active service locations/);
  assert.match(options, /location\.zone/);
  assert.match(functionSource("handleStaffingClientChange"), /staffingLocationSelect\.value = ""/);
});

test("Find Providers calls the matching API and renders loading, error, legacy-zone, and grouped states", () => {
  const submit = functionSource("handleFindStaffingProviders", { async: true });
  const results = functionSource("renderStaffingResults");
  assert.match(api, /POST/);
  assert.match(api, /\/api\/scheduling\/provider-matches/);
  assert.match(submit, /findSchedulingProviderMatches/);
  assert.match(submit, /clientId:/);
  assert.match(submit, /cptCode:/);
  assert.match(submit, /serviceLocationId:/);
  assert.match(submit, /date:/);
  assert.match(submit, /startTime:/);
  assert.match(submit, /endTime:/);
  assert.match(results, /Finding eligible providers/);
  assert.match(results, /could not be completed/);
  assert.match(results, /does not have a current operational zone/);
  assert.match(results, /result\.groups/);
  assert.match(results, /staffing-result-group/);
});

test("candidate cards keep eligibility, assignment, and requested-time status separate", () => {
  const card = functionSource("staffingCandidateCard");
  assert.match(card, /candidate\.provider\.name/);
  assert.match(card, /candidate\.provider\.role/);
  assert.match(card, /candidate\.zone\.label/);
  assert.match(card, /candidate\.availability\.label/);
  assert.match(card, /candidate\.schedule\.label/);
  assert.match(card, /candidate\.caseAssignment\.label/);
  assert.match(card, /Case status/);
  assert.match(card, /Staff this case/);
  assert.doesNotMatch(card, /score|percent|clientId|clientName|Create appointment/i);
});

test("Staff this case is limited to unassigned 97153 RBT candidates and does not depend on time readiness", () => {
  const eligibility = functionSource("canStaffCandidate");
  assert.match(eligibility, /cptCode === "97153"/);
  assert.match(eligibility, /canManageClientAssignments/);
  assert.match(eligibility, /role === "rbt"/);
  assert.match(eligibility, /caseAssignment\?\.status === "not_assigned"/);
  assert.doesNotMatch(eligibility, /availability|schedule|zone/);
});

test("Schedule readiness keeps RBT assignment, availability, conflict, and zone concepts separate", () => {
  const readiness = functionSource("staffingSchedulingReadiness");
  assert.match(readiness, /role === "rbt"/);
  assert.match(readiness, /request\.cptCode === "97153"/);
  assert.match(readiness, /caseAssignment\?\.status !== "assigned"/);
  assert.match(readiness, /Staff this case before scheduling/);
  assert.match(readiness, /availability\?\.status === "outside"/);
  assert.match(readiness, /schedule\?\.status === "conflict"/);
  assert.match(readiness, /availability\?\.status === "not_configured"/);
  assert.doesNotMatch(readiness, /candidate\.zone/);
});

test("staffing requires confirmation, reuses the assignment API, updates the card, and creates no appointment", () => {
  const open = functionSource("openStaffingConfirmation");
  const confirm = functionSource("handleConfirmStaffingAssignment", { async: true });
  const keyboard = functionSource("handleStaffingConfirmationKeydown");
  assert.match(open, /classList\.remove\("hidden"\)/);
  assert.match(open, /staffingConfirmationSubmit\?\.focus/);
  assert.match(confirm, /assignClientProvider\(clientId, candidate\.provider\.userId\)/);
  assert.match(confirm, /status: "assigned"/);
  assert.match(confirm, /No appointment was created/);
  assert.match(confirm, /error\.status === 409/);
  assert.match(confirm, /refreshClientAssignments/);
  assert.doesNotMatch(confirm, /createAppointment|createRecurringSeries/);
  assert.match(keyboard, /event\.key === "Escape"/);
  assert.match(functionSource("renderStaffingConfirmation"), /grant the RBT access/);
  assert.match(functionSource("renderStaffingConfirmation"), /No appointment will be created/);
});

test("Schedule this provider requires confirmation and reuses single appointment creation", () => {
  const card = functionSource("staffingCandidateCard");
  const open = functionSource("openStaffingSchedule");
  const confirmation = functionSource("renderStaffingScheduleConfirmation");
  const payload = functionSource("staffingAppointmentPayload");
  const confirm = functionSource("handleConfirmStaffingSchedule", { async: true });
  assert.match(card, /data-schedule-provider-id/);
  assert.match(card, /Schedule this provider/);
  assert.match(open, /staffingSchedulingReadiness\(candidate\)\.ready/);
  assert.match(open, /staffingScheduleSubmit\?\.focus/);
  assert.doesNotMatch(open, /createAppointment/);
  assert.match(confirmation, /BCBA clinical access/);
  assert.match(confirmation, /does not create a recurring series or change case assignments/);
  assert.match(confirmation, /Provider Availability is not configured/);
  for (const field of ["clientId", "serviceCode", "providerAssignments", "scheduledStartAt", "scheduledEndAt", "timeZone", "locationId"]) {
    assert.match(payload, new RegExp(`${field}:`));
  }
  assert.match(payload, /assignmentRole: "primary"/);
  assert.doesNotMatch(payload, /recurrence|requestId|caseAssignment/);
  assert.match(confirm, /await createAppointment\(staffingAppointmentPayload\(candidate, result\)\)/);
  assert.match(confirm, /await verifyStaffingRbtAssignment\(candidate, result\.request\.clientId\)/);
  assert.match(confirm, /await refreshCurrentStaffingMatches\(\)/);
  assert.match(confirm, /Appointment scheduled with/);
  assert.match(confirm, /Appointment was not created/);
  assert.doesNotMatch(confirm, /assignClientProvider|createRecurringSeries/);
  assert.match(functionSource("handleStaffingScheduleKeydown"), /event\.key === "Escape"/);
  const assignmentCheck = functionSource("verifyStaffingRbtAssignment", { async: true });
  assert.match(assignmentCheck, /candidate\.provider\.role !== "rbt"/);
  assert.match(assignmentCheck, /getClientAssignments\(clientId\)/);
  assert.match(assignmentCheck, /Staff this case before scheduling/);
});

test("Staffing card exposes separate Staff and Schedule actions without a combined action", () => {
  const card = functionSource("staffingCandidateCard");
  assert.match(card, /Staff this case/);
  assert.match(card, /Schedule this provider/);
  assert.doesNotMatch(card, /Staff and Schedule|Staff & Schedule/i);
});

test("Staffing uses compact cards and collapses to one column without horizontal overflow", () => {
  assert.match(css, /\.staffing-match-form[^}]*max-width: 760px/);
  assert.match(css, /\.staffing-candidate-list[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-candidate-list[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.staffing-candidate-card[^}]*min-width: 0/);
  assert.match(css, /\.staffing-confirmation-panel[^}]*calc\(100vw - 32px\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-schedule-summary[^}]*minmax\(0, 1fr\)/);
});
