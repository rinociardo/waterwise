import {
  recommend, applyReading, reservoirGal, kEstab, k0, madFor, BANDS, DEFAULT_CFG,
} from './model.js';
import * as store from './store.js';
import { seedPlants } from './plants.js';
import { getWeather, isoDay, rainWindow, climatologyET0 } from './weather.js';

export const APP_VERSION = '1.16.0';   // bump with sw.js CACHE on every release

let state = store.load();
let weather = { days: [], source: 'climatology' };
let tab = 'today';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

const gal = v => (Math.round(v * 2) / 2).toFixed(1).replace(/\.0$/, '');

// ── boot ────────────────────────────────────────────────────────────────────
// NOTE: init() is invoked at the BOTTOM of this file, not here. Function
// declarations hoist but `const` does not — booting from the top would run
// render() before module-level constants further down (GAUGE_STOPS) had been
// initialised, throwing a temporal-dead-zone ReferenceError.
async function init() {
  render();
  await refresh();
}

async function refresh() {
  const { lat, lon } = state.site;
  weather = await getWeather({ lat, lon, pastDays: 92, forecastDays: 7 });
  store.advanceToToday(state, weather.days);
  store.save(state);
  render();
}

// ── derived ─────────────────────────────────────────────────────────────────
function today() { return isoDay(); }

function todayWeather() {
  return weather.days.find(d => d.date === today())
      || { date: today(), et0In: climatologyET0(today()), rainIn: 0 };
}

function rows() {
  return state.plants
    .filter(p => !store.isRetired(p, today()))
    .map(p => ({ p, r: recommend(p, state.cfg) }))
    .sort((a, b) => b.r.depletionFrac - a.r.depletionFrac);
}

// ── render ──────────────────────────────────────────────────────────────────
function render() {
  const root = $('#app');
  root.replaceChildren(
    header(),
    el('main', { class: 'main' },
      tab === 'today' ? viewToday()
      : tab === 'plants' ? viewPlants()
      : tab === 'map' ? viewMap()
      : tab === 'log' ? viewLog()
      : viewSettings()),
    nav(),
  );
}

function header() {
  const w = todayWeather();
  const r3 = rainWindow(weather.days, today(), 3);
  const srcLabel = { live: 'live', cache: 'cached', climatology: 'offline estimate' }[weather.source];
  return el('header', { class: 'top' },
    el('div', { class: 'top-row' },
      el('h1', {}, 'WaterWise'),
      el('span', { class: `src src-${weather.source}` }, srcLabel),
    ),
    el('div', { class: 'stats' },
      stat('ET₀ today', w.et0In.toFixed(3) + '″'),
      stat('Rain, 3 days', r3.toFixed(2) + '″'),
      stat('Plants due', `${rows().filter(x => x.r.due).length} of ${rows().length}`),
      stat('Water needed', gal(rows().filter(x => x.r.due).reduce((s, x) => s + x.r.gallons, 0)) + ' gal'),
    ),
  );
}

function stat(label, value) {
  return el('div', { class: 'stat' },
    el('dt', {}, label), el('dd', {}, value));
}

// ── Today ───────────────────────────────────────────────────────────────────

/** Nag for a backup every fortnight.
 *
 *  There is no server. Everything you have entered lives in this browser's
 *  localStorage, and a browser can lose that without asking: clearing site
 *  data takes it, and Safari evicts storage for sites you have not opened in
 *  seven days unless the app is on the home screen. A downloaded JSON file is
 *  the only copy that survives any of that.
 *
 *  The download is NOT automatic. Browsers block file writes that no click
 *  asked for, and a program that quietly drops files in Downloads every
 *  fortnight is a program you end up fighting. So: one line, one button. */
const BACKUP_DAYS = 14;

function backupBanner() {
  const since = store.daysSinceBackup(state, today());
  if (since < BACKUP_DAYS) return null;
  const entries = state.log.length;
  return el('div', { class: 'bulk' },
    el('span', { class: 'hint' },
      (since === Infinity
        ? 'No backup yet. '
        : `Last backup was ${since} days ago. `) +
      `${entries} log ${entries === 1 ? 'entry' : 'entries'} and every learned kSite live only in this browser — ` +
      'clearing site data would take them.'),
    el('button', { class: 'btn small primary', onclick: doExport }, 'Download backup'),
    el('button', {
      class: 'btn small',
      title: 'Hide this for another two weeks without saving a file',
      onclick: () => { store.markBackup(state, today()); store.save(state); render(); },
    }, 'Not now'),
  );
}

function viewToday() {
  const all = rows();
  const due = all.filter(x => x.r.due);
  const rest = all.filter(x => !x.r.due);

  return el('div', {},
    backupBanner(),
    state.seedMerge && (state.seedMerge.added || state.seedMerge.updated || state.seedMerge.removed)
      ? el('p', { class: 'note-ok' },
          'Plant list updated from the app files: ' +
          [state.seedMerge.added && `${state.seedMerge.added} added`,
           state.seedMerge.updated && `${state.seedMerge.updated} changed`,
           state.seedMerge.removed && `${state.seedMerge.removed} removed`]
            .filter(Boolean).join(', ') +
          '. Your log, readings and learned kSite were kept, and the season was replayed.')
      : null,

    weather.source !== 'live' ? el('p', { class: 'warn' },
      weather.source === 'cache'
        ? 'Using cached weather — no connection right now.'
        : 'No weather data reached this device. Figures below use a seasonal average, not today’s actual conditions.') : null,

    // The bulk bar lives OUTSIDE the due section on purpose. It used to sit
    // inside it, which meant that logging the last due plant took the whole
    // bar away with it — including `Log ALL`, the one control whose scope does
    // not depend on this device's idea of what is due, and including the date
    // picker, so a backdated session could strand you with no way back to
    // today. You water the yard and then want to record it; that is exactly
    // the moment nothing is due.
    bulkBar(due),

    due.length === 0
      ? el('p', { class: 'empty' }, 'Nothing is due. Every root ball is above the watering threshold.')
      : el('section', {},
          el('h2', {}, `Water today — ${due.length} plants, ${gal(due.reduce((s,x)=>s+x.r.gallons,0))} gal`),
          el('ul', { class: 'list' }, due.map(x => plantRow(x, true)))),

    el('section', {},
      el('h2', {}, due.length ? 'Not yet due' : 'All plants'),
      el('ul', { class: 'list dim' }, rest.map(x => plantRow(x, false)))),
  );
}

/**
 * Log a set of plants on a given date, refusing to silently double up.
 *
 * Pressing a bulk button twice used to add a second entry for every plant with
 * no warning at all: depletion is clamped at zero, so the screen looks
 * identical while the log doubles and the season's gallons go with it. Anything
 * already watered on that date is now reported and skipped.
 *
 * Shared by Today (which always writes today) and the Log tab's backfill panel
 * (which writes a date you pick there).
 */
function logSetOn(set, pick, label, when) {
  return () => {
    const already = store.wateredOn(state, when);
    const fresh = set.filter(x => !already.has(x.p.id));
    const dup = set.length - fresh.length;

    if (!fresh.length) {
      alert(`All ${set.length} already have a watering logged for ${when}.\n\n` +
            'Nothing added. To change what was recorded, delete the entry on the Log tab and log it again.');
      return;
    }
    const msg = dup
      ? `${dup} of these ${set.length} already have an entry for ${when}.\n\n` +
        `OK logs ${label} for the remaining ${fresh.length} only.`
      : `Log ${label} for all ${fresh.length} plants, dated ${when}?`;
    if (!confirm(msg)) return;

    for (const x of fresh) store.logWater(state, x.p.id, pick(x), when);
    commit();
  };
}

/**
 * Log a whole round at once — the normal case when you have just walked the
 * yard with a hose rather than tapping each plant as you go.
 *
 * This bar writes TODAY, always. It used to carry a date picker, which made it
 * a mode: set a past date, forget, and every later tap on this screen quietly
 * filed water in the past with nothing but a line of hint text to say so.
 * Backfilling a missed round is a correction to history, so it lives on the Log
 * tab now, next to the history it corrects.
 */
function bulkBar(due) {
  const model = due.reduce((s, x) => s + x.r.gallons, 0);
  const nursery = due.reduce((s, x) => s + (x.p.nurseryGal || 0), 0);
  const when = today();
  const all = rows();
  return el('div', { class: 'bulk' },
    el('span', { class: 'hint' },
      'Watered everything already? Log the round in one go. ' +
      (due.length
        ? `The two “due” buttons cover the ${due.length} plants due on this device, not all ${all.length}. ` +
          'Another device may think a different set is due, so use “Log ALL” for a whole-yard round.'
        : `Nothing is due on this device right now. “Log ALL ${all.length}” still works — use it if you watered the yard anyway.`) +
      ' For a round you forgot to record, use Log → By date.'),
    due.length ? el('button', { class: 'btn small',
      onclick: logSetOn(due, x => x.r.gallons, `the model's doses (${gal(model)} gal)`, when) },
      `Log round — model, ${gal(model)} gal`) : null,
    due.length ? el('button', { class: 'btn small',
      onclick: logSetOn(due, x => x.p.nurseryGal || x.r.gallons, `the nursery doses (${gal(nursery)} gal)`, when) },
      `Log round — nursery, ${gal(nursery)} gal`) : null,
    el('button', {
      class: 'btn small',
      onclick: logSetOn(all, x => x.p.nurseryGal || x.r.gallons, 'the nursery doses', when),
    }, `Log ALL ${all.length} — nursery doses`),
  );
}

/** Persist, replay the log against the weather, redraw. */
function commit() {
  store.rebuild(state, weather.days);
  store.save(state);
  render();
}

/** Colour for a depletion fraction: green when full, amber mid, red when empty.
 *
 *  Saturation and lightness are interpolated alongside hue. Sweeping hue alone
 *  at a fixed S/L drags the midpoint through olive, because yellows need to be
 *  both lighter and more saturated than greens to read as the same intensity.
 *  A lightness offset is added in CSS for the dark theme. */
const GAUGE_STOPS = [
  { d: 0.0, h: 146, s: 44, l: 36 },   // full — green
  { d: 0.5, h: 42,  s: 85, l: 42 },   // half — amber
  { d: 1.0, h: 4,   s: 66, l: 45 },   // empty — red
];

function gaugeColor(depletionFrac) {
  const d = Math.min(1, Math.max(0, depletionFrac));
  let a = GAUGE_STOPS[0], b = GAUGE_STOPS[GAUGE_STOPS.length - 1];
  for (let i = 0; i < GAUGE_STOPS.length - 1; i++) {
    if (d >= GAUGE_STOPS[i].d && d <= GAUGE_STOPS[i + 1].d) {
      a = GAUGE_STOPS[i]; b = GAUGE_STOPS[i + 1]; break;
    }
  }
  const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
  const mix = (x, y) => Math.round(x + (y - x) * t);
  return { h: mix(a.h, b.h), s: mix(a.s, b.s), l: mix(a.l, b.l) };
}

function plantRow({ p, r }, actionable) {
  const pct = Math.round(r.depletionFrac * 100);
  const left = 100 - pct;
  const c = gaugeColor(r.depletionFrac);
  const cvars = `--h:${c.h};--s:${c.s}%;--l:${c.l}%`;
  return el('li', { class: 'row' },
    el('div', { class: 'row-head' },
      thumb(p, 'thumb-sm'),
      el('div', { class: 'grow' },
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'sub' }, `${p.sizeLabel} · ${p.botanical} ${p.cultivar}`)),
      el('div', { class: 'dose' },
        el('strong', { style: `${cvars};color:var(--gauge)` },
          actionable ? `${gal(r.gallons)} gal` : `${left}%`),
        el('span', { class: 'sub' }, actionable ? `${left}% water left` : 'water left')),
    ),
    el('div', {
      class: 'bar',
      style: cvars,
      title: `${gal(r.capacityGal - r.depletionGal)} of ${gal(r.capacityGal)} gal remaining`,
    },
      el('div', { class: 'fill', style: `width:${Math.max(0, left)}%` }),
      el('div', { class: 'mark', style: `left:${Math.round((1 - state.cfg.mad) * 100)}%`,
                  title: 'Watering threshold' })),
    el('div', { class: 'acts' },
      el('span', { class: 'amt' },
        el('input', {
          type: 'number', step: '0.5', min: '0', value: String(r.gallons),
          id: `amt-${p.id}`, 'aria-label': `Gallons for ${p.name}`,
        }),
        el('span', { class: 'unit' }, 'gal')),
      el('button', {
        class: `btn ${r.due ? 'primary' : ''}`, onclick: () => {
          const input = document.getElementById(`amt-${p.id}`);
          const v = parseFloat(input && input.value);
          // Always today. Per-plant logging on Today is "I just did this".
          store.logWater(state, p.id, Number.isFinite(v) && v > 0 ? v : r.gallons,
                         today());
          commit();
        }
      }, r.due ? 'Log watered' : 'Log anyway'),
      el('details', { class: 'reading' },
        el('summary', {}, 'Gauge reading'),
        el('div', { class: 'bands' }, BANDS.map(b =>
          el('button', {
            class: 'btn small', onclick: () => {
              const res = applyReading(p, b.key, state.cfg);
              store.logReading(state, p.id, b.key, res);
              store.save(state); render();   // readings act on the present only
            }
          }, b.label))),
        el('p', { class: 'hint' },
          `Model expects: ${r.band.label}. kSite ${(p.kSite ?? 1).toFixed(2)}. ` +
          `Nursery baseline ${p.nurseryGal} gal.`),
      ),
    ),
  );
}

/** Photo if one exists in ./photos/, quietly nothing if not.
 *
 *  A missing photo 404s once and is then remembered, so we don't fire 34 failed
 *  requests on every single load. Clearing the list is how you pick up a photo
 *  you've just added — hence the button on the Plants tab. */
const MISSING_PHOTOS = 'ww.photos.missing.v1';

function missingPhotos() {
  try { return new Set(JSON.parse(localStorage.getItem(MISSING_PHOTOS) || '[]')); }
  catch { return new Set(); }
}

function rememberMissing(src) {
  try {
    const set = missingPhotos();
    set.add(src);
    localStorage.setItem(MISSING_PHOTOS, JSON.stringify([...set]));
  } catch {}
}

export function forgetMissingPhotos() {
  try { localStorage.removeItem(MISSING_PHOTOS); } catch {}
}

function thumb(p, cls) {
  if (!p.photo || missingPhotos().has(p.photo)) return null;
  const img = el('img', {
    class: `thumb ${cls || ''}`, src: p.photo, alt: p.name,
    loading: 'lazy', decoding: 'async',
  });
  img.addEventListener('error', () => { rememberMissing(p.photo); img.remove(); });
  return img;
}

// ── Plants ──────────────────────────────────────────────────────────────────
let addOpen = false;

/** Add a plant by copying the shape of one already in the yard.
 *
 *  A ninth Skyrocket needs a name and nothing else — every dimension that
 *  matters (root ball, canopy, nursery dose, blurb, photo) comes from the
 *  eighth. `custom: true` keeps it out of mergeSeed's way, so it survives
 *  every future update untouched. */
function addPlantPanel() {
  if (!addOpen) {
    return el('div', { class: 'acts' },
      el('button', { class: 'btn small', onclick: () => { addOpen = true; render(); } },
        '+ Add a plant'));
  }

  const from = el('select', {},
    el('option', { value: '' }, 'Blank — a generic #5 shrub'),
    state.plants.map(p => el('option', { value: p.id }, `Copy ${p.name}`)));
  const name = el('input', { type: 'text', placeholder: 'e.g. Skyrocket juniper 9' });
  const when = el('input', { type: 'date', value: today(), max: today() });

  const add = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    const p = store.addPlant(state, {
      name: n,
      from: from.value || undefined,
      planted: when.value || today(),
    });
    addOpen = false;
    mapSel = p.id;          // so it is easy to find and drag into place
    commit();
  };

  return el('div', { class: 'row' },
    el('h3', {}, 'Add a plant'),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Name'), name,
        el('small', {}, 'What you will call it in the list.')),
      el('label', { class: 'field' }, el('span', {}, 'Shape'), from,
        el('small', {}, 'Copies root ball, canopy, nursery dose and photo — not the watering history.')),
      el('label', { class: 'field' }, el('span', {}, 'Planted'), when,
        el('small', {}, 'Sets where the establishment curve starts.')),
    ),
    el('div', { class: 'acts' },
      el('button', { class: 'btn small primary', onclick: add }, 'Add'),
      el('button', { class: 'btn small', onclick: () => { addOpen = false; render(); } }, 'Cancel'),
    ),
  );
}

/** Seed plants the user has deleted. They stay in `removedSeedIds` so that
 *  mergeSeed does not helpfully resurrect them on the next update — which
 *  also means the only way back is an explicit restore. */
function restorePanel() {
  const gone = state.removedSeedIds || [];
  if (!gone.length) return null;

  const names = new Map(seedPlants().map(p => [p.id, p.name]));
  return el('div', { class: 'row' },
    el('h3', {}, `Removed from the original list (${gone.length})`),
    el('p', { class: 'hint' },
      'These will not come back on an update. Restoring one brings it back with a clean history.'),
    el('div', { class: 'acts' }, gone.map(id => el('button', {
      class: 'btn small',
      onclick: () => {
        store.restoreSeedPlant(state, id);
        const m = store.mergeSeed(state.plants, state.removedSeedIds);
        state.plants = m.plants;
        commit();
      },
    }, `Restore ${names.get(id) || id}`))),
  );
}

function viewPlants() {
  return el('div', {},
    el('h2', {}, `Plants (${state.plants.length})`),
    addPlantPanel(),
    restorePanel(),
    el('p', { class: 'hint' },
      'kSite is learned from your gauge readings — it absorbs shade, soil and drainage without needing to model them.'),
    missingPhotos().size
      ? el('div', { class: 'acts' },
          el('button', { class: 'btn small', onclick: () => { forgetMissingPhotos(); render(); } },
            `Look for photos again (${missingPhotos().size} not found)`))
      : null,
    el('ul', { class: 'list' }, state.plants.map(p => {
      const cap = reservoirGal(p, state.cfg);
      const ke = kEstab(p, today(), state.cfg);
      return el('li', { class: 'row' },
        el('div', { class: 'row-head' },
          thumb(p, 'thumb-lg'),
          el('div', { class: 'grow' },
            el('div', { class: 'name' }, p.name),
            el('div', { class: 'sub' }, `${p.sizeLabel} · ring ${p.ringDiaFt || '—'} ft · nursery ${p.nurseryGal} gal`),
            p.blurb ? el('p', { class: 'blurb' }, p.blurb) : null),
          el('div', { class: 'dose' },
            el('strong', {}, `${gal(cap)} gal`),
            el('span', { class: 'sub' }, 'capacity')),
        ),
        el('div', { class: 'kv' },
          el('span', {}, `k₀ ${k0(p, state.cfg).toFixed(2)}`),
          el('span', {}, `k_estab ${ke.toFixed(2)}`),
          el('span', {}, `kSite ${(p.kSite ?? 1).toFixed(2)}`),
          el('span', {}, p.sun + ' sun'),
        ),
        placement(p),
        el('div', { class: 'acts' },
          el('span', { class: 'seg-label' }, 'Threshold'),
          el('span', { class: 'kv' }, `waters at ${Math.round(madFor(p, state.cfg) * 100)}% depleted`),
          el('button', {
            class: `btn small ${p.muted ? 'on' : ''}`,
            title: 'Keep tracking it, but never list it as due',
            onclick: () => { p.muted = !p.muted; store.save(state); render(); },
          }, p.muted ? '✓ Muted' : 'Mute'),
          el('button', {
            class: 'btn small danger',
            onclick: () => {
              const n = state.log.filter(e => e.plantId === p.id).length;
              if (!confirm(`Delete ${p.name}?` + (n ? ` Its ${n} log entries go too.` : '') +
                           (p.custom ? '' : '\n\nIt is from the original list; it will not return on update, but you can restore it from the top of this tab.'))) return;
              store.deletePlant(state, p.id);
              commit();
            },
          }, 'Delete'),
        ),
        p.note ? el('p', { class: 'hint' }, p.note) : null,
      );
    })),
  );
}

/** How water is delivered to this plant. Mutually exclusive, because each
 *  option implies a different share of the pour reaching the root zone:
 *  bare ground 0.60, mulch ring 0.95, drip 0.95 at the soil's own rate. */
function placement(p) {
  const mode = p.drip ? 'drip' : (p.hasRing ? 'ring' : 'none');
  const set = m => () => {
    p.drip = (m === 'drip');
    p.hasRing = (m === 'ring');
    store.save(state);
    store.rebuild(state, weather.days);   // efficiency changed, so replay
    store.save(state);
    render();
  };
  const opt = (m, label) => el('button', {
    class: `btn small ${mode === m ? 'on' : ''}`, onclick: set(m),
  }, `${mode === m ? '✓ ' : ''}${label}`);
  return el('div', { class: 'acts' },
    el('span', { class: 'seg-label' }, 'Delivery'),
    opt('none', 'Neither'),
    opt('ring', 'Mulch ring'),
    opt('drip', 'On drip'),
  );
}

// ── Map ─────────────────────────────────────────────────────────────────────
// A plan view of the plot. Positions are metres on a local grid with the origin
// at one corner — deliberately NOT latitude and longitude. Consumer phone GPS
// lands within about 5 m under open sky, and your plants are 1-3 m apart, so
// satellite positions would scramble the layout rather than record it.
//
// Drag a plant to place it. That is accurate enough to tell juniper 3 from
// juniper 6, which is the actual job. Measure with a tape only if you want
// the plan to be a real survey.

let mapSel = null;
let mapDrag = null;
let mapLabels = false;   // view preference, deliberately not persisted

function viewMap() {
  const widthM = state.site.eastWestM, lengthM = state.site.northSouthM;
  const northDeg = state.site.northDeg || 0;
  const PAD = 0.6;                       // metres of margin inside the frame
  const vbW = widthM + PAD * 2, vbH = lengthM + PAD * 2;
  const placed = rows().filter(({ p }) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const unplaced = rows().filter(({ p }) => !Number.isFinite(p.x) || !Number.isFinite(p.y));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  svg.setAttribute('class', 'map');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Plan of the planting');

  const ns = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // metre grid
  for (let i = 0; i <= widthM; i++) {
    svg.appendChild(ns('line', { x1: PAD + i, y1: PAD, x2: PAD + i, y2: PAD + lengthM,
      class: i % 5 ? 'grid' : 'grid5' }));
  }
  for (let j = 0; j <= lengthM; j++) {
    svg.appendChild(ns('line', { x1: PAD, y1: PAD + j, x2: PAD + widthM, y2: PAD + j,
      class: j % 5 ? 'grid' : 'grid5' }));
  }
  svg.appendChild(ns('rect', { x: PAD, y: PAD, width: widthM, height: lengthM, class: 'plot' }));

  // Compass rose. North is up by construction; northDeg tilts the needle for a
  // plot whose sides are not exactly on the cardinals.
  const cx = PAD + widthM - 0.75, cy = PAD + 0.75, rr = 0.5;
  const rose = ns('g', { class: 'rose', transform: `rotate(${northDeg} ${cx} ${cy})` });
  rose.appendChild(ns('circle', { cx, cy, r: rr, class: 'rosering' }));
  rose.appendChild(ns('line', { x1: cx, y1: cy + rr * 0.75, x2: cx, y2: cy - rr * 0.8, class: 'roseneedle' }));
  rose.appendChild(ns('polygon', {
    points: `${cx},${cy - rr} ${cx - 0.13},${cy - rr * 0.55} ${cx + 0.13},${cy - rr * 0.55}`,
    class: 'rosetip',
  }));
  const nt = ns('text', { x: cx, y: cy - rr - 0.14, class: 'roselabel' });
  nt.textContent = 'N';
  rose.appendChild(nt);
  svg.appendChild(rose);

  // axis labels, so the orientation is unmistakable even without the rose
  const lbl = (x, y, txt) => {
    const t = ns('text', { x, y, class: 'axis' }); t.textContent = txt; svg.appendChild(t);
  };
  lbl(PAD + widthM / 2, PAD - 0.15, `${widthM} m  east – west`);
  lbl(PAD + widthM / 2, PAD + lengthM + 0.45, 'S');
  lbl(PAD - 0.2, PAD + lengthM / 2, 'W');
  lbl(PAD + widthM + 0.2, PAD + lengthM / 2, 'E');

  // Labels are drawn in a second pass, AFTER every circle, so a name is never
  // hidden under a neighbour's canopy. The selected plant gets its full name;
  // everything else gets the short form, because 36 full names on a 20 x 10 m
  // plan at phone width is an unreadable thicket.
  const labels = [];

  for (const { p, r } of placed) {
    const c = gaugeColor(r.depletionFrac);
    const rad = Math.max(0.25, Math.min(1.6, (p.spreadFt * 0.3048) / 2));
    const g = ns('g', { class: `pin ${mapSel === p.id ? 'sel' : ''}`, 'data-id': p.id });
    g.appendChild(ns('circle', {
      cx: PAD + p.x, cy: PAD + p.y, r: rad,
      style: `--h:${c.h};--s:${c.s}%;--l:${c.l}%`,
      class: 'canopy',
    }));
    g.appendChild(ns('circle', { cx: PAD + p.x, cy: PAD + p.y, r: 0.12, class: 'stem' }));
    svg.appendChild(g);

    if (mapSel === p.id) {
      labels.push([PAD + p.x, PAD + p.y - rad - 0.25, p.name, 'pinlabel']);
    } else if (mapLabels) {
      labels.push([PAD + p.x, PAD + p.y - rad - 0.18, p.short || p.name, 'pintag']);
    }
  }

  for (const [x, y, txt, cls] of labels) {
    const t = ns('text', { x, y, class: cls });
    t.textContent = txt;
    svg.appendChild(t);
  }

  // Dragging, in SVG user units so it works at any zoom.
  //
  // The circles are moved DIRECTLY during the drag and the app re-renders only
  // once, on release. Calling render() on pointerdown or pointermove tears down
  // the very SVG element the listeners are bound to, and the drag dies on the
  // first move — which is exactly what it did the first time I wrote this.
  const toM = ev => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: clampNum(loc.x - PAD, 0, widthM), y: clampNum(loc.y - PAD, 0, lengthM) };
  };

  let dragEls = null;

  svg.addEventListener('pointerdown', ev => {
    const g = ev.target.closest && ev.target.closest('g.pin');
    if (!g) { if (mapSel) { mapSel = null; render(); } return; }
    mapDrag = g.dataset.id;
    mapSel = mapDrag;
    dragEls = [...g.querySelectorAll('circle')];
    g.classList.add('sel');
    try { svg.setPointerCapture(ev.pointerId); } catch {}
    ev.preventDefault();
  });

  svg.addEventListener('pointermove', ev => {
    if (!mapDrag || !dragEls) return;
    const p = state.plants.find(x => x.id === mapDrag);
    if (!p) return;
    const { x, y } = toM(ev);
    p.x = +x.toFixed(2); p.y = +y.toFixed(2);
    for (const c of dragEls) {
      c.setAttribute('cx', PAD + p.x);
      c.setAttribute('cy', PAD + p.y);
    }
    ev.preventDefault();
  });

  const end = ev => {
    if (!mapDrag) return;
    try { svg.releasePointerCapture(ev.pointerId); } catch {}
    mapDrag = null; dragEls = null;
    store.save(state);
    render();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  const sel = mapSel && state.plants.find(p => p.id === mapSel);

  return el('div', {},
    el('h2', {},
      el('span', {}, 'Map'),
      el('span', { class: 'qual' }, `${placed.length} of ${rows().length} placed`)),
    el('p', { class: 'hint' },
      'Drag a plant to place it. Circles are canopy spread, coloured by water left. ' +
      `Grid is 1 m; heavier lines every 5 m. North is up: ${widthM} m east–west across, ` +
      `${lengthM} m north–south down.`),
    el('div', { class: 'acts' },
      el('button', {
        class: `btn small ${mapLabels ? 'on' : ''}`,
        title: 'Short name beside every plant — the way to tell juniper 3 from juniper 6 while you place them',
        onclick: () => { mapLabels = !mapLabels; render(); },
      }, mapLabels ? '✓ Names' : 'Names'),
      mapLabels ? el('span', { class: 'kv' }, 'Tap a plant for its full name.') : null,
    ),
    el('div', { class: 'mapwrap' }, svg),
    sel
      ? el('p', { class: 'hint' },
          `${sel.name} — ${Number.isFinite(sel.x) ? `${sel.x.toFixed(1)} m across, ${sel.y.toFixed(1)} m along` : 'not placed'}`)
      : null,
    unplaced.length
      ? el('div', {},
          el('h3', {}, `Not yet placed (${unplaced.length})`),
          el('p', { class: 'hint' }, 'Tap one to drop it in the middle, then drag it where it belongs.'),
          el('div', { class: 'chips' }, unplaced.map(({ p }) =>
            el('button', { class: 'btn small', onclick: () => {
              // spiral outward from the centre so successive drops are separable
              const k = rows().filter(({ p: q }) => Number.isFinite(q.x)).length;
              const a = k * 2.399, rr = 0.35 * Math.sqrt(k);   // golden-angle spread
              p.x = +clampNum(widthM / 2 + rr * Math.cos(a), 0.2, widthM - 0.2).toFixed(2);
              p.y = +clampNum(lengthM / 2 + rr * Math.sin(a), 0.2, lengthM - 0.2).toFixed(2);
              mapSel = p.id; store.save(state); render();
            } }, p.name))))
      : null,
    el('h3', {}, 'Plot and orientation'),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'East–west (m)'),
        el('input', { type: 'number', step: '0.5', min: '2', value: String(widthM),
          onchange: e => { state.site.eastWestM = Math.max(2, parseFloat(e.target.value) || 20); store.save(state); render(); } }),
        el('small', {}, 'Drawn horizontally.')),
      el('label', { class: 'field' }, el('span', {}, 'North–south (m)'),
        el('input', { type: 'number', step: '0.5', min: '2', value: String(lengthM),
          onchange: e => { state.site.northSouthM = Math.max(2, parseFloat(e.target.value) || 10); store.save(state); render(); } }),
        el('small', {}, 'Drawn vertically.')),
      el('label', { class: 'field' }, el('span', {}, 'Compass offset (°)'),
        el('input', { type: 'number', step: '5', min: '-180', max: '180', value: String(northDeg),
          onchange: e => { state.site.northDeg = clampNum(parseFloat(e.target.value) || 0, -180, 180); store.save(state); render(); } }),
        el('small', {}, 'Tilts the needle if your boundaries are not quite on the cardinals. Positive turns it clockwise.')),
    ),
    el('div', { class: 'acts' },
      el('button', {
        class: 'btn small',
        title: 'Rotate every placement a quarter turn',
        onclick: () => {
          if (!confirm('Rotate the whole layout 90° and swap the plot dimensions?')) return;
          const W = state.site.eastWestM, L = state.site.northSouthM;
          for (const p of state.plants) {
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
              const { x, y } = p;
              p.x = +(L - y).toFixed(2); p.y = +x.toFixed(2);
            }
          }
          state.site.eastWestM = L; state.site.northSouthM = W;
          store.save(state); render();
        },
      }, 'Rotate layout 90°'),
    ),
  );
}

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── Log ─────────────────────────────────────────────────────────────────────
// Two views of the same entries. "By plant" answers "when did this last get
// water?"; "By date" answers "what did I miss on that round?" — which is the
// question a flat chronological list is worst at.
let logView = 'plant';
let logFilter = '';
let logOpen = null;

function daysAgo(dateISO) {
  if (!dateISO) return null;
  const d = Math.round((Date.parse(today()) - Date.parse(dateISO)) / 86400000);
  return d;
}

function ago(dateISO) {
  const d = daysAgo(dateISO);
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function viewLog() {
  const readings = state.log.filter(e => e.type === 'reading');
  const agreed = readings.filter(e => e.agreed).length;

  return el('div', {},
    el('h2', {}, 'Log'),
    el('div', { class: 'acts' },
      el('button', { class: `btn small ${logView === 'plant' ? 'on' : ''}`,
        onclick: () => { logView = 'plant'; render(); } }, 'By plant'),
      el('button', { class: `btn small ${logView === 'date' ? 'on' : ''}`,
        onclick: () => { logView = 'date'; render(); } }, 'By date'),
      el('button', { class: `btn small ${logView === 'all' ? 'on' : ''}`,
        onclick: () => { logView = 'all'; render(); } }, 'Everything'),
    ),
    readings.length
      ? el('p', { class: 'hint' },
          `${agreed} of ${readings.length} gauge readings matched the model (${Math.round(100 * agreed / readings.length)}%). ` +
          'Rising agreement means the model has learned your yard.')
      : el('p', { class: 'hint' },
          'No gauge readings yet. Each one corrects the model and teaches it that plant’s microsite.'),
    logView === 'plant' ? logByPlant()
      : logView === 'date' ? logByDate()
      : logAll(),
  );
}

/** One row per plant: when it was last watered, last read, and where it stands.
 *  This is the view that catches "I watered these — why does it not know?" */
function logByPlant() {
  const q = logFilter.trim().toLowerCase();
  const list = rows()
    .filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.botanical.toLowerCase().includes(q))
    .sort((a, b) => {
      const da = daysAgo(a.p.lastWatered), db = daysAgo(b.p.lastWatered);
      if (da === null && db === null) return 0;
      if (da === null) return -1;           // never watered floats to the top
      if (db === null) return 1;
      return db - da;                        // longest since watering first
    });

  return el('div', {},
    el('input', {
      class: 'search', type: 'search', placeholder: 'Filter by name…',
      value: logFilter, oninput: e => { logFilter = e.target.value; render(); },
    }),
    el('ul', { class: 'list lookup' }, list.map(({ p, r }) => {
      const c = gaugeColor(r.depletionFrac);
      const d = daysAgo(p.lastWatered);
      const stale = d === null || d >= 3;
      const open = logOpen === p.id;
      const mine = state.log.filter(e => e.plantId === p.id);
      return el('li', { class: 'lookrow' },
        el('button', { class: 'lookhead', onclick: () => { logOpen = open ? null : p.id; render(); } },
          el('span', { class: 'lookname' }, p.name),
          p.muted ? el('span', { class: 'tag' }, 'muted') : null,
          el('span', { class: `lookwhen ${stale ? 'stale' : ''}` }, ago(p.lastWatered)),
          el('span', { class: 'lookpct', style: `--h:${c.h};--s:${c.s}%;--l:${c.l}%` },
            `${100 - Math.round(r.depletionFrac * 100)}%`),
          el('span', { class: 'chev' }, open ? '▾' : '▸'),
        ),
        open
          ? el('div', { class: 'lookbody' },
              el('p', { class: 'hint' },
                `Last reading: ${ago(p.lastReading)}. kSite ${(p.kSite ?? 1).toFixed(2)}. ` +
                `${gal(r.capacityGal - r.depletionGal)} of ${gal(r.capacityGal)} gal remaining.`),
              mine.length
                ? el('ul', { class: 'list log' }, mine.slice(0, 40).map(e => logEntry(e, false)))
                : el('p', { class: 'empty' }, 'Nothing logged for this plant.'))
          : null,
      );
    })),
  );
}

/** One block per date: how many plants got water, and — the useful part —
 *  which ones did not. */
/**
 * Backfill a round you watered but did not record.
 *
 * This used to be a date picker on the Today screen, which made Today modal:
 * the picked date stuck, and every subsequent tap filed water in the past.
 * Here it is unambiguous — you are already looking at history, the date is
 * chosen per use, and nothing about it persists across a reload.
 */
let backfillDate = null;

function backfillPanel() {
  const all = rows();
  const when = backfillDate || today();
  const already = store.wateredOn(state, when);
  const missing = all.filter(x => !already.has(x.p.id));
  const nursery = missing.reduce((s, x) => s + (x.p.nurseryGal || 0), 0);

  return el('div', { class: 'bulk' },
    el('span', { class: 'hint' },
      'Watered the yard on a day you did not record? File it here and the model ' +
      'replays the weather from that date forward, which is what makes the ' +
      'figures come out right rather than just moving water around.'),
    el('label', { class: 'amt' },
      el('span', { class: 'unit' }, 'date'),
      el('input', {
        type: 'date', value: when, max: today(),
        onchange: e => { backfillDate = e.target.value || null; render(); },
      })),
    missing.length
      ? el('button', {
          class: 'btn small',
          onclick: logSetOn(missing, x => x.p.nurseryGal || x.r.gallons, 'the nursery doses', when),
        }, `Log ${missing.length} not yet recorded on ${when} — ${gal(nursery)} gal`)
      : el('span', { class: 'kv' }, `All ${all.length} plants already have an entry for ${when}.`),
  );
}

function logByDate() {
  const waters = state.log.filter(e => e.type === 'water');
  const dates = [...new Set(waters.map(e => e.date))].sort().reverse();
  const live = rows().map(x => x.p);

  if (!dates.length) {
    return el('div', {}, backfillPanel(),
      el('p', { class: 'empty' }, 'No waterings logged yet.'));
  }

  return el('div', {}, backfillPanel(),
    el('ul', { class: 'list' }, dates.slice(0, 60).map(date => {
    const onDate = waters.filter(e => e.date === date);
    const ids = new Set(onDate.map(e => e.plantId));
    const total = onDate.reduce((s, e) => s + (e.gallons || 0), 0);
    const missed = live.filter(p => !ids.has(p.id));
    const dups = store.duplicateCount(state, date);
    return el('li', { class: 'row' },
      el('div', { class: 'row-head' },
        el('div', { class: 'grow' },
          el('div', { class: 'name' }, date),
          el('div', { class: 'sub' }, `${ids.size} of ${live.length} plants · ${gal(total)} gal` +
            (dups ? ` · ${onDate.length} entries` : ''))),
        el('div', { class: 'dose' },
          el('strong', {}, missed.length ? `${missed.length}` : '✓'),
          el('span', { class: 'sub' }, missed.length ? 'not logged' : 'complete')),
      ),

      // A date can hold more entries than plants if a bulk button was pressed
      // twice. Depletion clamps at zero either way, so nothing on the Today
      // screen looks wrong — only the gallons total gives it away.
      dups
        ? el('div', { class: 'acts' },
            el('span', { class: 'seg-label' }, 'Duplicates'),
            el('span', { class: 'kv' },
              `${dups} extra ${dups === 1 ? 'entry' : 'entries'} — this date was logged more than once`),
            el('button', {
              class: 'btn small danger',
              onclick: () => {
                if (!confirm(`Keep one watering per plant on ${date} and delete the other ${dups}?\n\n` +
                             'The most recent entry for each plant is kept. Gauge readings are not touched.')) return;
                store.dedupeWaterings(state, date);
                commit();
              },
            }, `Remove ${dups} duplicate${dups === 1 ? '' : 's'}`))
        : null,
      missed.length
        ? el('details', {},
            el('summary', {}, `Show the ${missed.length} not logged on this date`),
            el('p', { class: 'missed' }, missed.map(p => p.name).join(' · ')),
            el('button', {
              class: 'btn small',
              onclick: () => {
                if (!confirm(`Log the ${missed.length} missing plants for ${date}?`)) return;
                for (const p of missed) store.logWater(state, p.id, p.nurseryGal || 1, date);
                commit();
              },
            }, `Add these ${missed.length} to ${date}`))
        : null,

      // Whole-date deletion. The log is the source of truth, so removing a day
      // is not a cosmetic tidy-up — the season is replayed without it and every
      // depletion figure since moves. Hence the count of what goes, readings
      // included, before you commit to it.
      el('details', { class: 'danger-zone' },
        el('summary', {}, `Delete this date…`),
        (() => {
          const n = store.entriesOn(state, date);
          return el('div', {},
            el('p', { class: 'hint' },
              `${n.water} watering${n.water === 1 ? '' : 's'}` +
              (n.reading ? ` and ${n.reading} gauge reading${n.reading === 1 ? '' : 's'}` : '') +
              `. Removing them replays the season as if ${date} never happened, so ` +
              'every depletion figure from that day forward changes.' +
              (n.reading ? ' Learned kSite is not replayed, so it stays as it is.' : '')),
            el('button', {
              class: 'btn small danger',
              onclick: () => {
                if (!confirm(`Delete all ${n.total} log entries dated ${date}?\n\nThis cannot be undone.`)) return;
                store.removeLogDate(state, date);
                commit();
              },
            }, `Delete all ${n.total} entries on ${date}`));
        })()),
    );
  })));
}

function logAll() {
  const entries = state.log.slice(0, 300);
  return entries.length === 0
    ? el('p', { class: 'empty' }, 'Nothing logged yet.')
    : el('ul', { class: 'list log' }, entries.map(e => logEntry(e, true)));
}

function logEntry(e, withName) {
  const p = state.plants.find(x => x.id === e.plantId);
  const who = withName ? ` — ${p ? p.name : e.plantId}` : '';
  return el('li', { class: 'logrow' },
    el('span', { class: 'when' }, e.date),
    el('span', { class: 'what' },
      e.type === 'water'
        ? `Watered ${gal(e.gallons)} gal${who}`
        : `Read ${bandLabel(e.band)} (model said ${bandLabel(e.predicted)})${who}`),
    el('span', { class: `tag ${e.type}` },
      e.type === 'water' ? 'water' : (e.agreed ? 'match' : 'correction')),
    el('button', {
      class: 'del', title: 'Delete this entry',
      onclick: () => { store.removeLogEntry(state, e.ts); commit(); },
    }, '×'),
  );
}

const bandLabel = k => (BANDS.find(b => b.key === k) || {}).label || k;

// ── Settings ────────────────────────────────────────────────────────────────
function viewSettings() {
  const c = state.cfg;
  const numField = (key, label, step, help) => el('label', { class: 'field' },
    el('span', {}, label),
    el('input', {
      type: 'number', step: String(step), value: String(c[key]),
      onchange: e => { c[key] = parseFloat(e.target.value); store.save(state); render(); }
    }),
    help ? el('small', {}, help) : null);

  return el('div', {},
    el('h2', {}, 'Settings'),

    el('h3', {}, 'Location'),
    el('div', { class: 'grid2' },
      el('label', { class: 'field' }, el('span', {}, 'Latitude'),
        el('input', { type: 'number', step: '0.0001', value: String(state.site.lat),
          onchange: e => { state.site.lat = parseFloat(e.target.value); store.save(state); refresh(); } })),
      el('label', { class: 'field' }, el('span', {}, 'Longitude'),
        el('input', { type: 'number', step: '0.0001', value: String(state.site.lon),
          onchange: e => { state.site.lon = parseFloat(e.target.value); store.save(state); refresh(); } })),
    ),
    el('button', { class: 'btn', onclick: useGeolocation }, 'Use my current location'),

    el('h3', {}, 'Soil and thresholds'),
    el('div', { class: 'grid2' },
      numField('awc', 'Available water capacity', 0.01, 'in water per in soil. Clay loam 0.18, sand 0.08, silt loam 0.20.'),
      numField('mad', 'Depletion before watering', 0.05, 'Fraction of the reservoir. 0.45 is conservative for establishing plants.'),
      numField('canopyScale', 'Canopy scale', 0.05, 'Converts silhouette ÷ ball area into a usable coefficient.'),
      numField('tauDays', 'Establishment decay τ (days)', 10, '400 ≈ three years to settle at 1.0.'),
      numField('minRainIn', 'Minimum useful rain (in)', 0.01, 'Smaller events never reach the root zone.'),
      numField('spill', 'Deliberate overfill', 0.05, 'Extra water to wet the surrounding backfill.'),
      numField('learnRate', 'kSite learning rate', 0.01, 'How fast a disagreement moves the site coefficient.'),
      numField('snapWeight', 'Reading snap weight', 0.05, 'How hard a reading pulls the integrator to what you observed.'),
    ),

    el('h3', {}, 'Data'),
    el('div', { class: 'acts' },
      el('button', { class: 'btn', onclick: doExport }, 'Export JSON'),
      el('label', { class: 'btn file' }, 'Import JSON',
        // No `accept` filter. iOS greys out .json files in the Files picker
        // when accept is 'application/json', because it matches on UTI rather
        // than MIME type — the file is right there and cannot be selected.
        // Better to accept anything and fail on parse with a clear message.
        el('input', { type: 'file', onchange: doImport })),
      el('button', { class: 'btn danger', onclick: () => {
        if (confirm('Erase all plants, readings and history?')) {
          state = store.reset(); store.save(state); refresh();
        }
      } }, 'Reset everything'),
    ),
    el('p', { class: 'hint' },
      `Version ${APP_VERSION}. Last integrated: ${state.lastStepDate || 'never'}. ` +
      `Last backup: ${state.lastBackup || 'never'}. ` +
      `Weather: ${weather.source}.` + (weather.error ? ` (${weather.error})` : '')),
    el('button', { class: 'btn small', onclick: forceUpdate },
      'Force update (clear cached app files)'),
    el('p', { class: 'hint' },
      'Clears the offline copy of the app and reloads. Your plants, log and settings are untouched.'),
  );
}

/** Drop the cached app shell and reload. Deliberately does NOT touch
 *  localStorage — that holds the plants, the log and the learned kSite. */
async function forceUpdate() {
  try {
    if ('caches' in window) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
    if ('serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
  } catch (e) {
    console.warn('force update failed', e);
  }
  location.reload();
}

function useGeolocation() {
  if (!navigator.geolocation) return alert('This browser has no geolocation.');
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.site.lat = +pos.coords.latitude.toFixed(4);
      state.site.lon = +pos.coords.longitude.toFixed(4);
      store.save(state); refresh();
    },
    err => alert('Could not get location: ' + err.message),
    { enableHighAccuracy: false, timeout: 10000 });
}

function doExport() {
  store.markBackup(state, today());
  const blob = new Blob([store.exportJSON(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `waterwise-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  store.save(state);
  render();
}

function doImport(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { state = store.importJSON(fr.result); store.save(state); refresh(); }
    catch (err) { alert('Import failed: ' + err.message); }
  };
  fr.readAsText(f);
}

// ── nav ─────────────────────────────────────────────────────────────────────
function nav() {
  const items = [['today', 'Today'], ['plants', 'Plants'], ['map', 'Map'],
                 ['log', 'Log'], ['settings', 'Settings']];
  return el('nav', { class: 'nav' }, items.map(([k, label]) =>
    el('button', {
      class: `tab ${tab === k ? 'active' : ''}`,
      onclick: () => { tab = k; render(); window.scrollTo(0, 0); }
    }, label)));
}

// ── service worker ──────────────────────────────────────────────────────────
console.info(`WaterWise ${APP_VERSION}`);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Check for a newer worker on every load rather than waiting for the
      // browser's own 24-hour cadence.
      reg.update();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('WaterWise: a new version is ready — reload to use it.');
          }
        });
      });
    } catch { /* http:// without a secure context, or SW disabled */ }
  });
}

// ── boot, after every module-level declaration above has been evaluated ──────
init();
