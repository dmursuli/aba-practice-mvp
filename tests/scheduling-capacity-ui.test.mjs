import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Capacity subview exposes read-only range and role filters with provider and client sections", () => {
  const panel = html.slice(html.indexOf('id="schedule-subview-capacity"'), html.indexOf('</section>\n      </section>', html.indexOf('id="schedule-subview-capacity"')));
  assert.match(panel, /Capacity &amp; Caseload/);
  assert.match(panel, /id="capacity-window"[\s\S]*This week[\s\S]*Next week[\s\S]*Next 4 weeks/);
  assert.match(panel, /id="capacity-role"[\s\S]*All providers[\s\S]*RBT[\s\S]*BCBA/);
  assert.match(panel, /id="capacity-provider-list"/);
  assert.match(panel, /id="capacity-client-list"/);
  assert.match(panel, /id="capacity-summary"/);
  assert.match(panel, /read-only/i);
  assert.doesNotMatch(panel, /<button|<form/);
});

test("Capacity UI loads the selected bounded range and rerenders role filters locally", () => {
  assert.match(api, /export async function getSchedulingCapacity/);
  assert.match(api, /\/api\/scheduling\/capacity/);
  assert.match(app, /if \(selectedSubview === "capacity"\) await loadSchedulingCapacity\(\)/);
  assert.match(app, /getSchedulingCapacity\(range\)/);
  assert.match(app, /capacityWindowSelect\?\.addEventListener\("change", handleCapacityWindowChange\)/);
  assert.match(app, /capacityRoleSelect\?\.addEventListener\("change", handleCapacityRoleChange\)/);
  assert.match(app, /state\.schedulingCapacityRole === "all" \|\| item\.provider\.role === state\.schedulingCapacityRole/);
});

test("Capacity cards distinguish availability gaps and client coverage without mutation actions", () => {
  assert.match(app, /Availability configured/);
  assert.match(app, /Not configured/);
  assert.match(app, /No RBT assigned/);
  assert.match(app, /Assigned — no 97153 scheduled/);
  assert.match(app, /97153 scheduled \+ confirmed/);
  assert.match(app, /Loading provider capacity/);
  assert.match(app, /state\.schedulingCapacityError = error\.message/);
  assert.doesNotMatch(app, /function (?:save|update|assign)SchedulingCapacity/);
  assert.match(css, /\.capacity-provider-list[^{]*\{[^}]*repeat\(2,/s);
  assert.match(css, /\.capacity-empty-state/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.capacity-provider-list[^}]*minmax\(0, 1fr\)/);
});
