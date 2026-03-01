const KEY = 'outreachops_mvp_v1';
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const K = 10;
const RATE_LIMIT_MS = 30_000;
const SOURCE_WEIGHT = { org: 1.0, provider: 0.7, public: 0.2 };

function id() { return Math.random().toString(36).slice(2, 10); }
function now() { return Date.now(); }

function seedData() {
  const t = now();
  const signals = [];
  const hot = ['g_r1_c1', 'g_r1_c2', 'g_r2_c2', 'g_r3_c2', 'g_r3_c3'];
  for (let i = 0; i < 18; i += 1) {
    signals.push({
      id: `s_${id()}`,
      created_at: t - i * 60 * 60 * 1000,
      source_type: i % 3 === 0 ? 'org' : i % 2 === 0 ? 'provider' : 'public',
      category: ['medical', 'food', 'shelter'][i % 3],
      grid_id: hot[i % hot.length],
      status: 'open',
      session_hash: `seed_${i % 5}`,
    });
  }
  const resources = [
    { id: 'r_1', resource_type: 'medical', availability_state: 'open', capacity_score: 4, updated_at: t },
    { id: 'r_2', resource_type: 'food', availability_state: 'limited', capacity_score: 2, updated_at: t },
    { id: 'r_3', resource_type: 'shelter', availability_state: 'open', capacity_score: 3, updated_at: t },
  ];
  const logs = [{ id: 'l_1', created_at: t - 2 * 60 * 60 * 1000, org_id: 'seed-org', grid_id: 'g_r1_c1', action: 'check-in', outcome: 'completed' }];
  return { signals, resources, logs, meta: { lastSubmitAt: 0, lastSession: null } };
}

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const seeded = seedData();
    save(seeded);
    return seeded;
  }
  return JSON.parse(raw);
}

function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

function computeGridAgg(state) {
  const current = now();
  const hourAgo = current - 60 * 60 * 1000;
  const recent = state.signals.filter((s) => s.created_at >= current - WINDOW_MS);
  const capacityAvg = state.resources.reduce((a, r) => a + r.capacity_score, 0) / Math.max(state.resources.length, 1);
  const byGrid = new Map();
  for (const s of recent) {
    const recencyWeight = Math.pow(0.5, (current - s.created_at) / (24 * 60 * 60 * 1000));
    const w = SOURCE_WEIGHT[s.source_type] * recencyWeight;
    if (!byGrid.has(s.grid_id)) byGrid.set(s.grid_id, { grid_id: s.grid_id, demand: 0, uSet: new Set(), hourCount: 0 });
    const g = byGrid.get(s.grid_id);
    g.demand += w;
    g.uSet.add(s.id);
    if (s.created_at >= hourAgo) g.hourCount += 1;
  }
  return Array.from(byGrid.values()).map((g) => {
    const anomaly = g.hourCount >= 4;
    const demand = anomaly ? g.demand * 0.5 : g.demand;
    const u_count = g.uSet.size;
    const data_insufficient = u_count < K;
    return {
      grid_id: g.grid_id,
      demand,
      u_count,
      data_insufficient,
      anomaly,
      capacity_score: capacityAvg,
      priority_p: demand / (capacityAvg + 0.1),
    };
  }).sort((a, b) => b.priority_p - a.priority_p);
}

function computeMetrics(state) {
  const firstLogByGrid = new Map();
  state.logs.forEach((l) => {
    if (!firstLogByGrid.has(l.grid_id) || firstLogByGrid.get(l.grid_id) > l.created_at) firstLogByGrid.set(l.grid_id, l.created_at);
  });
  const openSignals = state.signals.filter((s) => s.status === 'open');
  let backlog = 0;
  let totalMinutes = 0;
  let matched = 0;
  for (const s of openSignals) {
    const firstLog = firstLogByGrid.get(s.grid_id);
    if (!firstLog || firstLog < s.created_at) backlog += 1;
    if (firstLog && firstLog >= s.created_at) {
      totalMinutes += Math.round((firstLog - s.created_at) / 60000);
      matched += 1;
    }
  }
  return { backlog, avgResponse: matched ? Math.round(totalMinutes / matched) : 0 };
}

export function getState() {
  const state = load();
  return { ...state, gridAgg: computeGridAgg(state), metrics: computeMetrics(state) };
}

export function addSignal({ source_type, category, grid_id, session_hash }) {
  const state = load();
  if (state.meta.lastSession === session_hash && now() - state.meta.lastSubmitAt < RATE_LIMIT_MS) {
    return { blocked: true };
  }
  state.signals.push({ id: `s_${id()}`, created_at: now(), source_type, category, grid_id, status: 'open', session_hash });
  state.meta.lastSubmitAt = now();
  state.meta.lastSession = session_hash;
  save(state);
  return { blocked: false, state: getState() };
}

export function updateResource(resourceId, patch) {
  const state = load();
  const idx = state.resources.findIndex((r) => r.id === resourceId);
  if (idx === -1) return getState();
  state.resources[idx] = { ...state.resources[idx], ...patch, updated_at: now() };
  save(state);
  return getState();
}

export function addLog({ org_id, grid_id, action, outcome }) {
  const state = load();
  state.logs.push({ id: `l_${id()}`, created_at: now(), org_id, grid_id, action, outcome });
  save(state);
  return getState();
}

export function resetSeed() {
  const seeded = seedData();
  save(seeded);
  return getState();
}
