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
  assert.doesNotMatch(form, /name="(?:soap|behavior|treatment|clinical|assessment|recurrence|cancellation|confirmation|sessionId|planChangeLog)[^"]*"/i);
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

test("selecting an appointment opens a read-only details modal through the read endpoint", () => {
  const opener = functionSource("openAppointmentDetails", { async: true });
  assert.match(apiSource, /function getAppointment\(appointmentId[\s\S]*fetchWithTimeout\(`\/api\/appointments\/\$\{encodeURIComponent\(appointmentId\)\}`/);
  assert.match(opener, /selectedAppointmentDetails = null/);
  assert.match(opener, /appointmentDetailsLoading = true/);
  assert.match(opener, /await getAppointment\(appointmentId\)/);
  assert.match(opener, /requestId !== state\.appointmentDetailsRequestId/);
  assert.match(opener, /appointmentDetailsModal\.classList\.remove\("hidden"\)/);
  assert.match(htmlSource, /id="appointment-details-modal"[^>]*aria-hidden="true"/);
  assert.match(htmlSource, /aria-labelledby="appointment-details-title"/);
  assert.match(htmlSource, /Read-only operational appointment information/);
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
  assert.doesNotMatch(htmlSource.slice(htmlSource.indexOf('id="appointment-details-modal"'), htmlSource.indexOf('id="program-graph-modal"')), /Edit|Cancel|Confirm|Reschedule|Save/);
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
  assert.match(keydown, /closeAppointmentDetails\(\)/);
  assert.match(htmlSource, /class="modal-backdrop" data-close-appointment-details/);
  assert.match(appSource, /appointmentDetailsCloseButtons\.forEach[\s\S]*closeAppointmentDetails/);
  for (const source of [closer, keydown, functionSource("openAppointmentDetails", { async: true })]) {
    assert.doesNotMatch(source, /createAppointment|fetch\([^)]*,\s*\{|method:\s*"(?:POST|PUT|PATCH|DELETE)"|cancel|confirm|reschedule/i);
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
