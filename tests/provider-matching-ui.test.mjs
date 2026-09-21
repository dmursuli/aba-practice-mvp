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

test("Staffing tab provides the complete read-only matching request form", () => {
  const panel = html.slice(html.indexOf('id="schedule-subview-staffing"'), html.indexOf('id="schedule-subview-availability"'));
  for (const id of ["staffing-match-form", "staffing-client", "staffing-service", "staffing-location", "staffing-date", "staffing-start-time", "staffing-end-time", "staffing-find-providers", "staffing-results"]) {
    assert.match(panel, new RegExp(`id="${id}"`));
  }
  assert.match(panel, /Find providers for a service/);
  assert.match(panel, /recommendations only and will not assign or schedule anyone/);
  assert.doesNotMatch(panel, /Assign provider|Create appointment|Create recurring/i);
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

test("candidate cards show factual factors without scores, client details, or automatic actions", () => {
  const card = functionSource("staffingCandidateCard");
  assert.match(card, /candidate\.provider\.name/);
  assert.match(card, /candidate\.provider\.role/);
  assert.match(card, /candidate\.zone\.label/);
  assert.match(card, /candidate\.availability\.label/);
  assert.match(card, /candidate\.schedule\.label/);
  assert.doesNotMatch(card, /score|percent|clientId|clientName|Assign provider|Create appointment/i);
});

test("Staffing uses compact cards and collapses to one column without horizontal overflow", () => {
  assert.match(css, /\.staffing-match-form[^}]*max-width: 760px/);
  assert.match(css, /\.staffing-candidate-list[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.staffing-candidate-list[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.staffing-candidate-card[^}]*min-width: 0/);
});
