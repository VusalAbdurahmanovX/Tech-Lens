import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { collect, detect } from '../extension/detector.mjs';

const extension = fileURLToPath(new URL('../extension', import.meta.url));
const rules = JSON.parse(await readFile(join(extension, 'technologies.json'), 'utf8'));
assert.equal(new Set(rules.map(rule => rule.name)).size, rules.length);
for (const rule of rules) {
  assert(/^[a-z0-9]+\.(svg|png|ico)$/.test(rule.icon), rule.name);
  assert((await readFile(join(extension, 'icons', rule.icon))).length > 0, rule.name);
}
for (const rule of rules) for (const pattern of rule.patterns) new RegExp(pattern.regex, 'i');
const signal = (type, key, value) => ({ type, key, value });
const result = detect({ signals: [
  signal('meta', 'generator', 'WordPress 6.8'),
  signal('asset', '', 'https://example.org/wp-content/themes/site/main.js'),
  signal('global', 'jQuery.fn.jquery', '3.7.1'),
  signal('asset', '', 'https://www.googletagmanager.com/gtag/js'),
  signal('css', 'tailwind', '--tw-ring'),
] }, rules);
assert.equal(result.find(item => item.name === 'WordPress').version, '6.8');
assert.equal(result.filter(item => item.name === 'WordPress').length, 1);
assert.equal(result.find(item => item.name === 'jQuery').version, '3.7.1');
assert.equal(result.find(item => item.name === 'Tailwind CSS').confidence, 'possible');
assert(!result.some(item => item.name === 'Google Analytics'));
assert.deepEqual(detect({ signals: [] }, rules), []);
assert.deepEqual(detect({ signals: [signal('asset', '', 'https://fake.example/cdn.shopify.com/app.js')] }, rules), []);
assert.equal(detect({ signals: [signal('global', 'jQuery.fn.jquery', '<img onerror=alert(1)>')] }, rules).length, 0);
console.log(`PASS: ${rules.length} rules, versions, evidence, empty and misleading signals`);

if (!process.env.CHROME) process.exit(0);
const temp = await mkdtemp(join(tmpdir(), 'tech-lens-check-'));
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><meta name="generator" content="WordPress 6.8"><style>:root{--tw-ring-color:red}</style></head><body><div id="root"></div><svg class="lucide"></svg><script type="application/json" src="/_next/static/test.js"></script><script>window.jQuery={fn:{jquery:'3.7.1'}};document.getElementById('root').__reactFiber$fixture={};</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let ws;
try {
  await cp(extension, join(temp, 'extension'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(temp, 'extension/manifest.json'), 'utf8'));
  // Test-only localhost access substitutes the toolbar gesture in headless Chrome.
  if (process.env.TEST_ACCESS) manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(join(temp, 'extension/manifest.json'), JSON.stringify(manifest));
  browser = spawn(process.env.CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temp}/profile`, `--disable-extensions-except=${temp}/extension`, `--load-extension=${temp}/extension`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    browser.on('error', reject);
    browser.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const attach = async targetId => (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const evaluate = async (session, expression) => {
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    assert(!answer.exceptionDetails, JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  };
  const until = async fn => {
    for (let i = 0; i < 80; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Browser assertion timed out');
  };
  const workerSession = await until(async () => {
    for (const target of (await call('Target.getTargets')).targetInfos.filter(target => target.type === 'service_worker' && target.url.endsWith('/background.js'))) {
      const session = await attach(target.targetId);
      if (await evaluate(session, 'typeof chrome !== "undefined" && chrome.runtime?.getManifest().name === "Tech Lens"')) return session;
      await call('Target.detachFromTarget', { sessionId: session });
    }
    return null;
  });
  const extensionId = await evaluate(workerSession, 'chrome.runtime.id');
  const page = await call('Target.createTarget', { url: origin });
  const pageSession = await attach(page.targetId);
  await until(() => evaluate(pageSession, 'document.readyState === "complete"'));
  const snapshot = await evaluate(pageSession, `(${collect.toString()})(${JSON.stringify(rules)})`);
  const found = detect(snapshot, rules);
  for (const name of ['WordPress', 'React', 'Next.js', 'jQuery', 'Lucide', 'Tailwind CSS']) assert(found.some(item => item.name === name), name);
  await evaluate(workerSession, `chrome.tabs.query({}).then(tabs=>chrome.tabs.update(tabs.find(tab=>tab.url?.startsWith(${JSON.stringify(origin)})).id,{active:true}))`);
  const panel = await call('Target.createTarget', { url: `chrome-extension://${extensionId}/panel.html`, background: true });
  const panelSession = await attach(panel.targetId);
  if (!process.env.TEST_ACCESS) {
    await until(() => evaluate(panelSession, 'document.getElementById("status")?.textContent.includes("Unable to scan")'));
    assert.equal(await evaluate(panelSession, 'document.getElementById("site").textContent'), '127.0.0.1');
    assert(await evaluate(panelSession, 'document.getElementById("copy").disabled'));
    // Simulate declining the native prompt; verify the exact origin and retry path.
    await evaluate(panelSession, `chrome.permissions.request = async options => { window.requestedOrigins = options.origins; return false; };document.getElementById("scan").click()`);
    await until(() => evaluate(panelSession, 'document.getElementById("status").textContent.includes("Site access was denied")'));
    assert.deepEqual(await evaluate(panelSession, 'window.requestedOrigins'), ['http://127.0.0.1/*']);
    console.log('PASS: production manifest, missing permission, current-site request and denial');
  } else {
  await until(() => evaluate(panelSession, 'document.querySelectorAll(".tech").length === 6'));
  assert.equal(await evaluate(panelSession, 'document.getElementById("site").textContent'), '127.0.0.1');
  await evaluate(panelSession, 'document.getElementById("filter").value="jQuery";document.getElementById("filter").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate(panelSession, 'document.querySelectorAll(".tech").length'), 1);
  assert.equal(await evaluate(panelSession, 'document.querySelector(".version").textContent'), '3.7.1');
  await evaluate(panelSession, 'document.getElementById("filter").value="";document.getElementById("filter").dispatchEvent(new Event("input"))');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false }, panelSession);
  assert(await evaluate(panelSession, 'document.documentElement.scrollWidth <= innerWidth'));
  await until(() => evaluate(panelSession, '[...document.querySelectorAll(".tech-icon")].every(img => img.complete && img.naturalWidth > 0)'));
  assert.equal(await evaluate(panelSession, 'document.querySelectorAll(".tech-icon").length'), 6);
  const iconFiles = rules.map(rule => rule.icon);
  assert(await evaluate(panelSession, `Promise.all(${JSON.stringify(iconFiles)}.map(file => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); img.src = 'icons/' + file; }))).then(results => results.every(Boolean))`));
  await evaluate(panelSession, 'document.querySelector("summary").click()');
  assert(await evaluate(panelSession, 'document.querySelector("details").open'));
  await evaluate(panelSession, 'document.querySelector("summary").click()');
  if (process.env.SCREENSHOT) {
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }, panelSession);
    await writeFile(process.env.SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 280, height: 700, deviceScaleFactor: 1, mobile: false }, panelSession);
  assert(await evaluate(panelSession, 'document.documentElement.scrollWidth <= innerWidth'));
  // Navigation must clear the previous site's results, including export data.
  await call('Page.navigate', { url: 'about:blank' }, pageSession);
  await until(() => evaluate(panelSession, 'document.querySelectorAll(".tech").length === 0 && document.getElementById("copy").disabled'));
  await evaluate(panelSession, 'document.getElementById("scan").click()');
  await until(() => evaluate(panelSession, 'document.getElementById("status").textContent.includes("This page cannot be scanned")'));
  console.log('PASS: Chromium MV3 load, MAIN-world collection, panel, filtering, responsive layout, navigation and restricted page');
  }
} finally {
  ws?.close();
  if (browser && browser.exitCode === null) {
    const ended = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await ended;
  }
  server.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
