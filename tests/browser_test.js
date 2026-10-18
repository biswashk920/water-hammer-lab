// Browser test (Chromium via Playwright): loads the page, exercises every view and feature, fails on any console error.
// Usage: node tests/browser_test.js [outDir]   (needs: npm i playwright; npx playwright install chromium)
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
const path = require('path'), out = process.argv[2] || '/tmp/shots', url = 'file://' + path.resolve(__dirname, '../web/index.html');
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1300, height: 1000 } }), errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const wait = (ms) => page.waitForTimeout(ms), shot = (n) => page.screenshot({ path: `${out}/${n}.png` }), set = async (id, v) => { await page.fill('#' + id, String(v)); };
  const fps = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) errors.push('check failed: ' + m); };
  await page.goto(url); await wait(1200); await shot('01_2d_default');
  ok(await page.evaluate(() => !!document.querySelector('#kv b')), 'readouts rendered');
  await page.click('[data-v="3d"]'); await wait(1500); await shot('02_3d_default');
  const items = await page.evaluate(() => V3.stats.items); ok(items > 1000, `3D scene draws ${items} polygons`);
  console.log('3D scene fps:', await fps());
  await page.selectOption('#prof', '0,25,50'); await page.check('#tank'); await wait(1200); await shot('03_3d_hill_tank');
  ok(await page.evaluate(() => !!S.tank && S.z[50] > 24), 'hill profile and tank active');
  await page.click('[data-cam="side"]'); await wait(500); await shot('04_3d_side');
  await page.check('#cut'); await page.click('[data-cam="iso"]'); await wait(500); await shot('05_3d_cutaway'); await page.uncheck('#cut');
  await page.click('[data-v="surf"]'); await wait(1200); await shot('06_surface');
  console.log('surface fps:', await fps());
  await page.click('[data-v="3d"]'); await set('sy', 30); await set('Tc', 0.5); await wait(400); await page.uncheck('#tank'); await page.selectOption('#prof', '0,0,50'); await wait(3500); await shot('07_3d_burst');
  ok(await page.evaluate(() => !!A.burst && age !== null), 'burst detected and animating in 3D');
  await page.click('[data-v="surf"]'); await wait(800); await shot('08_surface_burst');
  await page.click('[data-v="2d"]'); await wait(800); await shot('09_2d_burst');
  await set('sy', 240); await set('e', 8); await page.selectOption('#prof', '0,0,50'); await set('Tc', 2); await wait(1500);
  await page.check('#tank'); await set('tH', 99); await set('tD', 0.4); await page.click('[data-v="3d"]'); await wait(5000); await shot('10_3d_tank_overflow');
  ok(await page.evaluate(() => S.tank.spill >= 0), 'tank overflow occurs and is shown');
  await set('V0', 9); await wait(900); ok((await page.textContent('#msg')).includes('Friction loss'), 'friction error message shown with numbers');
  // --- extra checks: mouse interaction, crest error, 2D with elevation + tank, phone viewport
  await set('V0', 1); await wait(800); await page.click('[data-v="3d"]'); await page.selectOption('#prof', '0,25,50'); await wait(1000);
  const box = await page.locator('#v3').boundingBox(), y0 = await page.evaluate(() => V3.cam.yaw), d0 = await page.evaluate(() => V3.cam.dist);
  await page.mouse.move(box.x + 300, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 420, box.y + 230, { steps: 6 }); await page.mouse.up();
  ok(Math.abs((await page.evaluate(() => V3.cam.yaw)) - y0) > 0.3, 'dragging rotates the camera');
  await page.mouse.wheel(0, -400); await wait(200); ok((await page.evaluate(() => V3.cam.dist)) < d0, 'wheel zooms');
  await page.check('#auto'); await wait(700); await shot('11_3d_after_drag_autorotate'); await page.uncheck('#auto');
  await set('zm', 250); await wait(900); ok((await page.textContent('#msg')).includes('crest'), 'crest above the hydraulic grade line is reported');
  await set('zm', 25); await set('tH', 130); await set('tD', 3); await wait(900); await page.click('[data-v="2d"]'); await wait(700); await shot('12_2d_hill_tank');
  await page.setViewportSize({ width: 390, height: 900 }); await wait(500); await page.click('[data-v="3d"]'); await wait(800); await shot('13_phone_3d');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 392), 'no horizontal overflow on a 390 px phone');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
  await browser.close(); process.exit(errors.length ? 1 : 0);
})();
