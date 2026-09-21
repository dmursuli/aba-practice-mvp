import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../public/api.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Zones subview is functional and contains the administrative editor", () => {
  const panel = html.slice(html.indexOf('id="schedule-subview-zones"'), html.indexOf('id="schedule-subview-capacity"'));
  assert.match(panel, /Provider Zones/); assert.match(panel, /provider-zone-provider/); assert.match(panel, /provider-zone-primary/); assert.match(panel, /provider-zone-acceptable/); assert.match(panel, /provider-zone-save/); assert.match(panel, /provider-zone-deactivate/); assert.doesNotMatch(panel, /No zone configuration/);
  assert.match(panel, /Primary zone is the provider’s preferred service area/);
  assert.match(panel, /do not currently block appointment scheduling/);
  assert.match(panel, /Primary service area/);
  assert.match(panel, /Additional service areas/);
  assert.match(panel, /Select any other areas this provider can cover/);
  assert.match(panel, /Save changes/);
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
  assert.match(css, /\.provider-zone-editor[\s\S]*max-width: 720px/);
  assert.match(css, /\.provider-zone-options[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.provider-zone-options[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.provider-zone-options[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.provider-zone-fieldset[^}]*min-width: 0/);
  assert.match(css, /\.provider-zone-option span[^}]*white-space: nowrap/);
});

test("additional service areas use accessible selectable chips with clear checked, focus, and disabled states", () => {
  assert.match(app, /<label class="provider-zone-option"><input type="checkbox"/);
  assert.match(css, /\.provider-zone-option:has\(input:checked\)/);
  assert.match(css, /\.provider-zone-option:focus-within/);
  assert.match(css, /\.provider-zone-option:has\(input:disabled\)/);
  assert.match(css, /\.provider-zone-option[^}]*cursor: pointer/);
  assert.match(css, /\.provider-zone-option span[^}]*text-align: left/);
});

test("Client Profile receives the same canonical zones without a municipality matrix", () => {
  const selector = html.slice(html.indexOf('id="service-location-zone"'), html.indexOf('id="service-location-primary"'));
  assert.doesNotMatch(selector, /optgroup|Tamiami|Florida City|Miami Beach/);
  assert.match(app, /state\.serviceZones/);
  assert.match(app, /renderServiceLocationZoneOptions/);
  assert.match(server, /serviceZones: SERVICE_ZONE_VALUES/);
});

test("legacy provider values are displayed explicitly and require an operational replacement before save", () => {
  assert.match(app, /legacyPrimary/);
  assert.match(app, /legacyAcceptable/);
  assert.match(app, /Legacy saved area/);
  assert.match(app, /providerZoneSaveButton\.disabled = disabled \|\| Boolean\(legacyPrimary\)/);
  assert.match(app, /Active · Version/);
  assert.match(app, /Inactive · Saving will reactivate version/);
  assert.match(app, /Not configured/);
});
