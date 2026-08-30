import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function functionSource(name, { async = false } = {}) {
  const marker = `${async ? "async " : ""}function ${name}(`;
  const start = appSource.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Unable to read ${name}`);
}

test("Add Appointment visibility is limited to admin and BCBA", () => {
  const context = { state: { currentUser: null } };
  vm.runInNewContext(functionSource("canCreateAppointments"), context);
  for (const role of ["admin", "bcba"]) {
    context.state.currentUser = { role };
    assert.equal(context.canCreateAppointments(), true);
  }
  for (const role of ["rbt", "read-only"]) {
    context.state.currentUser = { role };
    assert.equal(context.canCreateAppointments(), false);
  }
  assert.match(htmlSource, /id="schedule-add-appointment"[^>]*>Add Appointment</);
  assert.match(htmlSource, /class="[^"]*hidden[^"]*"[^>]*id="schedule-add-appointment"/);
  assert.match(functionSource("renderScheduleAccessControls"), /classList\.toggle\("hidden", !canCreateAppointments\(\)\)/);
});

test("creation form contains exactly the requested scheduling fields and canonical codes", () => {
  const form = htmlSource.slice(htmlSource.indexOf('id="appointment-form"'), htmlSource.indexOf('id="program-graph-modal"'));
  for (const name of [
    "clientId", "serviceCode", "providerUserId", "date", "startTime", "endTime", "timeZone",
    "serviceLocationIndex", "notes"
  ]) {
    assert.match(form, new RegExp(`name="${name}"`));
  }
  for (const removedName of ["locationLabel", "addressLine1", "addressLine2", "city", "state", "postalCode"]) {
    assert.doesNotMatch(form, new RegExp(`name="${removedName}"`));
  }
  assert.match(form, /Service Location/);
  assert.match(form, /id="appointment-setting-display" readonly/);
  assert.match(form, /Determined automatically by the selected service location/);
  assert.doesNotMatch(form, /<select name="settingType"/);
  assert.match(form, /Operational scheduling note/);
  const serviceValues = [...form.matchAll(/<option value="(971\d{2}|parent-training)"/g)].map((match) => match[1]);
  assert.deepEqual(serviceValues, ["97151", "97153", "97155", "97156"]);
  assert.doesNotMatch(form, /name="(?:soap|behavior|treatment|clinical|assessment|cancellation|confirmation|sessionId|planChangeLog)[^"]*"/i);
  assert.doesNotMatch(form, /Edit appointment|Cancel appointment|Confirm appointment|Reschedule appointment/i);
});

test("service locations reuse Client Profile data and auto-select a single saved location", () => {
  const context = {
    state: {
      clients: [
        { id: "single", defaultSetting: "Home", profile: {} },
        {
          id: "multiple",
          defaultSetting: "Clinic",
          profile: {
            serviceLocations: [
              { id: "home-1", name: "Home", settingType: "home", zone: "West Kendall", address: { line1: "123 Main" }, isPrimary: true, isActive: true },
              { id: "school-1", name: "School", settingType: "school", zone: "Doral", address: { city: "Miami", state: "FL" }, isActive: true },
              { id: "old-clinic", name: "Old Clinic", settingType: "clinic", zone: "Kendall", isActive: false }
            ]
          }
        }
      ]
    }
  };
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("normalizeClientServiceLocation"),
    functionSource("legacyDefaultSettingLocations"),
    functionSource("clientServiceLocations")
  ].join("\n"), context);

  const single = context.clientServiceLocations("single");
  assert.equal(single.length, 1);
  assert.equal(single[0].label, "Home");
  assert.equal(single[0].settingType, "home");

  const multiple = context.clientServiceLocations("multiple");
  assert.equal(multiple.length, 2);
  assert.equal(multiple[0].id, "home-1");
  assert.equal(multiple[0].addressLine1, "123 Main");
  assert.equal(multiple[0].zone, "West Kendall");
  assert.equal(multiple[0].isPrimary, true);
  assert.equal(multiple[1].city, "Miami");
  context.state.clients.push({ id: "legacy-multiple", defaultSetting: "Home and clinic" });
  const legacyMultiple = context.clientServiceLocations("legacy-multiple");
  assert.deepEqual(Array.from(legacyMultiple, (location) => location.label), ["Home", "Clinic"]);
  assert.deepEqual(Array.from(legacyMultiple, (location) => location.settingType), ["home", "clinic"]);
  assert.ok(legacyMultiple.every((location) => !location.label.includes("and")));
  assert.match(functionSource("renderAppointmentServiceLocations"), /if \(!multipleLocations\) select\.value = "0"/);
  assert.match(functionSource("renderAppointmentServiceLocations"), /findIndex\(\(location\) => location\.isPrimary\)/);
  assert.match(functionSource("renderAppointmentServiceLocations"), /select\.value = String\(primaryIndex\)/);
  assert.match(appSource, /clientId\?\.addEventListener\("change", renderAppointmentServiceLocations\)/);
});

test("recurring mode excludes legacy default-setting fallbacks and keeps structured IDs and zones", () => {
  const context = {
    state: {
      clients: [
        { id: "legacy", defaultSetting: "Clinic and home", profile: {} },
        { id: "structured", profile: { serviceLocations: [
          { id: "clinic-1", name: "Clinic", settingType: "clinic", zone: "Doral", isActive: true },
          { id: "inactive-1", name: "Old Home", settingType: "home", zone: "Kendall", isActive: false }
        ] } }
      ]
    }
  };
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("normalizeClientServiceLocation"),
    functionSource("legacyDefaultSettingLocations"),
    functionSource("clientServiceLocations"),
    functionSource("activeStructuredClientServiceLocations"),
    functionSource("appointmentServiceLocationsForMode")
  ].join("\n"), context);

  assert.deepEqual(Array.from(context.appointmentServiceLocationsForMode("legacy", false), (location) => location.label), ["Clinic", "Home"]);
  assert.equal(context.appointmentServiceLocationsForMode("legacy", true).length, 0);
  const recurringLocations = context.appointmentServiceLocationsForMode("structured", true);
  assert.equal(recurringLocations.length, 1);
  assert.equal(recurringLocations[0].id, "clinic-1");
  assert.equal(recurringLocations[0].zone, "Doral");
  const renderer = functionSource("renderAppointmentServiceLocations");
  assert.match(renderer, /appointmentServiceLocationsForMode\(clientId, isRecurring\)/);
  assert.match(renderer, /No active structured Service Locations/);
  assert.match(renderer, /Recurring series require an active structured Service Location/);
  assert.match(functionSource("applyAppointmentRecurrenceMode"), /renderAppointmentServiceLocations\(\{ preferredLocationId \}\)/);
});

test("Client Profile provides structured Service Location management without deletion", () => {
  const section = htmlSource.slice(
    htmlSource.indexOf('id="service-locations-title"'),
    htmlSource.indexOf('aria-labelledby="mastery-criteria-title"')
  );
  assert.match(section, /Add Service Location/);
  assert.match(section, /Edit Service Location|service-location-editor-title/);
  assert.match(section, /Location name/);
  assert.match(section, /Setting type/);
  assert.match(section, /Geographic zone/);
  assert.match(section, /School locations do not require an address/);
  assert.match(section, /Physical address <span>\(optional\)<\/span>/);
  for (const value of ["home", "school", "clinic", "community", "other"]) {
    assert.match(section, new RegExp(`<option value="${value}">`));
  }
  for (const zone of ["Homestead", "West Kendall", "Coral Gables", "Doral", "Aventura", "Miami Beach"]) {
    assert.match(section, new RegExp(`<option value="${zone}">`));
  }
  assert.doesNotMatch(section, /Delete Service Location|data-service-location-action="delete"/i);
  assert.match(functionSource("renderClientServiceLocations"), /No structured Service Locations are saved/);
  assert.match(functionSource("handleServiceLocationAction", { async: true }), /deactivateClientServiceLocation/);
  assert.match(functionSource("handleServiceLocationAction", { async: true }), /setPrimaryClientServiceLocation/);
});

test("selected service location is stored through the existing appointment snapshot", () => {
  const payload = functionSource("appointmentFormPayload");
  assert.match(payload, /selectedAppointmentServiceLocation\(formData\)/);
  assert.match(payload, /locationId: String\(serviceLocation\.id/);
  assert.match(payload, /label: String\(serviceLocation\.label/);
  assert.match(payload, /zone: String\(serviceLocation\.zone/);
  assert.match(payload, /addressLine1: String\(serviceLocation\.addressLine1/);
  assert.doesNotMatch(payload, /formData\.get\("(?:locationLabel|addressLine1|addressLine2|city|state|postalCode)"\)/);
  assert.match(functionSource("validateAppointmentForm"), /no saved service location\. Update the Client Profile before scheduling/);

  const context = {
    state: {
      appointmentServiceLocations: [{
        id: "school-1",
        label: "School",
        settingType: "school",
        zone: "Doral",
        operationalNote: "School dismissal 2:15.",
        addressLine1: "456 School Way",
        addressLine2: "Room 10",
        city: "Miami",
        state: "FL",
        postalCode: "33101"
      }]
    },
    Intl,
    Date,
    Math,
    Number,
    String,
    Object
  };
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("zonedAppointmentTimestamp"),
    functionSource("selectedAppointmentServiceLocation"),
    functionSource("appointmentFormPayload")
  ].join("\n"), context);
  const formData = new Map(Object.entries({
    clientId: "client-1",
    serviceCode: "97153",
    providerUserId: "user-rbt",
    date: "2026-08-03",
    startTime: "09:00",
    endTime: "10:00",
    timeZone: "America/New_York",
    serviceLocationIndex: "0",
    notes: "Use side gate."
  }));
  const createdPayload = context.appointmentFormPayload(formData);
  assert.equal(createdPayload.locationId, "school-1");
  assert.equal(createdPayload.locationSnapshot.label, "School");
  assert.equal(createdPayload.locationSnapshot.zone, "Doral");
  assert.equal(createdPayload.locationSnapshot.addressLine1, "456 School Way");
  assert.equal(createdPayload.locationSnapshot.operationalNote, "School dismissal 2:15.");
  assert.equal(createdPayload.settingType, "school");
  assert.equal(createdPayload.notes, "Use side gate.");
});

test("selectors use stable IDs from active same-agency authoritative records", () => {
  const route = serverSource.slice(
    serverSource.indexOf('url.pathname === "/api/appointment-options"'),
    serverSource.indexOf("const appointmentMatch", serverSource.indexOf('url.pathname === "/api/appointment-options"'))
  );
  assert.match(route, /client\.status !== "archived"/);
  assert.match(route, /normalizeAgency\(client\.agency\) === agency/);
  assert.match(route, /provider\.active !== false/);
  assert.match(route, /\["bcba", "rbt"\]\.includes\(provider\.role\)/);
  assert.match(route, /userAgency\(provider\) === agency/);
  assert.match(functionSource("appointmentFormPayload"), /clientId: String\(formData\.get\("clientId"\)/);
  assert.match(functionSource("appointmentFormPayload"), /userId: String\(formData\.get\("providerUserId"\)/);
  assert.doesNotMatch(functionSource("appointmentFormPayload"), /clientName|providerName|therapist/);
  assert.match(htmlSource, /<select name="providerUserId" required>/);
  assert.doesNotMatch(htmlSource, /<input[^>]*name="providerUserId"/);
});

test("provider choices follow service eligibility and exactly one primary assignment is submitted", () => {
  const context = {};
  vm.runInNewContext(functionSource("appointmentProviderRole"), context);
  assert.equal(context.appointmentProviderRole("97153"), "rbt");
  for (const code of ["97151", "97155", "97156"]) assert.equal(context.appointmentProviderRole(code), "bcba");
  assert.equal(context.appointmentProviderRole("parent-training"), "");
  const payload = functionSource("appointmentFormPayload");
  assert.match(payload, /providerAssignments: \[\{/);
  assert.match(payload, /assignmentRole: "primary"/);
  assert.doesNotMatch(payload, /secondary/);
});

test("date/time conversion submits explicit offsets and rejects invalid local DST time", () => {
  const context = { Intl, Date, Math, Number, String, Object };
  vm.runInNewContext(functionSource("zonedAppointmentTimestamp"), context);
  assert.equal(
    context.zonedAppointmentTimestamp("2026-08-03", "09:00", "America/New_York"),
    "2026-08-03T09:00:00-04:00"
  );
  assert.equal(context.zonedAppointmentTimestamp("2026-03-08", "02:30", "America/New_York"), "");
  assert.equal(context.zonedAppointmentTimestamp("2026-08-03", "09:00", "Eastern Time"), "");
  const validation = functionSource("validateAppointmentForm");
  assert.match(validation, /End time must be after start time; cross-midnight appointments are not supported/);
  assert.match(validation, /Date must be within the visible calendar week/);
  assert.match(validation, /selected time zone/);
});

test("submission is guarded, reports state, creates through Phase 2, and refreshes the visible week", () => {
  const handler = functionSource("handleCreateAppointment", { async: true });
  assert.match(handler, /if \(state\.appointmentSubmitting/);
  assert.match(handler, /state\.appointmentSubmitting = true/);
  assert.match(handler, /Creating appointment/);
  assert.match(handler, /await createAppointment\(appointmentFormPayload\(formData\)\)/);
  assert.match(handler, /Appointment created successfully/);
  assert.match(handler, /closeAppointmentForm\(\)/);
  assert.match(handler, /await ensureScheduleWeekLoaded\(\{ force: true \}\)/);
  assert.match(functionSource("setAppointmentFormBusy"), /appointmentSubmitButton\.disabled = isBusy/);
  assert.match(apiSource, /fetch\("\/api\/appointments",\s*\{[\s\S]*method: "POST"/);
});

test("Repeat defaults off and toggles between single and recurring time controls without replacing shared fields", () => {
  const form = htmlSource.slice(htmlSource.indexOf('id="appointment-form"'), htmlSource.indexOf('id="appointment-details-modal"'));
  assert.match(form, /<input type="checkbox" name="repeat" id="appointment-repeat">/);
  assert.doesNotMatch(form, /id="appointment-repeat"[^>]*checked/);
  assert.match(form, /id="appointment-single-time-fields"/);
  assert.match(form, /class="appointment-recurrence-fields hidden"/);
  for (const shared of ["clientId", "serviceCode", "providerUserId", "timeZone", "serviceLocationIndex", "notes"]) {
    assert.match(form, new RegExp(`name="${shared}"`));
  }
  const toggle = functionSource("applyAppointmentRecurrenceMode");
  assert.match(toggle, /appointmentSingleTimeFields\?\.classList\.toggle\("hidden", isRecurring\)/);
  assert.match(toggle, /appointmentRecurrenceFields\?\.classList\.toggle\("hidden", !isRecurring\)/);
  assert.doesNotMatch(toggle, /clientId|serviceCode|providerUserId|serviceLocationIndex/);
});

test("recurrence rows use readable unique weekdays, per-day times, safe removal, and a seven-day cap", () => {
  const markup = functionSource("appointmentRecurrenceRowMarkup");
  for (const weekday of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
    assert.match(markup, new RegExp(weekday));
  }
  assert.match(markup, /name="recurrenceWeekday"/);
  assert.match(markup, /name="recurrenceStartTime"/);
  assert.match(markup, /name="recurrenceEndTime"/);
  assert.match(functionSource("resetAppointmentRecurrenceRows"), /appointmentRecurrenceRowMarkup/);
  const add = functionSource("addAppointmentRecurrenceRow");
  assert.match(add, /find\(\(value\) => !used\.has\(value\)\)/);
  const controls = functionSource("updateAppointmentRecurrenceControls");
  assert.match(controls, /index !== rowIndex && value === option\.value/);
  assert.match(controls, /rows\.length === 1/);
  assert.match(controls, /rows\.length >= 7/);
  const remove = functionSource("handleAppointmentRecurrenceRowClick");
  assert.match(remove, /if \(rows\.length <= 1\) return/);
});

test("recurring validation requires a bounded series, active structured location, compatible provider, and valid rows", () => {
  const validation = functionSource("validateAppointmentForm");
  assert.match(validation, /\["recurrenceEndDate", "End date"\]/);
  assert.match(validation, /End date must be on or after start date/);
  assert.match(validation, /active structured Service Location/);
  assert.match(validation, /eligible for the selected service code/);
  assert.match(validation, /At least one recurrence day is required/);
  assert.match(validation, /Each recurrence weekday may be used only once/);
  assert.match(validation, /end time must be after its start time/);
  assert.match(functionSource("syncAppointmentSettingFromLocation"), /String\(location\.zone \|\| "Not assigned"\)/);
  assert.match(htmlSource, /id="appointment-setting-display" readonly/);
  assert.match(htmlSource, /id="appointment-zone-display" readonly/);
});

test("all client validation failures render beside submit controls and are brought into view", () => {
  const form = htmlSource.slice(htmlSource.indexOf('<form id="appointment-form"'), htmlSource.indexOf('id="appointment-details-modal"'));
  assert.match(form, /<form id="appointment-form" novalidate>/);
  assert.ok(form.indexOf('id="appointment-form-message"') > form.indexOf("</fieldset>"));
  assert.ok(form.indexOf('id="appointment-form-message"') < form.indexOf('class="form-actions appointment-form-actions"'));
  const feedback = functionSource("showAppointmentFormMessage");
  assert.match(feedback, /classList\.toggle\("appointment-form-error"/);
  assert.match(feedback, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(feedback, /focus\(\{ preventScroll: true \}\)/);
  const handler = functionSource("handleCreateAppointment", { async: true });
  assert.match(handler, /showAppointmentFormMessage\(errors\.join\(" "\), \{ isError: true \}\)/);
  assert.match(handler, /showAppointmentFormMessage\(error\.message \|\| "Unable to create the appointment\."/);
  assert.match(cssSource, /\.appointment-submit-feedback\.appointment-form-error\s*\{/);
});

test("recurring payload uses the Phase 4B contract and excludes server-managed recurrence data", () => {
  const payload = functionSource("recurringSeriesFormPayload");
  for (const field of ["requestId", "clientId", "serviceCode", "providerUserId", "serviceLocationId", "timeZone", "startDate", "endDate", "recurrenceRows", "operationalNote"]) {
    assert.match(payload, new RegExp(`${field}[,:]`));
  }
  assert.doesNotMatch(payload, /locationSnapshot|settingType|rowId|seriesId|revisionId|occurrenceId|status|version|createdAt|createdBy/);
  assert.match(functionSource("appointmentRecurrenceRowValues"), /weekday: Number\(weekday\)/);
  assert.match(apiSource, /function createRecurringSeries\(series[\s\S]*fetch\("\/api\/recurring-series"[\s\S]*method: "POST"/);
  assert.match(apiSource, /"idempotency-key": series\.requestId/);
});

test("recurring submission prevents duplicates, reuses an ambiguous retry requestId, and refreshes on success", () => {
  const request = functionSource("recurringSeriesSubmissionPayload");
  assert.match(request, /state\.recurringSeriesRequestSignature !== signature/);
  assert.match(request, /state\.recurringSeriesRequestId = recurringSeriesRequestId\(\)/);
  const handler = functionSource("handleCreateAppointment", { async: true });
  assert.match(handler, /if \(state\.appointmentSubmitting/);
  assert.match(handler, /await createRecurringSeries\(recurringSeriesSubmissionPayload\(formData\)\)/);
  assert.match(handler, /recurringSeriesSuccessMessage\(result\)/);
  assert.match(handler, /closeAppointmentForm\(\)/);
  assert.match(handler, /ensureScheduleWeekLoaded\(\{ force: true \}\)/);
  assert.match(apiSource, /series may have been created; retry to check safely/);
});

test("requestId remains stable for an unchanged retry and changes after a material recurrence edit", () => {
  let requestNumber = 0;
  const context = {
    state: { recurringSeriesRequestId: "", recurringSeriesRequestSignature: "" },
    selectedAppointmentServiceLocation: () => ({ id: "location-1" }),
    crypto: { randomUUID: () => `request-000${++requestNumber}` },
    String,
    Number,
    JSON,
    Date,
    Math
  };
  vm.runInNewContext([
    functionSource("appointmentRecurrenceRowValues"),
    functionSource("recurringSeriesFormPayload"),
    functionSource("recurringSeriesRequestId"),
    functionSource("recurringSeriesSubmissionPayload")
  ].join("\n"), context);
  const values = {
    clientId: "client-1",
    serviceCode: "97153",
    providerUserId: "user-rbt",
    serviceLocationIndex: "0",
    timeZone: "America/New_York",
    recurrenceStartDate: "2026-09-01",
    recurrenceEndDate: "2026-12-31",
    notes: "Use side gate."
  };
  const rows = {
    recurrenceWeekday: ["2", "4"],
    recurrenceStartTime: ["14:30", "15:00"],
    recurrenceEndTime: ["18:30", "18:00"]
  };
  const formData = {
    get: (name) => values[name] || "",
    getAll: (name) => rows[name] || []
  };
  const first = context.recurringSeriesSubmissionPayload(formData);
  const retry = context.recurringSeriesSubmissionPayload(formData);
  assert.equal(first.requestId, retry.requestId);
  assert.equal(first.recurrenceRows[0].weekday, 2);
  values.recurrenceEndDate = "2026-12-30";
  const edited = context.recurringSeriesSubmissionPayload(formData);
  assert.notEqual(edited.requestId, first.requestId);
});

test("recurring success reports appointment counts and non-blocking overlap review without raw IDs", () => {
  const success = functionSource("recurringSeriesSuccessMessage");
  assert.match(success, /appointmentCount/);
  assert.match(success, /scheduling overlap/);
  assert.match(success, /provider_overlap/);
  assert.match(success, /client_overlap/);
  assert.match(success, /review is needed/);
  assert.doesNotMatch(success, /existingAppointmentId|occurrenceId/);
});

test("calendar loads appointments with sessions and makes only appointments selectable", () => {
  const loader = functionSource("ensureScheduleWeekLoaded", { async: true });
  const renderer = functionSource("renderSchedule");
  assert.match(loader, /getVisibleSessions\(\{ startDate, endDate \}\)/);
  assert.match(loader, /getAppointments\(\{ startDate, endDate \}\)/);
  assert.match(renderer, /Scheduled appointment/);
  assert.match(renderer, /Completed session/);
  assert.match(renderer, /scheduleClientName\(appointment\.clientId\)/);
  assert.match(renderer, /appointment\.serviceCode/);
  assert.match(renderer, /scheduleProviderName\(appointment\.providerUserId\)/);
  assert.match(renderer, /scheduleAppointmentTimeLabel\(appointment\)/);
  assert.match(renderer, /scheduleSettingLabel\(appointment\.settingType\)/);
  assert.match(renderer, /scheduleStatusLabel\(appointment\.status\)/);
  assert.match(renderer, /<button type="button"[^>]*data-schedule-appointment-id=/);
  assert.match(renderer, /<article class="schedule-record">[\s\S]*Completed session/);
  assert.doesNotMatch(renderer, /<article[^>]*data-schedule-appointment-id/);
  assert.match(appSource, /scheduleWeekGrid\?\.addEventListener\("click", handleScheduleAppointmentSelection\)/);
  assert.match(functionSource("handleScheduleAppointmentSelection"), /openAppointmentDetails\(appointmentButton\.dataset\.scheduleAppointmentId\)/);
});

test("CPT colors and service-code text follow the scheduling design", () => {
  const renderer = functionSource("renderSchedule");
  assert.match(renderer, /scheduleAppointmentColorClass\(appointment\.serviceCode\)/);
  assert.match(renderer, /escapeHtml\(appointment\.serviceCode\)/);
  for (const [code, primary, background] of [
    ["97153", "#2563eb", "#dbeafe"],
    ["97155", "#7c3aed", "#ede9fe"],
    ["97156", "#0f766e", "#ccfbf1"],
    ["97151", "#b45309", "#fef3c7"]
  ]) {
    assert.match(cssSource, new RegExp(`\\.schedule-cpt-${code}\\s*\\{[^}]*border-left-color:\\s*${primary}[^}]*background:\\s*${background}`, "s"));
  }
});

test("selecting an appointment opens the operational details modal through the read endpoint", () => {
  const opener = functionSource("openAppointmentDetails", { async: true });
  assert.match(apiSource, /function getAppointment\(appointmentId[\s\S]*fetchWithTimeout\(`\/api\/appointments\/\$\{encodeURIComponent\(appointmentId\)\}`/);
  assert.match(opener, /selectedAppointmentDetails = null/);
  assert.match(opener, /appointmentDetailsLoading = true/);
  assert.match(opener, /await getAppointment\(appointmentId\)/);
  assert.match(opener, /requestId !== state\.appointmentDetailsRequestId/);
  assert.match(opener, /appointmentDetailsModal\.classList\.remove\("hidden"\)/);
  assert.match(htmlSource, /id="appointment-details-modal"[^>]*aria-hidden="true"/);
  assert.match(htmlSource, /aria-labelledby="appointment-details-title"/);
  assert.match(htmlSource, /Operational appointment information only/);
});

test("details show only operational appointment information in logical groups", () => {
  const renderer = functionSource("renderAppointmentDetails");
  for (const label of [
    "Scheduled appointment", "Client", "Service code", "Primary provider", "Date", "Start time", "End time",
    "Duration", "Time zone", "Setting", "Service location", "Geographic zone", "Status",
    "Operational scheduling note", "Created", "Updated"
  ]) assert.match(renderer, new RegExp(label));
  for (const group of ["Appointment summary", "Schedule", "Location", "Administrative"]) {
    assert.match(renderer, new RegExp(`<h4[^>]*>${group}</h4>`));
  }
  assert.match(renderer, /appointmentGeographicZone\(appointment\) \|\| "Not assigned"/);
  assert.match(renderer, /scheduleClientName\(appointment\.clientId\)/);
  assert.match(renderer, /scheduleProviderName\(appointmentPrimaryProviderId\(appointment\)\)/);
  assert.match(renderer, /appointment\.notes/);
  for (const forbidden of ["soap", "behavior", "treatment-plan", "assessment", "signature", "billing", "audit", "createdBy", "updatedBy", "version", "sessionId"]) {
    assert.doesNotMatch(renderer, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(htmlSource.slice(htmlSource.indexOf('id="appointment-details-modal"'), htmlSource.indexOf('id="program-graph-modal"')), /Cancel appointment|Confirm appointment|Reschedule appointment|Save Appointment/i);
});

test("appointment details display the canonical snapshot zone and preserve the legacy fallback", () => {
  const context = {};
  vm.runInNewContext(functionSource("appointmentGeographicZone"), context);
  assert.equal(context.appointmentGeographicZone({
    locationSnapshot: { label: "Dad's home", zone: "Tamiami" }
  }), "Tamiami");
  assert.equal(context.appointmentGeographicZone({
    locationSnapshot: { label: "Legacy home" }
  }), "");
  assert.match(functionSource("renderAppointmentDetails"), /appointmentGeographicZone\(appointment\) \|\| "Not assigned"/);
});

test("summary card shows service, status, client, date, time, and primary provider", () => {
  const renderer = functionSource("renderAppointmentDetails");
  assert.match(renderer, /appointment-summary-title/);
  assert.match(renderer, /appointment\.serviceCode/);
  assert.match(renderer, /escapeHtml\(status\)/);
  assert.match(renderer, /appointment-summary-client/);
  assert.match(renderer, /summaryDate/);
  assert.match(renderer, /timeRange/);
  assert.match(renderer, /Primary provider:/);
  assert.match(renderer, /providerName/);
});

test("setting is derived from the selected single service location", () => {
  const payload = functionSource("appointmentFormPayload");
  const sync = functionSource("syncAppointmentSettingFromLocation");
  assert.match(payload, /settingType: canonicalAppointmentSettingType\(serviceLocation\.settingType \|\| serviceLocation\.label\)/);
  assert.doesNotMatch(payload, /formData\.get\("settingType"\)/);
  assert.match(sync, /selectedAppointmentServiceLocation\(\)/);
  assert.match(sync, /appointmentSettingDisplay\.value/);
  assert.match(appSource, /serviceLocationIndex\?\.addEventListener\("change", syncAppointmentSettingFromLocation\)/);
});

test("legacy combined appointment labels display the one stored setting without rewriting data", () => {
  const context = {};
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("normalizeClientServiceLocation"),
    functionSource("legacyDefaultSettingLocations"),
    functionSource("scheduleSettingLabel"),
    functionSource("appointmentLocationLabel")
  ].join("\n"), context);
  assert.equal(context.appointmentLocationLabel({
    settingType: "clinic",
    locationSnapshot: { label: "Home and clinic" }
  }), "Clinic");
  assert.equal(context.appointmentLocationLabel({
    settingType: "home",
    locationSnapshot: { label: "Dad's House" }
  }), "Dad's House");
});

test("details close without mutation and Escape is supported", () => {
  const closer = functionSource("closeAppointmentDetails");
  const keydown = functionSource("handleAppointmentDetailsKeydown");
  assert.match(closer, /selectedAppointmentId = ""/);
  assert.match(closer, /selectedAppointmentDetails = null/);
  assert.match(closer, /classList\.add\("hidden"\)/);
  assert.match(keydown, /event\.key === "Escape"/);
  assert.match(keydown, /requestCloseAppointmentDetails\(\)/);
  assert.match(htmlSource, /class="modal-backdrop" data-close-appointment-details/);
  assert.match(appSource, /appointmentDetailsCloseButtons\.forEach[\s\S]*closeAppointmentDetails/);
  for (const source of [closer, keydown, functionSource("openAppointmentDetails", { async: true })]) {
    assert.doesNotMatch(source, /createAppointment|updateAppointment|cancelAppointment\(|fetch\([^)]*,\s*\{|method:\s*"(?:POST|PUT|PATCH|DELETE)"|reschedule/i);
  }
});

test("switching selection prevents stale details and unavailable filtered appointments close", () => {
  const opener = functionSource("openAppointmentDetails", { async: true });
  const unavailable = functionSource("closeUnavailableAppointmentDetails");
  assert.match(opener, /appointmentDetailsRequestId \+ 1/);
  assert.match(opener, /selectedAppointmentDetails = null/);
  assert.match(opener, /state\.selectedAppointmentId !== appointmentId/);
  assert.match(unavailable, /visibleAppointments\.some\(\(appointment\) => appointment\.id === state\.selectedAppointmentId\)/);
  assert.match(unavailable, /closeAppointmentDetails\(\)/);
  assert.match(functionSource("renderSchedule"), /closeUnavailableAppointmentDetails\(appointments\)/);
  assert.match(functionSource("changeScheduleWeek"), /closeAppointmentDetails\(\)/);
  assert.match(functionSource("showCurrentScheduleWeek"), /closeAppointmentDetails\(\)/);
});

test("Edit Appointment is available only to admin and BCBA", () => {
  const context = { state: { currentUser: null } };
  vm.runInNewContext(functionSource("canEditAppointments"), context);
  for (const role of ["admin", "bcba"]) {
    context.state.currentUser = { role };
    assert.equal(context.canEditAppointments(), true);
  }
  for (const role of ["rbt", "read-only"]) {
    context.state.currentUser = { role };
    assert.equal(context.canEditAppointments(), false);
  }
  const renderer = functionSource("renderAppointmentDetails");
  assert.match(renderer, /canEditAppointments\(\)/);
  assert.match(renderer, /data-appointment-edit-action="edit">Edit Appointment/);
  assert.match(functionSource("beginAppointmentEdit", { async: true }), /if \(!canEditAppointments\(\)/);
});

test("individual edit form exposes only Phase 3B operational fields and keeps client read-only", () => {
  const renderer = functionSource("renderAppointmentEditForm");
  for (const field of ["clientId", "serviceCode", "providerUserId", "date", "startTime", "endTime", "locationId", "notes"]) {
    assert.match(renderer, new RegExp(`name=\\"${field}\\"`));
  }
  assert.match(renderer, /Client identity cannot be changed/);
  assert.match(renderer, /type="text"[^>]*readonly/);
  assert.match(renderer, /The appointment's existing time zone is preserved/);
  assert.match(renderer, /name="settingDisplay" readonly/);
  assert.match(renderer, /name="zoneDisplay" readonly/);
  assert.match(renderer, /Derived from Service Location/);
  assert.match(renderer, /Operational scheduling note/);
  for (const protectedField of [
    "sessionId", "linkedAt", "linkedBy", "createdAt", "createdBy", "recurrenceSeriesId",
    "replacesAppointmentId", "replacedByAppointmentId", "cancellation", "authorizationRef", "status"
  ]) assert.doesNotMatch(renderer, new RegExp(`name=\\"${protectedField}\\"`, "i"));
});

test("edit provider choices use stable user IDs and re-filter immediately by service code", () => {
  const renderer = functionSource("renderAppointmentEditProviderOptions");
  assert.match(renderer, /appointmentProviderRole\(form\.elements\.serviceCode\.value\)/);
  assert.match(renderer, /state\.appointmentProviders\.filter\(\(provider\) => provider\.role === role\)/);
  assert.match(renderer, /value="\$\{escapeHtml\(provider\.id\)\}"/);
  assert.match(functionSource("handleAppointmentEditChange"), /name === "serviceCode"\) renderAppointmentEditProviderOptions\(\)/);
  const roleContext = {};
  vm.runInNewContext(functionSource("appointmentProviderRole"), roleContext);
  assert.equal(roleContext.appointmentProviderRole("97153"), "rbt");
  for (const code of ["97151", "97155", "97156"]) assert.equal(roleContext.appointmentProviderRole(code), "bcba");
});

test("edit locations use active structured Client Profile IDs and derive Setting and Zone", () => {
  const context = {
    state: {
      clients: [{
        id: "client-1",
        profile: { serviceLocations: [
          { id: "home-1", name: "Home", settingType: "home", zone: "West Kendall", isActive: true },
          { id: "old-1", name: "Old", settingType: "clinic", zone: "Doral", isActive: false }
        ] }
      }]
    }
  };
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("normalizeClientServiceLocation"),
    functionSource("activeStructuredClientServiceLocations")
  ].join("\n"), context);
  assert.deepEqual(Array.from(context.activeStructuredClientServiceLocations("client-1"), (location) => location.id), ["home-1"]);
  assert.match(functionSource("appointmentEditLocationOptions"), /Current legacy location:/);
  assert.match(functionSource("appointmentEditLocationOptions"), /location\.id/);
  const sync = functionSource("syncAppointmentEditLocationDetails");
  assert.match(sync, /location\?\.settingType/);
  assert.match(sync, /location\?\.zone/);
  assert.match(functionSource("handleAppointmentEditChange"), /name === "locationId"\) syncAppointmentEditLocationDetails\(\)/);
});

test("edit payload sends expectedVersion and only editable operational values", () => {
  const payload = functionSource("appointmentEditPayload");
  assert.match(payload, /expectedVersion: Number\(appointment\?\.version\)/);
  assert.match(payload, /clientId: String\(appointment\?\.clientId/);
  assert.match(payload, /userId: String\(formData\.get\("providerUserId"\)/);
  assert.match(payload, /assignmentRole: "primary"/);
  assert.match(payload, /scheduledStartAt: zonedAppointmentTimestamp/);
  assert.match(payload, /scheduledEndAt: zonedAppointmentTimestamp/);
  assert.match(payload, /locationId === "__current__" \? \{\} : \{ locationId \}/);
  for (const forbidden of [
    "sessionId", "linkedAt", "linkedBy", "createdAt", "createdBy", "recurrenceSeriesId",
    "replacement", "cancellation", "soap", "planChangeLog", "treatmentPlan", "locationSnapshot", "settingType", "zoneId"
  ]) assert.doesNotMatch(payload, new RegExp(forbidden, "i"));
  assert.match(apiSource, /function updateAppointment\(appointmentId, appointment\)[\s\S]*method: "PUT"/);
});

test("recurring edit makes this-appointment-only scope explicit and sends both current versions", () => {
  const renderer = functionSource("renderAppointmentEditForm");
  assert.match(renderer, /appointment\.recurrence\?\.isRecurring/);
  assert.match(renderer, /This change applies only to this appointment\./);
  assert.doesNotMatch(renderer, /This and future|Entire series|Edit Series/);
  const payload = functionSource("appointmentEditPayload");
  assert.match(payload, /appointment\?\.recurrence\?\.isRecurring/);
  assert.match(payload, /expectedAppointmentVersion: Number\(appointment\?\.version\)/);
  assert.match(payload, /expectedSeriesVersion: Number\(appointment\?\.recurrence\?\.seriesVersion\)/);
  assert.match(payload, /: \{ expectedVersion: Number\(appointment\?\.version\) \}/);
  assert.doesNotMatch(payload, /recurrenceSeriesId|recurrenceRevisionId|recurrenceRowId|recurrenceOccurrenceId/);
  assert.match(cssSource, /\.appointment-recurrence-scope-message\s*\{/);
});

test("edit validation rejects invalid time, incompatible providers, and inactive locations", () => {
  const validation = functionSource("validateAppointmentEditForm");
  assert.match(validation, /End time must be after start time; cross-midnight appointments are not supported/);
  assert.match(validation, /not valid in the appointment time zone/);
  assert.match(validation, /eligible for the selected service code/);
  assert.match(validation, /active structured Service Location/);
  assert.doesNotMatch(validation, /visible calendar week/);
});

test("save prevents double-submit, refreshes details and calendar, and reports moves outside the week", () => {
  const handler = functionSource("handleUpdateAppointment", { async: true });
  assert.match(handler, /if \(state\.appointmentEditSubmitting/);
  assert.match(handler, /state\.appointmentEditSubmitting = true/);
  assert.match(handler, /Saving appointment/);
  assert.match(handler, /await updateAppointment\(/);
  assert.match(handler, /state\.selectedAppointmentDetails = appointment/);
  assert.match(handler, /await ensureScheduleWeekLoaded\(\{ force: true \}\)/);
  assert.match(handler, /Appointment updated successfully/);
  assert.match(handler, /outside the visible week/);
  assert.match(handler, /preserveAppointmentDetailsOnScheduleRefresh = true/);
  assert.match(functionSource("closeUnavailableAppointmentDetails"), /!state\.preserveAppointmentDetailsOnScheduleRefresh/);
  assert.match(functionSource("setAppointmentEditBusy"), /submit\.disabled = isBusy \|\| state\.appointmentEditConflict/);
});

test("HTTP 409 preserves stale edits and requires Reload Latest or Cancel Edit", () => {
  const handler = functionSource("handleUpdateAppointment", { async: true });
  assert.match(handler, /error\.status === 409/);
  assert.match(handler, /appointmentEditConflict = true/);
  assert.match(handler, /appointment-edit-conflict/);
  const renderer = functionSource("renderAppointmentEditForm");
  assert.match(renderer, /This appointment was changed by another user\. Reload the latest version before editing\./);
  assert.match(renderer, /Reload Latest Appointment/);
  assert.match(renderer, /Cancel Edit/);
  assert.match(functionSource("reloadLatestAppointment", { async: true }), /await getAppointment\(appointmentId\)/);
  assert.match(functionSource("reloadLatestAppointment", { async: true }), /state\.selectedAppointmentDetails = appointment/);
  assert.match(functionSource("reloadLatestAppointment", { async: true }), /Discard your unsaved changes and reload the latest appointment/);
  assert.doesNotMatch(handler, /auto.?merge/i);
});

test("Cancel Edit discards locally without mutation and conflict cancel reloads the latest record", () => {
  const cancel = functionSource("cancelAppointmentEdit", { async: true });
  assert.match(cancel, /Discard your unsaved appointment changes/);
  assert.match(cancel, /state\.appointmentEditConflict/);
  assert.match(cancel, /reloadLatestAppointment\(\{ confirmDiscard: false \}\)/);
  assert.match(cancel, /state\.appointmentEditing = false/);
  assert.doesNotMatch(cancel, /updateAppointment|createAppointment|method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(functionSource("requestCloseAppointmentDetails"), /appointmentEditHasChanges\(\)/);
});

test("appointment editing remains separate from completed clinical-session records", () => {
  const renderer = functionSource("renderSchedule");
  assert.match(renderer, /<article class="schedule-record">[\s\S]*Completed session/);
  assert.doesNotMatch(renderer, /<article[^>]*data-schedule-appointment-id/);
  const editPayload = functionSource("appointmentEditPayload");
  const saveHandler = functionSource("handleUpdateAppointment", { async: true });
  for (const forbidden of ["sessionId", "soap", "planChangeLog", "treatmentPlan", "billing", "report"]) {
    assert.doesNotMatch(editPayload, new RegExp(forbidden, "i"));
    assert.doesNotMatch(saveHandler, new RegExp(forbidden, "i"));
  }
});

test("appointment edit and conflict controls remain responsive", () => {
  assert.match(cssSource, /\.appointment-edit-conflict\s*\{/);
  assert.match(cssSource, /@media \(max-width: 780px\)[\s\S]*\.appointment-details-actions,[\s\S]*width:\s*100%/);
});

test("Confirm Appointment is limited to Admin and BCBA and only scheduled appointments are eligible", () => {
  const context = { state: { currentUser: null, selectedAppointmentDetails: null } };
  vm.runInNewContext([
    functionSource("canConfirmAppointments"),
    functionSource("canConfirmAppointment")
  ].join("\n"), context);
  for (const role of ["admin", "bcba"]) {
    context.state.currentUser = { role };
    assert.equal(context.canConfirmAppointments(), true);
    assert.equal(context.canConfirmAppointment({ status: "scheduled" }), true);
  }
  for (const role of ["rbt", "read-only"]) {
    context.state.currentUser = { role };
    assert.equal(context.canConfirmAppointments(), false);
    assert.equal(context.canConfirmAppointment({ status: "scheduled" }), false);
  }
  context.state.currentUser = { role: "admin" };
  for (const status of ["confirmed", "cancelled", "completed", "no_show"]) {
    assert.equal(context.canConfirmAppointment({ status }), false);
  }
  const renderer = functionSource("renderAppointmentDetails");
  assert.match(renderer, /canConfirmAppointment\(appointment\)/);
  assert.match(renderer, /data-appointment-edit-action="confirm-appointment">Confirm Appointment/);
});

test("confirmation state displays the required immutable summary and explicit action", () => {
  const renderer = functionSource("renderAppointmentConfirmationForm");
  for (const label of [
    "Client", "Provider", "Service code", "Date", "Start time", "End time", "Service location", "Current status"
  ]) assert.match(renderer, new RegExp(label));
  assert.match(renderer, /Confirm this appointment as scheduled\?/);
  assert.match(renderer, /id="appointment-confirm-submit">Confirm Appointment/);
  assert.match(renderer, /operational review only/);
  assert.doesNotMatch(renderer, /name="(?:note|reason)"/i);
});

test("confirmation sends only confirmed status and the current expectedVersion", () => {
  const payload = functionSource("appointmentConfirmationPayload");
  assert.match(payload, /expectedVersion: Number\(state\.selectedAppointmentDetails\?\.version\)/);
  assert.match(payload, /status: "confirmed"/);
  for (const forbidden of [
    "clientId", "providerAssignments", "serviceCode", "scheduledStartAt", "scheduledEndAt",
    "locationSnapshot", "settingType", "zoneId", "sessionId", "soap", "planChangeLog"
  ]) assert.doesNotMatch(payload, new RegExp(forbidden, "i"));
});

test("confirmation prevents duplicate submission and refreshes details and calendar", () => {
  const handler = functionSource("handleConfirmAppointment", { async: true });
  assert.match(handler, /if \(state\.appointmentConfirmSubmitting/);
  assert.match(handler, /state\.appointmentConfirmSubmitting = true/);
  assert.match(handler, /Confirming appointment/);
  assert.match(handler, /await updateAppointment\(appointmentId, appointmentConfirmationPayload\(\)\)/);
  assert.match(handler, /await ensureScheduleWeekLoaded\(\{ force: true \}\)/);
  assert.match(handler, /await getAppointment\(appointmentId\)/);
  assert.match(handler, /Appointment confirmed successfully\./);
  const busy = functionSource("setAppointmentConfirmBusy");
  assert.match(busy, /submit\.disabled = isBusy \|\| state\.appointmentConfirmConflict/);
  assert.match(busy, /Confirming…/);
});

test("HTTP 409 confirmation state requires explicit reload or close without retry", () => {
  const handler = functionSource("handleConfirmAppointment", { async: true });
  assert.match(handler, /error\.status === 409/);
  assert.match(handler, /appointmentConfirmConflict = true/);
  assert.doesNotMatch(handler, /retry|auto.?merge/i);
  const renderer = functionSource("renderAppointmentConfirmationForm");
  assert.match(renderer, /This appointment was changed by another user\. Reload the latest version before confirming\./);
  assert.match(renderer, /Reload Latest Appointment/);
  assert.match(renderer, /Close Confirmation/);
  assert.match(functionSource("handleAppointmentDetailsAction"), /reload-confirmation[\s\S]*reloadLatestAppointment\(\{ confirmDiscard: false \}\)/);
});

test("confirmed appointments remain editable, cancellable, and visually distinct from completed sessions", () => {
  assert.doesNotMatch(functionSource("appointmentEditPayload"), /status:/);
  const cancelContext = { state: { currentUser: { role: "admin" }, selectedAppointmentDetails: null } };
  vm.runInNewContext([
    functionSource("canCancelAppointments"),
    functionSource("canCancelAppointment")
  ].join("\n"), cancelContext);
  assert.equal(cancelContext.canCancelAppointment({ status: "confirmed" }), true);
  const schedule = functionSource("renderSchedule");
  assert.match(schedule, /schedule-appointment-confirmed/);
  assert.match(schedule, /Confirmed appointment/);
  assert.match(schedule, /schedule-confirmed-label">Confirmed/);
  assert.match(schedule, /<article class="schedule-record">[\s\S]*Completed session/);
  assert.match(cssSource, /\.schedule-appointment-confirmed\s*\{/);
  assert.match(cssSource, /\.schedule-confirmed-label\s*\{/);
});

test("Cancel Appointment is available only to admin and BCBA and never repeats after cancellation", () => {
  const context = { state: { currentUser: null } };
  vm.runInNewContext(functionSource("canCancelAppointments"), context);
  for (const role of ["admin", "bcba"]) {
    context.state.currentUser = { role };
    assert.equal(context.canCancelAppointments(), true);
  }
  for (const role of ["rbt", "read-only"]) {
    context.state.currentUser = { role };
    assert.equal(context.canCancelAppointments(), false);
  }
  const renderer = functionSource("renderAppointmentDetails");
  assert.match(renderer, /canCancelAppointment\(appointment\)/);
  assert.match(renderer, /data-appointment-edit-action="cancel-appointment">Cancel Appointment/);
  assert.match(renderer, /!isCancelled/);
  assert.match(renderer, /appointment\.status === "cancelled"/);
  const beginEdit = functionSource("beginAppointmentEdit", { async: true });
  assert.match(beginEdit, /selectedAppointmentDetails\.status === "cancelled"/);
  const beginCancel = functionSource("beginAppointmentCancellation");
  assert.match(beginCancel, /!canCancelAppointment\(appointment\)/);
  const lifecycleContext = { state: { currentUser: { role: "admin" }, selectedAppointmentDetails: null } };
  vm.runInNewContext([
    functionSource("canCancelAppointments"),
    functionSource("canCancelAppointment")
  ].join("\n"), lifecycleContext);
  for (const status of ["scheduled", "confirmed"]) {
    assert.equal(lifecycleContext.canCancelAppointment({ status }), true);
  }
  for (const status of ["completed", "no_show", "cancelled"]) {
    assert.equal(lifecycleContext.canCancelAppointment({ status }), false);
  }
});

test("cancellation state shows the required appointment summary and explicit confirmation", () => {
  const renderer = functionSource("renderAppointmentCancellationForm");
  for (const label of [
    "Client", "Provider", "Service code", "Date", "Start time", "End time", "Service location", "Current status"
  ]) assert.match(renderer, new RegExp(label));
  assert.match(renderer, /name="category" required/);
  assert.match(renderer, /value="client">Client/);
  assert.match(renderer, /value="provider">Provider/);
  assert.match(renderer, /value="agency">Agency/);
  assert.match(renderer, /name="reason" required disabled/);
  assert.match(renderer, /name="note"[^>]*maxlength="360"/);
  assert.match(renderer, /Short operational note only; do not enter clinical narrative/);
  assert.match(renderer, /name="confirmed" value="yes" required/);
  assert.match(renderer, /The appointment will remain in scheduling history and will not be deleted/);
  assert.doesNotMatch(renderer, /soap|treatment plan|planChangeLog|billing|sessionId/i);
});

test("cancellation reasons are structured and filtered by category", () => {
  for (const [category, reasons] of Object.entries({
    client: ["client_cancelled", "illness", "vacation", "family_emergency", "no_show", "other"],
    provider: ["provider_cancelled", "provider_illness", "provider_pto", "provider_emergency", "other"],
    agency: ["agency_cancelled", "authorization_issue", "weather", "staffing_issue", "scheduling_error", "other"]
  })) {
    assert.match(appSource, new RegExp(`${category}:[\\s\\S]*${reasons.join("[\\s\\S]*")}`));
  }
  const options = functionSource("renderAppointmentCancellationReasonOptions");
  assert.match(options, /appointmentCancellationReasons\[category\] \|\| \[\]/);
  assert.match(options, /select\.disabled = !category/);
  assert.match(functionSource("handleAppointmentEditChange"), /name === "category"\) renderAppointmentCancellationReasonOptions\(\)/);
  const validation = functionSource("validateAppointmentCancellationForm");
  assert.match(validation, /Cancellation category is required/);
  assert.match(validation, /Cancellation reason is required/);
  assert.match(validation, /reason for the selected category/);
  assert.match(validation, /Confirm that this appointment should be cancelled/);
});

test("cancellation submits only the current version and structured operational cancellation values", () => {
  const payload = functionSource("appointmentCancellationPayload");
  assert.match(payload, /expectedVersion: Number\(state\.selectedAppointmentDetails\?\.version\)/);
  for (const field of ["category", "reason", "note"]) assert.match(payload, new RegExp(`${field}:`));
  for (const forbidden of ["sessionId", "soap", "planChangeLog", "treatmentPlan", "billing", "locationSnapshot", "providerAssignments"]) {
    assert.doesNotMatch(payload, new RegExp(forbidden, "i"));
  }
  assert.match(apiSource, /function cancelAppointment\(appointmentId, cancellation\)[\s\S]*\/cancel`[\s\S]*method: "POST"/);
});

test("cancellation prevents duplicate submission and refreshes details and the weekly calendar", () => {
  const handler = functionSource("handleCancelAppointment", { async: true });
  assert.match(handler, /if \(state\.appointmentCancelSubmitting/);
  assert.match(handler, /state\.appointmentCancelSubmitting = true/);
  assert.match(handler, /Cancelling appointment/);
  assert.match(handler, /await cancelAppointment\(appointmentId, appointmentCancellationPayload\(formData\)\)/);
  assert.match(handler, /await ensureScheduleWeekLoaded\(\{ force: true \}\)/);
  assert.match(handler, /await getAppointment\(appointmentId\)/);
  assert.match(handler, /Appointment cancelled successfully\. It remains in scheduling history\./);
  assert.match(handler, /preserveAppointmentDetailsOnScheduleRefresh = true/);
  const busy = functionSource("setAppointmentCancelBusy");
  assert.match(busy, /submit\.disabled = isBusy \|\| state\.appointmentCancelConflict/);
  assert.match(busy, /Cancelling…/);
});

test("HTTP 409 blocks stale cancellation and requires reload or close without auto-merge", () => {
  const handler = functionSource("handleCancelAppointment", { async: true });
  assert.match(handler, /error\.status === 409/);
  assert.match(handler, /appointmentCancelConflict = true/);
  assert.match(handler, /appointment-cancel-conflict/);
  assert.doesNotMatch(handler, /auto.?merge/i);
  const renderer = functionSource("renderAppointmentCancellationForm");
  assert.match(renderer, /This appointment was changed by another user\. Reload the latest version before cancelling\./);
  assert.match(renderer, /Reload Latest Appointment/);
  assert.match(renderer, /Close Cancellation/);
  assert.match(functionSource("closeAppointmentCancellation", { async: true }), /reloadLatestAppointment\(\{ confirmDiscard: false \}\)/);
});

test("cancelled appointments remain visible with CPT identity and explicit subdued status styling", () => {
  const renderer = functionSource("renderSchedule");
  assert.match(renderer, /scheduleAppointmentColorClass\(appointment\.serviceCode\)/);
  assert.match(renderer, /schedule-appointment-cancelled/);
  assert.match(renderer, /Cancelled appointment/);
  assert.match(renderer, /schedule-cancelled-label/);
  assert.match(renderer, /appointment\.status === "cancelled"/);
  assert.match(cssSource, /\.schedule-appointment-cancelled\s*\{[^}]*border-style:\s*dashed[^}]*repeating-linear-gradient/s);
  assert.match(cssSource, /\.schedule-cancelled-label\s*\{/);
});

test("cancelled appointment details show operational history with a readable actor and legacy category fallback", () => {
  const renderer = functionSource("renderAppointmentDetails");
  for (const label of [
    "Cancellation category", "Cancellation reason", "Cancellation note", "Cancelled date/time", "Cancelled by"
  ]) assert.match(renderer, new RegExp(label));
  assert.match(renderer, /appointment\.cancellationActor\?\.name/);
  assert.doesNotMatch(renderer, /cancellation\.cancelledBy/);
  assert.match(renderer, /appointment-details-cancelled/);
  const category = functionSource("appointmentCancellationCategory");
  assert.match(category, /cancellation\?\.category/);
  assert.match(category, /client_cancelled/);
  assert.match(category, /provider_cancelled/);
  assert.match(category, /agency_cancelled/);
  assert.match(category, /return ""/);
});

test("cancellation UI remains isolated from clinical records", () => {
  const sources = [
    functionSource("appointmentCancellationPayload"),
    functionSource("handleCancelAppointment", { async: true }),
    functionSource("beginAppointmentCancellation")
  ];
  for (const source of sources) {
    for (const forbidden of ["sessionId", "soap", "planChangeLog", "treatmentPlan", "graph", "funder", "billing", "noteHistory"]) {
      assert.doesNotMatch(source, new RegExp(forbidden, "i"));
    }
  }
});

test("creation payload and UI do not touch clinical records", () => {
  const payload = functionSource("appointmentFormPayload");
  const handler = functionSource("handleCreateAppointment", { async: true });
  for (const forbidden of ["sessionId", "soap", "planChangeLog", "treatmentPlan", "authorizationRef"]) {
    assert.doesNotMatch(payload, new RegExp(forbidden, "i"));
    assert.doesNotMatch(handler, new RegExp(forbidden, "i"));
  }
  assert.match(htmlSource, /This does not create a clinical session or SOAP note/);
});

test("appointment form is responsive without page-level horizontal scrolling", () => {
  assert.match(cssSource, /\.appointment-modal-panel\s*\{[^}]*width:\s*min\(860px, calc\(100vw - 32px\)\)/s);
  assert.match(cssSource, /\.appointment-modal-panel fieldset\s*\{[^}]*min-width:\s*0/s);
  assert.match(cssSource, /@media \(max-width: 780px\)[\s\S]*\.appointment-form-actions,[\s\S]*width:\s*100%/);
  assert.match(cssSource, /\.schedule-panel\s*\{[^}]*overflow:\s*hidden/s);
});
