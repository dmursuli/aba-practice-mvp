import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

function functionSource(name) {
  const marker = `function ${name}(`;
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

function asyncFunctionSource(name) {
  const marker = `async function ${name}(`;
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

test("Scheduling workspace has five subviews with Calendar active", () => {
  assert.match(htmlSource, /data-view-button="schedule">Scheduling</);
  assert.match(htmlSource, /data-view-panel="schedule"/);
  assert.match(htmlSource, /id="schedule-workspace-title">Scheduling workspace</);
  assert.match(htmlSource, /id="schedule-week-grid"/);
  const subviewButtons = htmlSource.match(/data-schedule-subview-button="(?:calendar|staffing|availability|zones|capacity)"/g) || [];
  const subviewPanels = htmlSource.match(/data-schedule-subview-panel="(?:calendar|staffing|availability|zones|capacity)"/g) || [];
  assert.equal(subviewButtons.length, 5);
  assert.equal(subviewPanels.length, 5);
  assert.match(htmlSource, /data-schedule-subview-button="calendar"[^>]*aria-selected="true"/);
  assert.match(htmlSource, /data-schedule-subview-panel="staffing"[\s\S]*No staffing business logic is active yet/);
  assert.match(htmlSource, /data-schedule-subview-panel="availability"[\s\S]*No availability records or calculations are active yet/);
  assert.match(htmlSource, /data-schedule-subview-panel="zones"[\s\S]*No zone configuration or assignment is active yet/);
  assert.match(htmlSource, /data-schedule-subview-panel="capacity"[\s\S]*No capacity calculations are active yet/);
});

test("Scheduling is available only to admin and BCBA roles", () => {
  const roleBlock = appSource.slice(
    appSource.indexOf("const roleViews"),
    appSource.indexOf("const domainOptions")
  );
  assert.match(roleBlock, /admin:\s*\[[^\]]*"schedule"/s);
  assert.match(roleBlock, /bcba:\s*\[[^\]]*"schedule"/s);
  assert.doesNotMatch(roleBlock, /rbt:\s*\[[^\]]*"schedule"/s);
  assert.doesNotMatch(roleBlock, /"read-only":\s*\[[^\]]*"schedule"/s);

  const switchBlock = asyncFunctionSource("switchView");
  assert.match(switchBlock, /if \(!allowedViews\(\)\.includes\(view\)\)/);
  assert.match(switchBlock, /if \(view === "schedule"\) await switchScheduleSubview\(state\.activeScheduleSubview\);/);
});

test("workspace subnavigation changes panels and loads data only for Calendar", () => {
  const block = asyncFunctionSource("switchScheduleSubview");
  assert.match(appSource, /activeScheduleSubview:\s*"calendar"/);
  assert.match(block, /\["calendar", "staffing", "availability", "zones", "capacity"\]/);
  assert.match(block, /button\.setAttribute\("aria-selected", String\(isActive\)\)/);
  assert.match(block, /panel\.classList\.toggle\("hidden"/);
  assert.match(block, /if \(selectedSubview === "calendar"\) await ensureScheduleWeekLoaded\(\);/);
});

test("week helpers render Monday through Sunday across month and year boundaries", () => {
  const context = {};
  vm.runInNewContext([
    functionSource("scheduleDateValue"),
    functionSource("scheduleMonday"),
    functionSource("addScheduleDays")
  ].join("\n"), context);

  const yearBoundaryMonday = context.scheduleMonday(new Date(2027, 0, 1));
  assert.equal(context.scheduleDateValue(yearBoundaryMonday), "2026-12-28");
  assert.equal(context.scheduleDateValue(context.addScheduleDays(yearBoundaryMonday, 6)), "2027-01-03");

  const monthBoundaryMonday = context.scheduleMonday(new Date(2026, 7, 1));
  assert.equal(context.scheduleDateValue(monthBoundaryMonday), "2026-07-27");
  assert.equal(context.scheduleDateValue(context.addScheduleDays(monthBoundaryMonday, 6)), "2026-08-02");
});

test("the weekly request is date bounded and uses a separate minimal cache", () => {
  const loadBlock = asyncFunctionSource("ensureScheduleWeekLoaded");
  const summaryBlock = functionSource("scheduleSessionSummary");

  assert.match(appSource, /scheduleSessions:\s*\[\]/);
  assert.match(loadBlock, /getVisibleSessions\(\{ startDate, endDate \}\)/);
  assert.match(loadBlock, /state\.scheduleSessions = \(payload\.sessions \|\| \[\]\)\.map\(scheduleSessionSummary\)/);
  assert.doesNotMatch(loadBlock, /state\.sessions\s*=/);
  assert.match(summaryBlock, /clientId:/);
  assert.match(summaryBlock, /serviceCode:/);
  assert.match(summaryBlock, /startTime:/);
  assert.match(summaryBlock, /endTime:/);
  assert.match(summaryBlock, /setting:/);
  assert.doesNotMatch(summaryBlock, /soapNote|finalizedSnapshot|amendments|providerSignature|therapist/);
});

test("legacy caregiver training is displayed under canonical service code 97156", () => {
  const block = functionSource("canonicalScheduleServiceCode");
  const context = {};
  vm.runInNewContext(block, context);

  assert.equal(context.canonicalScheduleServiceCode({ serviceType: "parent-training" }), "97156");
  assert.equal(context.canonicalScheduleServiceCode({ serviceType: "97153" }), "97153");
  assert.equal(context.canonicalScheduleServiceCode({}), "97153");
});

test("calendar records are explicitly historical and have loading, error, and empty states", () => {
  const block = functionSource("renderSchedule");

  assert.match(block, /Completed session/);
  assert.match(block, /Loading completed sessions/);
  assert.match(block, /Completed clinical records could not be loaded/);
  assert.match(block, /No completed sessions for this week/);
  assert.doesNotMatch(block, /appointment/i);
  assert.doesNotMatch(block, /soapNote|providerSignature|therapist/);
});

test("client and canonical service-code filters are wired to read-only rerendering", () => {
  assert.match(htmlSource, /id="schedule-client-filter"/);
  assert.match(htmlSource, /id="schedule-service-filter"/);
  assert.match(htmlSource, /<option value="">All clients<\/option>/);
  assert.match(htmlSource, /<option value="">All service codes<\/option>/);
  assert.match(htmlSource, /<option value="97153">97153<\/option>/);
  assert.match(htmlSource, /<option value="97156">97156<\/option>/);
  assert.match(appSource, /scheduleClientFilter\?\.addEventListener\("change", renderSchedule\)/);
  assert.match(appSource, /scheduleServiceFilter\?\.addEventListener\("change", renderSchedule\)/);
});

test("calendar is responsive without a page-level horizontal calendar layout", () => {
  assert.match(cssSource, /\.schedule-week-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(cssSource, /@media \(max-width: 1100px\)[\s\S]*?\.schedule-week-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(cssSource, /@media \(max-width: 780px\)[\s\S]*?\.schedule-week-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(cssSource, /\.schedule-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(cssSource, /\.schedule-subview\.hidden,\s*\.schedule-empty-state\.hidden\s*\{[^}]*display:\s*none/s);
});

test("workspace shell contains no scheduling persistence, mutation, or Zone Management logic", () => {
  assert.doesNotMatch(appSource, /appointments\s*:/);
  assert.doesNotMatch(appSource, /createAppointment|updateAppointment|deleteAppointment|cancelAppointment/);
  assert.doesNotMatch(appSource, /schedulingZones\s*:|zoneZip|zoneAdjacency|createZone|updateZone|deleteZone/);
  assert.doesNotMatch(htmlSource, /drag-and-drop|draggable|Create appointment|Edit appointment/);
  assert.doesNotMatch(htmlSource, /Create zone|Edit zone|ZIP-code association|travel-buffer rule/);
});
