// store.js — persistence and the daily integration step.

import { DEFAULT_CFG, stepDay, effectiveCapacityGal, clamp } from './model.js';
import { seedPlants } from './plants.js';
import { isoDay, addDays } from './weather.js';

const KEY = 'ww.state.v1';

export function defaultState() {
  return {
    version: 1,
    // The plot is described by its compass extents, not by "width" and
    // "length", so the map can never be drawn at the wrong orientation:
    // eastWestM is always the horizontal axis, northSouthM the vertical, and
    // north is always up. northDeg tilts the compass needle for a plot whose
    // axes are not exactly aligned — it rotates the needle, not the plan.
    site: { lat: 39.75, lon: -75.55, label: 'Wilmington, Delaware',
            eastWestM: 20, northSouthM: 10, northDeg: 0 },
    removedSeedIds: [],   // seed plants deliberately deleted — do not resurrect
    cfg: { ...DEFAULT_CFG },
    plants: seedPlants(),
    log: [],              // {ts, date, plantId, type:'water'|'reading', gallons?, band?, predicted?}
    lastStepDate: null,   // last date already integrated
    lastBackup: null,     // date of the last exported backup; null = never
  };
}

/** How long since the last backup, in days. Infinity if there has never been
 *  one — which is the state every fresh install starts in. */
export function daysSinceBackup(state, todayISO = isoDay()) {
  if (!state.lastBackup) return Infinity;
  const ms = new Date(todayISO + 'T12:00:00') - new Date(state.lastBackup + 'T12:00:00');
  return Math.max(0, Math.round(ms / 86400000));
}

export function markBackup(state, dateISO = isoDay()) {
  state.lastBackup = dateISO;
}

/** Fields that belong to the USER, not to the seed data.
 *  Everything else on a plant — dimensions, blurb, photo, nursery dose — is
 *  code, and an updated plants.js should win. */
const USER_FIELDS = [
  'kSite', 'depletionGal', 'hasRing', 'drip', 'lastWatered', 'lastReading',
  'muted', 'x', 'y',        // position on the map is the user's, not the seed's
];

/**
 * Reconcile saved plants against the current seed data.
 *
 * Without this, plants.js is only ever read once — on a browser's very first
 * load. Add a plant or correct a root-ball measurement afterwards and the
 * change is invisible, because localStorage already holds the old list. The
 * only recourse would be Reset, which throws away the watering log.
 *
 * So: seed data is code and refreshes on every load; the user's own state is
 * data and survives. New plants are appended, removed ones are dropped, and
 * anything the user created by hand is left alone.
 */
export function mergeSeed(savedPlants, removedSeedIds = []) {
  const saved = new Map((savedPlants || []).map(p => [p.id, p]));
  const gone = new Set(removedSeedIds);
  // A seed plant the user deleted must not come back on the next load.
  const seeds = seedPlants().filter(p => !gone.has(p.id));
  const seedIds = new Set(seeds.map(p => p.id));

  let added = 0, updated = 0;
  const merged = seeds.map(seed => {
    const old = saved.get(seed.id);
    if (!old) { added++; return seed; }
    const out = { ...seed };
    for (const f of USER_FIELDS) if (old[f] !== undefined) out[f] = old[f];
    // did any non-user field actually change?
    for (const k of Object.keys(seed)) {
      if (!USER_FIELDS.includes(k) && JSON.stringify(old[k]) !== JSON.stringify(seed[k])) {
        updated++; break;
      }
    }
    return out;
  });

  // Anything the user added by hand that the seed doesn't know about.
  const custom = (savedPlants || []).filter(p => !seedIds.has(p.id) && p.custom);
  const removed = (savedPlants || []).filter(p => !seedIds.has(p.id) && !p.custom).length;

  return { plants: [...merged, ...custom], added, updated, removed };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    // forward-compatible merge so new config keys appear without wiping state
    s.cfg = { ...DEFAULT_CFG, ...(s.cfg || {}) };
    if (!Array.isArray(s.log)) s.log = [];

    if (!Array.isArray(s.removedSeedIds)) s.removedSeedIds = [];
    // v1.13 and earlier kept a sticky "file entries under this date" mode on
    // the Today screen. Backfilling lives on the Log tab now and does not
    // persist, so drop any leftover value rather than leave a dead field that
    // looks meaningful in an export.
    delete s.logDate;
    migrateSite(s);
    const m = mergeSeed(s.plants, s.removedSeedIds);
    s.plants = m.plants;
    s.seedMerge = m;
    // A new plant has no integration history, and changed dimensions invalidate
    // the old depletion figures — so replay from scratch. The log makes that safe.
    if (m.added || m.updated || m.removed) s.lastStepDate = null;

    return s;
  } catch {
    return defaultState();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch (e) { console.warn('save failed', e); return false; }
}

/** v1.9 stored the plot as widthM x lengthM with no compass meaning, and drew
 *  the long side vertically. Carry those over to the compass-based fields,
 *  transposing any placements so the layout survives the axis swap. */
function migrateSite(s) {
  const site = s.site || (s.site = {});
  if (Number.isFinite(site.eastWestM) && Number.isFinite(site.northSouthM)) {
    if (!Number.isFinite(site.northDeg)) site.northDeg = 0;
    return;
  }
  const oldW = Number.isFinite(site.widthM) ? site.widthM : 10;
  const oldL = Number.isFinite(site.lengthM) ? site.lengthM : 20;
  site.eastWestM = oldL;      // the old long axis becomes the horizontal one
  site.northSouthM = oldW;
  site.northDeg = 0;
  delete site.widthM; delete site.lengthM;
  for (const p of s.plants || []) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const { x, y } = p; p.x = y; p.y = x;
    }
  }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch {}
  return defaultState();
}

/** Irrigation logged for a plant on a given date, in gross gallons. */
function irrigationOn(state, plantId, date) {
  return state.log
    .filter(e => e.type === 'water' && e.plantId === plantId && e.date === date)
    .reduce((s, e) => s + (e.gallons || 0), 0);
}

/**
 * Integrate every plant forward from lastStepDate to today.
 *
 * This is the open-loop part: it runs unattended and drifts, which is exactly
 * why a periodic gauge reading matters. Idempotent — running twice in a day
 * does nothing the second time.
 */
export function advanceToToday(state, weatherDays) {
  const today = isoDay();
  const byDate = new Map(weatherDays.map(d => [d.date, d]));

  // First run: start from the planting date so the model has real history.
  let cursor = state.lastStepDate
    ? addDays(state.lastStepDate, 1)
    : earliestStart(state, weatherDays);

  let steps = 0;
  const guard = 1200; // ~3 years, the whole establishment period

  while (cursor <= today && steps < guard) {
    const w = byDate.get(cursor);
    const day = {
      date: cursor,
      et0In: w ? w.et0In : fallbackET0(cursor),
      rainIn: w ? w.rainIn : 0,
    };
    for (const p of state.plants) {
      if (isRetired(p, cursor)) continue;
      p.depletionGal = stepDay(
        { ...p, depletionGal: p.depletionGal },
        { ...day, irrigationGal: irrigationOn(state, p.id, cursor) },
        state.cfg
      );
    }
    state.lastStepDate = cursor;
    cursor = addDays(cursor, 1);
    steps++;
  }

  // Clamp to what the roots can actually reach, in case constants changed
  // under a state that was integrated with the old ones.
  for (const p of state.plants) {
    p.depletionGal = clamp(p.depletionGal ?? 0, 0,
                           effectiveCapacityGal(p, today, state.cfg));
  }
  return { steps };
}

/**
 * Recompute every plant's depletion from scratch: zero at planting, then replay
 * the whole weather history applying each logged watering on its own date.
 *
 * This is what makes backdating possible. Incrementally subtracting water from
 * today's depletion is only correct if the water went in today — log a round
 * for last Sunday and the five days of evapotranspiration since then have to be
 * re-applied *after* it. So the log is the source of truth and the state is
 * derived from it, which also makes corrections and deletions work for free.
 *
 * kSite is deliberately NOT replayed. It is accumulated learning, not a
 * consequence of the weather, and replaying the readings would compound the
 * same lesson every time you edit anything.
 */
export function rebuild(state, weatherDays) {
  for (const p of state.plants) p.depletionGal = 0;
  state.lastStepDate = null;
  return advanceToToday(state, weatherDays);
}

function earliestStart(state, weatherDays) {
  const planted = state.plants.reduce(
    (min, p) => (!min || p.planted < min ? p.planted : min), null);
  const firstWeather = weatherDays.length ? weatherDays[0].date : isoDay();
  return planted && planted > firstWeather ? planted : firstWeather;
}

function fallbackET0(dateISO) {
  const m = new Date(dateISO + 'T12:00:00').getMonth();
  return [0.03,0.05,0.09,0.13,0.16,0.18,0.18,0.16,0.12,0.08,0.04,0.03][m];
}

export function isRetired(p, dateISO) {
  return !!p.retireAfter && dateISO >= p.retireAfter;
}

export function logWater(state, plantId, gallons, date = isoDay()) {
  state.log.unshift({ ts: Date.now(), date, plantId, type: 'water', gallons });
  const p = state.plants.find(x => x.id === plantId);
  if (p && (!p.lastWatered || date > p.lastWatered)) p.lastWatered = date;
  // Depletion is not touched here. Call rebuild() afterwards — that replays the
  // log against the weather and is correct whatever date the entry carries.
}

export function removeLogEntry(state, ts) {
  state.log = state.log.filter(e => e.ts !== ts);
}

/** Plant ids that already have a watering logged on `date`. */
export function wateredOn(state, date) {
  return new Set(state.log
    .filter(e => e.type === 'water' && e.date === date)
    .map(e => e.plantId));
}

/** How many surplus watering entries a date carries — entries beyond the first
 *  per plant. Pressing a bulk button twice is silent otherwise: the model
 *  clamps depletion at zero either way, so nothing on screen changes while the
 *  log quietly doubles and the season's gallons total goes with it. */
export function duplicateCount(state, date) {
  const waters = state.log.filter(e => e.type === 'water' && e.date === date);
  return waters.length - new Set(waters.map(e => e.plantId)).size;
}

/** What a date holds, by entry type — so a delete can say what it will take. */
export function entriesOn(state, date) {
  const on = state.log.filter(e => e.date === date);
  return {
    water: on.filter(e => e.type === 'water').length,
    reading: on.filter(e => e.type === 'reading').length,
    total: on.length,
  };
}

/** Delete every log entry on a date. Returns how many went.
 *
 *  The log is the source of truth, so this is not a cosmetic tidy-up: rebuild()
 *  replays the season without those entries and every depletion figure from
 *  that date forward changes. kSite is not replayed, so learning survives. */
export function removeLogDate(state, date) {
  const before = state.log.length;
  state.log = state.log.filter(e => e.date !== date);
  return before - state.log.length;
}

/** Collapse a date to one watering per plant, keeping the most recently
 *  entered — if two differ, the later one is the corrected intent. Readings
 *  are never touched. Returns how many entries were removed. */
export function dedupeWaterings(state, date) {
  const keep = new Map();          // plantId -> highest ts seen
  for (const e of state.log) {
    if (e.type !== 'water' || e.date !== date) continue;
    const best = keep.get(e.plantId);
    if (best === undefined || e.ts > best) keep.set(e.plantId, e.ts);
  }
  const before = state.log.length;
  state.log = state.log.filter(e =>
    e.type !== 'water' || e.date !== date || keep.get(e.plantId) === e.ts);
  return before - state.log.length;
}

export function logReading(state, plantId, band, result, date = isoDay()) {
  state.log.unshift({
    ts: Date.now(), date, plantId, type: 'reading',
    band, predicted: result.predictedKey, agreed: result.agreed,
  });
  const p = state.plants.find(x => x.id === plantId);
  if (p) {
    p.depletionGal = result.depletionGal;
    p.kSite = result.kSite;
    p.lastReading = date;
  }
}

/** Add a plant. `from` copies the shape of an existing one, which is how you
 *  add a ninth juniper without retyping its root ball. */
export function addPlant(state, { name, from, planted }) {
  const base = from
    ? { ...state.plants.find(p => p.id === from) }
    : {
        botanical: '', cultivar: '', sizeLabel: '#5',
        ballDiaIn: 11, ballDepthIn: 10, bufferFactor: 1.4, rootAccess0: 0.90,
        heightFt: 2.5, spreadFt: 2.5, ringDiaFt: 2, interception: 0.10,
        nurseryGal: 3, sun: 'full', evergreen: false,
      };
  const id = uniqueId(state, slug(name) || 'plant');
  const p = {
    ...base,
    id, name, custom: true,
    planted: planted || isoDay(),
    kSite: base.kSite ?? 1.0,
    depletionGal: 0, hasRing: false, drip: false, muted: false,
    lastWatered: null, lastReading: null,
    x: undefined, y: undefined,
    photo: base.photo,
  };
  delete p.retireAfter;
  state.plants.push(p);
  return p;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueId(state, base) {
  const taken = new Set(state.plants.map(p => p.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Remove a plant. A seed plant is remembered as removed so the next load
 *  does not helpfully put it back. */
export function deletePlant(state, id, alsoPurgeLog = true) {
  const p = state.plants.find(x => x.id === id);
  if (!p) return;
  state.plants = state.plants.filter(x => x.id !== id);
  if (!p.custom && !state.removedSeedIds.includes(id)) state.removedSeedIds.push(id);
  if (alsoPurgeLog) state.log = state.log.filter(e => e.plantId !== id);
}

/** Undo a seed deletion. */
export function restoreSeedPlant(state, id) {
  state.removedSeedIds = state.removedSeedIds.filter(x => x !== id);
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || !Array.isArray(s.plants)) throw new Error('Not a WaterWise export');
  s.cfg = { ...DEFAULT_CFG, ...(s.cfg || {}) };
  return s;
}
