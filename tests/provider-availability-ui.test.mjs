import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return appSource.slice(start, end);
}

test("Availability is a functional Scheduling subview with provider, date, timezone, week, and actions", () => {
  const panel = htmlSource.slice(
    htmlSource.indexOf('id="schedule-subview-availability"'),
    htmlSource.indexOf('id="schedule-subview-zones"')
  );
  assert.match(panel, /Provider Availability/);
  assert.match(panel, /Manage recurring provider availability/);
  assert.match(panel, /provider-configuration-editor provider-availability-editor/);
  assert.match(panel, /id="provider-availability-provider"/);
  assert.match(panel, /name="effectiveDate"/);
  assert.match(panel, /name="timezone" value="America\/New_York"/);
  assert.match(panel, /id="provider-availability-week"/);
  assert.match(panel, /id="provider-availability-save"/);
  assert.match(panel, /id="provider-availability-deactivate"/);
  assert.doesNotMatch(panel, /No availability records or calculations are active yet/);
});

test("Availability API client exposes list, read, create, update, and deactivate routes", () => {
  assert.match(apiSource, /function getProviderAvailabilityProfiles\(\)[\s\S]*fetch\("\/api\/provider-availability"\)/);
  assert.match(apiSource, /function getProviderAvailability\(providerUserId\)[\s\S]*encodeURIComponent\(providerUserId\)/);
  assert.match(apiSource, /function createProviderAvailability\(availability\)[\s\S]*method: "POST"/);
  assert.match(apiSource, /function updateProviderAvailability\(providerUserId, availability\)[\s\S]*method: "PUT"/);
  assert.match(apiSource, /function deactivateProviderAvailability\(providerUserId, expectedVersion\)[\s\S]*\/deactivate/);
});

test("Availability loads only when its subview opens and selector changes read one provider", () => {
  const switchSource = sourceBetween("async function switchScheduleSubview", "function scheduleMonday");
  assert.match(switchSource, /selectedSubview === "availability"\) await ensureProviderAvailabilityLoaded\(\)/);
  assert.match(appSource, /providerAvailabilityProvider\?\.addEventListener\("change", handleProviderAvailabilityProviderChange\)/);
  assert.match(appSource, /state\.providerAvailabilityProviders = payload\.providers \|\| \[\]/);
  assert.match(appSource, /state\.selectedProviderAvailabilityUserId = state\.providerAvailabilityProviders\[0\]\?\.id \|\| ""/);
  assert.match(appSource, /getProviderAvailability\(providerUserId\)/);
  assert.match(appSource, /Select an active BCBA or RBT provider/);
});

test("weekly editor renders all days and preserves form values while adding or removing blocks", () => {
  assert.match(appSource, /\["monday", "Monday"\]/);
  assert.match(appSource, /\["sunday", "Sunday"\]/);
  assert.match(appSource, /data-availability-action="add"/);
  assert.match(appSource, /data-availability-action="remove"/);
  assert.match(appSource, /syncProviderAvailabilityDraftFromForm\(\);[\s\S]*blocks\.push\(\{ start: "09:00", end: "17:00" \}\)/);
  assert.match(appSource, /blocks\.splice\(Number\(button\.dataset\.index\), 1\)/);
  assert.match(appSource, /No availability configured/);
});

test("save chooses create or versioned update, deactivate is versioned, and errors remain visible", () => {
  const saveSource = sourceBetween("async function handleSaveProviderAvailability", "async function handleDeactivateProviderAvailability");
  const deactivateSource = sourceBetween("async function handleDeactivateProviderAvailability", "function scheduleMonday");
  assert.match(saveSource, /validateProviderAvailabilityDraft/);
  assert.match(saveSource, /updateProviderAvailability/);
  assert.match(saveSource, /expectedVersion: state\.providerAvailabilityProfile\.version/);
  assert.match(saveSource, /createProviderAvailability/);
  assert.match(saveSource, /providerUserId: state\.selectedProviderAvailabilityUserId/);
  assert.match(saveSource, /state\.providerAvailabilityMessage = error\.message/);
  assert.match(deactivateSource, /window\.confirm/);
  assert.match(deactivateSource, /deactivateProviderAvailability\(profile\.providerUserId, profile\.version\)/);
  assert.match(appSource, /providerAvailabilityMessage\.textContent = state\.providerAvailabilityMessage/);
});

test("client validation covers date, timezone, HH:MM, ordering, duplicates, overlap, and cross-midnight", () => {
  const validation = sourceBetween("function validateProviderAvailabilityDraft", "async function handleProviderAvailabilityProviderChange");
  assert.match(validation, /Date\.UTC/);
  assert.match(validation, /Intl\.DateTimeFormat/);
  assert.match(validation, /timePattern/);
  assert.match(validation, /block\.start >= block\.end/);
  assert.match(validation, /cross-midnight blocks are not supported/);
  assert.match(validation, /duplicate availability block/);
  assert.match(validation, /availability blocks must not overlap/);
  assert.match(validation, /\.sort\(/);
});

test("Availability layout is responsive and avoids fixed-width weekly rows", () => {
  assert.match(cssSource, /\.provider-configuration-editor[^}]*max-width: 720px/);
  assert.match(cssSource, /\.provider-configuration-toolbar,[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(cssSource, /\.provider-availability-block\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) auto/);
  assert.match(cssSource, /@media \(max-width: 780px\)[\s\S]*\.provider-availability-toolbar,[\s\S]*\.provider-availability-block[\s\S]*grid-template-columns: 1fr/);
  assert.match(cssSource, /\.provider-availability-day\s*\{[\s\S]*min-width: 0/);
});

test("Availability uses the shared compact status, actions, and empty-state language", () => {
  assert.match(htmlSource, /id="provider-availability-status"/);
  assert.match(htmlSource, /id="provider-availability-save">Save changes/);
  assert.match(htmlSource, /id="provider-availability-deactivate">Deactivate profile/);
  assert.match(appSource, /No availability profile configured for this provider/);
  assert.match(appSource, /providerAvailabilityStatus\.dataset\.status/);
  assert.match(appSource, /providerAvailabilityMessage\.dataset\.tone/);
});
