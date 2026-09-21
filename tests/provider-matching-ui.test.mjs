import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

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
  assert.match(panel, /Find, staff, and schedule providers/);
  assert.match(panel, /Choose a client, service, location, and time to find providers/);
  assert.doesNotMatch(panel, /<button[^>]*>\s*(?:Create appointment|Create recurring|Schedule)/i);
  for (const id of ["staffing-confirmation-modal", "staffing-confirmation-title", "staffing-confirmation-content", "staffing-confirmation-submit"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["staffing-schedule-modal", "staffing-schedule-title", "staffing-schedule-content", "staffing-schedule-submit"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["staffing-recurring-modal", "staffing-recurring-title", "staffing-recurring-form", "staffing-recurring-content", "staffing-recurring-submit"]) {
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
  assert.match(card, /caseAccess\.label/);
  assert.match(card, /Case access/);
  assert.match(card, /BCBA clinical access/);
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
  assert.match(card, />Schedule</);
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

test("Staffing card exposes separately prioritized Staff, Schedule, and Recurring actions without a combined action", () => {
  const card = functionSource("staffingCandidateCard");
  assert.match(card, /primary-button staffing-case-action[^>]*data-staff-case-provider-id[^>]*>Staff this case/);
  assert.match(card, /primary-button staffing-case-action[^>]*data-schedule-provider-id[^>]*>Schedule/);
  assert.match(card, /secondary-button staffing-case-action[^>]*data-recurring-provider-id[^>]*>Recurring/);
  assert.doesNotMatch(card, /Staff and Schedule|Staff & Schedule/i);
});

test("recurring readiness requires access prerequisites but does not reuse the single-slot conflict decision", () => {
  const readiness = functionSource("staffingRecurringReadiness");
  assert.match(readiness, /canCreateAppointments/);
  assert.match(readiness, /activeStructuredClientServiceLocations/);
  assert.match(readiness, /role === "rbt"/);
  assert.match(readiness, /caseAssignment\?\.status !== "assigned"/);
  assert.match(readiness, /Staff this case before recurring scheduling/);
  assert.doesNotMatch(readiness, /candidate\.availability|candidate\.schedule|candidate\.zone/);
  const card = functionSource("staffingCandidateCard");
  assert.match(card, /staffingRecurringReadiness/);
  assert.match(card, /data-recurring-provider-id/);
});

test("recurring readiness allows assigned RBTs and BCBAs while withholding the action from unassigned RBTs", () => {
  const context = {
    state: {
      clients: [{ id: "client-1", status: "active" }],
      staffingMatchResult: {
        request: { clientId: "client-1", serviceLocationId: "location-1", cptCode: "97153" },
        permissions: { canCreateAppointments: true }
      }
    },
    activeStructuredClientServiceLocations: () => [{ id: "location-1" }]
  };
  vm.runInNewContext(functionSource("staffingRecurringReadiness"), context);
  const rbt = { provider: { role: "rbt" }, caseAssignment: { status: "assigned" }, schedule: { status: "conflict" }, availability: { status: "outside" } };
  assert.equal(context.staffingRecurringReadiness(rbt).ready, true);
  rbt.caseAssignment.status = "not_assigned";
  assert.equal(context.staffingRecurringReadiness(rbt).ready, false);
  assert.equal(context.staffingRecurringReadiness({ provider: { role: "bcba" } }).ready, true);
});

test("recurring Staffing opens an explicit editor and requires a separate confirmation step", () => {
  const open = functionSource("openStaffingRecurring");
  const render = functionSource("renderStaffingRecurring");
  const submit = functionSource("handleStaffingRecurringSubmit", { async: true });
  assert.match(open, /staffingRecurringDefaultDraft/);
  assert.match(open, /staffingRecurringStage = "edit"/);
  assert.match(open, /classList\.remove\("hidden"\)/);
  assert.doesNotMatch(open, /createRecurringSeries|createAppointment/);
  assert.match(render, /Review recurring schedule/);
  assert.match(render, /Confirm recurring schedule/);
  assert.match(render, /Start date/);
  assert.match(render, /End date/);
  assert.match(render, /Weekday and time pattern/);
  assert.match(render, /The requested Staffing date and time are defaults only/);
  assert.match(submit, /state\.staffingRecurringStage === "edit"/);
  assert.match(submit, /state\.staffingRecurringStage = "confirm"/);
  assert.ok(submit.indexOf('state.staffingRecurringStage = "confirm"') < submit.indexOf("await createRecurringSeries"));
});

test("recurring Staffing reuses recurrence rows, supports add/remove, and validates bounded patterns", () => {
  const render = functionSource("renderStaffingRecurring");
  const click = functionSource("handleStaffingRecurringContentClick");
  const validation = functionSource("validateStaffingRecurringDraft");
  assert.match(render, /appointmentRecurrenceRowMarkup/);
  assert.match(click, /staffing-recurring-add-day/);
  assert.match(click, /data-remove-recurrence-day/);
  assert.match(click, /recurrenceRows\.splice/);
  assert.match(validation, /Start date is required/);
  assert.match(validation, /End date is required/);
  assert.match(validation, /at most 12 months/);
  assert.match(validation, /Each recurrence weekday may be used only once/);
  assert.match(validation, /cross-midnight appointments are not supported/);
  assert.match(validation, /active structured service location/);
});

test("recurring Staffing uses the existing series endpoint after an immediate RBT assignment recheck", () => {
  const payload = functionSource("staffingRecurringUnsignedPayload");
  const submit = functionSource("handleStaffingRecurringSubmit", { async: true });
  for (const field of ["clientId", "serviceCode", "providerUserId", "serviceLocationId", "timeZone", "startDate", "endDate", "recurrenceRows", "operationalNote"]) {
    assert.match(payload, new RegExp(`${field}:`));
  }
  assert.match(submit, /await verifyStaffingRbtAssignment\(candidate, state\.staffingRecurringDraft\.clientId\)/);
  assert.match(submit, /await createRecurringSeries\(staffingRecurringSubmissionPayload\(\)\)/);
  assert.ok(submit.indexOf("await verifyStaffingRbtAssignment") < submit.indexOf("await createRecurringSeries"));
  assert.match(submit, /state\.scheduleLoadedStartDate = ""/);
  assert.match(submit, /await refreshCurrentStaffingMatches\(\)/);
  assert.match(submit, /Recurring schedule created with/);
  assert.match(submit, /recurringSeriesSuccessMessage\(result\)/);
  assert.doesNotMatch(submit, /assignClientProvider|createAppointment/);
  assert.match(api, /fetch\("\/api\/recurring-series"/);
});

test("the immediate assignment check rejects a removed RBT assignment and bypasses BCBA assignment lookup", async () => {
  let reads = 0;
  const context = {
    getClientAssignments: async () => {
      reads += 1;
      return { assignments: [] };
    },
    Error
  };
  vm.runInNewContext(functionSource("verifyStaffingRbtAssignment", { async: true }), context);
  await assert.rejects(
    context.verifyStaffingRbtAssignment({ provider: { role: "rbt", userId: "rbt-1" } }, "client-1"),
    /Staff this case before scheduling/
  );
  await context.verifyStaffingRbtAssignment({ provider: { role: "bcba", userId: "bcba-1" } }, "client-1");
  assert.equal(reads, 1);
});

test("recurring Staffing request identity is stable for retries and changes after a material edit", () => {
  let requestNumber = 0;
  const context = {
    state: {
      staffingRecurringDraft: null,
      staffingRecurringRequestId: "",
      staffingRecurringRequestSignature: ""
    },
    crypto: { randomUUID: () => `staffing-request-${++requestNumber}` },
    String,
    Number,
    JSON,
    Date,
    Math
  };
  vm.runInNewContext([
    functionSource("recurringSeriesRequestId"),
    functionSource("staffingRecurringUnsignedPayload"),
    functionSource("staffingRecurringSubmissionPayload")
  ].join("\n"), context);
  const draft = {
    clientId: "client-1",
    serviceCode: "97153",
    providerUserId: "user-rbt",
    serviceLocationId: "location-1",
    timeZone: "America/New_York",
    startDate: "2026-09-28",
    endDate: "2026-12-18",
    recurrenceRows: [{ weekday: 1, startLocalTime: "15:00", endLocalTime: "18:00" }],
    operationalNote: ""
  };
  const first = context.staffingRecurringSubmissionPayload(draft);
  const retry = context.staffingRecurringSubmissionPayload(draft);
  assert.equal(retry.requestId, first.requestId);
  draft.endDate = "2026-12-19";
  const edited = context.staffingRecurringSubmissionPayload(draft);
  assert.notEqual(edited.requestId, first.requestId);
});

test("recurring Staffing confirmation keeps access, zone, availability, and atomic validation visible", () => {
  const render = functionSource("renderStaffingRecurring");
  assert.match(render, /BCBA clinical access/);
  assert.match(render, /candidate\.zone\.label/);
  assert.match(render, /Provider Availability is not configured/);
  assert.match(render, /check every occurrence/);
  assert.match(render, /If any occurrence is invalid, nothing will be created/);
  assert.match(functionSource("handleStaffingRecurringKeydown"), /event\.key === "Escape"/);
});

test("Staffing uses compact cards and collapses to one column without horizontal overflow", () => {
  assert.match(css, /\.staffing-match-form[^}]*max-width: 820px/);
  assert.match(css, /\.staffing-candidate-list[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-candidate-list[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.staffing-candidate-card[^}]*min-width: 0/);
  assert.match(css, /\.staffing-confirmation-panel[^}]*calc\(100vw - 32px\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-schedule-summary[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.staffing-recurring-panel[^}]*calc\(100vw - 32px\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-recurring-fields[^}]*minmax\(0, 1fr\)/);
});
