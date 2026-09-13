// weather.js — daily reference evapotranspiration and rainfall.
//
// Open-Meteo returns et0_fao_evapotranspiration directly, which is the whole
// reason this app is cheap to build: FAO-56 Penman-Monteith already folds in
// radiation, temperature, humidity and wind. No API key for non-commercial use.
//
// Everything is cached to localStorage, and there is a climatological fallback
// so the app still gives a sane answer standing in the yard with no signal.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'ww.weather.cache.v1';

// Mean daily ET0 (inches) by month for ~40°N mid-Atlantic. Used only when the
// network is unavailable. Coarse, but far better than assuming zero.
const CLIMATOLOGY_IN = [
  0.03, 0.05, 0.09, 0.13, 0.16, 0.18,
  0.18, 0.16, 0.12, 0.08, 0.04, 0.03,
];

export function climatologyET0(dateISO) {
  const m = new Date(dateISO + 'T12:00:00').getMonth();
  return CLIMATOLOGY_IN[m];
}

export function isoDay(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

export function addDays(dateISO, n) {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }
  catch { return null; }
}

function writeCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch {}
}

/**
 * Fetch daily ET0 and precipitation.
 * Returns { days: [{date, et0In, rainIn}], source, fetchedAt, error? }
 * source is 'live' | 'cache' | 'climatology'.
 */
export async function getWeather({ lat, lon, pastDays = 30, forecastDays = 7 }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max',
    past_days: String(Math.min(92, pastDays)),
    forecast_days: String(Math.min(16, forecastDays)),
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    // Deliberately NOT setting precipitation_unit. Open-Meteo treats
    // et0_fao_evapotranspiration as a precipitation-class variable, so
    // precipitation_unit=inch silently converts it too — and converting again
    // on this side divides ET0 by 25.4 a second time. Everything comes back in
    // millimetres and is converted here, once, where it is visible.
  });

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const d = j.daily;
    if (!d || !Array.isArray(d.time)) throw new Error('unexpected payload');

    const days = d.time.map((date, i) => ({
      date,
      et0In: mmToIn(d.et0_fao_evapotranspiration?.[i]),
      rainIn: mmToIn(d.precipitation_sum?.[i]),
      tMaxF: num(d.temperature_2m_max?.[i]),
    })).filter(x => Number.isFinite(x.et0In));

    // Sanity guard: a plausible daily ET0 anywhere on earth is 0-0.5 in.
    // If the median lands far below that, a unit assumption has drifted —
    // shout rather than quietly under-watering everything for a season.
    const med = median(days.map(x => x.et0In).filter(Number.isFinite));
    if (days.length && med < 0.01) {
      console.warn(`[weather] median ET0 ${med.toFixed(4)}" looks too low — check units`);
    }

    const payload = { days, source: 'live', fetchedAt: Date.now(), lat, lon };
    writeCache(payload);
    return payload;
  } catch (err) {
    const cached = readCache();
    if (cached && Array.isArray(cached.days) && cached.days.length) {
      return { ...cached, source: 'cache', error: String(err.message || err) };
    }
    return {
      days: synthesise(pastDays, forecastDays),
      source: 'climatology',
      fetchedAt: Date.now(),
      error: String(err.message || err),
    };
  }
}

function num(v) { return Number.isFinite(v) ? v : 0; }
function mmToIn(v) { return Number.isFinite(v) ? v / 25.4 : 0; }
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function synthesise(pastDays, forecastDays) {
  const today = isoDay();
  const out = [];
  for (let i = -pastDays; i < forecastDays; i++) {
    const date = addDays(today, i);
    out.push({ date, et0In: climatologyET0(date), rainIn: 0, tMaxF: null });
  }
  return out;
}

/** Rainfall over the trailing n days ending on dateISO inclusive. */
export function rainWindow(days, dateISO, n = 3) {
  const end = Date.parse(dateISO);
  const start = end - (n - 1) * 86400000;
  return days
    .filter(d => { const t = Date.parse(d.date); return t >= start && t <= end; })
    .reduce((s, d) => s + (d.rainIn || 0), 0);
}
