import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
const destinations = ["clients", "users", "session", "schedule", "intake", "workflow", "plan", "parent", "graphs", "import", "report", "soap", "billing", "health", "audit"];
const expectedRoles = {
  admin: destinations,
  bcba: destinations,
  rbt: ["session", "graphs", "soap"],
  "read-only": ["graphs", "report", "soap"]
};

// Exercise the real shell functions; replace only out-of-scope feature loading.
function source(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = app.indexOf("\n}", start);
  return app.slice(start, end + 2);
}
const roleSource = app.match(/const roleViews = \{[\s\S]*?\n\};/)[0];
const functions = ["allowedViews", "applyRoleAccess", "currentView", "buildWorkspaceUrl", "syncWorkspaceUrl", "handleViewTabClick", "switchView"].map(source).join("\n");
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, role = "admin", width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  t.after(() => page.close());
  // Every request is fulfilled locally or blocked. No app server or real data.
  await page.route("**/*", route => route.request().url() === "http://127.0.0.1/shell-fixture"
    ? route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${header}${destinations.map(view => `<main data-view-panel="${view}" class="${view === "session" ? "" : "hidden"}"></main>`).join("")}<section data-admin-user-management>Synthetic admin controls</section></body></html>` })
    : route.abort());
  await page.goto("http://127.0.0.1/shell-fixture");
  await page.addScriptTag({ content: `
    const state = { currentUser: { role: ${JSON.stringify(role)} }, activeClientId: "synthetic-client", activeScheduleSubview: "calendar" };
    ${roleSource}
    function closeAppointmentDetails() {}
    function viewNeedsClientSessions() { return false; }
    function viewNeedsAllVisibleSessions() { return false; }
    ${["switchScheduleSubview", "refreshClientAssignments", "ensureTargetReviewsLoaded", "renderCharts", "refreshHistoricalImportBatches", "refreshHistoricalImportDuplicateMetadata", "renderFunderReportPreview", "renderBillingExport", "refreshAuditLog", "runDataHealthCheck", "refreshUsers", "refreshRbtFidelityHistory"].map(name => `async function ${name}() {}`).join("\n")}
    ${functions}
    document.querySelectorAll('[data-view-button]').forEach(button => button.addEventListener('click', event => handleViewTabClick(event, button.dataset.viewButton)));
    document.querySelector('#current-user-label').textContent = 'Synthetic User (Admin)';
    document.querySelector('#workspace-client-select').innerHTML = '<option value="synthetic-client">Synthetic Client</option><option value="long-client">Synthetic client with a very long multi-part name for shell layout testing only</option>';
    applyRoleAccess();
  ` });
  await page.waitForFunction(() => new URL(location.href).searchParams.has("view"));
  return page;
}

test("shell preserves identity, client/account controls, navigation order and panel hooks without a photograph", async t => {
  const page = await fixture(t);
  assert.equal(await page.locator("header img").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Triumph Workspace" }).count(), 1);
  assert.equal(await page.getByRole("combobox", { name: "Active client" }).count(), 1);
  assert.equal(await page.locator("#current-user-label").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Logout", exact: true }).count(), 1);
  assert.deepEqual([...html.matchAll(/data-view-panel="([^"]+)"/g)].map(match => match[1]).sort(), [...destinations].sort());
  assert.deepEqual(await page.locator("[data-view-button]").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), destinations);
  assert.equal(await page.locator('[aria-current="page"]').getAttribute("data-view-button"), "session");
});

for (const [role, expected] of Object.entries(expectedRoles)) {
  test(`${role} retains exact navigation visibility and synchronized selection through every allowed destination`, async t => {
    const page = await fixture(t, role);
    assert.deepEqual(await page.locator("[data-view-button]:visible").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), expected);
    assert.equal(await page.locator("[data-admin-user-management]").isVisible(), role === "admin");
    for (const view of expected) {
      await page.locator(`[data-view-button="${view}"]`).click();
      await page.waitForFunction(view => new URL(location.href).searchParams.get("view") === view, view);
      assert.deepEqual(await page.locator("[data-view-button].active").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), [view]);
      assert.deepEqual(await page.locator('[data-view-button][aria-current="page"]').evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), [view]);
      assert.deepEqual(await page.locator("[data-view-panel]:not(.hidden)").evaluateAll(nodes => nodes.map(node => node.dataset.viewPanel)), [view]);
      assert.equal(new URL(page.url()).searchParams.get("client"), "synthetic-client");
    }
    if (role === "rbt" || role === "read-only") {
      await page.evaluate(() => switchView("users"));
      assert.equal(await page.locator('[aria-current="page"]').getAttribute("data-view-button"), expected[0]);
      assert.equal(await page.locator('[data-view-button="users"]').isVisible(), false);
    }
  });
}

test("persistent selection marker is independent of keyboard focus", async t => {
  const page = await fixture(t);
  await page.locator('[data-view-button="session"]').click();
  await page.keyboard.press("Tab");
  const result = await page.evaluate(() => {
    const active = document.querySelector('[data-view-button="session"]');
    const focused = document.activeElement;
    return {
      focusedView: focused.dataset.viewButton,
      focusVisible: focused.matches(":focus-visible"),
      outline: getComputedStyle(focused).outlineStyle,
      outlineWidth: getComputedStyle(focused).outlineWidth,
      marker: getComputedStyle(active, "::after").content,
      markerHeight: getComputedStyle(active, "::after").height,
      focusedMarker: getComputedStyle(focused, "::after").content,
      current: active.getAttribute("aria-current")
    };
  });
  assert.equal(result.focusedView, "schedule");
  assert.equal(result.focusVisible, true);
  assert.equal(result.outline, "solid");
  assert.equal(result.outlineWidth, "3px");
  assert.equal(result.marker, '\"\"');
  assert.equal(result.markerHeight, "3px");
  assert.equal(result.focusedMarker, "none");
  assert.equal(result.current, "page");
});

test("desktop, tablet and mobile shell accommodates long names without overflow or overlapping toolbar controls", async t => {
  const page = await fixture(t);
  await page.locator("#current-user-label").evaluate(node => { node.textContent = `Synthetic ${"LongAccountName".repeat(12)} (Admin)`; });
  await page.getByRole("combobox", { name: "Active client" }).selectOption("long-client");
  for (const width of [1440, 1024, 820, 780, 768, 521, 520, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const result = await page.evaluate(() => {
      const selectors = [".workspace-identity", ".workspace-client-picker", ".user-box"];
      const boxes = selectors.map(selector => document.querySelector(selector).getBoundingClientRect().toJSON());
      const overlap = boxes.some((a, i) => boxes.slice(i + 1).some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
      const select = document.querySelector("#workspace-client-select");
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        outside: [...document.querySelectorAll("header *")].some(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }),
        overlap,
        selected: select.selectedOptions[0].textContent,
        selectWidth: select.getBoundingClientRect().width,
        navigationBelow: document.querySelector(".view-switcher").getBoundingClientRect().top >= document.querySelector(".workspace-toolbar").getBoundingClientRect().bottom,
        wrapping: getComputedStyle(document.querySelector(".view-switcher")).flexWrap
      };
    });
    assert.equal(result.overflow, false, `page overflow at ${width}px`);
    assert.equal(result.outside, false, `shell element outside viewport at ${width}px`);
    assert.equal(result.overlap, false, `toolbar overlap at ${width}px`);
    assert.ok(result.selectWidth >= 200, `usable client selector at ${width}px`);
    assert.match(result.selected, /very long multi-part name/);
    assert.equal(result.navigationBelow, true);
    assert.equal(result.wrapping, "wrap");
  }
});
