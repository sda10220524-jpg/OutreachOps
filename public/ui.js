import { APG_K, WINDOW_DAYS, canSubmitByRateLimit, GRID_META } from "./store.js";

const state = {
  tab: "dashboard",
  sheetTab: "priority",
  selectedGrid: GRID_META.ids[0],
  role: "public",
  request: {
    step: 1,
    category: "shelter",
    grid_id: null,
    safetyChecked: false
  },
  overlays: {
    rateLimit: false,
    submitSuccess: false,
    resourceEdit: null,
    logEntry: false
  },
  toast: "",
  data: {
    gridAgg: {},
    priorityList: [],
    metrics: { backlog: 0, avgResponseMin: 0 },
    resources: [],
    logs: [],
    signals: [],
    backendBanner: ""
  }
};

let rootEl;
let engine;
let metricPrev = { backlog: 0, avgResponseMin: 0 };
let toastTimer;

function showToast(message, ms = 2200) {
  clearTimeout(toastTimer);
  state.toast = message;
  render();
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, ms);
}

function selectedAgg() {
  return state.data.gridAgg[state.selectedGrid] || null;
}

function bumpMetricsIfChanged() {
  const next = state.data.metrics;
  if (next.backlog !== metricPrev.backlog || next.avgResponseMin !== metricPrev.avgResponseMin) {
    document.querySelectorAll(".metric-value").forEach((el) => {
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 450);
    });
  }
  metricPrev = { ...next };
}

function topChrome() {
  return `
    <header class="topbar">
      <div class="brand">
        <img src="./assets/OutreachOps_thumbnail.svg" alt="OutreachOps" />
        <span>OutreachOps</span>
      </div>
      <div class="top-pills">
        <span class="pill">Demo role: ${state.role}</span>
        <span class="pill">7 days</span>
        <button id="refreshBtn" class="pill-btn">Refresh</button>
      </div>
    </header>
    <section class="kpi-strip">
      <article class="metric-card"><p>Backlog</p><h3 class="metric-value">${state.data.metrics.backlog}</h3></article>
      <article class="metric-card"><p>Avg response time</p><h3 class="metric-value">${state.data.metrics.avgResponseMin} min</h3></article>
    </section>
    ${state.data.backendBanner ? `<div class="backend-banner">${state.data.backendBanner}</div>` : ""}
  `;
}

function gridPanel() {
  return `
    <section class="grid-panel">
      <div class="grid-note">Grid-only view · CWS weighted demand · APG(W=${WINDOW_DAYS}, k=${APG_K})</div>
      <div class="grid-cells">
        ${GRID_META.ids.map((id) => {
          const g = state.data.gridAgg[id] || {};
          const band = g.band || "DataInsufficient";
          const cls = ["cell", band.toLowerCase()];
          if (id === state.selectedGrid) cls.push("selected");
          return `<button class="${cls.join(" ")}" data-grid="${id}">
            <span class="cell-id">${id}</span>
            ${g.data_insufficient ? '<span class="cell-badge">Data insufficient</span>' : `<span class="cell-badge">${band}</span>`}
            ${g.anomaly ? '<span class="cell-flag">Review</span>' : ""}
          </button>`;
        }).join("")}
      </div>
    </section>
  `;
}

function summaryCard() {
  const s = selectedAgg();
  return `
    <section class="summary-card">
      <div><strong>${state.selectedGrid}</strong></div>
      <div>Demand (weighted): ${s?.demand ?? 0}</div>
      <div>Resource summary: ${resourceSummary()}</div>
      <div>Outreach summary: ${logSummary()}</div>
    </section>
  `;
}

function priorityList() {
  return `
    <div class="list-wrap">
      ${state.data.priorityList.map((item) => `
        <button class="priority-item ${item.grid_id === state.selectedGrid ? "active" : ""}" data-select-priority="${item.grid_id}">
          <span class="rank">#${item.rank}</span>
          <span class="meta"><b>${item.grid_id}</b><small>${item.band}</small></span>
          <span class="chips"><small>P ${item.priority_p}</small><small>D ${item.demand}</small><small>C ${item.capacity_score}</small></span>
        </button>
      `).join("")}
    </div>
  `;
}

function resourcesList() {
  return `
    <div class="list-wrap">
      ${state.data.resources.map((r) => `
        <button class="resource-item" data-edit-resource="${r.resource_id || r.id}">
          <b>${r.resource_type}</b>
          <span>${r.availability_state} · capacity ${r.capacity_score}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function dashboardView() {
  return `
    <section class="screen ${state.tab === "dashboard" ? "" : "hidden"}">
      ${topChrome()}
      ${gridPanel()}
      ${summaryCard()}
      <section class="sheet">
        <div class="sheet-tabs">
          <button data-sheet-tab="priority" class="${state.sheetTab === "priority" ? "active" : ""}">Priority</button>
          <button data-sheet-tab="resources" class="${state.sheetTab === "resources" ? "active" : ""}">Resources</button>
        </div>
        ${state.sheetTab === "priority" ? priorityList() : resourcesList()}
      </section>
      <button class="fab fab-request" id="fabRequest">+ Request</button>
      <button class="fab fab-log" id="fabLog">Log</button>
    </section>
  `;
}

function requestView() {
  const canSubmit = state.request.safetyChecked && !!state.request.grid_id;
  return `
    <section class="screen ${state.tab === "request" ? "" : "hidden"}">
      ${topChrome()}
      <section class="panel">
        <h2>Request · Step ${state.request.step}/3</h2>

        <div class="step ${state.request.step === 1 ? "" : "hidden"}">
          <h3>Step 1) Category</h3>
          <div class="chip-row">
            ${["shelter", "meal", "medical", "other"].map((c) => `<button class="choice ${state.request.category === c ? "active" : ""}" data-cat="${c}">${c}</button>`).join("")}
          </div>
        </div>

        <div class="step ${state.request.step === 2 ? "" : "hidden"}">
          <h3>Step 2) Grid Select</h3>
          <p class="muted">Tap grid only. No precise coordinates are collected.</p>
          <div class="chip-row">
            ${GRID_META.ids.map((id) => `<button class="choice ${state.request.grid_id === id ? "active" : ""}" data-request-grid="${id}">${id}</button>`).join("")}
          </div>
        </div>

        <div class="step ${state.request.step === 3 ? "" : "hidden"}">
          <h3>Step 3) Confirm</h3>
          <p>Category: <b>${state.request.category}</b></p>
          <p>Grid: <b>${state.request.grid_id || "none"}</b></p>
          <p><b>Do not enter personal data (address, phone, photos).</b></p>
          <div class="mini-check">
            <label><input type="checkbox" id="rqSafe" ${state.request.safetyChecked ? "checked" : ""}/> Grid-only and no personal data.</label>
            <label><input type="checkbox" disabled checked/> No enforcement workflow / no avoidance tips.</label>
          </div>
        </div>

        <div class="actions">
          ${state.request.step > 1 ? '<button class="btn" id="rqBack">Back</button>' : ""}
          ${state.request.step < 3 ? '<button class="btn primary" id="rqNext">Next</button>' : `<button class="btn primary" id="rqSubmit" ${canSubmit ? "" : "disabled"}>Submit</button>`}
          <button class="btn" id="rqCancel">Cancel</button>
        </div>
      </section>
    </section>
  `;
}

function safetyView() {
  return `
    <section class="screen ${state.tab === "safety" ? "" : "hidden"}">
      ${topChrome()}
      <section class="panel">
        <h2>Safety checklist</h2>
        <ul class="safety-list">
          <li>No pins / no precise coordinates / no photos / no routes</li>
          <li>No law enforcement or enforcement workflows</li>
          <li><b>No features that help sustain homelessness or provide avoidance tips.</b></li>
          <li>grid_id-only storage; no identity collection; no precise location storage</li>
          <li>Retention: Signals deleted after 7 days; aggregates only</li>
          <li>Abuse prevention: rate limit, cell spike flag, aggregates-only in public views</li>
        </ul>
      </section>
    </section>
  `;
}

function overlays() {
  const r = state.overlays.resourceEdit;
  return `
    ${state.overlays.rateLimit ? `<section class="overlay"><div class="modal"><h3>RateLimitBlock</h3><p>Please wait 30 seconds before submitting again.</p><button data-close-rate class="btn">OK</button></div></section>` : ""}
    ${state.overlays.submitSuccess ? `<section class="overlay"><div class="modal"><h3>SubmitSuccess</h3><p>Demand and priority were updated.</p><button id="goDash" class="btn primary">Back to Dashboard</button></div></section>` : ""}
    ${r ? `<section class="overlay"><div class="modal">
      <h3>ResourceEdit</h3>
      <label>Type <input id="resType" value="${r.resource_type}"/></label>
      <label>State
        <select id="resState">
          <option ${r.availability_state === "available" ? "selected" : ""}>available</option>
          <option ${r.availability_state === "limited" ? "selected" : ""}>limited</option>
          <option ${r.availability_state === "closed" ? "selected" : ""}>closed</option>
        </select>
      </label>
      <label>capacity_score (0~5)<input id="resCap" type="number" min="0" max="5" value="${r.capacity_score}"/></label>
      <label class="mini-check"><input type="checkbox" id="resSafe"/> Not for precise tracking / not for enforcement.</label>
      <div class="actions"><button id="resSave" class="btn primary">Save</button><button class="btn" data-close-resource>Cancel</button></div>
    </div></section>` : ""}
    ${state.overlays.logEntry ? `<section class="overlay"><div class="modal">
      <h3>LogEntry</h3>
      <label>grid_id <input id="logGrid" value="${state.selectedGrid}"/></label>
      <label>action
        <select id="logAction"><option>visit</option><option>check_in</option><option>referral</option></select>
      </label>
      <label>outcome
        <select id="logOutcome"><option>resolved</option><option>deferred</option><option>no_contact</option></select>
      </label>
      <label class="mini-check"><input type="checkbox" id="logSafe"/> No personal-identifying description, grid-only record.</label>
      <div class="actions"><button id="logSave" class="btn primary">Save</button><button class="btn" data-close-log>Cancel</button></div>
    </div></section>` : ""}
  `;
}

function bottomNav() {
  return `
    <nav class="bottom-nav">
      <button data-tab="dashboard" class="${state.tab === "dashboard" ? "active" : ""}">Dashboard</button>
      <button data-tab="request" class="${state.tab === "request" ? "active" : ""}">Request</button>
      <button data-tab="safety" class="${state.tab === "safety" ? "active" : ""}">Safety</button>
    </nav>
  `;
}

function resourceSummary() {
  const byType = {};
  state.data.resources.forEach((r) => {
    const key = r.resource_type || "other";
    if (!byType[key]) byType[key] = { total: 0, open: 0 };
    byType[key].total += 1;
    if (r.availability_state === "available") byType[key].open += 1;
  });
  const items = Object.entries(byType);
  if (!items.length) return "No resources";
  return items.map(([k, v]) => `${k} ${v.open}/${v.total}`).join(" · ");
}

function logSummary() {
  const total = (state.data.logs || []).filter((l) => l.grid_id === state.selectedGrid).length;
  return total ? `${total} logs` : "No outreach logs yet";
}

function bindEvents() {
  rootEl.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      state.tab = el.dataset.tab;
      render();
    });
  });

  rootEl.querySelector("#refreshBtn")?.addEventListener("click", () => {
    showToast("Realtime sync active");
  });

  rootEl.querySelectorAll("[data-grid]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedGrid = el.dataset.grid;
      render();
    });
  });

  rootEl.querySelectorAll("[data-select-priority]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedGrid = el.dataset.selectPriority;
      render();
    });
  });

  rootEl.querySelector("#fabRequest")?.addEventListener("click", () => {
    state.tab = "request";
    state.request.step = 1;
    render();
  });

  rootEl.querySelector("#fabLog")?.addEventListener("click", () => {
    state.overlays.logEntry = true;
    render();
  });

  rootEl.querySelectorAll("[data-cat]").forEach((el) => {
    el.addEventListener("click", () => {
      state.request.category = el.dataset.cat;
      render();
    });
  });

  rootEl.querySelectorAll("[data-request-grid]").forEach((el) => {
    el.addEventListener("click", () => {
      state.request.grid_id = el.dataset.requestGrid;
      render();
    });
  });

  rootEl.querySelector("#rqNext")?.addEventListener("click", () => {
    if (state.request.step === 2 && !state.request.grid_id) return showToast("Select a grid cell");
    state.request.step += 1;
    render();
  });

  rootEl.querySelector("#rqBack")?.addEventListener("click", () => {
    state.request.step -= 1;
    render();
  });

  rootEl.querySelector("#rqCancel")?.addEventListener("click", () => {
    state.tab = "dashboard";
    render();
  });

  rootEl.querySelector("#rqSafe")?.addEventListener("change", (e) => {
    state.request.safetyChecked = e.target.checked;
    render();
  });

  rootEl.querySelector("#rqSubmit")?.addEventListener("click", async () => {
    if (!canSubmitByRateLimit(state.role)) {
      state.overlays.rateLimit = true;
      return render();
    }
    await engine.submitSignal({ source_type: state.role, category: state.request.category, grid_id: state.request.grid_id });
    state.selectedGrid = state.request.grid_id;
    state.tab = "dashboard";
    state.overlays.submitSuccess = true;
    showToast("Demand updated and priority refreshed");
    render();
  });

  rootEl.querySelectorAll("[data-sheet-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      state.sheetTab = el.dataset.sheetTab;
      render();
    });
  });

  rootEl.querySelectorAll("[data-edit-resource]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.editResource;
      state.overlays.resourceEdit = state.data.resources.find((r) => (r.resource_id || r.id) === id) || null;
      render();
    });
  });

  rootEl.querySelector("#resSave")?.addEventListener("click", async () => {
    if (!rootEl.querySelector("#resSafe")?.checked) return showToast("Check safety confirmation");
    const base = state.overlays.resourceEdit;
    await engine.upsertResource({
      resource_id: base.resource_id || base.id,
      resource_type: rootEl.querySelector("#resType").value.trim() || "other",
      availability_state: rootEl.querySelector("#resState").value,
      capacity_score: Number(rootEl.querySelector("#resCap").value || 0)
    });
    state.overlays.resourceEdit = null;
    state.sheetTab = "priority";
    showToast("Updated → Priority recalculated");
    render();
  });

  rootEl.querySelector("#logSave")?.addEventListener("click", async () => {
    if (!rootEl.querySelector("#logSafe")?.checked) return showToast("Check safety confirmation");
    await engine.saveLog({
      grid_id: rootEl.querySelector("#logGrid").value.trim(),
      action: rootEl.querySelector("#logAction").value,
      outcome: rootEl.querySelector("#logOutcome").value
    });
    state.overlays.logEntry = false;
    showToast("Metrics updated");
    render();
  });

  rootEl.querySelector("#goDash")?.addEventListener("click", () => {
    state.overlays.submitSuccess = false;
    state.tab = "dashboard";
    render();
  });

  rootEl.querySelector("[data-close-rate]")?.addEventListener("click", () => {
    state.overlays.rateLimit = false;
    render();
  });

  rootEl.querySelector("[data-close-resource]")?.addEventListener("click", () => {
    state.overlays.resourceEdit = null;
    render();
  });

  rootEl.querySelector("[data-close-log]")?.addEventListener("click", () => {
    state.overlays.logEntry = false;
    render();
  });
}

function render() {
  rootEl.innerHTML = `${dashboardView()}${requestView()}${safetyView()}${bottomNav()}${overlays()}${state.toast ? `<div class="toast">${state.toast}</div>` : ""}`;
  bindEvents();
  bumpMetricsIfChanged();
}

export function initUI(root, appEngine) {
  rootEl = root;
  engine = appEngine;
  render();
}

export function setData(nextData) {
  state.data = nextData;
  render();
}
