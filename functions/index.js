const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

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
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

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
});
