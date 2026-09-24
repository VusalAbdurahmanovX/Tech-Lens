// This function is serialized by chrome.scripting: keep all page reads inside it.
export function collect(rules) {
  const signals = [];
  const add = (type, key, value) => {
    if (typeof value === 'string' && value) signals.push({ type, key, value: value.slice(0, 500) });
  };
  for (const element of document.querySelectorAll('script[src], link[href]')) {
    try {
      const url = new URL(element.src || element.href, location.href);
      add('asset', '', url.origin + url.pathname);
    } catch { /* Ignore malformed asset URLs. */ }
  }
  for (const element of document.querySelectorAll('meta[name="generator" i]')) {
    add('meta', 'generator', element.content);
  }
  const queries = new Set(rules.flatMap(rule => rule.patterns.filter(p => p.type === 'dom').map(p => p.key)));
  for (const selector of queries) {
    const element = document.querySelector(selector);
    if (element) add('dom', selector, element.getAttribute('ng-version') || 'present');
  }
  const paths = new Set(rules.flatMap(rule => rule.patterns.filter(p => p.type === 'global').map(p => p.key)));
  for (const path of paths) {
    try {
      let value = window;
      for (const part of path.split('.')) value = value?.[part];
      if (value !== undefined && value !== null) {
        add('global', path, typeof value === 'string' || typeof value === 'number' ? String(value) : 'present');
      }
    } catch { /* Some page globals have throwing getters. */ }
  }
  // ponytail: inspect at most 3000 nodes; raise the cap if large pages miss runtime roots.
  const nodes = document.querySelectorAll('*');
  for (let i = 0; i < Math.min(nodes.length, 3000); i++) {
    const keys = Object.keys(nodes[i]);
    if (keys.some(key => /^__(reactFiber|reactContainer|reactInternalInstance)\$/.test(key))) add('runtime', 'React', 'present');
    if (keys.includes('__vue__') || keys.includes('__vue_app__')) add('runtime', 'Vue', 'present');
  }
  // Inspect readable styles only; do not fetch cross-origin stylesheets or page source.
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        css += rule.cssText.slice(0, 10000) + '\n';
        if (css.length >= 250000) break;
      }
    } catch { /* Cross-origin stylesheets are intentionally inaccessible. */ }
    if (css.length >= 250000) break;
  }
  for (const rule of rules) {
    for (const pattern of rule.patterns.filter(p => p.type === 'css')) {
      const match = new RegExp(pattern.regex, 'i').exec(css);
      if (match) add('css', pattern.key, match[0]);
    }
  }
  return { url: location.origin + location.pathname, signals };
}

export function detect(snapshot, rules) {
  return rules.flatMap(rule => {
    const evidence = [];
    let version = '';
    let strong = false;
    for (const pattern of rule.patterns) {
      for (const signal of snapshot.signals) {
        if (signal.type !== pattern.type || (pattern.key && signal.key !== pattern.key)) continue;
        const match = new RegExp(pattern.regex || '.', 'i').exec(signal.value);
        if (!match) continue;
        strong ||= !pattern.possible;
        const candidate = pattern.version && match[pattern.version];
        if (candidate && /^\d[\w.+-]{0,39}$/.test(candidate)) version ||= candidate;
        evidence.push(pattern.label);
      }
    }
    return evidence.length ? [{ name: rule.name, icon: rule.icon, category: rule.category, version, confidence: strong ? 'strong' : 'possible', evidence: [...new Set(evidence)] }] : [];
  }).sort((a, b) => a.category.localeCompare(b.category, 'en') || a.name.localeCompare(b.name));
}
