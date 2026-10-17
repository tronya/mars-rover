import * as THREE from 'three';
import { pebbleDensity, terrainHeight, groundColorAtXZ, dustDepth } from './terrain.js';
import { REAL } from './real-mars.js';
import { beamLit } from './beam.js';
const REAL_DUST = !!REAL;
import { PLANET } from './planet.js';

// Dust thrown up by the wheels.
//
// What made the old trail read as fake: every puff was the same smooth, round,
// unlit disc, so a cloud of them looked like a stack of soft coins. Real dust is
// lumpy, it is lit (bright on the sun side, darker underneath, glowing when you look
// through it towards the sun), and it comes in two behaviours at once:
//   - heavy kick: dense clods of dust that barely rise, roll out sideways along the
//     ground and settle within a few seconds;
//   - fine plume: a thin haze that lifts off the top of that, drifts on the wind and
//     hangs in the air long after.
// Each particle is a camera-facing quad drawn from a small atlas of procedural
// cloud shapes, turned to a random angle and slowly spinning, shaded as if it were a
// soft ball of dust. All of them go out in a single instanced draw call.
//
// Colour still comes from the ground under the wheel (groundColorAtXZ) leaned toward
// the planet's day/night dust tint, and at night only what the tail lamps reach is
// lit, as before.

const GRAVITY = 3.71; // Mars
const VACUUM = PLANET === 'moon'; // no air: ballistic grains, no clouds at all
const MOON_G = 1.62;
const POOL = 900;
const WIND = new THREE.Vector3(0.5, 0, 0.2);
const NIGHT_FLOOR = 0.025; // moonlight on the dust: barely there, the lamps do the lighting
const TAIL_LIT_R = 13;

// 2×2 atlas of lumpy cloud shapes: fbm noise under a soft radial falloff, pushed
// through a contrast curve so the edge breaks up into billows instead of a gradient.
function makeCloudAtlas() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N * 2;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N * 2, N * 2);
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let f = 0; f < 4; f++) {
    const G = 16;
    const lattice = [];
    for (let o = 0; o < 4; o++) {
      const g = new Float32Array((G << o) * (G << o));
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      lattice.push(g);
    }
    const sample = (o, x, y) => {
      const n = G << o;
      const fx = x * n;
      const fy = y * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let tx = fx - x0;
      let ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const g = lattice[o];
      const at = (i, j) => g[((j % n) + n) % n * n + (((i % n) + n) % n)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      return a + (b - a) * ty;
    };
    const ox = (f % 2) * N;
    const oy = Math.floor(f / 2) * N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        let n = 0;
        let amp = 0.5;
        for (let o = 0; o < 4; o++) { n += sample(o, u * 0.25 + f * 0.13, v * 0.25 + f * 0.37) * amp; amp *= 0.5; }
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const fall = Math.max(0, 1 - r * r);
        let a = fall * (0.35 + 1.3 * n) - 0.35;
        a = Math.max(0, Math.min(1, a * 1.8));
        const i = ((oy + y) * N * 2 + ox + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const material = new THREE.ShaderMaterial({
  uniforms: {
    atlas: { value: null },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, // world, towards the light
    sunCol: { value: new THREE.Color(1, 1, 1) },
    ambient: { value: 0.5 },
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 500 },
    fogFar: { value: 1200 },
  },
  vertexShader: /* glsl */ `
    attribute vec3 iPos;
    attribute vec4 iData;   // size, rotation, alpha, atlas frame
    attribute vec3 iColor;
    uniform vec3 sunDir;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying float vAlpha;
    varying vec3 vColor;
    varying vec3 vSunV;
    varying float vDepth;
    void main() {
      float s = iData.x;
      float c = cos(iData.y), sn = sin(iData.y);
      vec2 p = position.xy;
      vLocal = p * 2.0;                      // -1..1 across the quad, for the fake sphere normal
      vec2 rp = vec2(p.x * c - p.y * sn, p.x * sn + p.y * c) * s;
      vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
      mv.xy += rp;
      gl_Position = projectionMatrix * mv;
      float f = iData.w;
      vUv = (uv + vec2(mod(f, 2.0), floor(f / 2.0))) * 0.5;
      vAlpha = iData.z;
      vColor = iColor;
      vSunV = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
      vDepth = -mv.z;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D atlas;
    uniform vec3 sunCol;
    uniform float ambient;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    varying vec2 vUv;
    varying vec2 vLocal;
    varying float vAlpha;
    varying vec3 vColor;
    varying vec3 vSunV;
    varying float vDepth;
    void main() {
      float a = texture2D(atlas, vUv).a * vAlpha;
      if (a < 0.004) discard;
      // Shade each puff as a soft ball: the side facing the sun lit, the far side in
      // its own shadow, and a forward-scatter glow when the sun is behind it.
      float r2 = min(1.0, dot(vLocal, vLocal));
      vec3 n = normalize(vec3(vLocal, sqrt(1.0 - r2) + 0.35));
      float lambert = 0.5 + 0.5 * dot(n, vSunV);
      float scatter = pow(max(0.0, -vSunV.z), 6.0) * 1.2;
      vec3 col = vColor * (ambient + sunCol * (lambert * 0.85 + scatter));
      float fog = smoothstep(fogNear, fogFar, vDepth);
      gl_FragColor = vec4(mix(col, fogColor, fog), a);
    }
  `,
  transparent: true,
  depthWrite: false,
});

function patchNoise(x, z) {
  const a = Math.sin(x * 0.013 + z * 0.021);
  const b = Math.sin(x * 0.006 - z * 0.017 + 2.4);
  const c = Math.sin((x + z) * 0.0037 - 1.1);
  return 0.5 + 0.5 * (a * 0.5 + b * 0.32 + c * 0.18);
}

// Soft, bright ground throws more dust than rock or the graded road (terrain.js dustDepth:
// 0 on the road and bare ground, 1 on deep dust); 1 on every world but real Mars.
export function dustKick(depth) {
  return 0.55 + 0.9 * depth;
}

export function createDustTrail() {
  material.uniforms.atlas.value = makeCloudAtlas();
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const iPos = new Float32Array(POOL * 3);
  const iData = new Float32Array(POOL * 4);
  const iColor = new Float32Array(POOL * 3);
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = POOL;
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const group = new THREE.Group();
  group.add(mesh);

  const particles = Array.from({ length: POOL }, () => ({
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), col: new THREE.Color(),
    life: 0, max: 1, base: 1, grow: 1, punch: 1, rot: 0, spin: 0, frame: 0, fine: false, settled: false, ph: 0,
  }));
  let cursor = 0;
  const acc = [];
  const accFine = [];
  let time = 0;
  const back = new THREE.Vector3();
  const side = new THREE.Vector3();
  const dayTint = new THREE.Color(0xc99a70);
  const groundCol = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, size, grow, life, punch, fine) {
    // Recycle the oldest; never steal one that has barely started.
    const p = particles[cursor++ % POOL];
    p.pos.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.life = p.max = life;
    p.base = size;
    p.grow = grow;
    p.punch = punch;
    p.rot = Math.random() * Math.PI * 2;
    p.spin = (Math.random() - 0.5) * 0.6;
    p.frame = Math.floor(Math.random() * 4);
    p.fine = fine;
    p.settled = false;
    p.ph = Math.random() * 100;
    groundColorAtXZ(x, z, groundCol);
    p.col.copy(groundCol).lerp(dayTint, 0.3);
    // Fine haze reads paler than the clods it lifts off.
    if (fine) p.col.lerp(dayTint, 0.35).multiplyScalar(1.12);
  }

  // ctx: sandCtx from main.js — x/z/yaw/vx/vz/wheels/daylight/tail, plus sun/fog.
  function update(dt, ctx) {
    time += dt;
    const gust = 1 + 0.5 * Math.sin(time * 0.11);
    const speed = Math.hypot(ctx.vx, ctx.vz);
    const nightFloor = 1 - (1 - ctx.daylight) * (1 - NIGHT_FLOOR);
    back.set(-ctx.vx, 0, -ctx.vz);
    if (back.lengthSq() > 0.01) back.normalize();
    side.set(-back.z, 0, back.x);

    ctx.wheels.forEach((w, i) => {
      if (!w.contact) return;
      const sandiness = pebbleDensity(w.cx, w.cz);
      const slip = Math.hypot(w.vx, w.vy);
      const patch = 0.15 + 1.5 * Math.pow(patchNoise(w.cx, w.cz), 2.2);
      // A wider tyre churns up more of the ground, so it throws more dust.
      const rate = (speed * 0.72 + slip * 2) * (0.12 + 0.9 * sandiness) * patch * (w.wk || 1) * (REAL_DUST ? dustKick(dustDepth(w.cx, w.cz)) : 1);
      if (VACUUM) {
        acc[i] = (acc[i] || 0) + rate * 6 * dt;
        while (acc[i] >= 1) {
          acc[i] -= 1;
          const kick = 0.5 + Math.random() * 0.7;
          spawn(
            w.cx + (Math.random() - 0.5) * 0.5 * (w.wk || 1), w.g + 0.15, w.cz + (Math.random() - 0.5) * 0.5 * (w.wk || 1),
            ctx.vx * 0.45 + back.x * (1 + kick * 2) + (Math.random() - 0.5) * 1.4,
            0.7 + Math.random() * 1.8,
            ctx.vz * 0.45 + back.z * (1 + kick * 2) + (Math.random() - 0.5) * 1.4,
            0.1 + Math.random() * 0.14, 0, 6, 0.9, false
          );
        }
        return;
      }
      // Heavy kick: low, sideways, short-lived, dense.
      acc[i] = (acc[i] || 0) + rate * 1.4 * dt;
      while (acc[i] >= 1) {
        acc[i] -= 1;
        const out = (Math.random() - 0.5) * 2.4 * (0.6 + sandiness);
        const kick = 0.4 + Math.random() * 0.8;
        spawn(
          w.cx + (Math.random() - 0.5) * 0.5 * (w.wk || 1), w.g + 0.15, w.cz + (Math.random() - 0.5) * 0.5 * (w.wk || 1),
          ctx.vx * 0.7 + back.x * kick + side.x * out,
          0.3 + Math.random() * 0.7 + slip * 0.15,
          ctx.vz * 0.7 + back.z * kick + side.z * out,
          0.5 + sandiness * 0.6 + Math.min(0.6, slip * 0.2),
          2.6 + sandiness * 1.6,
          2.2 + Math.random() * 2.2 + sandiness * 1.2,
          0.5 + 0.3 * sandiness + Math.min(0.25, slip * 0.05),
          false
        );
      }
      // Fine plume: fewer, rises, grows big and thin, hangs a long time.
      accFine[i] = (accFine[i] || 0) + rate * 0.45 * dt;
      while (accFine[i] >= 1) {
        accFine[i] -= 1;
        spawn(
          w.cx + (Math.random() - 0.5) * 0.8, w.g + 0.3, w.cz + (Math.random() - 0.5) * 0.8,
          ctx.vx * 0.55 + back.x * 0.6 + (Math.random() - 0.5) * 1.2,
          0.9 + Math.random() * 1.1,
          ctx.vz * 0.55 + back.z * 0.6 + (Math.random() - 0.5) * 1.2,
          1.0 + sandiness * 0.8,
          5.5 + sandiness * 3,
          6 + Math.random() * 4 + Math.min(6, speed * 0.25),
          0.16 + 0.12 * sandiness,
          true
        );
      }
    });

    for (let i = 0; i < POOL; i++) {
      const p = particles[i];
      const o3 = i * 3;
      const o4 = i * 4;
      if (p.life <= 0) { iData[o4 + 2] = 0; iData[o4] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { iData[o4 + 2] = 0; iData[o4] = 0; continue; }
      const k = 1 - p.life / p.max;
      let alpha;
      let size;
      if (VACUUM) {
        p.vel.y -= MOON_G * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.vel.y < 0 && p.pos.y <= terrainHeight(p.pos.x, p.pos.z)) { p.life = 0; iData[o4 + 2] = 0; continue; }
        size = p.base;
        alpha = p.punch * Math.min(1, k * 12);
      } else {
        if (!p.settled) {
          // Clods fall back fast; the fine stuff barely falls at all in thin air.
          p.vel.y -= GRAVITY * (p.fine ? 0.08 : 0.45) * dt;
          p.vel.x += WIND.x * gust * dt;
          p.vel.z += WIND.z * gust * dt;
          // Eddies: the plume billows and tears instead of drifting as one smooth smoke
          // (thin air carries it high and lets it hang, so it is the fine dust that wanders).
          if (p.fine) {
            const e = 0.55 * Math.min(1, k * 4);
            p.vel.x += Math.sin(time * 0.9 + p.ph) * e * dt + Math.sin(time * 2.3 + p.ph * 1.7) * e * 0.4 * dt;
            p.vel.z += Math.cos(time * 0.8 + p.ph * 1.3) * e * dt + Math.cos(time * 2.1 + p.ph * 0.9) * e * 0.4 * dt;
            p.vel.y += Math.sin(time * 1.1 + p.ph * 2.1) * e * 0.35 * dt;
          }
          p.vel.multiplyScalar(1 - (p.fine ? 0.45 : 1.1) * dt);
          p.pos.addScaledVector(p.vel, dt);
          // Keep the puff's centre about a third of its size above the ground, so it
          // sits on the surface as a mound instead of being cut in half by it.
          const r = p.base * (0.45 + Math.min(1, k * 1.4) * p.grow) * 0.5;
          const floor = terrainHeight(p.pos.x, p.pos.z) + r * 0.35;
          if (p.pos.y <= floor) {
            p.pos.y = floor;
            if (!p.fine) {
              p.settled = true;
              p.vel.set(p.vel.x * 0.3 + WIND.x * gust * 0.3, 0, p.vel.z * 0.3 + WIND.z * gust * 0.3);
            } else p.vel.y = Math.max(p.vel.y, 0);
          }
        } else {
          p.pos.addScaledVector(p.vel, dt);
          p.vel.multiplyScalar(1 - 0.6 * dt);
          p.pos.y = terrainHeight(p.pos.x, p.pos.z) + p.base * (0.45 + p.grow) * 0.17;
        }
        const grow = Math.min(1, k * 1.4);
        size = p.base * (0.45 + grow * p.grow);
        // Fast fade-in, long fade-out, thinning as it spreads.
        const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
        alpha = p.punch * Math.max(0, fade) * (1 - grow * 0.45);
      }
      p.rot += p.spin * dt;

      // By night the dust is lit by what reaches it: the headlight beams ahead and the
      // red glow of the tail lamps behind (red, like the lamps); the rest is dark.
      let bright = nightFloor;
      let tail = 0;
      if (bright < 1) {
        if (ctx.head && ctx.head.on) {
          bright = Math.max(bright, Math.min(1, beamLit(p.pos.x, p.pos.y, p.pos.z, ctx.head.x, ctx.head.y, ctx.head.z, ctx.head.dx, ctx.head.dz) * 1.7));
        }
        if (ctx.tail && ctx.tail.on) {
          const dx = p.pos.x - ctx.tail.x;
          const dy = p.pos.y - ctx.tail.y;
          const dz = p.pos.z - ctx.tail.z;
          tail = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / TAIL_LIT_R);
        }
      }
      iPos[o3] = p.pos.x;
      iPos[o3 + 1] = p.pos.y;
      iPos[o3 + 2] = p.pos.z;
      iData[o4] = size;
      iData[o4 + 1] = p.rot;
      iData[o4 + 2] = alpha;
      iData[o4 + 3] = p.frame;
      iColor[o3] = p.col.r * Math.max(bright, tail);
      iColor[o3 + 1] = p.col.g * Math.max(bright, tail * 0.4);
      iColor[o3 + 2] = p.col.b * Math.max(bright, tail * 0.35);
    }
    geo.attributes.iPos.needsUpdate = true;
    geo.attributes.iData.needsUpdate = true;
    geo.attributes.iColor.needsUpdate = true;

    const U = material.uniforms;
    if (ctx.sunDir) {
      // At night the same light is the moon, mirrored above the horizon (sunshadow.js).
      U.sunDir.value.set(ctx.sunDir.x, Math.abs(ctx.sunDir.y), ctx.sunDir.z).normalize();
    }
    if (ctx.sunColor) U.sunCol.value.copy(ctx.sunColor).multiplyScalar(0.33 * (ctx.sunIntensity ?? 1));
    U.ambient.value = 0.28 + 0.3 * ctx.daylight;
    if (ctx.fog) {
      U.fogColor.value.copy(ctx.fog.color);
      U.fogNear.value = ctx.fog.near;
      U.fogFar.value = ctx.fog.far;
    }
  }

  return {
    group,
    update,
    setTint(color) {
      dayTint.copy(color);
    },
  };
}
