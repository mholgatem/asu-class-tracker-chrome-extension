const ALARM_NAME = "seat-check";

async function getOrCreateSyncTab() {
  const { syncTabId } = await chrome.storage.local.get("syncTabId");
  if (syncTabId) {
    const tab = await chrome.tabs.get(syncTabId).catch(() => null);
    if (tab && tab.url && tab.url.startsWith("https://catalog.apps.asu.edu/")) {
      return tab;
    }
  }
  const tabs = await chrome.tabs.query({ url: "https://catalog.apps.asu.edu/*" });
  if (tabs.length === 0) return null;
  await chrome.storage.local.set({ syncTabId: tabs[0].id });
  return tabs[0];
}

async function markSyncTab(tabId) {
  const iconUrl = chrome.runtime.getURL("icons/icon16.png");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (iconUrl) => {
      if (!document.title.startsWith("📡 "))
        document.title = "📡 " + document.title;
      let lnk = document.getElementById("asu-monitor-favicon");
      if (!lnk) {
        lnk = document.createElement("link");
        lnk.id = "asu-monitor-favicon";
        lnk.rel = "icon";
        document.head.appendChild(lnk);
      }
      lnk.href = iconUrl;
    },
    args: [iconUrl]
  }).catch(() => {});
}

async function unmarkSyncTab(tabId) {
  if (!tabId) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: () => {
      document.title = document.title.replace(/^📡 /, "");
      document.getElementById("asu-monitor-favicon")?.remove();
    }
  }).catch(() => {});
}

function getCurrentTerm() {
  const now = new Date();
  const year = now.getFullYear() % 100;
  const month = now.getMonth() + 1;
  let sem;
  if (month >= 1 && month <= 5) sem = 1;
  else if (month >= 6 && month <= 7) sem = 4;
  else sem = 7;
  return `22${String(year).padStart(2, "0")}${sem}`;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  await new Promise(r => setTimeout(r, 300));
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Catalog tab took too long to load.");
}

async function checkSeats() {
  const { monitoring } = await chrome.storage.local.get("monitoring");
  if (!monitoring) return;

  const { classes, term } = monitoring;
  console.log(`[ASU Monitor] Checking classes ${classes.join(",")} term ${term}`);

  const syncTab = await getOrCreateSyncTab();
  if (!syncTab) {
    const now = new Date().toISOString();
    const { classData: existing = {} } = await chrome.storage.local.get("classData");
    const classData = { ...existing };
    for (const cls of classes) {
      classData[cls] = {
        ...(classData[cls] || {}),
        error: "Open catalog.apps.asu.edu in a tab and try again.",
        lastChecked: now
      };
    }
    await chrome.storage.local.set({ classData });
    return;
  }

  const tabId = syncTab.id;
  const catalogUrl =
    `https://catalog.apps.asu.edu/catalog/classes/classlist` +
    `?campusOrOnlineSelection=C&searchType=all&classNbr=${classes.join(",")}` +
    `&term=${term}&honors=F&promod=F`;

  await chrome.tabs.update(tabId, { url: catalogUrl });
  await waitForTabComplete(tabId);
  await new Promise(r => setTimeout(r, 4500));

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (classes) => {
        const resultMap = {};
        const remaining = new Set(classes);
        const seatsCells = document.querySelectorAll(".class-results-cell.seats");

        for (const cell of seatsCells) {
          if (remaining.size === 0) break;

          // Walk up max 6 levels to find a container with one of our class numbers
          let container = cell.parentElement;
          let foundCls = null;

          for (let i = 0; i < 6 && container; i++) {
            const text = container.innerText || "";
            for (const cls of remaining) {
              if (new RegExp(`\\b${cls}\\b`).test(text)) {
                foundCls = cls;
                break;
              }
            }
            if (foundCls) break;
            container = container.parentElement;
          }

          if (!foundCls) continue;

          const nowrap = cell.querySelector(".text-nowrap");
          let available = 0;
          if (nowrap) {
            const raw = nowrap.textContent.trim();
            const m = raw.match(/^(\d+)\s+of\s+(\d+)/);
            if (m) available = parseInt(m[1]);
          }

          const titleCell = container.querySelector(".class-results-cell.title");
          const title = titleCell
            ? titleCell.innerText.trim().split("\n")[0]
            : `Class ${foundCls}`;

          resultMap[foundCls] = { available, title, source: "seats-cell" };
          remaining.delete(foundCls);
        }

        // Fallbacks for any class not found via DOM
        const bodyText = document.body.innerText;
        for (const cls of remaining) {
          const idx = bodyText.indexOf(cls);
          const snippet = idx >= 0
            ? bodyText.slice(Math.max(0, idx - 100), idx + 500)
            : bodyText.slice(0, 600);

          const mOf = snippet.match(/(\d+)\s+of\s+(\d+)/);
          if (mOf) { resultMap[cls] = { available: parseInt(mOf[1]), source: "fallback-of" }; continue; }

          const mAvail = snippet.match(/this class has (\d+) available seat/i);
          if (mAvail) { resultMap[cls] = { available: parseInt(mAvail[1]), source: "A" }; continue; }

          if (/this class has no available seat/i.test(snippet)) { resultMap[cls] = { available: 0, source: "B" }; continue; }
          if (/class is full|class full|no seats/i.test(snippet)) { resultMap[cls] = { available: 0, source: "C" }; continue; }

          resultMap[cls] = { __noMatch: true, snippet: snippet.slice(0, 400) };
        }

        return resultMap;
      },
      args: [classes]
    });
  } catch (err) {
    const now = new Date().toISOString();
    const { classData: existing = {} } = await chrome.storage.local.get("classData");
    const classData = { ...existing };
    for (const cls of classes) {
      classData[cls] = { ...(classData[cls] || {}), error: `Script injection failed: ${err.message}`, lastChecked: now };
    }
    await chrome.storage.local.set({ classData });
    return;
  }

  const scraped = results?.[0]?.result;
  if (!scraped) {
    const now = new Date().toISOString();
    const { classData: existing = {} } = await chrome.storage.local.get("classData");
    const classData = { ...existing };
    for (const cls of classes) {
      classData[cls] = { ...(classData[cls] || {}), error: "No result from DOM scraper — try reloading the catalog tab.", lastChecked: now };
    }
    await chrome.storage.local.set({ classData });
    return;
  }

  const { prevSeats: prevSeatsStored = {}, classData: existingData = {} } =
    await chrome.storage.local.get(["prevSeats", "classData"]);

  const now = new Date().toISOString();
  const classData = { ...existingData };
  const prevSeats = { ...prevSeatsStored };
  let totalAvailable = 0;

  for (const cls of classes) {
    const res = scraped[cls];
    if (!res) {
      classData[cls] = { ...(classData[cls] || {}), error: "Not found in page results.", lastChecked: now };
      continue;
    }
    if (res.__noMatch) {
      console.warn(`[ASU Monitor] No DOM pattern matched for ${cls}. Snippet:\n${res.snippet}`);
      classData[cls] = { ...(classData[cls] || {}), error: "Could not find seat info — check service worker console.", lastChecked: now };
      continue;
    }

    const { available, title, source } = res;
    console.log(`[ASU Monitor] (${source}) Class ${cls} "${title}": ${available} seats`);

    const prevAvail = prevSeats[cls] ?? 0;
    classData[cls] = { available, title, lastChecked: now };
    prevSeats[cls] = available;
    totalAvailable += available;

    if (prevAvail === 0 && available > 0) {
      const s = available !== 1 ? "s" : "";
      chrome.notifications.create(`asu-seat-${cls}-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "ASU Seat Alert!",
        message: `${title} now has ${available} seat${s} open`,
        priority: 2
      });

      chrome.tabs.sendMessage(tabId, {
        type: "SEATS_AVAILABLE",
        count: available,
        classNbr: cls,
        classTitle: title
      }).catch(() => {});
    }
  }

  await chrome.storage.local.set({ classData, prevSeats });
  await markSyncTab(tabId);

  if (totalAvailable > 0) {
    chrome.action.setBadgeText({ text: String(totalAvailable) });
    chrome.action.setBadgeBackgroundColor({ color: "#00AA00" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_MONITORING") {
    const { classes, term, interval = 1 } = msg;
    chrome.storage.local.set({
      savedConfig: { classes, term, interval },
      monitoring: { classes, term, interval }
    }).then(() => {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      checkSeats();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "STOP_MONITORING") {
    chrome.alarms.clear(ALARM_NAME);
    chrome.storage.local.get("syncTabId").then(({ syncTabId }) => {
      unmarkSyncTab(syncTabId);
    });
    chrome.storage.local.remove("monitoring");
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CHECK_NOW") {
    checkSeats().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkSeats();
});
