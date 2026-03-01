codex/build-firebase-mvp-for-outreachops
const functions = require("firebase-functions");
const admin = require("firebase-admin");

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
main

admin.initializeApp();
const db = admin.firestore();

codex/build-firebase-mvp-for-outreachops
const WINDOW_DAYS = 7;
const APG_K = 10;
const EPSILON = 0.1;
const CLEANUP_BATCH_SIZE = 400;

function since(days) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
}

function weightFor(sourceType) {
  if (sourceType === "org") return 1.0;
  if (sourceType === "provider") return 0.7;
  return 0.2;
}

function decay(createdAt) {
  const ageHours = (Date.now() - createdAt.toMillis()) / 36e5;
  return Math.max(0.2, 1 - ageHours / (24 * WINDOW_DAYS));
}

async function recomputeGrid(gridId) {
  const sigSnap = await db.collection("signals")
    .where("grid_id", "==", gridId)
    .where("created_at", ">=", since(WINDOW_DAYS))
    .get();

  const recent = sigSnap.docs.map((d) => d.data());

  const burstSnap = await db.collection("signals")
    .where("grid_id", "==", gridId)
    .where("created_at", ">=", since(1 / 24))
    .get();

  const anomaly = burstSnap.size >= 9;
  let demand = 0;
  recent.forEach((s) => {
    const base = typeof s.weight === "number" ? s.weight : weightFor(s.source_type);
    demand += base * decay(s.created_at);
  });
  demand = Number((demand * (anomaly ? 0.5 : 1)).toFixed(2));

  const resSnap = await db.collection("resources").get();
  const capacity = resSnap.empty
    ? 1
    : Number((resSnap.docs.reduce((sum, d) => sum + Number(d.data().capacity_score || 0), 0) / resSnap.size).toFixed(2));

  const priority = Number((demand / (capacity + EPSILON)).toFixed(2));

  await db.collection("gridAgg").doc(gridId).set({
    demand,
    u_count: sigSnap.size,
    state_flags: {
      data_insufficient: sigSnap.size < APG_K,
      anomaly
    },
    capacity_score: capacity,
    priority_p: priority,

const SOURCE_WEIGHT = { org: 1.0, provider: 0.7, public: 0.2 };
const W_MS = 7 * 24 * 60 * 60 * 1000;

async function recomputeGridAgg(gridId) {
  const now = Date.now();
  const since = new Date(now - W_MS);
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const snap = await db.collection('signals').where('grid_id', '==', gridId).where('created_at', '>=', since).get();

  let demand = 0;
  let hourCount = 0;
  const uSet = new Set();
  snap.forEach((d) => {
    const s = d.data();
    const created = s.created_at?.toMillis?.() || now;
    const recency = Math.pow(0.5, (now - created) / (24 * 60 * 60 * 1000));
    demand += (SOURCE_WEIGHT[s.source_type] || 0.2) * recency;
    uSet.add(d.id);
    if (created >= hourAgo.getTime()) hourCount += 1;
  });

  const anomaly = hourCount >= 4;
  if (anomaly) demand *= 0.5;

  const resSnap = await db.collection('resources').get();
  let cap = 0;
  resSnap.forEach((r) => { cap += Number(r.data().capacity_score || 0); });
  cap = cap / Math.max(resSnap.size, 1);

  await db.collection('gridAgg').doc(gridId).set({
    demand,
    u_count: uSet.size,
    state_flags: { data_insufficient: uSet.size < 10, anomaly },
    capacity_score: cap,
    priority_p: demand / (cap + 0.1),
main
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

codex/build-firebase-mvp-for-outreachops
async function recomputeMetrics() {
  const sigSnap = await db.collection("signals").where("status", "==", "open").get();
  const logSnap = await db.collection("outreachLogs").get();

  const firstLogByGrid = {};
  logSnap.docs.forEach((d) => {
    const l = d.data();
    if (!l.created_at) return;
    if (!firstLogByGrid[l.grid_id] || l.created_at.toMillis() < firstLogByGrid[l.grid_id].toMillis()) {
      firstLogByGrid[l.grid_id] = l.created_at;
    }
  });

  let backlog = 0;
  let sumMin = 0;
  let cnt = 0;

  sigSnap.docs.forEach((d) => {
    const s = d.data();
    if (!s.created_at) return;
    const first = firstLogByGrid[s.grid_id];
    if (!first) backlog += 1;
    if (first) {
      const diff = (first.toMillis() - s.created_at.toMillis()) / 60000;
      if (diff >= 0) {
        sumMin += diff;
        cnt += 1;
      }
    }
  });

  await db.collection("meta").doc("metrics").set({
    backlog,
    avgResponseMin: cnt ? Math.round(sumMin / cnt) : 0,
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function recomputeAllGridsAndMetrics() {
  const gridsSnap = await db.collection("gridAgg").get();
  await Promise.all(gridsSnap.docs.map((d) => recomputeGrid(d.id)));
  await recomputeMetrics();
}

exports.onSignalCreate = functions.firestore.document("signals/{id}").onCreate(async (snap) => {
  await snap.ref.set({
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000)
  }, { merge: true });

  const signal = snap.data();
  await recomputeGrid(signal.grid_id);
  await recomputeMetrics();
});

exports.onSignalDelete = functions.firestore.document("signals/{id}").onDelete(async (snap) => {
  const signal = snap.data();
  if (signal?.grid_id) {
    await recomputeGrid(signal.grid_id);
  }
  await recomputeMetrics();
});

exports.onResourceWrite = functions.firestore.document("resources/{id}").onWrite(async () => {
  const agg = await db.collection("gridAgg").get();
  await Promise.all(agg.docs.map((d) => recomputeGrid(d.id)));
});

exports.onOutreachLogWrite = functions.firestore.document("outreachLogs/{id}").onWrite(async () => {
  await recomputeMetrics();
});

exports.cleanupExpiredSignals = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  const expiredGridIds = new Set();

  while (true) {
    const expired = await db.collection("signals")
      .where("expireAt", "<=", admin.firestore.Timestamp.now())
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (expired.empty) break;

    const batch = db.batch();
    expired.docs.forEach((d) => {
      const signal = d.data();
      if (signal?.grid_id) expiredGridIds.add(signal.grid_id);
      batch.delete(d.ref);
    });
    await batch.commit();

    if (expired.size < CLEANUP_BATCH_SIZE) break;
  }

  await Promise.all(Array.from(expiredGridIds).map((gridId) => recomputeGrid(gridId)));
  await recomputeMetrics();
  return null;
});

exports.recomputeAll = functions.https.onRequest(async (_req, res) => {
  await recomputeAllGridsAndMetrics();
  res.status(200).send("ok");

exports.onSignalCreated = onDocumentCreated('signals/{signalId}', async (event) => {
  const data = event.data.data();
  const ref = event.data.ref;
  const createdAt = data.created_at?.toMillis?.() || Date.now();
  await ref.set({ expires_at: admin.firestore.Timestamp.fromMillis(createdAt + W_MS) }, { merge: true });
  await recomputeGridAgg(data.grid_id);
});

exports.onResourceWritten = onDocumentWritten('resources/{resourceId}', async () => {
  const grids = await db.collection('gridAgg').get();
  await Promise.all(grids.docs.map((g) => recomputeGridAgg(g.id)));
});

exports.cleanupExpiredSignals = onSchedule('every 24 hours', async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection('signals').where('expires_at', '<=', now).limit(500).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
main
});
