const WINDOW_DAYS = 7;
const APG_K = 10;
const EPSILON = 0.1;
const ANOMALY_THRESHOLD = 9;

const SOURCE_WEIGHT = { org: 1.0, provider: 0.7, public: 0.2 };

export const GRID_META = (() => {
  const rows = 5;
  const cols = 5;
  const features = [];
  const ids = [];
  const west = 126.94;
  const east = 127.06;
  const south = 37.50;
  const north = 37.59;
  const stepX = (east - west) / cols;
  const stepY = (north - south) / rows;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const id = `g_r${r + 1}_c${c + 1}`;
      ids.push(id);
      const x0 = west + c * stepX;
      const x1 = x0 + stepX;
      const y0 = south + r * stepY;
      const y1 = y0 + stepY;
      features.push({
        type: "Feature",
        properties: { grid_id: id },
        geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }
      });
    }
  }

  return { ids, geojson: { type: "FeatureCollection", features }, bounds: [[west, south], [east, north]] };
})();

const mockSeed = {
  signals: [
    { created_at: Date.now() - 1_200_000, source_type: "public", category: "shelter", grid_id: "g_r2_c2", status: "open", weight: 0.2 },
    { created_at: Date.now() - 2_100_000, source_type: "provider", category: "meal", grid_id: "g_r3_c3", status: "open", weight: 0.7 },
    { created_at: Date.now() - 4_200_000, source_type: "org", category: "medical", grid_id: "g_r2_c2", status: "open", weight: 1.0 }
  ],
  resources: [
    { id: "shelter_main", resource_id: "shelter_main", resource_type: "shelter", availability_state: "available", capacity_score: 4 },
    { id: "meal_mobile", resource_id: "meal_mobile", resource_type: "meal", availability_state: "limited", capacity_score: 2 },
    { id: "clinic_team", resource_id: "clinic_team", resource_type: "clinic", availability_state: "available", capacity_score: 3 }
  ],
  logs: [
    { created_at: Date.now() - 800_000, grid_id: "g_r3_c3", action: "visit", outcome: "resolved" }
  ]
};

function nowMs() { return Date.now(); }
function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return new Date(v).getTime();
}
function within7Days(ts) { return nowMs() - toMillis(ts) <= WINDOW_DAYS * 24 * 60 * 60 * 1000; }
function decay(ts) {
  const ageHours = (nowMs() - toMillis(ts)) / (1000 * 60 * 60);
  return Math.max(0.2, 1 - ageHours / (24 * WINDOW_DAYS));
}
function quantileCut(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)];
}
function priorityBand(demand, cuts) {
  if (demand >= cuts.high) return "High";
  if (demand >= cuts.mid) return "Mid";
  return "Low";
}

export function createEngine(firebaseHandles) {
  const { db, currentUid, collection, addDoc, doc, setDoc, onSnapshot, serverTimestamp } = firebaseHandles;
  let rawSignals = [];
  let rawResources = [];
  let rawLogs = [];
  let listeners = [];
  let onUpdate = () => {};
  let useMock = !db || !currentUid;

  function compute() {
    const recentSignals = rawSignals.filter((s) => within7Days(s.created_at));
    const logsByGrid = new Map();
    rawLogs.forEach((log) => {
      const prev = logsByGrid.get(log.grid_id);
      if (!prev || toMillis(log.created_at) < toMillis(prev.created_at)) logsByGrid.set(log.grid_id, log);
    });

    const resources = rawResources.length ? rawResources : [...mockSeed.resources];
    const resourceAvg = resources.length
      ? resources.reduce((sum, r) => sum + Number(r.capacity_score || 0), 0) / resources.length
      : 1;

    const byGrid = Object.fromEntries(GRID_META.ids.map((id) => [id, {
      grid_id: id,
      demand: 0,
      u_count: 0,
      count: 0,
      anomaly: false,
      data_insufficient: true,
      capacity_score: Number(resourceAvg.toFixed(2)),
      priority_p: 0,
      band: "Low"
    }]));

    const hourCut = nowMs() - 60 * 60 * 1000;
    const hourCounts = {};
    recentSignals.forEach((s) => {
      const g = byGrid[s.grid_id];
      if (!g) return;
      g.count += 1;
      g.u_count += 1;
      g.demand += (SOURCE_WEIGHT[s.source_type] ?? 0.2) * decay(s.created_at);
      if (toMillis(s.created_at) >= hourCut) hourCounts[s.grid_id] = (hourCounts[s.grid_id] || 0) + 1;
    });

    Object.values(byGrid).forEach((g) => {
      const anomaly = (hourCounts[g.grid_id] || 0) >= ANOMALY_THRESHOLD;
      g.anomaly = anomaly;
      g.data_insufficient = g.u_count < APG_K;
      g.demand = Number((g.demand * (anomaly ? 0.5 : 1)).toFixed(2));
      g.priority_p = Number((g.demand / (g.capacity_score + EPSILON)).toFixed(2));
    });

    const publishable = Object.values(byGrid).filter((g) => !g.data_insufficient).map((g) => g.demand);
    const cuts = { mid: quantileCut(publishable, 0.3), high: quantileCut(publishable, 0.7) };

    Object.values(byGrid).forEach((g) => {
      g.band = g.data_insufficient ? "DataInsufficient" : priorityBand(g.demand, cuts);
    });

    const priorityList = Object.values(byGrid).sort((a, b) => b.priority_p - a.priority_p).map((x, i) => ({ ...x, rank: i + 1 }));

    let backlog = 0;
    let sum = 0;
    let cnt = 0;
    recentSignals.forEach((s) => {
      const first = logsByGrid.get(s.grid_id);
      if (!first) backlog += 1;
      if (first) {
        const diff = (toMillis(first.created_at) - toMillis(s.created_at)) / 60000;
        if (diff >= 0) { sum += diff; cnt += 1; }
      }
    });

    return {
      gridAgg: byGrid,
      priorityList,
      metrics: { backlog, avgResponseMin: cnt ? Math.round(sum / cnt) : 0 },
      resources,
      logs: rawLogs,
      signals: recentSignals
    };
  }

  function emit() { onUpdate(compute()); }

  function seedMock() {
    rawSignals = [...mockSeed.signals];
    rawResources = [...mockSeed.resources];
    rawLogs = [...mockSeed.logs];
  }

  function setRealtime(updateCb) {
    onUpdate = updateCb;
    if (useMock) {
      seedMock();
      emit();
      return;
    }

    listeners = [
      onSnapshot(collection(db, "signals"), (snap) => { rawSignals = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, () => { useMock = true; seedMock(); emit(); }),
      onSnapshot(collection(db, "resources"), (snap) => { rawResources = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, () => { useMock = true; seedMock(); emit(); }),
      onSnapshot(collection(db, "outreachLogs"), (snap) => { rawLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, () => { useMock = true; seedMock(); emit(); })
    ];
  }

  async function submitSignal(payload) {
    const write = { created_at: serverTimestamp(), source_type: payload.source_type, category: payload.category, grid_id: payload.grid_id, status: "open", weight: SOURCE_WEIGHT[payload.source_type] ?? 0.2 };
    if (!useMock) await addDoc(collection(db, "signals"), write);
    rawSignals.push({ ...write, created_at: Date.now() });
    emit();
  }

  async function upsertResource(resource) {
    const id = resource.resource_id;
    const payload = {
      resource_id: id,
      resource_type: resource.resource_type,
      availability_state: resource.availability_state,
      updated_at: serverTimestamp(),
      capacity_score: Number(resource.capacity_score)
    };
    if (!useMock) await setDoc(doc(db, "resources", id), payload, { merge: true });

    const idx = rawResources.findIndex((r) => (r.resource_id || r.id) === id);
    const optimistic = { ...payload, id, updated_at: Date.now() };
    if (idx >= 0) rawResources[idx] = { ...rawResources[idx], ...optimistic };
    else rawResources.push(optimistic);
    emit();
  }

  async function saveLog(payload) {
    const write = { created_at: serverTimestamp(), grid_id: payload.grid_id, action: payload.action, outcome: payload.outcome };
    if (!useMock) await addDoc(collection(db, "outreachLogs"), write);
    rawLogs.push({ ...write, created_at: Date.now() });
    emit();
  }

  return { setRealtime, submitSignal, upsertResource, saveLog, getSnapshot: () => compute() };
}

export function canSubmitByRateLimit(key = "public") {
  const now = nowMs();
  const prev = Number(localStorage.getItem(`oo_rate_${key}`) || 0);
  if (now - prev < 30_000) return false;
  localStorage.setItem(`oo_rate_${key}`, String(now));
  return true;
}

export { WINDOW_DAYS, APG_K, EPSILON };
