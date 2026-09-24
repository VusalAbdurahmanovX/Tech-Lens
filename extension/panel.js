import { collect, detect } from './detector.mjs';

const $ = id => document.getElementById(id);
const rulesPromise = fetch('./technologies.json').then(response => {
  if (!response.ok) throw new Error('Rules unavailable');
  return response.json();
});
let report = null;
let revision = 0;
const ownWindow = await chrome.windows.getCurrent();

function render() {
  $('results').replaceChildren();
  const query = $('filter').value.toLowerCase().trim();
  const entries = (report?.technologies || []).filter(item => `${item.name} ${item.category}`.toLowerCase().includes(query));
  $('count').textContent = entries.length;
  $('empty').hidden = !report || entries.length > 0;
  let category = '';
  for (const item of entries) {
    if (category !== item.category) {
      category = item.category;
      const title = document.createElement('h2');
      title.textContent = category;
      $('results').append(title);
    }
    const card = document.createElement('details');
    card.className = 'tech';
    const summary = document.createElement('summary');
    const icon = document.createElement('img');
    icon.className = 'tech-icon';
    icon.src = `icons/${item.icon}`;
    icon.alt = '';
    icon.width = 24;
    icon.height = 24;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    if (item.version) {
      const version = document.createElement('span');
      version.className = 'version';
      version.textContent = item.version;
      name.append(version);
    }
    const badge = document.createElement('span');
    badge.className = `badge ${item.confidence}`;
    badge.textContent = item.confidence === 'strong' ? '✓' : 'Possible';
    badge.setAttribute('aria-label', item.confidence === 'strong' ? 'Strong signal' : 'Possible match');
    badge.title = item.confidence === 'strong' ? 'Strong signal · Expand to view evidence' : 'Possible match · Expand to view evidence';
    summary.append(icon, name, badge);
    const evidence = document.createElement('ul');
    evidence.className = 'evidence';
    for (const text of item.evidence) {
      const li = document.createElement('li');
      li.textContent = text;
      evidence.append(li);
    }
    card.append(summary, evidence);
    $('results').append(card);
  }
}

async function scan(requestAccess = false) {
  const current = ++revision;
  report = null;
  render();
  $('scan').disabled = true;
  $('copy').disabled = true;
  $('site').textContent = 'Current tab';
  $('status').textContent = 'Scanning this page…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: ownWindow.id });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('This page cannot be scanned. Open a regular HTTP/HTTPS website.');
    $('site').textContent = new URL(tab.url).hostname;
    if (requestAccess) {
      const origin = new URL(tab.url);
      const permissions = { origins: [`${origin.protocol}//${origin.hostname}/*`] };
      if (!await chrome.permissions.contains(permissions) && !await chrome.permissions.request(permissions)) {
        throw new Error('Site access was denied. Click Scan and allow access to this website.');
      }
    }
    const rules = await rulesPromise;
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collect, args: [rules] });
    if (current !== revision) return;
    if (!result?.result?.signals) throw new Error('No scan result was returned. Reload the page and try again.');
    report = { site: result.result.url, scannedAt: new Date().toISOString(), technologies: detect(result.result, rules) };
    $('site').textContent = new URL(report.site).hostname;
    $('status').textContent = report.technologies.length ? `${report.technologies.length} technologies detected. Select a technology to view the evidence.` : 'No known signatures found. Some technologies may not be visible from this page.';
    $('copy').disabled = false;
    render();
  } catch (error) {
    if (current !== revision) return;
    $('status').textContent = `Unable to scan: ${error.message || String(error)} Click Scan to grant access to this website.`;
  } finally {
    if (current === revision) $('scan').disabled = false;
  }
}

$('scan').addEventListener('click', () => scan(true));
$('filter').addEventListener('input', render);
$('copy').addEventListener('click', async () => {
  if (!report) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    $('status').textContent = 'Technology report copied as JSON.';
  } catch {
    $('status').textContent = 'Clipboard access failed. Focus the panel and try again.';
  }
});
chrome.tabs.onActivated.addListener(info => { if (info.windowId === ownWindow.id) scan(); });
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && tab.windowId === ownWindow.id && change.status === 'loading') {
    revision++;
    report = null;
    render();
    $('copy').disabled = true;
    $('scan').disabled = false;
    $('site').textContent = 'Page changed';
    $('status').textContent = 'Click Scan again once the page has finished loading.';
  }
});
scan();
