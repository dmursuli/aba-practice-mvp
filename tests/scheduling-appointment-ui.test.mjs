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
    "clientId", "serviceCode", "providerUserId", "date", "startTime", "endTime", "timeZone", "settingType",
    "serviceLocationIndex", "notes"
  ]) {
    assert.match(form, new RegExp(`name="${name}"`));
  }
  for (const removedName of ["locationLabel", "addressLine1", "addressLine2", "city", "state", "postalCode"]) {
    assert.doesNotMatch(form, new RegExp(`name="${removedName}"`));
  }
  assert.match(form, /Service Location/);
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
          serviceLocations: [
            { id: "home-1", label: "Home", settingType: "home", addressLine1: "123 Main" },
            { id: "school-1", label: "School", settingType: "school", address: { city: "Miami", state: "FL" } }
          ]
        }
      ]
    }
  };
  vm.runInNewContext([
    functionSource("canonicalAppointmentSettingType"),
    functionSource("normalizeClientServiceLocation"),
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
  assert.equal(multiple[1].city, "Miami");
  assert.match(functionSource("renderAppointmentServiceLocations"), /if \(!multipleLocations\) select\.value = "0"/);
  assert.match(appSource, /clientId\?\.addEventListener\("change", renderAppointmentServiceLocations\)/);
});

test("selected service location is stored through the existing appointment snapshot", () => {
  const payload = functionSource("appointmentFormPayload");
  assert.match(payload, /selectedAppointmentServiceLocation\(formData\)/);
  assert.match(payload, /locationId: String\(serviceLocation\.id/);
  assert.match(payload, /label: String\(serviceLocation\.label/);
  assert.match(payload, /addressLine1: String\(serviceLocation\.addressLine1/);
  assert.doesNotMatch(payload, /formData\.get\("(?:locationLabel|addressLine1|addressLine2|city|state|postalCode)"\)/);
  assert.match(functionSource("validateAppointmentForm"), /no saved service location\. Update the Client Profile before scheduling/);

  const context = {
    state: {
      appointmentServiceLocations: [{
        id: "school-1",
        label: "School",
        settingType: "school",
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
    settingType: "school",
    serviceLocationIndex: "0",
    notes: "Use side gate."
  }));
  const createdPayload = context.appointmentFormPayload(formData);
  assert.equal(createdPayload.locationId, "school-1");
  assert.equal(createdPayload.locationSnapshot.label, "School");
  assert.equal(createdPayload.locationSnapshot.addressLine1, "456 School Way");
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

test("calendar loads appointments with sessions and renders distinct noninteractive blocks", () => {
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
  assert.doesNotMatch(renderer, /onclick|data-appointment-id|button/);
  assert.match(cssSource, /\.schedule-appointment-record\s*\{[^}]*border-left-color:\s*#7654a8[^}]*background:\s*#faf7ff/s);
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
