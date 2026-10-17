// The ghost of your best crossing: the path of the fastest leg, replayed beside the next
// attempt so you race yourself. A track is a list of samples [t, x, z, yaw] taken a few
// times a second; this file only holds the maths (recording, replay, saving) and no
// rendering, so it can be tested.
const STEP = 0.25; // seconds between samples
const KEY = 'rover.ghost';

export function createRecorder() {
  const track = [];
  let next = 0;
  return {
    // call every frame with the leg's clock; samples when a step has passed
    sample(t, x, z, yaw) {
      if (t < next) return;
      next = t + STEP;
      track.push([Math.round(t * 100) / 100, Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(yaw * 100) / 100]);
    },
    finish(t, x, z, yaw) {
      track.push([Math.round(t * 100) / 100, Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(yaw * 100) / 100]);
      return track;
    },
    reset() { track.length = 0; next = 0; },
    length: () => track.length,
  };
}

// Where the ghost is at time t: linear between samples, yaw taking the short way round.
export function ghostAt(track, t) {
  if (!track || track.length < 2) return null;
  if (t <= track[0][0]) return { x: track[0][1], z: track[0][2], yaw: track[0][3] };
  const last = track[track.length - 1];
  if (t >= last[0]) return { x: last[1], z: last[2], yaw: last[3], done: true };
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid][0] <= t) lo = mid; else hi = mid; }
  const a = track[lo], b = track[hi];
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  let dyaw = b[3] - a[3];
  dyaw -= Math.round(dyaw / (2 * Math.PI)) * 2 * Math.PI;
  return { x: a[1] + (b[1] - a[1]) * u, z: a[2] + (b[2] - a[2]) * u, yaw: a[3] + dyaw * u };
}

// When the ghost was nearest this spot (searching forward from a hint index, because the
// leg only ever moves on). Returns { time, index }; `time - yourClock` is how far ahead
// of the ghost you are (positive = ahead).
export function ghostTimeAt(track, x, z, hint = 0) {
  let best = hint, bd = Infinity;
  const end = Math.min(track.length, hint + 400);
  for (let i = hint; i < end; i++) {
    const d = (track[i][1] - x) ** 2 + (track[i][2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { time: track[best][0], index: best, dist: Math.sqrt(bd) };
}

// Saved per region/chassis/direction next to the record (records.js key shape).
export const ghostKey = (c) => `${c.region}|${c.chassis}|${c.from}>${c.to}`;
export function saveGhost(c, track) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) || {};
    all[ghostKey(c)] = track;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* storage may be blocked or full */ }
}
export function loadGhost(c) {
  try {
    const t = (JSON.parse(localStorage.getItem(KEY)) || {})[ghostKey(c)];
    return Array.isArray(t) && t.length > 2 ? t : null;
  } catch (e) { return null; }
}
