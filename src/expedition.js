// Expedition (S-8): a long trip you start yourself (X). The game strings together a few
// real places and ends at a base; you drive to each in order, in whatever way you like.
// It pays by distance and a bonus for being quick. While it runs, side jobs wait.

const ARRIVE_R = 45;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Order the stops: always the nearest unvisited place next, then the farthest-from-here
// base last. Pure and deterministic, so it can be tested.
export function planStops(from, places, bases, maxPlaces = 3) {
  const stops = [];
  let here = from;
  const left = places.filter((p) => dist(p, from) > ARRIVE_R * 2);
  while (stops.length < maxPlaces && left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (dist(left[i], here) < dist(left[bi], here)) bi = i;
    const [p] = left.splice(bi, 1);
    stops.push({ x: p.x, z: p.z, name: p.name, letter: p.letter, blurb: p.blurb });
    here = p;
  }
  // end at the base that is further from the last stop, so the way home is not a hop
  const ends = bases.filter((b) => dist(b, here) > ARRIVE_R * 2);
  if (ends.length) {
    const b = ends.reduce((m, c) => (dist(c, here) > dist(m, here) ? c : m));
    stops.push({ x: b.x, z: b.z, name: `база ${b.name}`, letter: b.name[0], base: true });
  }
  return stops;
}

export function legLength(from, stops) {
  let d = 0, here = from;
  for (const s of stops) { d += dist(here, s); here = s; }
  return d;
}

export function createExpedition({ places, bases }) {
  let run = null;
  return {
    get active() { return !!run; },
    start(x, z) {
      const from = { x, z };
      const stops = planStops(from, places, bases);
      if (stops.length < 2) return null;
      run = { stops, next: 0, t: 0, length: legLength(from, stops) };
      return { type: 'start', text: `Експедиція: ${stops.length} зупинок, ${(run.length / 1000).toFixed(1)} км`, stops };
    },
    cancel() {
      if (!run) return null;
      run = null;
      return { type: 'cancel', text: 'Експедицію скасовано' };
    },
    update(dt, x, z) {
      if (!run) return null;
      run.t += dt;
      const s = run.stops[run.next];
      if (dist({ x, z }, s) > ARRIVE_R) return null;
      run.next++;
      if (run.next < run.stops.length) {
        return { type: 'stop', text: `Зупинка: ${s.name} · далі ${run.stops[run.next].name}`, lines: s.blurb ? [['ОРІОН · геолог', `${s.name}. ${s.blurb}`]] : null };
      }
      // par pace 7 m/s: finishing under par earns up to +50 %
      const par = run.length / 7;
      const quick = Math.max(0, Math.min(0.5, (par - run.t) / par));
      const pay = Math.round((8 + run.length / 300) * (1 + quick));
      const out = { type: 'done', pay, seconds: run.t, text: `Експедицію завершено: ${(run.length / 1000).toFixed(1)} км за ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')} · +${pay} мотлоху` };
      run = null;
      return out;
    },
    hud(x, z) {
      if (!run) return null;
      const s = run.stops[run.next];
      return { title: 'Експедиція', text: `${run.next + 1}/${run.stops.length}: ${s.name} · ${(dist({ x, z }, s) / 1000).toFixed(1)} км`, left: run.stops.length - run.next };
    },
    targets() {
      if (!run) return [];
      const s = run.stops[run.next];
      return [{ x: s.x, z: s.z, kind: 'circle', text: s.letter || '★', color: '#ff9bd0' }];
    },
  };
}
