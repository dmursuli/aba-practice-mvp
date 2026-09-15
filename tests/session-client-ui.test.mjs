import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("session program cards expose the canonical objective in a closed compact disclosure", () => {
  const template = html.match(/<template id="program-template">([\s\S]*?)<\/template>/)?.[1] || "";
  assert.match(template, /<details class="program-objective" data-program-objective-details hidden>/);
  assert.match(template, /<summary>View objective<\/summary>/);
  assert.doesNotMatch(template, /data-program-objective-details[^>]*\sopen(?:\s|>)/);
  assert.match(app, /program\?\.objective \|\| program\?\.description \|\| program\?\.instructions/);
  assert.match(app, /objectiveDetails\.hidden = !objective/);
});

test("the single Add Client form is collapsed near the top and contains no agency field", () => {
  assert.equal((html.match(/id="new-client-form"/g) || []).length, 1);
  assert.ok(html.indexOf('id="toggle-new-client"') < html.indexOf('id="client-profile-form"'));
  assert.ok(html.indexOf('id="new-client-form"') < html.indexOf('id="client-profile-form"'));
  const form = html.match(/<form id="new-client-form"([\s\S]*?)<\/form>/)?.[0] || "";
  assert.match(form, /class="session-form hidden"/);
  assert.match(form, /id="cancel-new-client"/);
  assert.doesNotMatch(form, /agency/i);
});

test("Add Client open, cancel, and successful creation reuse and reset the existing form", () => {
  assert.match(app, /toggleNewClientButton\?\.addEventListener\("click", toggleNewClientForm\)/);
  assert.match(app, /cancelNewClientButton\?\.addEventListener\("click", closeNewClientForm\)/);
  assert.match(app, /function closeNewClientForm\(\)[\s\S]*?newClientForm\.reset\(\)[\s\S]*?classList\.add\("hidden"\)/);
  assert.match(app, /handleNewClientSubmit[\s\S]*?createClient\([\s\S]*?setActiveClient\(client\.id\)[\s\S]*?closeNewClientForm\(\)/);
});
