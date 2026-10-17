import * as THREE from 'three';
import { REAL } from './real-mars.js';
import { slopeRedness } from './passability.js';
import { createExplored } from './explored.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { terrainHeight, ROUTE_PTS, ROUTE_BOUNDS, BASES } from './terrain.js';
import { PLANET } from './planet.js';

// A small, real 3D relief of the whole crossing, built once from the same height
// field the ground itself uses. Parked in the corner it's a north-up close-up that
// follows the rover; a tap opens it into a big dialog, the same north-up view (drag
// to pan, wheel to zoom) where tapping the ground — a tap, not a drag — drops a
// waypoint there. Lit by a fixed lamp rather than the sol cycle, so it reads the
// same whether it's day or night outside.

// The relief mesh only reads terrainHeight, which already differs per planet, but
// every colour here was hand-picked for Mars, so a moonscape or Верданта still
// rendered like a scoop of red dust otherwise. One look per planet, Mars untouched.
const LOOK_BY_PLANET = {
  mars: {
    elev: [[0.0, 0x7c4228], [0.35, 0xa15c34], [0.68, 0xc99459], [1.0, 0xecd4a8]],
    bg: 0x120a06, road: 0xe8aa74, sun: 0xfff3e0, ambient: 0x9a7a5c,
  },
  moon: {
    elev: [[0.0, 0x2c2c2e], [0.35, 0x48484a], [0.68, 0x76767a], [1.0, 0xb2b2ae]],
    bg: 0x030303, road: 0x9a9a96, sun: 0xf2f2f6, ambient: 0x5c5c60,
  },
  verdanta: {
    elev: [[0.0, 0x141416], [0.35, 0x2c3a2a], [0.68, 0x4a5c3f], [1.0, 0x8c9a90]],
    bg: 0x0a1210, road: 0x6a6a5e, sun: 0xeef2f0, ambient: 0x546a52,
  },
};
const LOOK = LOOK_BY_PLANET[PLANET] || LOOK_BY_PLANET.mars;
const STEEP = new THREE.Color(0xd12a1c);
const ELEV_STOPS = LOOK.elev.map(([t, c]) => [t, new THREE.Color(c)]);
function elevColor(hi, out) {
  let i = 0;
  while (i < ELEV_STOPS.length - 2 && hi > ELEV_STOPS[i + 1][0]) i++;
  const [t0, c0] = ELEV_STOPS[i];
  const [t1, c1] = ELEV_STOPS[i + 1];
  const t = t1 > t0 ? Math.min(1, Math.max(0, (hi - t0) / (t1 - t0))) : 0;
  return out.copy(c0).lerp(c1, t);
}

// canvas: the WebGL view. overlay: a plain 2D canvas stacked exactly on top of it.
export function createMinimap3D(canvas, overlay, missionModules = [], extraSites = []) {
  const PAD = 1400; // well past the road, so panning the big map still finds ground
  const x0 = ROUTE_BOUNDS.x0 - PAD;
  const x1 = ROUTE_BOUNDS.x1 + PAD;
  const z0 = ROUTE_BOUNDS.z0 - PAD;
  const z1 = ROUTE_BOUNDS.z1 + PAD;
  const spanX = x1 - x0;
  const spanZ = z1 - z0;
  const center = new THREE.Vector3(x0 + spanX / 2, 0, z0 + spanZ / 2);

  // Camera framing: how far out the camera has to orbit for the whole padded
  // crossing to fit inside its field of view from any angle. A plain circular orbit
  // at one fitted distance, rather than an ellipse tied to spanX/spanZ, frames the
  // same way from every angle by construction — the ellipse framed some turntable
  // angles fine and cropped others.
  const FOV = 42;
  const halfDiag = 0.5 * Math.hypot(spanX, spanZ);
  const orbitDist = (halfDiag / Math.tan(THREE.MathUtils.degToRad(FOV / 2))) * 1.2;
  const ORBIT_ELEV = THREE.MathUtils.degToRad(56);
  // Parked small, the map is a top-down close-up that follows the rover, north
  // (+Z) up — so it agrees with the compass — rather than a turntable of the whole
  // 10 km crossing, where the rover and every target were a pixel or two.
  const SMALL_H = 1300;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.bg);

  // The relief mesh: one static grid over the whole crossing, roughly 45 m a cell —
  // coarser than the driving terrain, which is fine for an overview you can orbit.
  const cell = 45;
  const segX = Math.max(24, Math.round(spanX / cell));
  const segZ = Math.max(24, Math.round(spanZ / cell));
  const geo = new THREE.PlaneGeometry(spanX, spanZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center.x, 0, center.z);
  const pos = geo.attributes.position;
  let maxH = 1;
  let minH = 0;
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = terrainHeight(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    if (h > maxH) maxH = h;
    if (h < minH) minH = h;
  }
  // Real ground dips well below the base: spread the colours over the whole range
  // instead of burying everything under the base in the darkest stop.
  if (!REAL) minH = 0;
  const col = new Float32Array(pos.count * 3);
  const cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heights[i]);
    // Most of the crossing sits low and only the mesas reach the top of the range;
    // a plain linear ramp buried the whole plain in the darkest stop. A gamma curve
    // gives the low ground a readable tone while peaks still stand out palest.
    elevColor(Math.pow(Math.max(0, heights[i] - minH) / (maxH - minH), 0.5), cc);
    // Real terrain: steep ground (a climb or a slide for a rover) shades towards red.
    if (REAL) cc.lerp(STEEP, 0.75 * slopeRedness(REAL.slope(pos.getX(i), pos.getZ(i))));
    col[i * 3] = cc.r;
    col[i * 3 + 1] = cc.g;
    col[i * 3 + 2] = cc.b;
  }
  // Fog of discovery: ground the rover has not been near is dimmed (never hidden: you still
  // plan waypoints on it). `baseCol` keeps the true colours to bring back as it is explored.
  const baseCol = Float32Array.from(col);
  const UNSEEN = 0.42;
  const EXPLORE_STEP = 45;
  const exNx = Math.ceil(spanX / EXPLORE_STEP) + 1, exNz = Math.ceil(spanZ / EXPLORE_STEP) + 1;
  const exX0 = center.x - spanX / 2, exZ0 = center.z - spanZ / 2;
  const explored = createExplored(exNx, exNz, exX0, exZ0, EXPLORE_STEP);
  const exIndex = (i) => {
    const gi = Math.min(exNx - 1, Math.max(0, Math.round((pos.getX(i) - exX0) / EXPLORE_STEP)));
    const gj = Math.min(exNz - 1, Math.max(0, Math.round((pos.getZ(i) - exZ0) / EXPLORE_STEP)));
    return gj * exNx + gi;
  };
  const vertexExIndex = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) vertexExIndex[i] = exIndex(i);
  const paint = (isSeen) => {
    for (let i = 0; i < pos.count; i++) {
      const k = isSeen ? 1 : UNSEEN;
      if (isSeen && !explored.has(vertexExIndex[i])) continue;
      col[i * 3] = baseCol[i * 3] * k; col[i * 3 + 1] = baseCol[i * 3 + 1] * k; col[i * 3 + 2] = baseCol[i * 3 + 2] * k;
    }
  };
  paint(false);
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);

  // The road, as a tube standing clear of the terrain so it reads from any angle.
  const roadPts = ROUTE_PTS.filter((_, i) => i % 3 === 0).map(
    (p) => new THREE.Vector3(p.x, terrainHeight(p.x, p.z) + 3, p.z)
  );
  const curve = new THREE.CatmullRomCurve3(roadPts);
  const roadGeo = new THREE.TubeGeometry(curve, 240, 3.4, 5, false);
  scene.add(new THREE.Mesh(roadGeo, new THREE.MeshBasicMaterial({ color: LOOK.road })));

  // Bases, modules and the rover are drawn in plain 2D on the overlay (see
  // drawOverlay) — a 3D marker sized for the whole-crossing view is a speck on the
  // close-up and a boulder the other way round; a 2D icon is the same size in both.
  // Гермес-3 modules on Mars, seed probes on Верданта, nothing on the Moon.
  const modules = PLANET === 'moon' ? [] : missionModules;

  const sun = new THREE.DirectionalLight(LOOK.sun, 2.0);
  sun.position.set(-420, 720, 260);
  scene.add(sun, new THREE.AmbientLight(LOOK.ambient, 1.4));

  const camera = new THREE.PerspectiveCamera(FOV, 1, 20, 12000);
  camera.far = Math.max(12000, orbitDist * 1.5);
  camera.updateProjectionMatrix();
  camera.position.set(
    center.x,
    orbitDist * Math.sin(ORBIT_ELEV),
    center.z - orbitDist * Math.cos(ORBIT_ELEV)
  );

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const octx = overlay.getContext('2d');
  let overlayDpr = 1;

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.minDistance = 140;
  controls.maxDistance = orbitDist * 1.6;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomSpeed = 0.7;
  controls.enabled = false; // off while parked small; the tap there opens the dialog instead
  controls.update();

  let big = false;
  let dynamic = []; // per-frame targets from outside (the current side job)
  let route = [];

  // A tap either opens the dialog (parked small) or, inside it, drops a waypoint —
  // a drag orbits instead. Distinguished by how far the pointer moved and how long
  // it was held between down and up.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  let onAdd = null;
  let onTapSmall = null;
  // Opened big, it's the same north-up view as the corner map, just larger: drag to
  // pan, wheel to zoom. It follows the rover until you drag it somewhere else.
  const view = { x: 0, z: 0, h: 2600, follow: true };
  let dragFrom = null;
  const unitsPerPx = () => (2 * view.h * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / Math.max(1, canvas.clientHeight);
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (big) {
      dragFrom = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!big || !dragFrom) return;
    const dx = e.clientX - dragFrom.x;
    const dy = e.clientY - dragFrom.y;
    if (view.follow && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) return;
    view.follow = false;
    const u = unitsPerPx();
    // Screen right is world -X and screen up is world +Z in this north-up view.
    view.x += dx * u;
    view.z += dy * u;
    dragFrom = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('wheel', (e) => {
    if (!big) return;
    e.preventDefault();
    view.h = THREE.MathUtils.clamp(view.h * Math.exp(e.deltaY * 0.0012), 300, orbitDist * 0.9);
  }, { passive: false });
  canvas.addEventListener('pointerup', (e) => {
    dragFrom = null;
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    if (moved > 6 || held > 450) return;
    if (!big) {
      if (onTapSmall) onTapSmall();
      return;
    }
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(mesh, false)[0];
    if (hit && onAdd) onAdd(hit.point.x, hit.point.z);
  });

  function setRoute(newRoute) {
    route = newRoute;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    renderer.setSize(r.width, r.height, false);
    // The 2D overlay is sized in real device pixels too (drawn shapes stay crisp,
    // never blurry-stretched), then scaled back down to the same CSS box with a
    // transform on the drawing context — same trick <canvas> itself uses.
    overlayDpr = Math.min(window.devicePixelRatio, 1.5);
    overlay.width = r.width * overlayDpr;
    overlay.height = r.height * overlayDpr;
  }

  // Everything you steer by is drawn in plain 2D on the overlay, once a frame: a
  // circle asked for at 13 px is 13 px on the small panel and the big dialog alike.
  // Parked small, a target outside the view is pinned to the rim with an arrow
  // pointing its way, so there's always something to head for.
  const pr = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const toScreen = (x, y, z) => {
    pr.set(x, y, z).project(camera);
    return { x: ((pr.x + 1) / 2) * overlay.width, y: ((1 - pr.y) / 2) * overlay.height, behind: pr.z > 1 };
  };
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} км`);
  const INK = 'rgba(13, 20, 26, 0.92)';

  // Labels already placed this frame; a new one that would overlap steps down (or
  // up) a line at a time until it's clear, so a cluster of targets in the same
  // direction still reads as a list rather than one smear of digits.
  let placed = [];
  function label(text, x, y, align = 'left') {
    const k = overlayDpr;
    octx.font = `bold ${10.5 * k}px ui-monospace, monospace`;
    const tw = octx.measureText(text).width;
    const lh = 12 * k;
    const x0 = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
    const dir = y > overlay.height / 2 ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      const yy = y + dir * i * lh;
      if (!placed.some((r) => x0 < r.x1 + 5 * k && x0 + tw + 5 * k > r.x0 && Math.abs(yy - r.y) < lh)) {
        y = yy;
        break;
      }
      if (i === 5) return;
    }
    placed.push({ x0, x1: x0 + tw, y });
    octx.textAlign = align;
    octx.textBaseline = 'middle';
    octx.lineWidth = 3 * k;
    octx.strokeStyle = INK;
    octx.strokeText(text, x, y);
    octx.fillStyle = '#f4ead8';
    octx.fillText(text, x, y);
  }
  function shape(kind, x, y, r, color, text) {
    const k = overlayDpr;
    octx.beginPath();
    if (kind === 'diamond') {
      octx.moveTo(x, y - r); octx.lineTo(x + r, y); octx.lineTo(x, y + r); octx.lineTo(x - r, y);
      octx.closePath();
    } else if (kind === 'square') {
      octx.roundRect(x - r, y - r, r * 2, r * 2, 3 * k);
    } else {
      octx.arc(x, y, r, 0, Math.PI * 2);
    }
    octx.fillStyle = color;
    octx.fill();
    octx.lineWidth = 2 * k;
    octx.strokeStyle = INK;
    octx.stroke();
    if (text) {
      octx.fillStyle = '#0d1a22';
      octx.font = `bold ${11 * k}px ui-monospace, monospace`;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText(text, x, y + k);
    }
  }

  function drawTarget(t, rover) {
    const k = overlayDpr;
    const w = overlay.width;
    const h = overlay.height;
    const s = toScreen(t.x, terrainHeight(t.x, t.z), t.z);
    const d = Math.hypot(t.x - rover.x, t.z - rover.z);
    const r = t.r * k;
    const m = 14 * k;
    const inside = !s.behind && s.x > m && s.x < w - m && s.y > m && s.y < h - m;
    if (inside) {
      shape(t.kind, s.x, s.y, r, t.color, t.text);
      label(fmtDist(d), s.x + r + 4 * k, s.y);
      return;
    }
    // Off the close-up: slide along the line from the centre until it meets the
    // rim, then draw the icon there with a little arrow pointing on out.
    const cx = w / 2;
    const cy = h / 2;
    let dx = s.x - cx;
    let dy = s.y - cy;
    const e = Math.min((cx - m - r) / Math.abs(dx || 1e-6), (cy - m - r) / Math.abs(dy || 1e-6));
    const ex = cx + dx * e;
    const ey = cy + dy * e;
    const a = Math.atan2(dy, dx);
    octx.save();
    octx.translate(ex, ey);
    octx.rotate(a);
    octx.beginPath();
    octx.moveTo(r + 9 * k, 0); octx.lineTo(r + 2 * k, -5 * k); octx.lineTo(r + 2 * k, 5 * k);
    octx.closePath();
    octx.fillStyle = t.color;
    octx.fill();
    octx.lineWidth = 1.5 * k;
    octx.strokeStyle = INK;
    octx.stroke();
    octx.restore();
    shape(t.kind, ex, ey, r * 0.85, t.color, t.text);
    const right = ex < w / 2;
    label(fmtDist(d), ex + (right ? 1 : -1) * (r + 5 * k), ey + (ey < h / 2 ? 1 : -1) * 11 * k, right ? 'left' : 'right');
  }

  function drawOverlay(sim) {
    const k = overlayDpr;
    const w = overlay.width;
    const h = overlay.height;
    octx.clearRect(0, 0, w, h);
    placed = [];
    const rover = { x: sim.pos.x, z: sim.pos.z };
    const ry = terrainHeight(rover.x, rover.z);
    const rs = toScreen(rover.x, ry, rover.z);

    // Planned route: a dashed line from the rover through every waypoint in order.
    if (route.length) {
      octx.setLineDash([6 * k, 5 * k]);
      octx.lineWidth = 2 * k;
      octx.strokeStyle = 'rgba(79, 224, 255, 0.85)';
      octx.beginPath();
      octx.moveTo(rs.x, rs.y);
      for (const p of route) {
        const q = toScreen(p.x, terrainHeight(p.x, p.z), p.z);
        octx.lineTo(q.x, q.y);
      }
      octx.stroke();
      octx.setLineDash([]);
    }

    const targets = [];
    for (const b of BASES) targets.push({ ...b, kind: 'square', r: 8, color: '#4fe0ff', text: b.name[0] });
    for (const e of extraSites) targets.push({ x: e.x, z: e.z, kind: 'square', r: 8, color: e.color, text: e.text });
    for (const d of dynamic) targets.push({ x: d.x, z: d.z, kind: d.kind || 'circle', r: 9, color: d.color, text: d.text });
    for (const m of modules) {
      if (!m.collected) targets.push({ x: m.x, z: m.z, kind: 'diamond', r: 8, color: '#' + m.color.toString(16).padStart(6, '0') });
    }
    route.forEach((p, i) => targets.push({ x: p.x, z: p.z, kind: 'circle', r: 10, color: i === 0 ? '#7ce68f' : '#4fe0ff', text: String(i + 1) }));
    for (const t of targets) t.d = Math.hypot(t.x - rover.x, t.z - rover.z);
    targets.sort((a, b) => a.d - b.d);
    for (const t of targets) drawTarget(t, rover);

    // The rover: a fat arrowhead along its real heading on screen (projected, so
    // it's right from any orbit angle too), dark-outlined to read over any ground.
    fwd.set(0, 0, 1).applyQuaternion(sim.quat);
    const ahead = toScreen(rover.x + fwd.x * 40, ry, rover.z + fwd.z * 40);
    const a = Math.atan2(ahead.y - rs.y, ahead.x - rs.x);
    octx.save();
    octx.translate(rs.x, rs.y);
    octx.rotate(a);
    octx.beginPath();
    octx.moveTo(12 * k, 0);
    octx.lineTo(-8 * k, -8 * k);
    octx.lineTo(-4 * k, 0);
    octx.lineTo(-8 * k, 8 * k);
    octx.closePath();
    octx.fillStyle = '#ffe14f';
    octx.fill();
    octx.lineWidth = 2.2 * k;
    octx.strokeStyle = INK;
    octx.stroke();
    octx.restore();

    // North tick: both views are always north-up.
    if (big) label('Пн ▲', w / 2, 20 * k, 'center');
    else label('Пн ▲', w - 8 * k, 12 * k, 'right');
    if (big) label(`масштаб: ${fmtDist(unitsPerPx() * 100)} на 100 px`, 10 * k, 20 * k);
  }

  function update(sim, dt) {
    camera.up.set(0, 0, 1);
    if (big) {
      if (view.follow) {
        view.x = sim.pos.x;
        view.z = sim.pos.z;
      }
      camera.position.set(view.x, view.h, view.z);
      camera.lookAt(view.x, 0, view.z);
    } else {
      camera.position.set(sim.pos.x, terrainHeight(sim.pos.x, sim.pos.z) + SMALL_H, sim.pos.z);
      camera.lookAt(sim.pos.x, 0, sim.pos.z);
    }
    renderer.render(scene, camera);
    drawOverlay(sim);
  }

  // Called a couple of times a second with where the rover is: reveals the ground around it.
  function reveal(x, z, r = 450) {
    const fresh = explored.mark(x, z, r);
    if (!fresh.length) return;
    const set = new Set(fresh);
    for (let i = 0; i < pos.count; i++) {
      if (!set.has(vertexExIndex[i])) continue;
      col[i * 3] = baseCol[i * 3]; col[i * 3 + 1] = baseCol[i * 3 + 1]; col[i * 3 + 2] = baseCol[i * 3 + 2];
    }
    geo.attributes.color.needsUpdate = true;
  }

  return {
    update,
    setRoute,
    reveal,
    exploredFraction: () => explored.fraction(),
    exportExplored: () => explored.encode(),
    importExplored(str) {
      if (explored.decode(str) === null) return false;
      paint(false);
      paint(true);
      geo.attributes.color.needsUpdate = true;
      return true;
    },
    setDynamic(list) {
      dynamic = list;
    },
    resize,
    setBig(v) {
      big = v;
      controls.enabled = false;
      if (v) view.follow = true;
    },
    // Back onto the rover after panning away.
    recenter() {
      view.follow = true;
    },
    setOnAdd(fn) {
      onAdd = fn;
    },
    setOnTapSmall(fn) {
      onTapSmall = fn;
    },
  };
}
