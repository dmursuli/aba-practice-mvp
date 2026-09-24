import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
const destinations = ["clients", "users", "session", "schedule", "intake", "workflow", "plan", "parent", "graphs", "import", "report", "soap", "billing", "health", "audit"];
const groupedDestinations = ["clients", "session", "intake", "workflow", "plan", "parent", "graphs", "report", "soap", "schedule", "billing", "users", "import", "health", "audit"];
const expectedRoles = {
  admin: groupedDestinations,
  bcba: groupedDestinations,
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
const functions = ["syncWorkspaceNavigationGroups", "requestedWorkspaceState", "allowedViews", "applyRoleAccess", "currentView", "buildWorkspaceUrl", "syncWorkspaceUrl", "handleViewTabClick", "switchView"].map(source).join("\n");
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
    document.querySelectorAll('[data-navigation-category]').forEach(button => button.addEventListener('click', () => syncWorkspaceNavigationGroups(button.dataset.navigationCategory)));
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
  assert.deepEqual(await page.locator("[data-view-button]").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), groupedDestinations);
  assert.equal(await page.locator('[aria-current="page"]').getAttribute("data-view-button"), "session");
});

for (const [role, expected] of Object.entries(expectedRoles)) {
  test(`${role} retains exact navigation visibility and synchronized selection through every allowed destination`, async t => {
    const page = await fixture(t, role);
    assert.deepEqual(await page.locator("[data-view-button]:not(.hidden)").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), expected);
    assert.equal(await page.locator("[data-admin-user-management]").isVisible(), role === "admin");
    for (const view of expected) {
      if (["admin", "bcba"].includes(role)) {
        const category = Object.entries(groupViews).find(([, views]) => views.includes(view))[0].toLowerCase();
        await page.locator(`[data-navigation-category="${category}"]`).click();
      }
      await page.locator(`[data-view-button="${view}"]`).click();
      await page.waitForFunction(view => new URL(location.href).searchParams.get("view") === view, view);
      assert.deepEqual(await page.locator("[data-view-button].active").evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), [view]);
      assert.deepEqual(await page.locator('[data-view-button][aria-current="page"]').evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), [view]);
      assert.deepEqual(await page.locator("[data-view-panel]:not(.hidden)").evaluateAll(nodes => nodes.map(node => node.dataset.viewPanel)), [view]);
      assert.equal(new URL(page.url()).searchParams.get("client"), "synthetic-client");
      if (["admin", "bcba"].includes(role)) {
        const category = Object.entries(groupViews).find(([, views]) => views.includes(view))[0].toLowerCase();
        assert.equal(await page.locator('[data-navigation-category][aria-pressed="true"]').getAttribute('data-navigation-category'), category);
        assert.deepEqual(await page.locator('[data-view-button]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), groupViews[Object.keys(groupViews).find(name => name.toLowerCase() === category)]);
      }
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
  assert.equal(result.focusedView, "intake");
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
        outside: [...document.querySelectorAll("header *:not([data-navigation-category])")].some(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }),
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

const groupViews = {
  Clinical: ["clients", "session", "intake", "workflow", "plan", "parent", "graphs", "report", "soap"],
  Operations: ["schedule", "billing"],
  Administration: ["users", "import", "health", "audit"]
};

test("category exploration preserves the page and role transitions restore simple menus", async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.originalNavButtons = [...document.querySelectorAll('[data-view-button]')]; });
  for (const role of ["admin", "bcba", "rbt", "read-only", "admin"]) {
    await page.evaluate(role => { state.currentUser.role = role; applyRoleAccess(); }, role);
    const grouped = ["admin", "bcba"].includes(role);
    assert.equal(await page.getByRole("navigation", { name: "Workspace views" }).count(), 1);
    assert.equal(await page.locator("[data-view-button]").count(), 15);
    assert.equal(await page.evaluate(() => originalNavButtons.every(button => button.isConnected)), true);
    assert.deepEqual(await page.locator('[data-navigation-category]:visible').allTextContents(), grouped ? Object.keys(groupViews) : []);
    if (grouped) {
      for (const [name, views] of Object.entries(groupViews)) {
        const previousUrl = page.url();
        const current = await page.locator('[aria-current="page"]').getAttribute('data-view-button');
        await page.getByRole('button', { name, exact: true }).click();
        assert.equal(page.url(), previousUrl);
        assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-view-button'), current);
        assert.deepEqual(await page.locator('[data-view-panel]:not(.hidden)').evaluateAll(nodes => nodes.map(node => node.dataset.viewPanel)), [current]);
        assert.deepEqual(await page.locator('[data-view-button]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), views);
        assert.equal(await page.getByRole('group', { name, exact: true }).isVisible(), true);
        assert.equal(await page.locator('[data-navigation-category][aria-current]').count(), 0);
        // Hidden category destinations cannot appear in the keyboard sequence.
        await page.locator('[data-navigation-category="clinical"]').focus();
        const order = [];
        for (let i = 0; i < 4 + views.length; i++) {
          order.push(await page.evaluate(() => document.activeElement.dataset.navigationCategory || document.activeElement.id || document.activeElement.dataset.viewButton));
          await page.keyboard.press('Tab');
        }
        assert.deepEqual(order, ['clinical', 'operations', 'administration', 'workspace-client-select', ...views]);
      }
      await page.locator('[data-navigation-category="clinical"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-navigation-category="clinical"]').getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      assert.equal(await page.locator('[data-navigation-category="operations"]').getAttribute('aria-pressed'), 'true');
    } else {
      assert.deepEqual(await page.locator('[data-view-button]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.viewButton)), expectedRoles[role]);
      assert.equal(await page.locator('.view-nav-group[role="group"]').count(), 0);
      assert.equal(await page.locator('[data-navigation-group="clinical"]').evaluate(node => getComputedStyle(node).display), 'contents');
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-navigation-group="operations"] [data-view-button]').forEach(button => button.classList.add('hidden'));
    syncWorkspaceNavigationGroups('operations');
  });
  assert.equal(await page.locator('[data-navigation-category="operations"]').isVisible(), false);
  assert.equal(await page.locator('[data-navigation-group="operations"]').isVisible(), false);
});

test("direct view/client URLs and Meta/Ctrl/Shift clicks retain existing behavior", async t => {
  const page = await fixture(t);
  const requested = await page.evaluate(async () => {
    history.replaceState({}, '', '?view=graphs&client=synthetic-direct');
    const requested = requestedWorkspaceState();
    state.activeClientId = requested.clientId;
    await switchView(requested.view);
    return requested;
  });
  assert.deepEqual(requested, { view: "graphs", clientId: "synthetic-direct" });
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-view-button'), 'graphs');
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.evaluate(() => {
    window.openCalls = [];
    window.open = (...args) => { openCalls.push(args); return null; };
  });
  // Dispatch the browser click event directly: macOS may intercept a physical
  // Control-click as a context-menu gesture before the application receives it.
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey"]) {
    await page.locator('[data-view-button="schedule"]').dispatchEvent("click", { [modifier]: true });
    assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-view-button'), 'graphs');
  }
  const calls = await page.evaluate(() => openCalls);
  assert.equal(calls.length, 3);
  for (const [url, target, features] of calls) {
    assert.equal(new URL(url).searchParams.get("view"), "schedule");
    assert.equal(new URL(url).searchParams.get("client"), "synthetic-direct");
    assert.equal(target, "_blank");
    assert.equal(features, "noopener");
  }
});

test("direct destinations automatically reveal their category for both full roles", async t => {
  for (const role of ['admin', 'bcba']) {
    const page = await fixture(t, role);
    for (const [category, views] of Object.entries(groupViews)) {
      for (const view of views) {
        await page.evaluate(async view => {
          history.replaceState({}, '', `?view=${view}&client=synthetic-direct`);
          const requested = requestedWorkspaceState();
          state.activeClientId = requested.clientId;
          await switchView(requested.view);
        }, view);
        assert.equal(await page.locator('[data-navigation-category][aria-pressed="true"]').textContent(), category);
        assert.equal(await page.locator(`[data-view-button="${view}"]`).isVisible(), true);
        assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-view-button'), view);
      }
    }
  }
});

test("every role and category avoids page overflow at desktop, tablet and mobile widths", async t => {
  const page = await fixture(t);
  for (const role of Object.keys(expectedRoles)) {
    await page.evaluate(role => { state.currentUser.role = role; applyRoleAccess(); }, role);
    for (const width of [1440, 1024, 781, 780, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const category of (["admin", "bcba"].includes(role) ? Object.keys(groupViews) : [null])) {
        if (category) await page.getByRole('button', { name: category, exact: true }).click();
        const result = await page.evaluate(() => {
          const visible = [...document.querySelectorAll('[data-view-button]')].filter(node => node.getClientRects().length);
          const categories = document.querySelector('.navigation-categories');
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            outside: visible.some(node => { const r = node.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }),
            order: visible.every(node => getComputedStyle(node).order === '0'),
            belowCategories: !categories.getClientRects().length || visible.every(node => node.getBoundingClientRect().top >= categories.getBoundingClientRect().bottom),
            visibleGroups: [...document.querySelectorAll('.view-nav-group')].filter(node => !node.classList.contains('hidden')).length
          };
        });
        assert.equal(result.overflow, false, `${role}/${category} at ${width}px`);
        assert.equal(result.outside, false);
        assert.equal(result.order, true);
        assert.equal(result.belowCategories, true);
        assert.equal(result.visibleGroups, 1);
      }
    }
  }
});

test("desktop client context aligns right beside categories while destinations remain below", async t => {
  const page = await fixture(t);
  for (const width of [1440, 1024, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    const result = await page.evaluate(() => {
      const identity = document.querySelector('.workspace-identity').getBoundingClientRect();
      const context = document.querySelector('.workspace-navigation-context').getBoundingClientRect();
      const categories = document.querySelector('.navigation-categories').getBoundingClientRect();
      const picker = document.querySelector('.workspace-client-picker');
      const label = picker.querySelector('span');
      const select = picker.querySelector('select');
      const labelBox = label.getBoundingClientRect(), selectBox = select.getBoundingClientRect();
      const toolbar = document.querySelector('.workspace-toolbar').getBoundingClientRect();
      const logout = document.querySelector('#logout-button').getBoundingClientRect();
      const destinations = document.querySelector('[data-navigation-group]:not(.hidden)').getBoundingClientRect();
      return {
        selectWidth: selectBox.width,
        inline: labelBox.right < selectBox.left && labelBox.top < selectBox.bottom && labelBox.bottom > selectBox.top,
        label: label.textContent,
        transform: getComputedStyle(label).textTransform,
        associated: select.labels.length === 1 && select.labels[0] === picker,
        accountRightGap: toolbar.right - logout.right,
        clientRightGap: context.right - picker.getBoundingClientRect().right,
        identityAboveContext: identity.bottom <= context.top,
        categoriesBesideClient: categories.right <= picker.getBoundingClientRect().left,
        destinationsBelowContext: destinations.top >= context.bottom
      };
    });
    assert.ok(result.selectWidth >= 220 && result.selectWidth <= 240);
    assert.equal(result.inline, true);
    assert.equal(result.label, 'Client');
    assert.equal(result.transform, 'none');
    assert.equal(result.associated, true);
    assert.ok(Math.abs(result.accountRightGap) < 1);
    assert.ok(Math.abs(result.clientRightGap) < 1);
    assert.equal(result.identityAboveContext, true);
    assert.equal(result.categoriesBesideClient, true);
    assert.equal(result.destinationsBelowContext, true);
  }
});
