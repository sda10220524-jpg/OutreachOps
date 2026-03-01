codex/build-firebase-mvp-for-outreachops
import { APG_K, WINDOW_DAYS, canSubmitByRateLimit, GRID_META } from "./store.js";

const state = {
  tab: "dashboard",
  sheet: "half",
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
    signals: []
  }
};

let rootEl;
let engine;
let map;
let metricPrev = { backlog: 0, avgResponseMin: 0 };
let toastTimer;

function toast(msg, ms = 2400) {
  clearTimeout(toastTimer);
  state.toast = msg;
  render();
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, ms);
}

function getSelectedAgg() {
  return state.data.gridAgg[state.selectedGrid] || null;
}

function kpiPulseIfChanged() {
  const m = state.data.metrics;
  if (m.backlog !== metricPrev.backlog || m.avgResponseMin !== metricPrev.avgResponseMin) {
    document.querySelectorAll(".metric-value").forEach((el) => {
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 420);
    });
  }
  metricPrev = { ...m };
}

function topBar() {
  return `
    <header class="topbar">
      <button class="icon-btn" aria-label="menu">☰</button>
      <div class="brand"><img src="./assets/OutreachOps_thumbnail.svg" alt="OutreachOps"/><span>OutreachOps</span></div>
      <div class="chips"><span class="chip">Demo role: ${state.role}</span><span class="chip">7 days</span></div>
    </header>
    <section class="kpi-strip">
      <article class="kpi-card"><p>Backlog</p><h3 class="metric-value">${state.data.metrics.backlog}</h3></article>
      <article class="kpi-card"><p>Avg response time</p><h3 class="metric-value">${state.data.metrics.avgResponseMin} min</h3></article>
    </section>
    ${state.data.backendBanner ? `<div class="backend-banner">${state.data.backendBanner}</div>` : ""}
  `;
}

function dashboardView() {
  const selected = getSelectedAgg();
  const safetyLine = "No features that help sustain homelessness or provide avoidance tips.";

  return `
  <main class="view ${state.tab === "dashboard" ? "" : "hidden"}">
    ${topBar()}

    <section class="map-panel">
      <div id="map"></div>
      <div class="map-note">Demand is confidence-weighted aggregate (CWS). APG W=${WINDOW_DAYS}, k=${APG_K}.</div>
    </section>

    <section class="sheet sheet-${state.sheet}">
      <button class="sheet-handle" id="sheetCycle"></button>
      <div class="sheet-tabs">
        <button data-sheet-tab="priority" class="${state.sheetTab === "priority" ? "active" : ""}">Priority</button>
        <button data-sheet-tab="resources" class="${state.sheetTab === "resources" ? "active" : ""}">Resources</button>
      </div>

      <div class="cell-summary">
        <strong>${state.selectedGrid}</strong>
        ${selected ? `<span>${selected.band}</span><span>P ${selected.priority_p}</span>` : ""}
      </div>
      <div class="summary-grid">
        <div>Demand (weighted): ${selected?.demand ?? 0}</div>
        <div>Resource status summary: ${resourceSummary()}</div>
        <div>Log summary: ${logSummary()}</div>
      </div>

      <div class="sheet-body ${state.sheetTab === "priority" ? "" : "hidden"}">
        ${state.data.priorityList.map((item) => `
          <button class="prio-item ${item.grid_id === state.selectedGrid ? "active" : ""}" data-grid-pick="${item.grid_id}">
            <div class="left">#${item.rank}</div>
            <div class="mid"><b>${item.grid_id}</b><span>${item.band}</span></div>
            <div class="right"><span>P ${item.priority_p}</span><span>D ${item.demand}</span><span>C ${item.capacity_score}</span></div>
          </button>
        `).join("")}
      </div>

      <div class="sheet-body ${state.sheetTab === "resources" ? "" : "hidden"}">
        ${state.data.resources.map((res) => `
          <button class="res-card" data-edit-resource="${res.resource_id || res.id}">
            <div><b>${res.resource_type}</b></div>
            <div>${res.availability_state} · capacity ${res.capacity_score}</div>
          </button>
        `).join("")}
      </div>
      <p class="mini-safe">${safetyLine}</p>
    </section>
  </main>`;
}

function requestView() {
  const canSubmit = state.request.safetyChecked && !!state.request.grid_id;
  return `
  <main class="view ${state.tab === "request" ? "" : "hidden"}">
    ${topBar()}
    <section class="request-card">
      <h2>Request · Step ${state.request.step}/3</h2>

      <div class="step ${state.request.step === 1 ? "" : "hidden"}">
        <h3>Step 1) Category</h3>
        <div class="cat-grid">
          ${["shelter", "meal", "medical", "other"].map((c) => `<button class="cat ${state.request.category === c ? "active" : ""}" data-cat="${c}">${c}</button>`).join("")}
        </div>
      </div>

      <div class="step ${state.request.step === 2 ? "" : "hidden"}">
        <h3>Step 2) Grid Select</h3>
        <p class="muted">Tap only a grid cell. No precise coordinates are collected.</p>
        <div class="grid-chooser">
          ${state.data.priorityList.map((item) => `<button class="grid-chip ${state.request.grid_id === item.grid_id ? "active" : ""}" data-request-grid="${item.grid_id}">${item.grid_id}</button>`).join("")}
        </div>
      </div>

      <div class="step ${state.request.step === 3 ? "" : "hidden"}">
        <h3>Step 3) Confirm</h3>
        <p>Category: <b>${state.request.category}</b></p>
        <p>Grid: <b>${state.request.grid_id || "none"}</b></p>
        <p><b>Do not enter personal data (address, phone, photos).</b></p>
        <div class="checkline">
          <label><input type="checkbox" id="rqSafe" ${state.request.safetyChecked ? "checked" : ""}/> I confirm grid-only reporting (no personal data).</label>
          <label><input type="checkbox" disabled checked/> No enforcement / no avoidance-tip workflow.</label>
        </div>
      </div>

      <div class="actions">
        ${state.request.step > 1 ? '<button class="btn" id="rqBack">Back</button>' : ""}
        ${state.request.step < 3 ? '<button class="btn primary" id="rqNext">Next</button>' : `<button class="btn primary ${canSubmit ? "" : "disabled"}" id="rqSubmit" ${canSubmit ? "" : "disabled"}>Submit</button>`}
        <button class="btn" id="rqCancel">Cancel</button>
      </div>
    </section>
  </main>`;
}

function safetyView() {
  return `
  <main class="view ${state.tab === "safety" ? "" : "hidden"}">
    ${topBar()}
    <section class="safety-card">
      <h2>Safety checklist</h2>
      <ul>
        <li>No pins / no precise coordinates / no photos / no routes</li>
        <li>No law enforcement or enforcement workflows</li>
        <li><b>No features that help sustain homelessness or provide avoidance tips.</b></li>
        <li>grid_id-only storage; no identity collection; no precise location storage</li>
        <li>Retention: Signals deleted after 7 days; aggregates only</li>
        <li>Abuse prevention: rate limit, cell spike flag, aggregates-only in public views</li>
      </ul>
    </section>
  </main>`;
}

function overlays() {
  const res = state.overlays.resourceEdit;
  return `
    ${state.overlays.rateLimit ? `<section class="overlay"><div class="modal"><h3>RateLimitBlock</h3><p>Please wait 30s before submitting again.</p><button data-close-rate>OK</button></div></section>` : ""}
    ${state.overlays.submitSuccess ? `<section class="overlay"><div class="modal"><h3>SubmitSuccess</h3><p>Request aggregated and dashboard updated.</p><button id="goDash">Go Dashboard</button></div></section>` : ""}
    ${res ? `<section class="overlay"><div class="modal"><h3>ResourceEdit</h3>
      <label>Type <input id="resType" value="${res.resource_type}"/></label>
      <label>State <select id="resState"><option ${res.availability_state === "available" ? "selected" : ""}>available</option><option ${res.availability_state === "limited" ? "selected" : ""}>limited</option><option ${res.availability_state === "closed" ? "selected" : ""}>closed</option></select></label>
      <label>capacity_score (0~5)<input id="resCap" type="number" min="0" max="5" value="${res.capacity_score}"/></label>
      <label><input type="checkbox" id="resSafe"/> Confirm this is not for precise tracking or enforcement.</label>
      <div class="actions"><button id="resSave" class="btn primary">Save</button><button class="btn" data-close-resource>Cancel</button></div>
    </div></section>` : ""}
    ${state.overlays.logEntry ? `<section class="overlay"><div class="modal"><h3>LogEntry</h3>
      <label>grid_id <input id="logGrid" value="${state.selectedGrid}"/></label>
      <label>action <select id="logAction"><option>visit</option><option>check_in</option><option>referral</option></select></label>
      <label>outcome <select id="logOutcome"><option>resolved</option><option>deferred</option><option>no_contact</option></select></label>
      <label><input type="checkbox" id="logSafe"/> No personal-identifying narrative, grid-only record.</label>
      <div class="actions"><button id="logSave" class="btn primary">Save</button><button class="btn" data-close-log>Cancel</button></div>
    </div></section>` : ""}
  `;
}

function nav() {
  return `<nav class="bottom-nav">
    <button data-tab="dashboard" class="${state.tab === "dashboard" ? "active" : ""}">Dashboard</button>
    <button data-tab="request" class="${state.tab === "request" ? "active" : ""}">Request</button>
    <button data-tab="safety" class="${state.tab === "safety" ? "active" : ""}">Safety</button>
  </nav>
  ${state.tab === "dashboard" ? '<button class="fab req" id="fabRequest">+ Request</button><button class="fab log" id="fabLog">Log</button>' : ''}`;
}

function resourceSummary() {
  const byType = {};
  state.data.resources.forEach((r) => {
    const t = r.resource_type || "other";
    byType[t] = byType[t] || { total: 0, open: 0 };
    byType[t].total += 1;
    if (r.availability_state === "available") byType[t].open += 1;
  });
  const entries = Object.entries(byType);
  if (!entries.length) return "No resources";
  return entries.map(([k, v]) => `${k} ${v.open}/${v.total}`).join(" · ");
}

function logSummary() {
  const logs = state.data.logs.filter((l) => l.grid_id === state.selectedGrid);
  if (!logs.length) return "No outreach logs yet";
  return `${logs.length} logs`; // aggregate only
}

function bind() {
  rootEl.querySelectorAll("[data-tab]").forEach((el) => el.addEventListener("click", () => {
    state.tab = el.dataset.tab;
    render();
  }));

  rootEl.querySelector("#fabRequest")?.addEventListener("click", () => {
    state.tab = "request";
    state.request.step = 1;
    render();
  });

  rootEl.querySelector("#fabLog")?.addEventListener("click", () => {
    if (!state.selectedGrid) return toast("Select a grid cell first");
    state.overlays.logEntry = true;
    render();
  });

  rootEl.querySelector("#sheetCycle")?.addEventListener("click", () => {
    state.sheet = state.sheet === "collapsed" ? "half" : state.sheet === "half" ? "full" : "collapsed";
    render();
  });

  rootEl.querySelectorAll("[data-sheet-tab]").forEach((el) => el.addEventListener("click", () => {
    state.sheetTab = el.dataset.sheetTab;
    state.sheet = "half";
    render();
  }));

  rootEl.querySelectorAll("[data-grid-pick]").forEach((el) => el.addEventListener("click", () => {
    state.selectedGrid = el.dataset.gridPick;
    state.sheet = "half";
    updateMapVisuals();
    render();
  }));

  rootEl.querySelectorAll("[data-edit-resource]").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.editResource;
    const target = state.data.resources.find((r) => (r.resource_id || r.id) === id);
    state.overlays.resourceEdit = target || null;
    render();
  }));

  rootEl.querySelectorAll("[data-cat]").forEach((el) => el.addEventListener("click", () => {
    state.request.category = el.dataset.cat;
    render();
  }));

  rootEl.querySelectorAll("[data-request-grid]").forEach((el) => el.addEventListener("click", () => {
    state.request.grid_id = el.dataset.requestGrid;
    render();
  }));

  rootEl.querySelector("#rqNext")?.addEventListener("click", () => {
    if (state.request.step === 2 && !state.request.grid_id) return toast("Select a grid cell");
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
    state.overlays.submitSuccess = true;
    state.tab = "dashboard";
    state.sheet = "half";
    toast("Demand updated and priority refreshed");
    render();
  });

  rootEl.querySelector("[data-close-rate]")?.addEventListener("click", () => {
    state.overlays.rateLimit = false;
    render();
  });

  rootEl.querySelector("#goDash")?.addEventListener("click", () => {
    state.overlays.submitSuccess = false;
    state.tab = "dashboard";
    render();
  });

  rootEl.querySelector("[data-close-resource]")?.addEventListener("click", () => {
    state.overlays.resourceEdit = null;
    render();
  });

  rootEl.querySelector("#resSave")?.addEventListener("click", async () => {
    if (!rootEl.querySelector("#resSafe")?.checked) return toast("Check safety confirmation");

    const base = state.overlays.resourceEdit;
    await engine.upsertResource({
      resource_id: base.resource_id || base.id,
      resource_type: rootEl.querySelector("#resType").value.trim() || "other",
      availability_state: rootEl.querySelector("#resState").value,
      capacity_score: Number(rootEl.querySelector("#resCap").value || 0)
    });
    state.overlays.resourceEdit = null;
    state.sheetTab = "priority";
    toast("Updated → Priority recalculated");
    render();
  });

  rootEl.querySelector("[data-close-log]")?.addEventListener("click", () => {
    state.overlays.logEntry = false;
    render();
  });

  rootEl.querySelector("#logSave")?.addEventListener("click", async () => {
    if (!rootEl.querySelector("#logSafe")?.checked) return toast("Check safety confirmation");

    await engine.saveLog({
      grid_id: rootEl.querySelector("#logGrid").value.trim(),
      action: rootEl.querySelector("#logAction").value,
      outcome: rootEl.querySelector("#logOutcome").value
    });
    state.overlays.logEntry = false;
    toast("Metrics updated");
    render();
  });
}

function mapColorForBand(band, insufficient) {
  if (insufficient) return "#d1d5db";
  if (band === "High") return "#e6a437";
  if (band === "Mid") return "#63a7ae";
  return "#b8d7da";
}

function getMapFeatures() {
  return GRID_META.geojson.features.map((feature) => {
    const id = feature.properties.grid_id;
    const agg = state.data.gridAgg[id] || {};
    return {
      ...feature,
      properties: {
        grid_id: id,
        selected: id === state.selectedGrid ? 1 : 0,
        band: agg.band || "Low",
        insufficient: agg.data_insufficient ? 1 : 0,
        anomaly: agg.anomaly ? 1 : 0,
        fillColor: mapColorForBand(agg.band, agg.data_insufficient)
      }
    };
  });
}

function updateMapVisuals() {
  if (!map || !map.getSource("grid")) return;
  map.getSource("grid").setData({ type: "FeatureCollection", features: getMapFeatures() });
}

function mountMapIfNeeded() {
  const mapEl = rootEl.querySelector("#map");
  if (!mapEl || map) return;

  if (!window.maplibregl) {
    mapEl.innerHTML = '<div class="map-fallback">Map unavailable. Grid interactions remain active via list.</div>';
    return;
  }

  try {
    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.35, "raster-saturation": -0.8 } }]
      },
      center: [127.0, 37.545],
      zoom: 12,
      dragRotate: false,
      touchZoomRotate: true
    });
  } catch (err) {
    map = null;
    mapEl.innerHTML = '<div class="map-fallback">Map rendering is unavailable in this environment.</div>';
    return;
  }

  map.on("load", () => {
    map.addSource("grid", { type: "geojson", data: { type: "FeatureCollection", features: getMapFeatures() } });

    map.addLayer({
      id: "grid-fill",
      type: "fill",
      source: "grid",
      paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.62 }
    });

    map.addLayer({
      id: "grid-insufficient-hatch",
      type: "line",
      source: "grid",
      filter: ["==", ["get", "insufficient"], 1],
      paint: { "line-color": "#6b7280", "line-width": 1.5, "line-dasharray": [1, 2] }
    });

    map.addLayer({
      id: "grid-outline",
      type: "line",
      source: "grid",
      paint: {
        "line-color": ["case", ["==", ["get", "selected"], 1], "#111827", "#4b5563"],
        "line-width": ["case", ["==", ["get", "selected"], 1], 3, 1]
      }
    });

    map.on("click", "grid-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      state.selectedGrid = feature.properties.grid_id;
      state.sheet = "half";
      render();
    });

    map.fitBounds(GRID_META.bounds, { padding: 20, animate: false });
  });

  map.on("error", () => {
    mapEl.innerHTML = '<div class="map-fallback">Map rendering is unavailable in this environment.</div>';
  });
}

function render() {
  if (map) {
    map.remove();
    map = null;
  }
  rootEl.innerHTML = `${dashboardView()}${requestView()}${safetyView()}${nav()}${overlays()}${state.toast ? `<div class="toast">${state.toast}</div>` : ""}`;
  bind();
  mountMapIfNeeded();
  updateMapVisuals();
  kpiPulseIfChanged();
}

export function initUI(root, appEngine) {
  rootEl = root;
  engine = appEngine;
  render();
}

export function setData(nextData) {
  const prev = state.data.priorityList.map((x) => x.grid_id).join("|");
  const next = nextData.priorityList.map((x) => x.grid_id).join("|");
  state.data = nextData;
  if (prev && prev !== next) {
    state.sheetTab = "priority";
  }
  render();

export function toast(message) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

export function modal(contentHtml, onClose) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal"><div class="modal-body">${contentHtml}</div></div>`;
  root.querySelector('[data-close]')?.addEventListener('click', () => {
    root.innerHTML = '';
    onClose?.();
  });
  return root;
}

export function bindTabs(onTab) {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.add('active');
      onTab(btn.dataset.tab);
    });
  });
main
}
