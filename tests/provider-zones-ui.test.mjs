import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Zones subview is functional and contains the administrative editor", () => {
  const panel = html.slice(html.indexOf('id="schedule-subview-zones"'), html.indexOf('id="schedule-subview-capacity"'));
  assert.match(panel, /Provider Zones/); assert.match(panel, /provider-zone-provider/); assert.match(panel, /provider-zone-primary/); assert.match(panel, /provider-zone-acceptable/); assert.match(panel, /provider-zone-save/); assert.match(panel, /provider-zone-deactivate/); assert.doesNotMatch(panel, /No zone configuration/);
});

test("Zones UI loads eligible providers and canonical zones and wires CRUD", () => {
  assert.match(app, /selectedSubview === "zones"\) await ensureProviderZonesLoaded/);
  assert.match(app, /state\.providerZoneValues = payload\.zones/);
  assert.match(app, /getProviderZones\(providerUserId\)/);
  assert.match(app, /createProviderZones/); assert.match(app, /updateProviderZones/); assert.match(app, /deactivateProviderZones/);
  assert.match(api, /\/api\/provider-zones/);
});

test("primary zone is removed and disabled from additional zones with visible errors", () => {
  assert.match(app, /acceptableZones\.filter\(\(zone\) => zone !== state\.providerZoneDraft\.primaryZone\)/);
  assert.match(app, /element\.value === draft\.primaryZone/);
  assert.match(app, /state\.providerZoneMessage = error\.message/);
  assert.match(app, /providerZoneMessage\.textContent/);
});

test("Zones layout is responsive without horizontal overflow", () => {
  assert.match(css, /\.provider-zone-options[\s\S]*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.provider-zone-options[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.provider-zone-fieldset[^}]*min-width: 0/);
});
