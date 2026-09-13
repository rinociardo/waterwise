// model.js — pure water-balance model. No DOM, no I/O. Unit-testable.
//
// Physical basis:
//   Each plant is a bucket whose capacity is the plant-available water held in
//   its root ball. Water leaves as evapotranspiration, enters as rain and
//   irrigation. We water when depletion crosses MAD (management allowed
//   depletion).
//
//   The interesting term is K_ESTAB. A newly transplanted B&B plant has a
//   canopy far larger than the root system left to supply it, so it uses water
//   much faster than its root-ball volume alone would suggest. That ratio is
//   the establishment coefficient, and it decays toward 1.0 over ~3 years as
//   roots expand to match the canopy. One line reproduces the whole
//   year-1 / year-2 / established taper.

export const GAL_PER_IN_SQFT = 0.623; // 1 inch of water over 1 sq ft = 0.623 gal

export const DEFAULT_CFG = {
  // Soil
  awc: 0.18,            // in of plant-available water per in of soil depth (clay loam)
  mad: 0.33,            // fraction of the reachable reservoir depleted before we
                        // water. Conservative on purpose: a transplant holding
                        // less than half its roots cannot ride out the
                        // depletion a fully rooted plant tolerates. Raise
                        // toward 0.5 once established.

  // Establishment
  canopyScale: 0.35,    // converts (silhouette area / ball area) into a usable Kc
  k0Max: 4.0,           // clamp on the initial establishment coefficient
  k0Min: 1.0,
  tauDays: 400,         // e-folding time for establishment decay (~3 yr to settle)

  // Rain
  minRainIn: 0.10,      // events smaller than this never reach the root zone

  // Irrigation
  spill: 0.15,          // deliberate overfill to wet surrounding backfill
  minDoseGal: 0.5,      // never recommend a trivial top-up
  refillFloor: 0.60,    // when watering, deliver at least this share of the FULL
                        // ball. Deep and infrequent beats shallow and often —
                        // small top-ups train roots to stay near the surface.

  // Gauge feedback
  snapWeight: 0.30,     // how hard a reading pulls the integrator to the observed band
  learnRate: 0.06,      // per-disagreement adjustment to kSite
  kSiteMin: 0.5,
  kSiteMax: 2.0,
};

// Seed values for kSite by sun exposure. These are only a starting guess;
// the gauge-reading loop corrects them from observation.
export const SUN_SEED = {
  full: 1.00,        // baseline — maximum exposure
  afternoon: 0.95,   // only the hot half of the day
  morning: 0.90,     // only the cool half
  shade: 0.80,
};

// Ordinal bands a person can actually judge with a $15 meter or a finger.
// Values are depletion fraction (0 = full, 1 = empty).
export const BANDS = [
  { key: 'wet',      label: 'Wet',          lo: 0.00, hi: 0.15 },
  { key: 'moist',    label: 'Moist',        lo: 0.15, hi: 0.40 },
  { key: 'dryish',   label: 'Slightly dry', lo: 0.40, hi: 0.65 },
  { key: 'dry',      label: 'Dry',          lo: 0.65, hi: 1.00 },
];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function circleAreaSqft(diameterFt) {
  return Math.PI * Math.pow(diameterFt / 2, 2);
}

export function ballAreaSqft(p) {
  return circleAreaSqft(p.ballDiaIn / 12);
}

/** Plant-available water the root ball can hold, in gallons.
 *  bufferFactor accounts for the loosened backfill around a B&B ball, which
 *  acts as a slow-release buffer the roots can still reach. */
export function reservoirGal(p, cfg = DEFAULT_CFG) {
  const inchesAvailable = cfg.awc * p.ballDepthIn;
  return inchesAvailable * ballAreaSqft(p) * GAL_PER_IN_SQFT * (p.bufferFactor ?? 1.0);
}

/** Share of the ball's water the roots can actually reach, on a given date.
 *
 *  A balled-and-burlapped plant lost most of its fine roots in the nursery
 *  field, so it cannot extract anything like the full available water sitting
 *  in its own root ball — the water is there, the roots to take it are not.
 *  Container stock keeps its root system intact and starts near 1.0.
 *
 *  This recovers on the same time constant as the establishment coefficient,
 *  and it is what makes the model reproduce the nursery's every-2-3-days
 *  cadence instead of predicting a leisurely weekly soak. */
export function rootAccess(p, dateISO, cfg = DEFAULT_CFG) {
  const a0 = p.rootAccess0 ?? 0.9;
  const t = Math.max(0, daysBetween(p.planted, dateISO));
  return 1 - (1 - a0) * Math.exp(-t / cfg.tauDays);
}

/** The reservoir the plant can actually draw on today. */
export function effectiveCapacityGal(p, dateISO, cfg = DEFAULT_CFG) {
  return reservoirGal(p, cfg) * rootAccess(p, dateISO, cfg);
}

/** Initial establishment coefficient: how much faster this plant drinks than
 *  its root ball alone would suggest. Silhouette (height x spread) is a better
 *  proxy for transpiring leaf area than plan-view footprint, especially for
 *  narrow columnar conifers like the Skyrockets. */
export function k0(p, cfg = DEFAULT_CFG) {
  const silhouette = p.heightFt * p.spreadFt;
  const raw = (silhouette / ballAreaSqft(p)) * cfg.canopyScale;
  return clamp(raw, cfg.k0Min, cfg.k0Max);
}

export function daysBetween(aISO, bISO) {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 86400000);
}

/** Establishment coefficient on a given date, decaying toward 1.0. */
export function kEstab(p, dateISO, cfg = DEFAULT_CFG) {
  const t = Math.max(0, daysBetween(p.planted, dateISO));
  return 1 + (k0(p, cfg) - 1) * Math.exp(-t / cfg.tauDays);
}

/** Gallons this plant transpires on a day with the given reference ET. */
export function dailyUseGal(p, et0In, dateISO, cfg = DEFAULT_CFG) {
  return et0In * ballAreaSqft(p) * GAL_PER_IN_SQFT
       * kEstab(p, dateISO, cfg) * (p.kSite ?? 1.0);
}

/** Gallons of rain that actually reach the root ball. Small events are lost to
 *  mulch and canopy entirely; larger ones lose the interception fraction. */
export function rainGainGal(p, rainIn, cfg = DEFAULT_CFG) {
  if (!(rainIn >= cfg.minRainIn)) return 0;
  const throughfall = rainIn * (1 - (p.interception ?? 0.15));
  return throughfall * ballAreaSqft(p) * GAL_PER_IN_SQFT;
}

/** Advance one plant by one day. Returns the new depletion in gallons.
 *  irrigationGal is what was poured (gross); applyEff converts it to what
 *  actually soaked into the root zone. */
export function stepDay(p, day, cfg = DEFAULT_CFG) {
  const cap = effectiveCapacityGal(p, day.date, cfg);
  const use = dailyUseGal(p, day.et0In, day.date, cfg);
  const gain = rainGainGal(p, day.rainIn, cfg);
  const irr = (day.irrigationGal ?? 0) * applyEff(p);
  return clamp((p.depletionGal ?? 0) + use - gain - irr, 0, cap);
}

/** Fraction of poured water that stays in the root zone. A mulch ring holds the
 *  dose while it percolates; without one, much of a fast pour runs off. */
export function applyEff(p) {
  if (p.drip) return 0.95;      // drip delivers at the soil's own rate
  return p.hasRing ? 0.95 : 0.60;
}

/** Depletion this plant tolerates before it wants water.
 *
 *  The global default is deliberately cautious because most of the yard is
 *  transplanted stock with compromised roots. But tolerance is a property of
 *  the PLANT, not of the yard: a prairie grass genuinely rides out drying that
 *  would stress a newly dug conifer. Where that is true, say so here rather
 *  than loosening the threshold for everything. */
export function madFor(p, cfg = DEFAULT_CFG) {
  return clamp(p.mad ?? cfg.mad, 0.1, 0.9);
}

/** What to do with this plant today. */
export function recommend(p, cfg = DEFAULT_CFG, dateISO = todayISO()) {
  const full = reservoirGal(p, cfg);
  const cap = effectiveCapacityGal(p, dateISO, cfg);
  const dep = clamp(p.depletionGal ?? 0, 0, cap);
  const frac = cap > 0 ? dep / cap : 0;
  // Muted plants are still tracked and still shown — they just never nag.
  const due = !p.muted && frac >= madFor(p, cfg);

  // Net water to deliver: what the plant actually used, but never less than a
  // meaningful share of the whole ball — the point is to wet the full depth,
  // not to trickle in exactly what evaporated.
  const net = Math.max(dep, cfg.refillFloor * full);

  // Gross it up for the spill that wets the backfill and for whatever runs off
  // a plant with no mulch ring to hold the dose.
  let gal = (net * (1 + cfg.spill)) / applyEff(p);
  gal = Math.round(gal * 2) / 2; // nearest half gallon

  return {
    due,
    depletionGal: dep,
    depletionFrac: frac,
    capacityGal: cap,
    fullCapacityGal: full,
    mad: madFor(p, cfg),
    muted: !!p.muted,
    gallons: Math.max(gal, cfg.minDoseGal),
    band: bandForFraction(frac),
  };
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function bandForFraction(frac) {
  return BANDS.find(b => frac >= b.lo && frac < b.hi) ?? BANDS[BANDS.length - 1];
}

export function bandMidpoint(key) {
  const b = BANDS.find(x => x.key === key);
  return b ? (b.lo + b.hi) / 2 : 0.5;
}

/** Fold a human moisture reading into the model.
 *
 *  Two separate corrections, deliberately kept apart:
 *   1. STATE — the bucket is an open-loop integrator and drifts, so a reading
 *      pulls the current depletion toward the observed band.
 *   2. BIAS — if readings consistently disagree in the same direction, this
 *      plant's microsite differs from the model. kSite absorbs that: shade,
 *      compaction, a downspout, wind, root damage. We never need to know which.
 *
 *  The reading is ORDINAL. Never treat a conductivity meter's dial as a
 *  quantity — it drifts with fertiliser salts and means nothing absolute.
 */
export function applyReading(p, observedKey, cfg = DEFAULT_CFG, dateISO = todayISO()) {
  const cap = effectiveCapacityGal(p, dateISO, cfg);
  const predictedFrac = cap > 0 ? clamp((p.depletionGal ?? 0) / cap, 0, 1) : 0;
  const predictedKey = bandForFraction(predictedFrac).key;

  const order = BANDS.map(b => b.key);
  const iObs = order.indexOf(observedKey);
  const iPred = order.indexOf(predictedKey);

  // 1. state correction
  const target = bandMidpoint(observedKey) * cap;
  const depletionGal = (1 - cfg.snapWeight) * (p.depletionGal ?? 0) + cfg.snapWeight * target;

  // 2. bias learning — higher index = drier
  let kSite = p.kSite ?? 1.0;
  if (iObs > iPred) kSite *= (1 + cfg.learnRate);
  else if (iObs < iPred) kSite *= (1 - cfg.learnRate);
  kSite = clamp(kSite, cfg.kSiteMin, cfg.kSiteMax);

  return {
    depletionGal,
    kSite,
    predictedKey,
    observedKey,
    agreed: iObs === iPred,
  };
}

/** Run a plant forward over a series of days. Used by the tests to check that
 *  the model reproduces the nursery's cadence, and by the UI to backfill state
 *  from weather history. autoWater=true simulates watering whenever due. */
export function simulate(plant, days, cfg = DEFAULT_CFG, autoWater = false) {
  let p = { ...plant };
  const events = [];
  for (const day of days) {
    p.depletionGal = stepDay(p, day, cfg);
    const r = recommend(p, cfg);
    if (autoWater && r.due) {
      events.push({ date: day.date, gallons: r.gallons });
      p.depletionGal = 0;
    }
  }
  return { plant: p, events };
}

/** Mean interval in days between watering events. */
export function meanInterval(events) {
  if (events.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < events.length; i++) sum += daysBetween(events[i - 1].date, events[i].date);
  return sum / (events.length - 1);
}
