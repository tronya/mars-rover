import { beamLit } from './beam.js';
import * as THREE from 'three';
import { PLANET } from './planet.js';
import { terrainHeight, waterDepthAt, waterLevelAt } from './terrain.js';
import { GLOW } from './glow.js';

// Ambient life in the air, per planet. Everything here is a THREE.Points cloud drawn
// by one small shader; what differs is who moves the points:
//
//   Mars      dust devils — whole columns animated on the GPU from a few uniforms, so
//             hundreds of spiralling grains cost one draw call — and wind-blown sand
//             streaming low over the ground around the rover.
//   Верданта  pollen by day, fireflies by night (bright enough to bloom), and mist
//             lying on the river at dawn and through the night.
//   Moon      nothing: no air, nothing drifts. (Its dust is ballistic, see dust.js.)
//
// CPU-driven points only ever sample terrain height when they respawn and then glide
// between two known heights, so a thousand of them cost a few height lookups a frame.

const WIND = new THREE.Vector2(0.93, 0.37).normalize(); // matches dust.js's drift

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const DOT = softDot();

// Shared point shader: per-point size (metres) and alpha, one colour, distance fade.
function pointsMaterial({ color, additive = false, fadeFar = 700 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: DOT },
      color: { value: new THREE.Color(color) },
      bright: { value: 1 },
      opacity: { value: 1 },
      scale: { value: 800 },
      fadeFar: { value: fadeFar },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      uniform float scale;
      uniform float fadeFar;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * scale / -mv.z, 0.0, 256.0);
        vA = alpha * (1.0 - smoothstep(fadeFar * 0.6, fadeFar, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      uniform float bright;
      uniform float opacity;
      varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA * opacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(color * bright, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// A CPU-driven cloud: `count` points, a per-point record, and a step() that writes
// positions/sizes/alphas into the buffers.
function cloud(count, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const flush = () => {
    geo.attributes.position.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  };
  return { points, pos, size, alpha, flush, mat };
}

// ---------- Mars: dust devils ----------
const DEVILS = 3;
const PER_DEVIL = 1300;
const DEVIL_PUSH_R = 14; // m — inside this the column shoves the rover round

function devilMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: DOT },
      color: { value: new THREE.Color(color) },
      bright: { value: 1 },
      scale: { value: 800 },
      time: { value: 0 },
      devils: { value: Array.from({ length: DEVILS }, () => new THREE.Vector4()) }, // x, ground y, z, strength
      shape: { value: Array.from({ length: DEVILS }, () => new THREE.Vector4()) }, // height, top radius, spin, lean
    },
    vertexShader: /* glsl */ `
      attribute vec4 seed; // phase, height fraction, radius jitter, speed
      attribute float which;
      uniform float scale;
      uniform float time;
      uniform vec4 devils[${DEVILS}];
      uniform vec4 shape[${DEVILS}];
      varying float vA;
      void main() {
        int i = int(which + 0.5);
        vec4 d = devils[0]; vec4 s = shape[0];
        if (i == 1) { d = devils[1]; s = shape[1]; }
        if (i == 2) { d = devils[2]; s = shape[2]; }
        float h = fract(seed.y + time * 0.05 * seed.w);        // grains climb, then recycle
        float hh = pow(h, 1.35);
        // A wide skirt of dust kicked up round the foot, then the funnel.
        float skirt = 1.0 - smoothstep(0.0, 0.14, h);
        float r = (mix(1.8, s.y, pow(h, 1.4)) + skirt * 5.5 * seed.w) * seed.z;
        float a = seed.x + time * s.z * (1.6 - h) * seed.w;     // spins faster low down
        vec2 lean = vec2(sin(time * 0.3 + hh * 2.5), cos(time * 0.23 + hh * 2.0)) * hh * s.w;
        vec3 p = vec3(d.x + cos(a) * r + lean.x, d.y + hh * s.x, d.z + sin(a) * r + lean.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sizeM = mix(1.6, 6.5, h) * seed.z * (1.0 + skirt * 0.8);
        gl_PointSize = clamp(sizeM * scale / -mv.z, 0.0, 128.0);
        // Spiral bands that travel round with the spin, so the eye can see it turn.
        float bandsA = 0.45 + 0.55 * smoothstep(-0.2, 0.8, sin(a * 2.0 - hh * 9.0));
        vA = d.w * smoothstep(0.0, 0.03, h) * pow(1.0 - h, 0.7) * 0.42 * bandsA * (1.0 - smoothstep(900.0, 1300.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      uniform float bright;
      varying float vA;
      void main() {
        float a = texture2D(map, gl_PointCoord).a * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(color * bright, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

export function createAmbient() {
  const group = new THREE.Group();
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ----- Mars -----
  let devilMat = null;
  const devils = [];
  if (PLANET === 'mars') {
    devilMat = devilMaterial(0xe0b889);
    const n = DEVILS * PER_DEVIL;
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(n * 4);
    const which = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = Math.random() * Math.PI * 2;
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = 0.6 + Math.random() * 0.8;
      seed[i * 4 + 3] = 0.6 + Math.random() * 0.8;
      which[i] = Math.floor(i / PER_DEVIL);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('which', new THREE.BufferAttribute(which, 1));
    const pts = new THREE.Points(geo, devilMat);
    pts.frustumCulled = false;
    group.add(pts);
    for (let i = 0; i < DEVILS; i++) devils.push({ x: 0, z: 0, vx: 0, vz: 0, age: 0, life: 0, height: 40, top: 7, spin: 2, lean: 3, k: 0 });
  }
  function respawnDevil(d, cx, cz, first) {
    // Far enough out to be seen as a whole column, now and then close enough to meet.
    const ang = Math.random() * Math.PI * 2;
    const dist = first ? rnd(150, 600) : rnd(220, 650);
    d.x = cx + Math.cos(ang) * dist;
    d.z = cz + Math.sin(ang) * dist;
    const sp = rnd(1.5, 4);
    d.vx = WIND.x * sp + rnd(-1, 1);
    d.vz = WIND.y * sp + rnd(-1, 1);
    d.age = first ? rnd(0, 40) : 0;
    d.life = rnd(70, 150);
    d.height = rnd(28, 70);
    d.top = rnd(8, 16);
    d.spin = rnd(1.4, 2.6);
    d.lean = rnd(2, 6);
  }

  // Wind-blown sand: low streaks racing over the ground around the rover.
  let sand = null;
  const grains = [];
  if (PLANET === 'mars') {
    // Paler than the ground it blows over — the same colour vanished against it.
    sand = cloud(900, pointsMaterial({ color: 0xe8c79c, fadeFar: 90 }));
    group.add(sand.points);
    for (let i = 0; i < 900; i++) grains.push({ x: 0, z: 0, y0: 0, y1: 0, t: 0, life: 0, v: 0, lift: 0, s: 0, haze: false });
  }
  function respawnGrain(g, cx, cz) {
    // Upwind of the rover, inside a 70 m disc, so the stream flows past it.
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 60;
    g.x = cx + Math.cos(a) * r - WIND.x * 15;
    g.z = cz + Math.sin(a) * r - WIND.y * 15;
    g.v = rnd(4, 9);
    g.life = rnd(1.5, 4);
    g.t = 0;
    g.y0 = terrainHeight(g.x, g.z);
    g.y1 = terrainHeight(g.x + WIND.x * g.v * g.life, g.z + WIND.y * g.v * g.life);
    // Mostly grains (a few centimetres: specks), one in five a low, wide, faint puff —
    // together they read as a sheet of blowing sand, not as floating balls.
    g.haze = Math.random() < 0.2;
    g.lift = g.haze ? rnd(0.2, 0.7) : rnd(0.05, 0.6);
    g.s = g.haze ? rnd(1.6, 3.4) : rnd(0.03, 0.08);
  }

  // Sand streaming off dune crests: every couple of seconds the ground around the
  // rover is scanned for ridges — points the wind blows over and then drops away
  // behind — and each of those trails a plume that pours down its lee side.
  let drift = null;
  const crests = [];
  const driftP = [];
  let crestScan = 0;
  if (PLANET === 'mars') {
    drift = cloud(700, pointsMaterial({ color: 0xe9c79a, fadeFar: 650 }));
    group.add(drift.points);
    for (let i = 0; i < 700; i++) driftP.push({ x: 0, z: 0, y0: 0, y1: 0, t: 0, life: 0, v: 0, s: 0, ok: false, c: 0 });
  }
  const LOOK = 16; // m either side along the wind when judging a crest
  function scanCrests(cx, cz) {
    crests.length = 0;
    const found = [];
    for (let j = -7; j <= 7; j++) {
      for (let i = -7; i <= 7; i++) {
        // Jitter the grid so the same dunes are not always sampled at the same spot.
        const x = cx + i * 38 + rnd(-12, 12);
        const z = cz + j * 38 + rnd(-12, 12);
        const h = terrainHeight(x, z);
        const lee = h - terrainHeight(x + WIND.x * LOOK, z + WIND.y * LOOK);
        const up = h - terrainHeight(x - WIND.x * LOOK, z - WIND.y * LOOK);
        // A crest: the ground falls away downwind and is not still climbing upwind.
        if (lee > 1.6 && up > -0.8) found.push({ x, z, h, lee });
      }
    }
    found.sort((a, b) => b.lee - a.lee);
    for (const f of found.slice(0, 6)) crests.push(f);
  }
  function respawnDrift(p) {
    if (!crests.length) { p.ok = false; return; }
    p.c = Math.floor(Math.random() * crests.length);
    const c = crests[p.c];
    // Spread along the ridge, across the wind.
    const across = rnd(-14, 14);
    p.x = c.x - WIND.y * across;
    p.z = c.z + WIND.x * across;
    p.v = rnd(4.5, 9);
    p.life = rnd(2.2, 4.5);
    p.t = 0;
    p.y0 = terrainHeight(p.x, p.z) + rnd(0.2, 0.9);
    const ex = p.x + WIND.x * p.v * p.life;
    const ez = p.z + WIND.y * p.v * p.life;
    p.y1 = Math.min(p.y0 + 1, terrainHeight(ex, ez) + rnd(0.3, 1.6));
    p.s = rnd(2.4, 6);
    p.ok = true;
  }

  // Верданта at night: pollen drifting through the headlight beams, lit only where
  // the beams actually are.
  let motes = null;
  const moteP = [];
  if (PLANET === 'verdanta') {
    motes = cloud(360, pointsMaterial({ color: 0xfff1d6, additive: true, fadeFar: 60 }));
    group.add(motes.points);
    for (let i = 0; i < 360; i++) moteP.push({ f: 0, l: 0, y: 0, ph: 0, ok: false, x: 0, z: 0, wy: 0 });
  }

  // ----- Верданта -----
  let pollen = null;
  let flies = null;
  let mist = null;
  const pollenP = [];
  const flyP = [];
  const mistP = [];
  if (PLANET === 'verdanta') {
    pollen = cloud(420, pointsMaterial({ color: 0xf2efd2, fadeFar: 45 }));
    flies = cloud(260, pointsMaterial({ color: new THREE.Color(0xd8ff7a).multiplyScalar(GLOW), additive: true, fadeFar: 90 }));
    mist = cloud(110, pointsMaterial({ color: 0xc9d6d8, fadeFar: 260 }));
    group.add(pollen.points, flies.points, mist.points);
    for (let i = 0; i < 420; i++) pollenP.push({ x: 0, y: 0, z: 0, ph: 0, s: 0, ok: false });
    for (let i = 0; i < 260; i++) flyP.push({ x: 0, y: 0, z: 0, ph: 0, sp: 0, ok: false });
    for (let i = 0; i < 110; i++) mistP.push({ x: 0, y: 0, z: 0, s: 0, ph: 0, ok: false });
  }
  function placeNear(p, cx, cz, rMax, yLo, yHi) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * rMax;
    p.x = cx + Math.cos(a) * r;
    p.z = cz + Math.sin(a) * r;
    p.y = terrainHeight(p.x, p.z) + rnd(yLo, yHi);
    p.ph = Math.random() * 100;
    p.ok = true;
  }
  function placeMist(p, cx, cz) {
    // Only on open water: a few tries, else park it invisible until next time.
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(8, 160);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (waterDepthAt(x, z) > 0.4) {
        p.x = x;
        p.z = z;
        p.y = waterLevelAt(x, z) + rnd(0.4, 2.2);
        p.s = rnd(9, 20);
        p.ph = Math.random() * 100;
        p.ok = true;
        return;
      }
    }
    p.ok = false;
  }

  let time = 0;
  let first = true;
  const out = { push: new THREE.Vector2() };

  // ctx: { x, z, daylight, dt, pxScale }
  function update(dt, ctx) {
    time += dt;
    const { x: cx, z: cz, daylight } = ctx;
    const night = 1 - daylight;
    // Sprites are unlit, so their brightness follows the light by hand.
    const lit = 0.12 + 0.88 * daylight;
    // At night the blowing sand and the dust plumes are only there where the headlights
    // reach them: everything else is dark. `mask` is 1 by day, the beam by night.
    const nightK = THREE.MathUtils.smoothstep(night, 0.25, 0.7);
    const H = ctx.head && ctx.head.on ? ctx.head : null;
    const mask = (x, y, z) => (1 - nightK) + nightK * (H ? Math.min(1, beamLit(x, y, z, H.x, H.y, H.z, H.dx, H.dz) * 1.7) : 0);
    const litBlown = lit + nightK * ((H ? 0.85 : 0.12) - lit); // what the points glow with, by day or in the beam
    out.push.set(0, 0);

    if (devilMat) {
      devilMat.uniforms.time.value = time;
      devilMat.uniforms.scale.value = ctx.pxScale;
      devilMat.uniforms.bright.value = lit;
      // Heat makes them: they only run in the warm part of the day.
      const season = THREE.MathUtils.smoothstep(daylight, 0.55, 0.9);
      devils.forEach((d, i) => {
        if (first || d.age > d.life || Math.hypot(d.x - cx, d.z - cz) > 1100) respawnDevil(d, cx, cz, first);
        d.age += dt;
        d.x += d.vx * dt;
        d.z += d.vz * dt;
        const k = Math.min(1, d.age / 10, (d.life - d.age) / 10) * season;
        d.k = k;
        devilMat.uniforms.devils.value[i].set(d.x, terrainHeight(d.x, d.z), d.z, Math.max(0, k));
        devilMat.uniforms.shape.value[i].set(d.height, d.top, d.spin, d.lean);
        // Inside the column: a swirl round it plus a pull in. Returned as an
        // acceleration for main.js to feed the rover.
        const dx = cx - d.x;
        const dz = cz - d.z;
        const r = Math.hypot(dx, dz);
        if (k > 0 && r < DEVIL_PUSH_R && r > 0.01) {
          const f = k * (1 - r / DEVIL_PUSH_R) * 5.5;
          out.push.x += (-dz / r) * f - (dx / r) * f * 0.35;
          out.push.y += (dx / r) * f - (dz / r) * f * 0.35;
        }
      });
    }

    if (sand) {
      sand.mat.uniforms.scale.value = ctx.pxScale;
      sand.mat.uniforms.bright.value = litBlown;
      grains.forEach((g, i) => {
        g.t += dt;
        if (first || g.t > g.life) { respawnGrain(g, cx, cz); if (first) g.t = Math.random() * g.life; }
        const u = g.t / g.life;
        const px = g.x + WIND.x * g.v * g.t;
        const pz = g.z + WIND.y * g.v * g.t;
        // Saltation: grains hop — low arcs, not a flat conveyor.
        const hop = g.haze ? g.lift : Math.abs(Math.sin(u * Math.PI * (2 + (i % 3)))) * g.lift;
        sand.pos[i * 3] = px;
        sand.pos[i * 3 + 1] = g.y0 + (g.y1 - g.y0) * u + 0.06 + hop;
        sand.pos[i * 3 + 2] = pz;
        sand.size[i] = g.s;
        sand.alpha[i] = Math.sin(u * Math.PI) * (g.haze ? 0.09 : 0.9) * (nightK > 0 ? mask(px, sand.pos[i * 3 + 1], pz) : 1);
      });
      sand.flush();
    }

    if (drift) {
      drift.mat.uniforms.scale.value = ctx.pxScale;
      drift.mat.uniforms.bright.value = litBlown;
      if (first || (crestScan -= dt) <= 0) { crestScan = 2.5; scanCrests(cx, cz); }
      // Gusty: the ridges smoke in pulses, not a constant hose.
      const gust = 0.45 + 0.55 * Math.max(0, Math.sin(time * 0.35) * 0.7 + Math.sin(time * 1.1 + 1.3) * 0.3);
      driftP.forEach((p, i) => {
        p.t += dt;
        if (first || !p.ok || p.t > p.life) {
          respawnDrift(p);
          if (first) p.t = Math.random() * p.life;
        }
        const u = p.ok ? p.t / p.life : 0;
        drift.pos[i * 3] = p.x + WIND.x * p.v * p.t;
        drift.pos[i * 3 + 1] = p.y0 + (p.y1 - p.y0) * u * u + Math.sin(u * Math.PI) * 0.8;
        drift.pos[i * 3 + 2] = p.z + WIND.y * p.v * p.t;
        drift.size[i] = p.s * (0.6 + u * 1.4);
        drift.alpha[i] = p.ok ? Math.sin(u * Math.PI) * 0.42 * gust * Math.min(1, crests[p.c]?.lee / 4 || 1) * (nightK > 0 ? mask(drift.pos[i * 3], drift.pos[i * 3 + 1], drift.pos[i * 3 + 2]) : 1) : 0;
      });
      drift.flush();
    }

    if (motes) {
      motes.mat.uniforms.scale.value = ctx.pxScale;
      const on = ctx.headOn ? THREE.MathUtils.smoothstep(night, 0.3, 0.8) : 0;
      const fx = Math.sin(ctx.yaw);
      const fz = Math.cos(ctx.yaw);
      const gy = terrainHeight(cx, cz);
      moteP.forEach((p, i) => {
        // Kept in rover-relative beam space: f metres ahead, l to the side.
        if (!p.ok || p.f < 1 || p.f > 30 || Math.abs(p.l) > 9) {
          p.f = rnd(2, 28);
          p.l = rnd(-8, 8);
          p.y = rnd(0.2, 3.2);
          p.ph = Math.random() * 100;
          p.ok = true;
        }
        // Drift in the world, which in beam space means sliding back as you drive.
        const dxw = Math.sin(time * 0.4 + p.ph) * 0.3 + WIND.x * 0.2 - ctx.vx;
        const dzw = Math.cos(time * 0.37 + p.ph) * 0.3 + WIND.y * 0.2 - ctx.vz;
        p.f += (dxw * fx + dzw * fz) * dt;
        p.l += (dxw * fz - dzw * fx) * dt;
        p.y += Math.sin(time * 0.6 + p.ph * 1.3) * 0.08 * dt;
        motes.pos[i * 3] = cx + fx * p.f + fz * p.l;
        motes.pos[i * 3 + 1] = gy + p.y;
        motes.pos[i * 3 + 2] = cz + fz * p.f - fx * p.l;
        motes.size[i] = 0.035 + (i % 4) * 0.01;
        // Inside the two beam cones (lamps ~1 m either side, ~0.35 rad spread),
        // brighter close in, glinting as they tumble.
        const inCone = Math.max(0, 1 - Math.max(0, Math.abs(p.l) - 1) / (p.f * 0.38 + 0.6));
        const height = 1 - THREE.MathUtils.smoothstep(Math.abs(p.y - 1.2), 0.8, 2.4);
        const glint = 0.55 + 0.45 * Math.sin(time * 3 + p.ph * 5);
        motes.alpha[i] = on * inCone * height * glint * (1 - p.f / 32) * 0.9;
      });
      motes.flush();
    }

    if (pollen) {
      pollen.mat.uniforms.scale.value = ctx.pxScale;
      pollen.mat.uniforms.bright.value = lit;
      pollenP.forEach((p, i) => {
        if (!p.ok || Math.hypot(p.x - cx, p.z - cz) > 32) placeNear(p, cx, cz, 30, 0.3, 6);
        p.x += (WIND.x * 0.35 + Math.sin(time * 0.7 + p.ph) * 0.25) * dt;
        p.z += (WIND.y * 0.35 + Math.cos(time * 0.6 + p.ph) * 0.25) * dt;
        p.y += Math.sin(time * 0.9 + p.ph * 1.7) * 0.12 * dt;
        pollen.pos[i * 3] = p.x;
        pollen.pos[i * 3 + 1] = p.y;
        pollen.pos[i * 3 + 2] = p.z;
        pollen.size[i] = 0.05 + (i % 5) * 0.012;
        pollen.alpha[i] = 0.75 * daylight;
      });
      pollen.flush();

      flies.mat.uniforms.scale.value = ctx.pxScale;
      const fliesOn = THREE.MathUtils.smoothstep(night, 0.55, 0.9);
      flyP.forEach((p, i) => {
        if (!p.ok || Math.hypot(p.x - cx, p.z - cz) > 70) { placeNear(p, cx, cz, 65, 0.4, 2.6); p.sp = rnd(0.4, 1.2); }
        p.x += Math.sin(time * 0.5 * p.sp + p.ph) * 0.9 * dt;
        p.z += Math.cos(time * 0.43 * p.sp + p.ph * 1.3) * 0.9 * dt;
        p.y += Math.sin(time * 0.8 * p.sp + p.ph * 0.7) * 0.35 * dt;
        flies.pos[i * 3] = p.x;
        flies.pos[i * 3 + 1] = p.y;
        flies.pos[i * 3 + 2] = p.z;
        flies.size[i] = 0.14;
        // Each one blinks on its own slow rhythm: mostly dark, then a soft pulse.
        const blink = Math.max(0, Math.sin(time * (0.9 + p.sp) + p.ph * 7));
        flies.alpha[i] = fliesOn * blink * blink * blink;
      });
      flies.flush();

      mist.mat.uniforms.scale.value = ctx.pxScale;
      // Thickest at first light, present all night, burnt off by midday.
      const dawn = ctx.dawn;
      mist.mat.uniforms.bright.value = 0.18 + 0.82 * daylight;
      const mistOn = Math.max(dawn, night * 0.6);
      mistP.forEach((p, i) => {
        if (!p.ok || Math.hypot(p.x - cx, p.z - cz) > 175) placeMist(p, cx, cz);
        if (p.ok) {
          p.x += WIND.x * 0.4 * dt;
          p.z += WIND.y * 0.4 * dt;
        }
        mist.pos[i * 3] = p.x;
        mist.pos[i * 3 + 1] = p.y;
        mist.pos[i * 3 + 2] = p.z;
        mist.size[i] = p.s;
        mist.alpha[i] = p.ok ? mistOn * 0.16 * (0.7 + 0.3 * Math.sin(time * 0.2 + p.ph)) : 0;
      });
      mist.flush();
    }

    first = false;
    return out;
  }

  return { group, update, devils, crests };
}
