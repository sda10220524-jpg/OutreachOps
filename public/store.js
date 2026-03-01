const WINDOW_DAYS = 7;
const APG_K = 10;
const EPSILON = 0.1;
const ANOMALY_THRESHOLD = 9;

const SOURCE_WEIGHT = { org: 1.0, provider: 0.7, public: 0.2 };
const NETWORK_FALLBACK_CODES = new Set(["unavailable", "deadline-exceeded", "resource-exhausted"]);

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
  gridAgg: {
    g_r2_c2: { demand: 1.2, u_count: 12, state_flags: { data_insufficient: false, anomaly: false }, capacity_score: 3, priority_p: 0.39 },
    g_r3_c3: { demand: 0.8, u_count: 11, state_flags: { data_insufficient: false, anomaly: false }, capacity_score: 3, priority_p: 0.26 }
  },
  metrics: { backlog: 3, avgResponseMin: 42 },
  resources: [
    { id: "shelter_main", resource_id: "shelter_main", resource_type: "shelter", availability_state: "available", capacity_score: 4 },
    { id: "meal_mobile", resource_id: "meal_mobile", resource_type: "meal", availability_state: "limited", capacity_score: 2 },
    { id: "clinic_team", resource_id: "clinic_team", resource_type: "clinic", availability_state: "available", capacity_score: 3 }
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

function defaultGridCell(id, capacity) {
  return {
    grid_id: id,
    demand: 0,
    u_count: 0,
    count: 0,
    anomaly: false,
    data_insufficient: true,
    capacity_score: Number(capacity.toFixed(2)),
    priority_p: 0,
    band: "DataInsufficient"
  };
}

export function createEngine(firebaseHandles) {
  const { db, currentUid, collection, addDoc, doc, setDoc, onSnapshot, serverTimestamp } = firebaseHandles;

  let rawResources = [];
  let aggByGrid = {};
  let metricsFromBackend = { backlog: 0, avgResponseMin: 0 };
  let pendingSignals = [];
  let pendingLogs = [];
  let listeners = [];
  let onUpdate = () => {};
  let useMock = !db || !currentUid;
  let backendBanner = "";

  function emit() {
    onUpdate(computeSnapshot());
  }

  function enableMockWithSeed(message) {
    useMock = true;
    backendBanner = message;
    rawResources = [...mockSeed.resources];
    aggByGrid = { ...mockSeed.gridAgg };
    metricsFromBackend = { ...mockSeed.metrics };
    emit();
  }

  function handleReadError(label, err) {
    const code = err?.code || "unknown";
    if (code === "permission-denied") {
      backendBanner = "Backend read blocked";
      emit();
      return;
    }

    if (NETWORK_FALLBACK_CODES.has(code)) {
      if (!useMock) {
        enableMockWithSeed(`Backend unavailable (${label})`);
      }
      return;
    }

    backendBanner = `Backend listener error (${label})`;
    emit();
  }

  function computeSnapshot() {
    const resources = rawResources.length ? rawResources : [...mockSeed.resources];
    const resourceAvg = resources.length
      ? resources.reduce((sum, r) => sum + Number(r.capacity_score || 0), 0) / resources.length
      : 1;

    const byGrid = Object.fromEntries(
      GRID_META.ids.map((id) => {
        const base = aggByGrid[id] || {};
        const stateFlags = base.state_flags || {};
        const cell = defaultGridCell(id, resourceAvg);
        cell.demand = Number(base.demand || 0);
        cell.u_count = Number(base.u_count || 0);
        cell.capacity_score = Number(base.capacity_score || resourceAvg);
        cell.priority_p = Number(base.priority_p || 0);
        cell.data_insufficient = stateFlags.data_insufficient !== undefined ? !!stateFlags.data_insufficient : cell.u_count < APG_K;
        cell.anomaly = stateFlags.anomaly !== undefined ? !!stateFlags.anomaly : false;
        return [id, cell];
      })
    );

    const recentSignals = pendingSignals.filter((s) => within7Days(s.created_at));
    const hourCut = nowMs() - 60 * 60 * 1000;
    const hourCounts = {};

    recentSignals.forEach((s) => {
      const g = byGrid[s.grid_id];
      if (!g) return;
      g.count += 1;
      g.u_count += 1;
      g.demand += (SOURCE_WEIGHT[s.source_type] ?? 0.2) * decay(s.created_at);
      if (toMillis(s.created_at) >= hourCut) {
        hourCounts[s.grid_id] = (hourCounts[s.grid_id] || 0) + 1;
      }
    });

    Object.values(byGrid).forEach((g) => {
      if ((hourCounts[g.grid_id] || 0) >= ANOMALY_THRESHOLD) {
        g.anomaly = true;
        g.demand *= 0.5;
      }
      g.demand = Number(g.demand.toFixed(2));
      g.data_insufficient = g.u_count < APG_K;
      g.capacity_score = Number(resourceAvg.toFixed(2));
      g.priority_p = Number((g.demand / (g.capacity_score + EPSILON)).toFixed(2));
    });

    const publishable = Object.values(byGrid).filter((g) => !g.data_insufficient).map((g) => g.demand);
    const cuts = { mid: quantileCut(publishable, 0.3), high: quantileCut(publishable, 0.7) };
    Object.values(byGrid).forEach((g) => {
      g.band = g.data_insufficient ? "DataInsufficient" : priorityBand(g.demand, cuts);
    });

    const priorityList = Object.values(byGrid).sort((a, b) => b.priority_p - a.priority_p).map((x, i) => ({ ...x, rank: i + 1 }));

    const metrics = {
      backlog: Math.max(0, Number(metricsFromBackend.backlog || 0) + recentSignals.length - pendingLogs.length),
      avgResponseMin: Math.max(0, Number(metricsFromBackend.avgResponseMin || 0) - pendingLogs.length * 4)
    };

    return {
      gridAgg: byGrid,
      priorityList,
      metrics,
      resources,
      logs: pendingLogs,
      signals: recentSignals,
      backendBanner
    };
  }

  function setRealtime(updateCb) {
    onUpdate = updateCb;

    if (useMock) {
      enableMockWithSeed("Using local demo data");
      return;
    }

    listeners = [
      onSnapshot(
        collection(db, "gridAgg"),
        (snap) => {
          aggByGrid = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
          emit();
        },
        (err) => handleReadError("gridAgg", err)
      ),
      onSnapshot(
        doc(db, "meta", "metrics"),
        (docSnap) => {
          if (docSnap.exists()) metricsFromBackend = docSnap.data();
          emit();
        },
        (err) => handleReadError("meta/metrics", err)
      ),
      onSnapshot(
        collection(db, "resources"),
        (snap) => {
          rawResources = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit();
        },
        (err) => handleReadError("resources", err)
      )
    ];

    emit();
  }

  async function submitSignal(payload) {
    const write = {
      created_at: serverTimestamp(),
      source_type: payload.source_type,
      category: payload.category,
      grid_id: payload.grid_id,
      status: "open",
      weight: SOURCE_WEIGHT[payload.source_type] ?? 0.2
    };

    if (!useMock) {
      await addDoc(collection(db, "signals"), write);
    }

    pendingSignals.push({ ...write, created_at: Date.now() });
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

    if (!useMock) {
      await setDoc(doc(db, "resources", id), payload, { merge: true });
    }

    const idx = rawResources.findIndex((r) => (r.resource_id || r.id) === id);
    const optimistic = { ...payload, id, updated_at: Date.now() };
    if (idx >= 0) rawResources[idx] = { ...rawResources[idx], ...optimistic };
    else rawResources.push(optimistic);

    emit();
  }

  async function saveLog(payload) {
    const write = {
      created_at: serverTimestamp(),
      grid_id: payload.grid_id,
      action: payload.action,
      outcome: payload.outcome
    };

    if (!useMock) {
      await addDoc(collection(db, "outreachLogs"), write);
    }

    pendingLogs.push({ ...write, created_at: Date.now() });
    emit();
  }

  return {
    setRealtime,
    submitSignal,
    upsertResource,
    saveLog,
    getSnapshot: () => computeSnapshot()
  };
}

export function canSubmitByRateLimit(key = "public") {
  const now = nowMs();
  const prev = Number(localStorage.getItem(`oo_rate_${key}`) || 0);
  if (now - prev < 30_000) return false;
  localStorage.setItem(`oo_rate_${key}`, String(now));
  return true;
}

export { WINDOW_DAYS, APG_K, EPSILON };
