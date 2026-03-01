const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

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
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

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
});
