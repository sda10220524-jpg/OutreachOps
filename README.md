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
