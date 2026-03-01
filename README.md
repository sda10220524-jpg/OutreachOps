codex/build-firebase-mvp-for-outreachops
# OutreachOps (Firebase mobile-first MVP)

OutreachOps is a **grid-aggregate-only** outreach operations dashboard: it supports rapid mobile request/log workflows while preventing individual tracking.

## Non-negotiables (hard requirements)
- No pins/markers/dots/current-location/precise-coordinate text/photos/routes in UI.
- No law-enforcement-oriented wording or workflows.
- No `lat/lng/address/name/phone/photo` storage; data is `grid_id` centered.
- Public view shows **aggregates only**, not raw individual request lists.
- Safety always includes:
  - `No features that help sustain homelessness or provide avoidance tips.`

## APG / CWS / NRGI (1-line summaries)
- **APG:** W=7 days, k=10, U(cell)<k is rendered as data-insufficient (no numeric disclosure).
- **CWS:** source-weighted demand (`org>provider>public`) with time decay + anomaly penalty.
- **NRGI:** `Priority P = Demand / (Capacity + 0.1)`.

## Firebase + runtime
- Frontend: Vanilla HTML/CSS/JS + MapLibre GL + OSM raster background (no API key)
- Backend: Firebase Auth(Anonymous), Firestore realtime listeners (`onSnapshot`), Cloud Functions
- Config is committed in `public/firebase.js` per demo requirement.

## Run locally
1. `cd functions && npm install && cd ..`
2. `firebase emulators:start`
3. open `http://127.0.0.1:5000`

## Demo flow proof (F1/F2/F3)
1. **F1** Request submit
   - Dashboard → `+ Request` → Step1/2/3 submit
   - Immediately after submit: selected grid demand/priority updates and priority list refreshes.
2. **F2** Resource edit
   - Dashboard BottomSheet `Resources` → open ResourceEdit → change `availability_state`/`capacity_score` + save
   - Toast `Updated → Priority recalculated` and immediate list reorder.
3. **F3** Outreach log
   - Dashboard `Log` FAB → LogEntry save
   - KPI strip (`Backlog`, `Avg response time`) updates instantly + pulse emphasis.

## Safety UX
- Dedicated `Safety` tab remains one-screen checklist.
- Mini-checks are enforced right before Request submit / Resource save / Log save.

## Scope exclusions
- No geolocation permission requests.
- No per-person profile handling.
- No routing/navigation features.
- No raw public signal feed.


## Realtime listener strategy (rules-safe)
- Client subscribes to `gridAgg`, `resources`, and `meta/metrics` (aggregated/allowed reads).
- Client does **not** subscribe to raw `signals`/`outreachLogs` collections when rules deny those reads.
- If read fails with `permission-denied`, app shows a small **Backend read blocked** banner and keeps write paths active.
- Mock fallback is only enabled for backend availability errors (for example `unavailable`).

## Cleanup consistency
- Functions include `onSignalDelete` recomputation and chunked scheduled cleanup (`<=400` deletes per batch) with post-cleanup aggregate/metrics recompute so expired signals are not counted.

# OutreachOps MVP (Firebase-ready, grid-only)

OutreachOps is a privacy-first outreach operations dashboard that works with **grid_id-only aggregation** (no individual tracking, no precise location storage).

## Non-negotiables

- **No pins, no precise coordinates, no photos, no routes in UI.**
- **No law-enforcement / enforcement workflows.**
- **Storage is grid_id-centered; no identity collection and no precise location storage.**
- **Safety tab includes exact sentence:**
  - `No features that help sustain homelessness or provide avoidance tips.`

## Project structure

- logo is SVG to avoid binary in PR tool
- `public/index.html` — single mobile-first app shell (Dashboard / Request / Safety)
- `public/styles.css` — design tokens + component styles
- `public/app.js` — UI controller and event flows (F1/F2/F3)
- `public/ui.js` — tabs, modal, toast helpers
- `public/store.js` — local MVP data store + APG/CWS/NRGI + metrics
- `public/firebase.js` — Firebase config placeholder
- `functions/index.js` — Firestore-triggered aggregate recompute and cleanup job
- `firestore.rules` — minimal safety rules (blocks location-like keys)

## APG/CWS/NRGI (shown in UI helper text)

- APG: `W=7 days`, `k=10`, and `U<k => Data insufficient` (no numeric density shown).
- CWS weights: `org=1.0`, `provider=0.7`, `public=0.2` with recency decay.
- NRGI: `Priority P = Demand / (Capacity + 0.1)`.

## Local run (no backend required)

Open directly:

```bash
open public/index.html
```

Or with a static server:

```bash
npx serve public
```

## Firebase emulator run

```bash
npm i -g firebase-tools
cd functions && npm install && cd ..
firebase emulators:start
```

## Deploy (optional)

```bash
firebase deploy --only hosting,functions,firestore:rules
```

## 2–3 minute demo script

1. **F1 Request registration**
   - Go to Request tab → select category → select grid → submit.
   - App auto-returns Dashboard and shows demand/count impact.
2. **F2 Resource status change**
   - Dashboard → Resource Board → edit resource state or capacity.
   - Toast appears: `Updated → Priority recalculated`, and Priority list reorders.
3. **F3 Log entry update**
   - Switch Demo role to `Org`.
   - Open Log Entry modal and save action/outcome.
   - Backlog / Avg response cards visibly update.
4. **Safety tab**
   - Show all checklist items on one screen, including required fixed sentence.

## Explicit non-goals in this MVP

- No marker pins, no geolocation permission flow, no coordinate display.
- No identity profile collection.
- No direct raw signal list exposure in public view.
main
