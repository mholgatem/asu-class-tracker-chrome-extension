# ASU Class Seat Monitor

A Chrome extension that watches Arizona State University class seat availability and notifies you the moment a seat opens up — no manual refreshing required.

## How It Works

The extension operates entirely client-side. It navigates an open `catalog.apps.asu.edu` browser tab on a configurable interval, waits for the React SPA to finish rendering, then scrapes the DOM for seat counts. No external servers or APIs are involved beyond what the ASU catalog already loads.

**Monitoring loop:**

1. You enter one or more 5-digit class numbers and a 4-digit semester code, then click **Start Monitoring**.
2. The extension immediately performs a check, then sets a repeating alarm at your chosen polling interval (default: 5 minutes).
3. On each tick, the background service worker navigates the designated "sync tab" to the catalog search URL for your classes and waits up to ~15 seconds for the page to load.
4. A script is injected into that tab to read seat counts from `.class-results-cell.seats` elements. Several fallback text patterns are also tried in case the primary DOM selector fails.
5. If a class transitions from 0 seats to 1 or more seats, you receive:
   - An OS-level desktop notification
   - An in-page toast notification inside the catalog tab
   - A green badge on the extension icon showing the total available seat count

**Seat scraping strategy (in priority order):**

1. Primary: `.class-results-cell.seats .text-nowrap` — parses `"N of M"` format
2. Fallback A: searches surrounding page text for `"X of Y"` pattern
3. Fallback B: `"this class has N available seat"` text
4. Fallback C: `"this class has no available seat"` / `"class is full"` / `"no seats"` text

## Features

- **Multi-class monitoring** — watch several classes simultaneously in a single polling cycle
- **Sync tab** — one designated catalog tab is used for all navigations; it gets a `📡` title prefix and the extension favicon so you can identify it at a glance
- **Click-to-focus** — clicking a class row in the popup brings the sync tab to the foreground
- **Configurable interval** — set polling frequency from 1 to 120 minutes
- **Persistent config** — your class list, semester code, and interval survive browser restarts
- **Desktop + in-page notifications** — OS notification fires even if the catalog tab is in the background; an animated toast also appears directly on the catalog page
- **Badge count** — extension icon shows total available seats across all monitored classes
- **Auto tab recovery** — if the sync tab is closed, the next alarm tick automatically picks another open catalog tab and marks it as the new sync tab

## Installation

No build step required.

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. The extension icon will appear in your toolbar.

## Usage

1. Open `https://catalog.apps.asu.edu` in a tab (the extension needs this tab to scrape seat data).
2. Click the extension icon.
3. Enter a 5-digit class number and click **Add** (repeat for additional classes).
4. Verify the **Semester Code** (auto-filled based on the current date — format: `22YY` + `1` Spring / `4` Summer / `7` Fall, e.g. `2271` = Fall 2027).
5. Set a **Polling Interval** in minutes.
6. Click **Start Monitoring**.

To stop, click **Stop Monitoring**. The sync tab's title and favicon are restored automatically.

## Semester Codes

| Code | Semester |
|------|----------|
| `2261` | Spring 2026 |
| `2264` | Summer 2026 |
| `2267` | Fall 2026 |
| `2271` | Spring 2027 |

Pattern: `22` + last two digits of year + semester digit (`1`/`4`/`7`).

---

## Fragility Warning — How This Can Break

This extension depends on the rendered HTML structure of `catalog.apps.asu.edu`, which is a React SPA not under our control. ASU can silently change it at any time.

### Things that will break it

**CSS class renames**
The primary scraper targets `.class-results-cell.seats` and `.class-results-cell.title`. If ASU's front-end team renames or restructures these classes (common during framework upgrades or redesigns), the primary selector returns zero results and the extension falls through to text-based fallbacks. If those fallbacks also fail, you'll see "Could not find seat info" errors in the popup.

**Seat count format change**
The parser expects the text `"N of M"` (e.g. `"3 of 30"`). If ASU changes this to `"3 available"` or `"3/30"`, the regex won't match and the fallback chain takes over. If no fallback matches either, the class is reported as an error.

**SPA load time increase**
The extension waits a fixed 4.5 seconds after `tab.status === "complete"` for React to finish rendering. If ASU's catalog becomes significantly slower (heavier bundles, more API calls), the scraper may run before the seat data appears in the DOM, producing incorrect zero counts or no-match errors. The 15-second `waitForTabComplete` timeout would surface this as "Catalog tab took too long to load."

**URL structure change**
The catalog search URL is hardcoded as:
```
https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=C&searchType=all&classNbr=...&term=...&honors=F&promod=F
```
If ASU changes the path or required query parameters, the navigation will land on an error page or an empty result, and scraping will fail.

**Authentication / login wall**
If ASU puts class search behind a login page, the tab will redirect to an auth flow instead of loading results. The scraper will find no matching elements and report errors for all classes.

**Content Security Policy changes**
Chrome's `scripting.executeScript` can be blocked if ASU tightens their CSP to disallow injected scripts. This would surface as "Script injection failed" errors.

### How to diagnose a breakage

1. Open the catalog tab that has the `📡` prefix.
2. Manually navigate to a class search and inspect the seat count element — check what CSS classes it actually has.
3. Open the extension's service worker console: `chrome://extensions` > **ASU Class Seat Monitor** > **Service worker** > **Inspect**.
4. Look for `[ASU Monitor]` log lines. A `__noMatch` log will include a text snippet from the page, which shows what the scraper actually saw.
5. Update the selectors or fallback patterns in `background.js` accordingly.
