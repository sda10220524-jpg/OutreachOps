codex/build-firebase-mvp-for-outreachops
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0uCBut6d5J9c8SgWR8awnYVgpSdjuuc8",
  authDomain: "outreachops-90566.firebaseapp.com",
  projectId: "outreachops-90566",
  storageBucket: "outreachops-90566.firebasestorage.app",
  messagingSenderId: "500012573302",
  appId: "1:500012573302:web:67c89e972968c5e636b557",
  measurementId: "G-FNVLCJGCQ6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUid = null;

try {
  if (await isSupported()) {
    getAnalytics(app);
  }
} catch (err) {
  console.warn("Analytics disabled:", err?.message || err);
}

try {
  const cred = await signInAnonymously(auth);
  currentUid = cred.user?.uid || null;
} catch (err) {
  console.error("Anonymous auth failed", err);
}

export const OO = {
  db,
  auth,
  currentUid,
  collection,
  doc,
  setDoc,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  updateDoc

// Firebase placeholder config for hackathon handoff.
// Replace with real keys before deployment.
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME'
main
};
