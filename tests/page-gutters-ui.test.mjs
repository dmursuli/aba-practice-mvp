import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const views = [...html.matchAll(/data-view-panel="([^"]+)"/g)].map(match => match[1]);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  // Static local markup only: no application scripts, backend, or external assets.
  await page.route("**/*", route => route.abort());
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, ""));
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    document.querySelector("#login-screen").classList.add("hidden");
    document.querySelector("#app-root").classList.remove("hidden");
    document.querySelector("#current-user-label").textContent = "Synthetic User (Admin)";
    document.querySelector("#workspace-client-select").innerHTML = '<option>Synthetic Client</option>';
  });
  return page;
}

async function showView(page, view) {
  await page.evaluate(view => {
    document.querySelectorAll("[data-view-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.viewPanel !== view));
  }, view);
}

for (const width of [1440, 1024, 781, 780, 768, 390, 320]) {
  test(`all page wrappers have aligned outer gutters at ${width}px`, async t => {
    const page = await fixture(t);
    await page.setViewportSize({ width, height: 1000 });
    for (const view of views) {
      await showView(page, view);
      const result = await page.locator(`[data-view-panel="${view}"]`).evaluate(panel => {
        const style = getComputedStyle(panel);
        const rect = panel.getBoundingClientRect();
        return {
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          left: rect.left,
          right: rect.right,
          top: rect.top,
          shellBottom: document.querySelector(".topbar").getBoundingClientRect().bottom,
          contentTop: rect.top + parseFloat(style.paddingTop),
          overflow: document.documentElement.scrollWidth - innerWidth
        };
      });
      const gutter = width > 780 ? 18 : 14;
      assert.deepEqual(result.padding, Array(4).fill(`${gutter}px`), view);
      assert.equal(result.left, 0, view);
      assert.equal(result.right, width, view);
      assert.equal(result.top, result.shellBottom, view);
      assert.equal(result.contentTop - result.shellBottom, gutter, view);
      assert.ok(result.overflow <= 1, `${view}: ${result.overflow}px horizontal overflow at ${width}px`);
    }
  });
}

test("content width variants and SOAP split/stack behavior are preserved", async t => {
  const page = await fixture(t);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [view, selector, maxWidth] of [["session", ".entry-panel", "1180px"], ["clients", ".client-panel", "980px"], ["schedule", ".schedule-panel", "1400px"]]) {
      await showView(page, view);
      assert.equal(await page.locator(selector).first().evaluate(node => getComputedStyle(node).maxWidth), maxWidth);
    }
    await showView(page, "soap");
    const layout = await page.locator(".soap-shell").evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(" ").length, gap: getComputedStyle(node).gap }));
    assert.equal(layout.columns, width > 1100 ? 2 : 1);
    assert.equal(layout.gap, "18px");
  }
});

test("report print overrides remove screen gutters at desktop and narrow widths", async t => {
  const page = await fixture(t);
  await showView(page, "report");
  await page.emulateMedia({ media: "print" });
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of [".report-shell", ".report-panel"]) {
      const style = await page.locator(selector).evaluate(node => {
        const s = getComputedStyle(node);
        return { padding: s.padding, maxWidth: s.maxWidth, display: s.display };
      });
      assert.deepEqual(style, { padding: "0px", maxWidth: "none", display: "block" });
    }
    assert.equal(await page.locator(".topbar").isVisible(), false);
    assert.equal(await page.locator("#funder-report-form").isVisible(), false);
  }
});
