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
