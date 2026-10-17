// Best times for the crossing, per region, chassis and direction, kept in the browser.
// A leg only counts if it was driven: at least a minute, no teleport (main.js voids it).
const KEY = 'rover.records';
const MIN_SECONDS = 60;
const key = (c) => `${c.region}|${c.chassis}|${c.from}>${c.to}`;
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}

export function fmtTime(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function bestOf(c) {
  const v = load()[key(c)];
  return typeof v === 'number' ? v : null;
}

// Returns { counted, isNew, best, prev }. `counted` is false for a leg too short to be real.
export function recordLeg(c, seconds) {
  if (!(seconds >= MIN_SECONDS)) return { counted: false, isNew: false, best: bestOf(c), prev: bestOf(c) };
  const all = load();
  const prev = typeof all[key(c)] === 'number' ? all[key(c)] : null;
  const isNew = prev === null || seconds < prev;
  if (isNew) {
    all[key(c)] = Math.round(seconds * 10) / 10;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage may be blocked */ }
  }
  return { counted: true, isNew, best: isNew ? all[key(c)] : prev, prev };
}
