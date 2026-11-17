// Run from the repository root: node website/qa/contact-form.cjs
// Uses the repository's existing Playwright. All submissions are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

async function main() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let mode = 'success', posts = [], release;
    await page.route('**/*', async route => {
      const req = route.request();
      if (!req.url().startsWith(base)) return route.abort();
      if (req.method() !== 'POST') return route.continue();
      posts.push({ url: req.url(), body: new URLSearchParams(req.postData()), headers: req.headers() });
      if (mode === 'network') return route.abort('failed');
      if (mode === 'timeout') return;
      if (mode === 'delayed') await new Promise(resolve => { release = resolve; });
      return route.fulfill({ status: mode === 'error' ? 500 : 200, contentType: 'text/html', body: mode === 'fallback' ? html : '<p>Thank you</p>' });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const open = async (query = '?utm_source=google&utm_medium=cpc&utm_campaign=miami_aba&email=private%40example.com#contact') => {
      await page.goto('about:blank');
      await page.goto(base + '/' + query);
      await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    };
    const fill = async () => {
      await page.locator('[name="name"]').fill('Test Caregiver');
      await page.locator('[name="email"]').fill('synthetic@example.com');
      await page.locator('[name="phone"]').fill('(305) 555-0123');
      await page.locator('[name="preferred_contact_method"]').selectOption('Email');
      await page.locator('[name="privacyAcknowledgment"]').check();
    };
    const send = () => page.locator('#consultation-form button').click();
    const status = () => page.locator('#form-status').textContent();
    await open();
    assert.equal(await page.locator('form[data-netlify="true"][name="consultation"][netlify-honeypot="bot-field"]').count(), 1);
    assert.equal(await page.locator('[name="bot-field"]').isVisible(), false);
    await send(); assert.equal(posts.length, 0);
    await fill();
    await page.locator('[name="email"]').fill('invalid');
    await send(); assert.equal(posts.length, 0);
    await page.locator('[name="email"]').fill('synthetic@example.com');
    await page.locator('[name="phone"]').fill('-------');
    await send(); assert.equal(posts.length, 0);
    await fill();
    await page.locator('[name="privacyAcknowledgment"]').uncheck();
    await send(); assert.equal(posts.length, 0);
    await fill();
    await page.locator('[name="bot-field"]').evaluate(el => { el.value = 'bot'; });
    await send(); assert.equal(posts.length, 0);
    await page.locator('[name="bot-field"]').evaluate(el => { el.value = ''; });
    mode = 'delayed';
    await send();
    await page.waitForFunction(() => document.querySelector('form').getAttribute('aria-busy') === 'true');
    await page.locator('form').evaluate(el => el.dispatchEvent(new Event('submit', { cancelable: true })));
    assert.equal(posts.length, 1);
    assert.equal(await page.locator('form button').isDisabled(), true);
    assert.match(await status(), /Sending/);
    release();
    await page.waitForFunction(() => document.querySelector('#form-status').textContent.startsWith('Thank you'));
    assert.equal(posts[0].body.get('utm_source'), 'google');
    assert.equal(posts[0].body.get('referral_source'), '');
    assert.equal(posts[0].body.get('landing_page'), 'https://triumphbehavioral.com/');
    assert.equal(posts[0].body.get('form-name'), 'consultation');
    assert.equal(posts[0].body.get('bot-field'), '');
    assert.ok(Date.parse(posts[0].body.get('submitted_at')));
    assert.equal(posts[0].url, base + '/');
    assert.equal(posts[0].headers.referer, undefined);
    assert.equal(await page.locator('[name="email"]').inputValue(), '');
    assert.equal(await page.locator('form button').isDisabled(), true);
    for (const failure of ['error', 'network', 'fallback', 'timeout']) {
      mode = failure; await open(); await fill();
      if (failure === 'timeout') await page.evaluate(() => { const original = window.setTimeout; window.setTimeout = (fn, ms) => original(fn, ms === 20000 ? 50 : ms); });
      await send();
      await page.waitForFunction(() => document.querySelector('#form-status').textContent.startsWith('We could not'));
      assert.equal(await page.locator('[name="email"]').inputValue(), 'synthetic@example.com');
      assert.equal(await page.locator('form button').isDisabled(), false);
    }
    mode = 'success';
    await open('?utm_source=private%40example.com&utm_medium=305-555-0123&utm_campaign=https%3A%2F%2Fexample.com%2Fprivate#contact');
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) assert.equal(await page.locator(`[name="${key}"]`).inputValue(), '');
    await fill(); await page.locator('[name="referral_source"]').selectOption('Friend/Family Referral'); await send();
    await page.waitForFunction(() => document.querySelector('#form-status').textContent.startsWith('Thank you'));
    assert.equal(posts.at(-1).body.get('referral_source'), 'Friend/Family Referral');
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 950 }); await open();
      await page.locator('#contact').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      await page.locator('#contact').screenshot({ path: `/tmp/triumph-contact-${width}.png` });
      assert.equal(await page.locator('a[href^="#"]').evaluateAll(links => links.filter(a => !document.getElementById(a.hash.slice(1)))).then(x => x.length), 0);
      if (width === 390) {
        await page.locator('.nav-toggle').click();
        assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'true');
        await page.locator('#site-nav a[href="#contact"]').click();
        assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
      }
    }
    const missing = await page.locator('img[src^="./"]').evaluateAll(imgs => imgs.map(i => i.getAttribute('src')));
    for (const src of missing) assert.ok(fs.existsSync(path.join(root, src)), src);
    assert.deepEqual(errors, []);
    console.log('PASS: static form definition, validation, honeypot, attribution, success, duplicate guard, failures/retry, timeout, privacy, responsive layouts, navigation and local assets. No real submissions sent.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
