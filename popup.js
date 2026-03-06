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

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const classNbrInput  = document.getElementById("classNbr");
const addClassBtn    = document.getElementById("add-class");
const classListDiv   = document.getElementById("class-list");
const termInput      = document.getElementById("term-input");
const intervalInput  = document.getElementById("interval-input");
const btn            = document.getElementById("btn");
const checkNowBtn    = document.getElementById("check-now");
const statusDiv      = document.getElementById("status");
const errorMsg       = document.getElementById("error-msg");

let classes = [];
let isMonitoring = false;

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = msg ? "block" : "none";
}

async function saveConfig() {
  await chrome.storage.local.set({
    savedConfig: { classes, term: termInput.value.trim(), interval: intervalInput.value.trim() }
  });
}

function renderClassList() {
  classListDiv.innerHTML = "";
  for (const cls of classes) {
    const tag = document.createElement("span");
    tag.className = "class-tag";
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.disabled = isMonitoring;
    removeBtn.addEventListener("click", () => {
      if (isMonitoring) return;
      classes = classes.filter(x => x !== cls);
      saveConfig();
      renderClassList();
    });
    tag.append(cls, " ", removeBtn);
    classListDiv.appendChild(tag);
  }
}

function renderStatus(monitoring, classData) {
  if (!monitoring) {
    statusDiv.style.display = "none";
    return;
  }
  statusDiv.style.display = "block";
  statusDiv.innerHTML = "";

  for (const cls of monitoring.classes) {
    const data = classData?.[cls];
    const row = document.createElement("div");

    if (!data) {
      row.className = "status-row inactive";
      row.innerHTML = `<span class="cls-nbr">${cls}</span> — <span class="time-label">Checking...</span>`;
    } else if (data.error) {
      const needsCatalogTab = data.error.includes("catalog.apps.asu.edu");
      row.className = "status-row error";
      row.innerHTML =
        `<span class="cls-nbr">${cls}</span> — <span style="color:#e57373">${data.error}</span>` +
        (needsCatalogTab
          ? `<br><span class="time-label" style="color:#ffb74d">Fix: open ` +
            `<a href="https://catalog.apps.asu.edu" target="_blank" style="color:#ffb74d">catalog.apps.asu.edu</a> in a tab</span>`
          : "") +
        `<br><span class="time-label">checked ${formatTime(data.lastChecked)}</span>`;
    } else {
      const { available, title, lastChecked } = data;
      row.className = `status-row ${available > 0 ? "active" : "inactive"}`;
      const seatsHtml = available > 0
        ? `<span class="seats-avail">${available} seat${available !== 1 ? "s" : ""} available</span>`
        : `<span class="seats-none">No seats</span>`;
      row.innerHTML =
        `<span class="cls-nbr">${cls}</span>${title ? ` — ${title}` : ""}<br>` +
        `${seatsHtml} <span class="time-label">· checked ${formatTime(lastChecked)}</span>`;
      row.style.cursor = "pointer";
      row.title = "Click to focus the sync tab";
      row.addEventListener("click", async () => {
        const { syncTabId } = await chrome.storage.local.get("syncTabId");
        if (!syncTabId) return;
        const tab = await chrome.tabs.get(syncTabId).catch(() => null);
        if (!tab) return;
        await chrome.tabs.update(syncTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      });
    }

    statusDiv.appendChild(row);
  }
}

function setMonitoringUI(monitoring) {
  isMonitoring = !!monitoring;
  addClassBtn.disabled    = isMonitoring;
  classNbrInput.disabled  = isMonitoring;
  termInput.disabled      = isMonitoring;
  intervalInput.disabled  = isMonitoring;
  btn.textContent        = isMonitoring ? "Stop Monitoring" : "Start Monitoring";
  btn.className          = isMonitoring ? "stop" : "start";
  checkNowBtn.style.display = isMonitoring ? "block" : "none";
  renderClassList();
}

async function loadState() {
  const { savedConfig, monitoring, classData } =
    await chrome.storage.local.get(["savedConfig", "monitoring", "classData"]);

  if (savedConfig?.classes?.length) {
    classes = savedConfig.classes;
  }
  termInput.value     = savedConfig?.term     || getCurrentTerm();
  intervalInput.value = savedConfig?.interval || "5";

  setMonitoringUI(monitoring || null);
  renderClassList();
  renderStatus(monitoring || null, classData || {});
}

addClassBtn.addEventListener("click", () => {
  if (isMonitoring) return;
  const val = classNbrInput.value.trim();
  if (!/^\d{5}$/.test(val)) {
    showError("Class number must be exactly 5 digits.");
    return;
  }
  if (classes.includes(val)) {
    showError("That class is already in the list.");
    return;
  }
  showError("");
  classes.push(val);
  classNbrInput.value = "";
  saveConfig();
  renderClassList();
});

classNbrInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addClassBtn.click();
});

termInput.addEventListener("change", () => saveConfig());
intervalInput.addEventListener("change", () => saveConfig());

btn.addEventListener("click", async () => {
  const { monitoring } = await chrome.storage.local.get("monitoring");

  if (monitoring) {
    await chrome.runtime.sendMessage({ type: "STOP_MONITORING" });
    setMonitoringUI(null);
    statusDiv.style.display = "none";
    showError("");
  } else {
    const term     = termInput.value.trim();
    const interval = parseInt(intervalInput.value, 10);
    if (classes.length === 0) {
      showError("Add at least one class number.");
      return;
    }
    if (!/^\d{4}$/.test(term)) {
      showError("Term code must be exactly 4 digits (e.g. 2261).");
      return;
    }
    if (!Number.isInteger(interval) || interval < 1) {
      showError("Check interval must be at least 1 minute.");
      return;
    }
    showError("");
    await chrome.runtime.sendMessage({ type: "START_MONITORING", classes, term, interval });
    setMonitoringUI({ classes, term, interval });
    renderStatus({ classes, term, interval }, {});
  }
});

checkNowBtn.addEventListener("click", async () => {
  checkNowBtn.disabled = true;
  checkNowBtn.textContent = "Checking...";
  await chrome.runtime.sendMessage({ type: "CHECK_NOW" });
  setTimeout(async () => {
    const { monitoring, classData } = await chrome.storage.local.get(["monitoring", "classData"]);
    renderStatus(monitoring, classData || {});
    checkNowBtn.disabled = false;
    checkNowBtn.textContent = "Check Now";
  }, 2000);
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.classData) {
    const { monitoring } = await chrome.storage.local.get("monitoring");
    renderStatus(monitoring, changes.classData.newValue || {});
  }
});

loadState();
