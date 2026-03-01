codex/build-firebase-mvp-for-outreachops
import { OO } from "./firebase.js";
import { createEngine } from "./store.js";
import { initUI, setData } from "./ui.js";

const root = document.getElementById("app");
const engine = createEngine(OO);

initUI(root, engine);
setData(engine.getSnapshot());
engine.setRealtime((snapshot) => {
  setData(snapshot);
});

import { addLog, addSignal, getState, resetSeed, updateResource } from './store.js';
import { bindTabs, modal, toast } from './ui.js';

const sessionId = `sess_${Math.random().toString(36).slice(2, 9)}`;
const appState = {
  tab: 'dashboard',
  role: 'public',
  selectedGrid: 'g_r1_c1',
  sheetTab: 'priority',
  request: { step: 1, category: null, grid_id: null },
  data: getState(),
};

function refreshData() {
  appState.data = getState();
}

function renderDashboard() {
  const { metrics, gridAgg, resources } = appState.data;
  const gridIds = Array.from({ length: 20 }, (_, i) => `g_r${Math.floor(i / 5) + 1}_c${(i % 5) + 1}`);
  const aggMap = new Map(gridAgg.map((g) => [g.grid_id, g]));
  const panel = document.getElementById('dashboard');
  panel.innerHTML = `
  <div class="metrics">
    <div class="card"><div>Backlog</div><div class="metric-value">${metrics.backlog}</div></div>
    <div class="card"><div>Avg response time (minutes)</div><div class="metric-value">${metrics.avgResponse}</div></div>
  </div>
  <div class="card">
    <div class="helper">Demand uses confidence-weighted aggregate (APG/CWS/NRGI). DataInsufficient cells hide numeric density.</div>
    <div class="map-grid">
      ${gridIds.map((gid) => {
        const g = aggMap.get(gid);
        const selected = appState.selectedGrid === gid ? 'selected' : '';
        const insufficient = g?.data_insufficient ? 'insufficient' : '';
        const anomaly = g?.anomaly ? 'anomaly' : '';
        const label = g?.data_insufficient ? '<span class="badge">Data insufficient</span>' : `<span class="badge">Demand ${Math.round((g?.demand || 0) * 10) / 10}</span>`;
        return `<button class="grid-cell ${selected} ${insufficient} ${anomaly}" data-grid="${gid}"><strong>${gid}</strong>${label}</button>`;
      }).join('')}
    </div>
  </div>
  <div class="sheet">
    <div class="sheet-tabs">
      <button data-sheet="priority" ${appState.sheetTab === 'priority' ? 'class="active"' : ''}>Priority List</button>
      <button data-sheet="resources" ${appState.sheetTab === 'resources' ? 'class="active"' : ''}>Resource Board</button>
      ${appState.role === 'org' ? '<button id="logEntryBtn">Log Entry</button>' : ''}
    </div>
    <div class="sheet-content">
      ${appState.sheetTab === 'priority' ? gridAgg.map((g) => `<div class="list-item" data-grid-item="${g.grid_id}"><strong>${g.grid_id}</strong><div>P: ${g.priority_p.toFixed(2)} · Demand: ${g.data_insufficient ? 'Data insufficient' : g.demand.toFixed(2)} · Capacity: ${g.capacity_score.toFixed(1)}</div></div>`).join('') : resources.map((r) => `<div class="list-item"><strong>${r.resource_type}</strong><div>State: ${r.availability_state} | Capacity: ${r.capacity_score}</div><button data-resource="${r.id}">Edit</button></div>`).join('')}
    </div>
  </div>`;

  panel.querySelectorAll('.grid-cell').forEach((el) => el.addEventListener('click', () => {
    appState.selectedGrid = el.dataset.grid;
    render();
  }));
  panel.querySelectorAll('[data-sheet]').forEach((el) => el.addEventListener('click', () => {
    appState.sheetTab = el.dataset.sheet;
    render();
  }));
  panel.querySelectorAll('[data-grid-item]').forEach((el) => el.addEventListener('click', () => {
    appState.selectedGrid = el.dataset.gridItem;
    render();
  }));
  panel.querySelectorAll('[data-resource]').forEach((el) => el.addEventListener('click', () => openResourceEdit(el.dataset.resource)));
  document.getElementById('logEntryBtn')?.addEventListener('click', openLogEntry);
}

function renderRequest() {
  const panel = document.getElementById('request');
  const categories = ['medical', 'food', 'shelter', 'other'];
  if (appState.request.step === 1) {
    panel.innerHTML = `<div class="card"><h3>Step 1: Category</h3>${categories.map((c) => `<button data-cat="${c}">${c}</button>`).join('')}</div>`;
    panel.querySelectorAll('[data-cat]').forEach((el) => el.addEventListener('click', () => {
      appState.request.category = el.dataset.cat;
      appState.request.step = 2;
      render();
    }));
  } else if (appState.request.step === 2) {
    const gridIds = Array.from({ length: 20 }, (_, i) => `g_r${Math.floor(i / 5) + 1}_c${(i % 5) + 1}`);
    panel.innerHTML = `<div class="card"><h3>Step 2: Grid select</h3><div class="map-grid">${gridIds.map((g) => `<button class="grid-cell" data-rgrid="${g}">${g}</button>`).join('')}</div></div>`;
    panel.querySelectorAll('[data-rgrid]').forEach((el) => el.addEventListener('click', () => {
      appState.request.grid_id = el.dataset.rgrid;
      appState.request.step = 3;
      render();
    }));
  } else {
    panel.innerHTML = `<div class="card"><h3>Step 3: Confirm submit</h3><p>Category: ${appState.request.category}</p><p>Grid: ${appState.request.grid_id}</p><p><strong>Do not enter personal data (address, phone, photos).</strong></p><button class="primary" id="submitReq">Submit</button> <button id="cancelReq">Cancel</button></div>`;
    document.getElementById('cancelReq').addEventListener('click', () => {
      appState.request = { step: 1, category: null, grid_id: null };
      render();
    });
    document.getElementById('submitReq').addEventListener('click', () => {
      const result = addSignal({ source_type: appState.role, category: appState.request.category, grid_id: appState.request.grid_id, session_hash: sessionId });
      if (result.blocked) {
        modal('<h3>RateLimitBlock</h3><p>Repeated submissions are blocked for 30 seconds.</p><button data-close>Close</button>');
        toast('Rate-limit triggered');
        return;
      }
      appState.request = { step: 1, category: null, grid_id: null };
      refreshData();
      appState.selectedGrid = result.state.gridAgg[0]?.grid_id || appState.request.grid_id;
      document.querySelector('[data-tab="dashboard"]').click();
      toast('Submit success: Dashboard updated');
    });
  }
}

function renderSafety() {
  document.getElementById('safety').innerHTML = `
  <div class="card">
    <h3>Safety Checklist</h3>
    <ul class="safety-list">
      <li>No pins / no precise coordinates / no photos / no routes</li>
      <li>No law enforcement or enforcement workflows</li>
      <li><strong>No features that help sustain homelessness or provide avoidance tips.</strong></li>
      <li>grid_id-only storage; no identity collection; no precise location storage</li>
      <li>Retention: Signals deleted after 7 days; aggregates only</li>
      <li>Abuse prevention: rate limit, cell spike flag, aggregates-only in public views</li>
    </ul>
  </div>`;
}

function openResourceEdit(resourceId) {
  const r = appState.data.resources.find((x) => x.id === resourceId);
  const root = modal(`<h3>Resource Edit</h3>
    <label>Availability <select id="resState"><option>open</option><option>limited</option><option>closed</option></select></label>
    <label>Capacity (0..5) <input type="number" id="resCap" min="0" max="5" value="${r.capacity_score}" /></label>
    <div style="margin-top:8px"><button id="saveRes" class="primary">Save</button> <button data-close>Cancel</button></div>`);
  root.querySelector('#resState').value = r.availability_state;
  root.querySelector('#saveRes').addEventListener('click', () => {
    updateResource(resourceId, { availability_state: root.querySelector('#resState').value, capacity_score: Number(root.querySelector('#resCap').value) });
    root.innerHTML = '';
    refreshData();
    render();
    toast('Updated → Priority recalculated');
  });
}

function openLogEntry() {
  const root = modal(`<h3>Log Entry</h3><p>Selected grid: ${appState.selectedGrid}</p>
    <label>Action <input id="action" value="check-in" /></label>
    <label>Outcome <input id="outcome" value="completed" /></label>
    <div style="margin-top:8px"><button id="saveLog" class="primary">Save</button> <button data-close>Cancel</button></div>`);
  root.querySelector('#saveLog').addEventListener('click', () => {
    addLog({ org_id: 'demo-org', grid_id: appState.selectedGrid, action: root.querySelector('#action').value, outcome: root.querySelector('#outcome').value });
    root.innerHTML = '';
    refreshData();
    render();
    toast('Metrics updated');
  });
}

function render() {
  renderDashboard();
  renderRequest();
  renderSafety();
}

bindTabs((tab) => { appState.tab = tab; });
document.getElementById('roleSelect').addEventListener('change', (e) => { appState.role = e.target.value; render(); });
document.getElementById('refreshBtn').addEventListener('click', () => { refreshData(); render(); toast('Refreshed'); });
document.getElementById('refreshBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); resetSeed(); refreshData(); render(); toast('Seed reset'); });
render();
main
