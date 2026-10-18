// Real Mars: Jezero crater (USGS CTX DTM of the Mars 2020 landing site, 20 m/px, see
// tools/prep-dem.mjs) or Gale crater (HRSC DTM, 30 m/px, tools/prep-gale.mjs); credits in
// textures/CREDITS.md. Loaded once, up front, so terrain.js can ask for a height
// synchronously like it always has. If the file is missing (or the player picked the
// classic region) REAL stays null and the procedural Mars is used unchanged.
const REGIONS = {
  jezero: {
    bases: [{ px: 1000, py: 860 }, { px: 760, py: 560 }], // АЛЬФА on the crater floor, БЕТА up on the delta
    places: [
      { name: 'Русло дельти', letter: 'Р', px: 520, py: 650, blurb: 'Тут річка колись впадала в озеро Єзеро. Видно, як вода розрізала вал.' },
      { name: 'Кратер-свідок', letter: 'К', px: 645, py: 705, blurb: 'Малий кратер на дельті: удар стався вже після того, як озеро зникло.' },
    ],
    near: ['Пагорб-оглядач', 'Западина', 'Уступ'],
  },
  gale: {
    // АЛЬФА at Bradbury Landing, where Curiosity touched down; БЕТА 8 km on, among the foothills near Pahrump Hills
    bases: [{ lon: 137.4417, lat: -4.5895 }, { lon: 137.38, lat: -4.72 }],
    places: [
      // the summit itself lies outside this window, so the marker sits on the highest ground in it
      { name: 'Схил гори Шарпа', letter: 'Ш', highest: true, blurb: 'Підніжжя Eolis Mons, п\'яти кілометрів шарів: кожен шар — інша епоха Марса.' },
      { name: 'Жовтий Ніж', letter: 'Ж', lon: 137.45, lat: -4.60, blurb: 'Тут марсохід Curiosity знайшов глину: колись тут була вода, придатна для життя.' },
    ],
    near: ['Пагорб-оглядач', 'Западина', 'Уступ'],
  },
  olympus: {
    // The flank of Olympus Mons, 12-17 km above the datum: АЛЬФА high on the slope, БЕТА a kilometre and a half lower
    bases: [{ px: 120, py: 540 }, { px: 400, py: 640 }],
    places: [
      { name: 'Схил вулкана', letter: 'В', px: 260, py: 560, blurb: 'Ти їдеш схилом найбільшого вулкана Сонячної системи: Олімп вищий за Еверест утричі, а схил такий пологий, що з нього не видно вершини.' },
      { name: 'Лавові тераси', letter: 'Л', px: 560, py: 330, blurb: 'Застиглі потоки лави. Вона текла тут мільярди років тому, шар за шаром.' },
    ],
    near: ['Пагорб-оглядач', 'Западина', 'Уступ'],
  },
};
import { PLANET } from './planet.js';

let region = 'jezero';
try { region = localStorage.getItem('rover.region') || 'jezero'; } catch (e) { /* keep default */ }
if (!REGIONS[region]) region = null; // 'classic' or anything unknown: procedural Mars

async function loadBytes(name) {
  const url = new URL(`../textures/mars/${name}`, import.meta.url);
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    const mod = 'node:fs'; // not a literal, so the bundler leaves it alone
    const fs = await import(/* @vite-ignore */ mod);
    return fs.readFileSync(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function build(meta, bytes, albedoBytes) {
  const u16 = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const { width: W, height: H, mppX, mppY, minH, maxH } = meta;
  const span = (maxH - minH) / 65535;
  const halfW = (W - 1) * mppX / 2;
  const halfH = (H - 1) * mppY / 2;
  const at = (i, j) => minH + u16[j * W + i] * span;
  // World x/z in metres from the middle of the map; +z is south, like the image rows.
  function height(x, z) {
    const fx = Math.min(W - 1.001, Math.max(0, (x + halfW) / mppX));
    const fz = Math.min(H - 1.001, Math.max(0, (z + halfH) / mppY));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  }
  // 0..1 brightness of the ground from the CTX orthoimage, nearest pixel
  function albedo(x, z) {
    const i = Math.min(W - 1, Math.max(0, Math.round((x + halfW) / mppX)));
    const j = Math.min(H - 1, Math.max(0, Math.round((z + halfH) / mppY)));
    return albedoBytes[j * W + i] / 255;
  }
  // Slope (rise over run) per pixel, once, so asking for it costs one lookup
  const slopeGrid = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    slopeGrid[j * W + i] = Math.hypot((at(i + 1, j) - at(i - 1, j)) / (2 * mppX), (at(i, j + 1) - at(i, j - 1)) / (2 * mppY));
  }
  function slope(x, z) {
    const i = Math.min(W - 1, Math.max(0, Math.round((x + halfW) / mppX)));
    const j = Math.min(H - 1, Math.max(0, Math.round((z + halfH) / mppY)));
    return slopeGrid[j * W + i];
  }
  // lon/lat (degrees) to world x/z, for regions whose meta records the projection origin
  const R = meta.radius;
  const lonLat = (lon, lat) => ({
    x: (R * lon * Math.PI / 180 - meta.originX) - halfW,
    z: (meta.originY - R * lat * Math.PI / 180) - halfH,
  });
  return { meta, halfW, halfH, height, albedo, slope, lonLat, region };
}

export const REAL = await (async () => {
  if (PLANET !== 'mars' || !region) return null;
  try {
    const [metaBytes, bytes, albedoBytes] = await Promise.all([loadBytes(`${region}-meta.json`), loadBytes(`${region}-height.bin`), loadBytes(`${region}-albedo.bin`)]);
    return build(JSON.parse(new TextDecoder().decode(metaBytes)), bytes, albedoBytes);
  } catch (e) {
    console.warn('real Mars unavailable, using the procedural one:', e);
    return null;
  }
})();

// ---- a road that follows the ground ----
// Cheapest path between two map pixels where steep ground costs a lot. Run on a coarse
// grid (100 m) of block-averaged heights, so it ignores pebble-scale noise.
const STEP = 5;
function findRoute(real, waypoints) {
  const { meta } = real;
  const gw = Math.floor(meta.width / STEP), gh = Math.floor(meta.height / STEP);
  const cell = STEP * meta.mppX;
  const hg = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    hg[j * gw + i] = real.height((i + 0.5) * cell - real.halfW, (j + 0.5) * cell - real.halfH);
  }
  const slopeAt = (a, b, d) => Math.abs(hg[a] - hg[b]) / d;
  const legs = [];
  for (let w = 0; w + 1 < waypoints.length; w++) {
    const [sx, sz] = waypoints[w], [ex, ez] = waypoints[w + 1];
    const toCell = ([px, pz]) => [Math.round((px + real.halfW) / cell - 0.5), Math.round((pz + real.halfH) / cell - 0.5)];
    const [si, sj] = toCell([sx, sz]), [ei, ej] = toCell([ex, ez]);
    const start = sj * gw + si, goal = ej * gw + ei;
    const g = new Float32Array(gw * gh).fill(Infinity);
    const from = new Int32Array(gw * gh).fill(-1);
    const heap = [[0, start]];
    g[start] = 0;
    const push = (e) => { heap.push(e); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const hx = (n) => Math.hypot((n % gw) - ei, Math.floor(n / gw) - ej) * cell;
    while (heap.length) {
      const [, n] = pop();
      if (n === goal) break;
      const ni = n % gw, nj = (n / gw) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const mi = ni + di, mj = nj + dj;
        if (mi < 2 || mj < 2 || mi >= gw - 2 || mj >= gh - 2) continue;
        const m = mj * gw + mi;
        const d = Math.hypot(di, dj) * cell;
        const s = slopeAt(n, m, d);
        if (s > 0.3) continue;
        const c = g[n] + d * (1 + 60 * s * s + 6 * s);
        if (c < g[m]) { g[m] = c; from[m] = n; push([c + hx(m), m]); }
      }
    }
    const path = [];
    for (let n = goal; n !== -1; n = from[n]) path.push(n);
    path.reverse();
    legs.push(...(w ? path.slice(1) : path));
  }
  return legs.map((n) => [((n % gw) + 0.5) * cell - real.halfW, (((n / gw) | 0) + 0.5) * cell - real.halfH]);
}

// A base or place is given either as map pixels or as lon/lat; both end up in world metres.
function toWorld(real, a) {
  if (a.highest) {
    let best = null;
    for (let x = -real.halfW + 2000; x <= real.halfW - 2000; x += 100) for (let z = -real.halfH + 2000; z <= real.halfH - 2000; z += 100) {
      const h = real.height(x, z);
      if (!best || h > best.h) best = { x, z, h };
    }
    return [best.x, best.z];
  }
  if (a.px !== undefined) return [a.px * real.meta.mppX - real.halfW, a.py * real.meta.mppY - real.halfH];
  const p = real.lonLat(a.lon, a.lat);
  return [p.x, p.z];
}
export const REAL_ROUTE = (() => {
  if (!REAL) return null;
  const pts = findRoute(REAL, REGIONS[REAL.region].bases.map((b) => toWorld(REAL, b)));
  // thin it to a control point every ~300 m so the spline can round the corners
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= 300 || i === pts.length - 1) { out.push(pts[i]); acc = 0; }
  }
  return out;
})();

// Named places on the real map, so the compass and the map have something real to point
// at. The far ones come from the region table; the near ones are found in the data itself,
// within reach of the road. `blurb` is what the radio says on arrival.
function nearPlaces() {
  const pts = REAL_ROUTE;
  const near = (x, z) => { let d = Infinity; for (const [px, pz] of pts) d = Math.min(d, Math.hypot(x - px, z - pz)); return d; };
  let hi = null, lo = null, steep = null;
  for (let x = -REAL.halfW; x <= REAL.halfW; x += 100) for (let z = -REAL.halfH; z <= REAL.halfH; z += 100) {
    const d = near(x, z);
    if (d < 400 || d > 2600) continue;
    const h = REAL.height(x, z);
    const sl = Math.hypot(REAL.height(x + 30, z) - REAL.height(x - 30, z), REAL.height(x, z + 30) - REAL.height(x, z - 30)) / 60;
    if (!hi || h > hi.h) hi = { x, z, h };
    if (!lo || h < lo.h) lo = { x, z, h };
    if (!steep || sl > steep.sl) steep = { x, z, sl };
  }
  return [
    hi && { name: 'Пагорб-оглядач', letter: 'П', ...hi, blurb: 'Найвища точка поблизу траси. Звідси видно далеко навколо.' },
    lo && { name: 'Западина', letter: 'З', ...lo, blurb: 'Найнижча точка поблизу траси: тут збирається пил.' },
    steep && { name: 'Уступ', letter: 'У', ...steep, blurb: 'Крутий уступ: шар за шаром порода, яку колись відклала вода.' },
  ].filter(Boolean);
}
export const REAL_PLACES = REAL
  ? [
    ...REGIONS[REAL.region].places.map((p) => {
      const [x, z] = toWorld(REAL, p);
      return { name: p.name, letter: p.letter, blurb: p.blurb, x, z };
    }),
    ...nearPlaces(),
  ]
  : [];

// A place can sit on a scarp no rover can climb (Уступ is 30 degrees). `goal` is where a
// trip to it should end: the nearest gently sloping ground, searched outwards.
function driveableNear(p) {
  if (!REAL || REAL.slope(p.x, p.z) < 0.14) return { x: p.x, z: p.z };
  for (let r = 40; r <= 800; r += 40) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (Math.abs(x) > REAL.halfW - 300 || Math.abs(z) > REAL.halfH - 300) continue;
      let worst = REAL.slope(x, z);
      for (let j = 0; j < 8; j++) worst = Math.max(worst, REAL.slope(x + Math.cos(j * 0.785) * 30, z + Math.sin(j * 0.785) * 30));
      if (worst < 0.14 && (!best || worst < best.worst)) best = { x, z, worst };
    }
    if (best) return { x: best.x, z: best.z };
  }
  return { x: p.x, z: p.z };
}
for (const p of REAL_PLACES) p.goal = driveableNear(p);

// Radio chatter on the way, per region: `at` is how far along the road (0 = the base you
// left, 1 = the one you are heading for) it comes on, once a session. Оріон talks about
// the ground you are actually driving over; the facts are the real ones (landing dates,
// sizes, what each rover found).
const ORION = 'ОРІОН · керівник зміни';
export const REGION_RADIO = {
  jezero: [
    { at: 0.1, lines: [[ORION, 'Сьомий, ти на дні Єзеро. Сорок п’ять кілометрів у поперечнику: колись тут стояло озеро.']] },
    { at: 0.4, lines: [[ORION, 'Тут сів «Персеверанс», вісімнадцятого лютого 2021-го. Він збирає зразки, які колись привезуть на Землю.']] },
    { at: 0.7, lines: [[ORION, 'Бачиш уступ попереду? То фронт дельти: річка кидала тут пісок і мул мільярди років тому.']] },
    { at: 0.92, lines: [[ORION, 'Поряд із «Персеверансом» літав «Інженьюіті»: перший політ над Марсом, дев’ятнадцяте квітня 2021-го. Тридцять секунд.']] },
  ],
  gale: [
    { at: 0.1, lines: [[ORION, 'Це Гейл, Сьомий: сто п’ятдесят чотири кілометри у поперечнику. Ти стартуєш там, де сів «Кьюріосіті».']] },
    { at: 0.4, lines: [[ORION, 'Шостого серпня 2012-го «Кьюріосіті» опустився на «Бредбері». Тут він знайшов глину, а отже воду, придатну для життя.']] },
    { at: 0.7, lines: [[ORION, 'Бачиш гору попереду? Ейолис-Монс, понад п’ять кілометрів шарів. Кожен шар розповідає про іншу епоху Марса.']] },
    { at: 0.92, lines: [[ORION, 'Підніжжя гори. Ровер лазив тут роками, кожен метр підйому давав нову породу під колеса.']] },
  ],
  olympus: [
    { at: 0.1, lines: [[ORION, 'Це схил Олімпу, Сьомий. Тут повітря таке розріджене, що тиск удвічі нижчий, ніж навіть на рівнині.']] },
    { at: 0.4, lines: [[ORION, 'Олімп заввишки двадцять два кілометри. Ти не бачиш вершини: схил такий пологий, що горизонт ховає її.']] },
    { at: 0.7, lines: [[ORION, 'Бачиш темні смуги? Це лавові потоки. Вулкан росте шарами, потік за потоком.']] },
    { at: 0.92, lines: [[ORION, 'База внизу. Вулкан давно спить, але він найбільший на планеті.']] },
  ],
};
