# Tech Lens

A lightweight Chrome and Edge extension that reveals the technologies behind a website, with recognizable brand icons, detected versions, and inspectable evidence.

Tech Lens runs locally. No account, API key, build step, or runtime dependencies required.

## Install

1. [Download the latest ZIP](https://github.com/VusalAbdurahmanovX/Tech-Lens/archive/refs/heads/main.zip) and extract it.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode** and select **Load unpacked**.
4. Select the **extension** folder inside the extracted directory. This is the folder containing `manifest.json`, not the repository root.
5. Pin Tech Lens to the toolbar, open a website, and click its icon.
6. Click **Scan** and approve access to the current website if prompted.

To update, replace the extracted files with the latest version and click **Reload** on the extension's card.

## Features

- 44 technology signatures covering frameworks, CMS, ecommerce, UI libraries, icons, fonts, analytics, payments, security, and animation.
- Compact categories with locally bundled brand icons, including React, Next.js, Vue, and WordPress.
- Versions when directly observable, with strong signals distinguished from possible matches.
- Expandable detection evidence, instant search, and JSON clipboard export.
- A side panel that keeps the website visible while you inspect its stack.

## Detection

Tech Lens inspects script and stylesheet URLs, generator metadata, DOM markers, readable CSS, and JavaScript runtime properties. Rules live in [`extension/technologies.json`](extension/technologies.json).

A signature match is evidence, not a guarantee. Shared CSS classes and copied assets can produce false positives. A Google tag does not prove GA4 is installed; Cloudflare Turnstile does not prove the site uses Cloudflare's CDN.

The current version scans the main frame, up to 3,000 DOM elements and approximately 250 KB of accessible CSS. It does not inspect cross-origin stylesheet contents, closed shadow roots, iframe contents, bundled source code, or HTTP response headers. Server languages and hosting providers are not inferred. Browser internal pages and extension stores cannot be scanned.

## Privacy and permissions

Page data stays on your device. Tech Lens has no telemetry, remote scanning service, persistent scan history, cookie collection, or external logo requests.

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access after invoking the extension. |
| `tabs` | Read the current tab's URL and track navigation. |
| `scripting` | Inspect the permitted page and its JavaScript environment. |
| `sidePanel` | Display the inspector alongside the website. |
| Optional HTTP/HTTPS access | Request access to the current site's hostname when you click Scan. |

Site permissions can be revoked in your browser's extension settings. Icons and their attribution are documented in [`extension/icons/SOURCES.md`](extension/icons/SOURCES.md).

## Development

Edit the extension files and reload it in your browser. No package installation is needed.

Run the checks with Node.js 22 or later:

```sh
node tests/check.mjs
CHROME=/path/to/chrome node tests/check.mjs
TEST_ACCESS=1 CHROME=/path/to/chrome node tests/check.mjs
```

The browser checks use Chrome for Testing with a temporary profile. The default mode checks the production manifest's missing-permission and denial paths. `TEST_ACCESS=1` grants localhost access only to the temporary test copy, then verifies collection, rendering, icons, search, responsive layout, and navigation. The native permission approval dialog and Edge require manual verification.

Requires Chrome 116+ or a current Edge version with the Side Panel API.
