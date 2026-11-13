// Integration regression check. Only a fresh, disposable Wealthfolio on loopback is accepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.WEALTHFOLIO_URL ?? 'http://127.0.0.1:8096';
const url = new URL(base);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a disposable Wealthfolio on loopback.');

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(res.ok, `${method} ${path}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

assert.equal((await api('GET', '/accounts')).length, 0, 'Refusing to seed an existing portfolio. Start a fresh disposable instance.');
await api('PUT', '/settings', { baseCurrency: 'EUR', timezone: 'Europe/Berlin', language: 'en', onboardingCompleted: true });
const account = await api('POST', '/accounts', { name: 'Synthetic brokerage', accountType: 'SECURITIES', currency: 'EUR', isDefault: true, isActive: true });
await api('POST', '/activities/bulk', { creates: [
  ['2025-01-02', 1000], ['2025-06-02', 500], ['2025-09-01', -200],
].map(([day, amount]) => ({
  accountId: account.id, activityType: amount > 0 ? 'DEPOSIT' : 'WITHDRAWAL', activityDate: day, amount: Math.abs(amount), currency: 'EUR',
})) });
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
await api('POST', '/addons/install-zip', {
  zipDataB64: readFileSync(new URL('../build/hindsight.zip', import.meta.url)).toString('base64'),
  enableAfterInstall: true, approvedNetworkHosts: manifest.network.allowedHosts,
});
const store = (key, value) => api('PUT', `/addons/storage/hindsight/${key}`, { value: JSON.stringify(value) });
await store('settings:benchmarks', [{ name: '', ticker: '', kind: 'cash' }]);
await store('settings:range', { preset: 'ALL' });
// Synthetic inflation cache keeps the layout test independent of financial data providers.
await store('oecd:v1:DEU', { f: Date.now(), from: '2024-12-01', d: {
  '2024-12': 100, [new Date().toISOString().slice(0, 7)]: 101,
} });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  for (const hasTouch of [false, true]) {
    const context = await browser.newContext({ hasTouch, viewport: { width: 412, height: 1000 } });
    const page = await context.newPage();
    // The older host may offer an application update while controls are being checked.
    await page.addLocatorHandler(page.getByRole('button', { name: 'Remind me later', exact: true }), (button) => button.click());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      for (const theme of ['light', 'dark']) {
        await api('PUT', '/settings', { theme });
        const frame = page.frameLocator('iframe').first();
        const marker = frame.getByRole('button', { name: /^(Show|Hide) markers$/ });
        // 1000px leaves an iframe of 768-1023px beside the sidebar: wide controls under the host's mobile CSS.
        for (const width of [360, 412, 1000, 1240]) {
          // Load at the target width: after a resize the host switches between phone and sidebar layout only
          // once its media hooks catch up, which on slow runners outlasts any check of the iframe itself.
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(`${base}/addons/hindsight`);
          await marker.waitFor({ timeout: 60_000 });
          const frameWidth = await frame.locator('body').evaluate(() => window.innerWidth);
          if (width === 1000) assert(frameWidth >= 768 && frameWidth < 1024, `1000px: iframe is ${frameWidth}px, not tablet-sized`);
          // Wait for the host's mobile hook and responsive components to settle after loading.
          await frame.locator(frameWidth >= 768
            ? '.hindsight-row-button.hindsight-add-benchmark:visible'
            : '.hindsight-row-icon.hindsight-add-benchmark:visible').waitFor();
          for (const enabled of [false, true]) {
            if ((await marker.getAttribute('aria-pressed')) !== String(enabled)) await marker.click();
            const layout = await marker.evaluate((button) => {
              const dates = document.querySelector('.hindsight-date-range > [data-no-swipe-drag]');
              const modeRow = button.parentElement;
              const pill = modeRow.querySelector('[role="group"]');
              const nodes = {
                filters: dates.parentElement.parentElement,
                dates, presets: dates.firstElementChild, modeRow, pill,
              };
              const details = (el) => {
                const r = el.getBoundingClientRect(), s = getComputedStyle(el);
                return { height: r.height, center: r.y + r.height / 2, overflowY: s.overflowY,
                  clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
                  verticalScrollbar: ['auto', 'scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight };
              };
              const visible = (el) => el.getBoundingClientRect().width > 0;
              const controls = {
                marker: button, scope: document.querySelector('[role="combobox"]'),
                calendar: dates.querySelector(':scope > button'),
                add: [...document.querySelectorAll('.hindsight-add-benchmark')].find(visible),
                help: document.querySelector('.hindsight-title-icon'),
                ...Object.fromEntries([...document.querySelectorAll('.hindsight-badge-remove')].filter(visible)
                  .map((el, i) => [`remove${i}`, el])),
              };
              // Every control's touch target (its ::after, if any) must survive all clipping boxes, the control's own
              // included, wherever the host's mobile .flex reset or a future wrapper turns one into a scroll container.
              // The pseudo-element is positioned against the padding box, so its used offsets and size give its rect.
              const clipped = [];
              const fmt = (a, b) => `${a.toFixed(1)}-${b.toFixed(1)}`;
              for (const [name, el] of Object.entries(controls)) {
                const r = el.getBoundingClientRect(), after = getComputedStyle(el, '::after');
                const target = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
                if (after.content !== 'none' && after.position === 'absolute') {
                  target.top = r.top + el.clientTop + parseFloat(after.top);
                  target.bottom = target.top + parseFloat(after.height);
                  target.left = r.left + el.clientLeft + parseFloat(after.left);
                  target.right = target.left + parseFloat(after.width);
                  if (!Object.values(target).every(Number.isFinite)) clipped.push(`${name}: unresolved ::after ${after.top}/${after.height}`);
                  // Small or coarse screens enlarge targets to 44px (WCAG 2.5.5); a border must not eat into it.
                  if (matchMedia('(max-width: 1023px), (pointer: coarse)').matches) {
                    for (const size of [target.bottom - target.top, target.right - target.left]) {
                      if (size < 43.5) clipped.push(`${name} target is ${size.toFixed(1)}px`);
                    }
                  }
                }
                for (let a = el; a && a !== document.body; a = a.parentElement) {
                  const s = getComputedStyle(a), ar = a.getBoundingClientRect();
                  const box = { top: ar.top + a.clientTop, left: ar.left + a.clientLeft };
                  box.bottom = box.top + a.clientHeight; box.right = box.left + a.clientWidth;
                  const where = `<${a.tagName.toLowerCase()} class="${a.className}">`;
                  if (s.overflowY !== 'visible' && (target.top < box.top - 0.5 || target.bottom > box.bottom + 0.5)) {
                    clipped.push(`${name} (${fmt(target.top, target.bottom)}) clipped vertically by ${where} (${fmt(box.top, box.bottom)}, ${s.overflowY})`);
                  }
                  // The badge carousel clips its slides horizontally on purpose; its edges are a scroll affordance.
                  if (s.overflowX !== 'visible' && a.dataset.slot !== 'carousel-content'
                    && (target.left < box.left - 0.5 || target.right > box.right + 0.5)) {
                    clipped.push(`${name} (${fmt(target.left, target.right)}) clipped horizontally by ${where} (${fmt(box.left, box.right)}, ${s.overflowX})`);
                  }
                }
              }
              const root = document.scrollingElement;
              return {
                rows: Object.fromEntries(Object.entries(nodes).map(([name, el]) => [name, details(el)])),
                ...Object.fromEntries(Object.entries(controls).map(([name, el]) => [name, details(el)])),
                clipped,
                horizontalOverflow: root.scrollWidth - root.clientWidth,
                calendarBackground: getComputedStyle(controls.calendar).backgroundColor,
              };
            });
            const where = `${theme}, touch=${hasTouch}, ${width}px, markers=${enabled}`;
            for (const [name, row] of Object.entries(layout.rows)) {
              assert(!row.verticalScrollbar, `${where}: ${name} scrolls vertically: ${JSON.stringify(row)}`);
              if (name !== 'presets') assert.equal(row.overflowY, 'visible', `${where}: ${name} clips touch targets`);
            }
            assert.deepEqual(layout.clipped, [], `${where}: clipped touch targets`);
            assert(layout.horizontalOverflow <= 0, `${where}: page overflows horizontally by ${layout.horizontalOverflow}px`);
            assert(!/^(transparent|rgba\(.*, 0\))$/.test(layout.calendarBackground), `${where}: calendar has no background`);
            assert.equal(layout.marker.height, 32, `${where}: marker button height`);
            assert.equal(layout.rows.pill.height, 32, `${where}: mode switch height`);
            assert(Math.abs(layout.marker.center - layout.rows.pill.center) < 0.5, `${where}: chart controls are misaligned`);
            for (const key of ['scope', 'calendar']) assert.equal(layout[key].height, 36, `${where}: ${key} height`);
            assert.equal(layout.rows.presets.height, 36, `${where}: period row height`);
            assert.equal(layout.add.height, 34, `${where}: add benchmark height`);
          }
        }
      }
      assert.deepEqual(errors, [], 'Browser errors');
    } finally {
      await context.close();
    }
  }
  console.log('Layout passed: 360/412/1000/1240px, light/dark, touch/mouse, markers off/on.');
} finally {
  await browser.close();
}
