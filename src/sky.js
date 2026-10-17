import * as THREE from 'three';
import { PLANET } from './planet.js';

// Fog colour and sky horizon are the same raw display values, so terrain fades
// into the sky seamlessly (three applies fog after tone mapping).
const raw = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

export const PRESETS = {
  day: {
    horizon: raw(0.86, 0.62, 0.45),
    zenith: raw(0.6, 0.4, 0.31),
    ground: raw(0.5, 0.28, 0.17),
    tint: raw(1.0, 0.86, 0.66),
    stars: 0,
    glow: 0.22,
    core: 0.35,
    discA: 0.9993,
    discB: 0.9998,
    disc: 3.0,
    dir: new THREE.Vector3(0.55, 0.48, 0.7).normalize(),
  },
  // No air to scatter sunlight into a blue (or butterscotch) dome — the Moon's sky
  // is black at noon same as at midnight, stars and all, sun blazing in the middle
  // of it. Only the ground and the vehicle read as "day" there; the sky never does.
  moonDay: {
    horizon: raw(0, 0, 0),
    zenith: raw(0, 0, 0),
    ground: raw(0, 0, 0),
    tint: raw(1.0, 0.97, 0.92),
    stars: 1,
    glow: 0.05,
    core: 0.3,
    discA: 0.9992,
    discB: 0.9998,
    disc: 3.2,
  },
  // An actual atmosphere and cloud cover — the reference art is heavily overcast,
  // so this is a flat, pale, low-contrast sky (no real cloud rendering, just a
  // dome with almost no horizon-to-zenith gradient) with the sun a soft diffuse
  // glow behind the cloud rather than a hard disc.
  verdantaDay: {
    horizon: raw(0.72, 0.74, 0.74),
    zenith: raw(0.48, 0.53, 0.56),
    ground: raw(0.26, 0.3, 0.28),
    tint: raw(0.95, 0.97, 1.0),
    stars: 0,
    glow: 0.5,
    core: 0.03,
    discA: 0.985,
    discB: 0.999,
    disc: 0.4,
  },
  night: {
    horizon: raw(0.075, 0.062, 0.09),
    zenith: raw(0.006, 0.008, 0.03),
    ground: raw(0.02, 0.015, 0.02),
    tint: raw(0.65, 0.78, 1.0),
    stars: 1,
    glow: 0.05,
    core: 0.08,
    discA: 0.9975,
    discB: 0.9982,
    disc: 1.5,
    dir: new THREE.Vector3(0.4, 0.55, 0.75).normalize(),
  },
  // The cloud deck that keeps Верданта's day bright and shadowless is gone by
  // night — no moon or streetlight to light it from below, so it reads as
  // ordinary black sky instead of a lit dome, and the companion planet/stars get
  // to pop the way they do off-world instead of sitting on a grey haze.
  verdantaNight: {
    horizon: raw(0, 0, 0),
    zenith: raw(0, 0, 0),
    ground: raw(0, 0, 0),
    tint: raw(0.75, 0.82, 1.0),
    stars: 1,
    glow: 0.04,
    core: 0.06,
    discA: 0.9975,
    discB: 0.9982,
    disc: 1.2,
  },
};

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      blueHalo: { value: 0 },
      horizon: { value: new THREE.Color() },
      zenith: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      tint: { value: new THREE.Color() },
      stars: { value: 0 },
      glow: { value: 0 },
      core: { value: 0 },
      discA: { value: 0.9993 },
      discB: { value: 0.9998 },
      disc: { value: 3 },
      // A companion world in orbit, visible in the dome the same way the sun disc
      // is — see `planetDirAt` below. Zero radius/glow (the defaults) means nothing
      // is drawn, so this is harmless on planets that never set it.
      planetDir: { value: new THREE.Vector3(0, 1, 0) },
      planetTangent: { value: new THREE.Vector3(1, 0, 0) },
      planetBitangent: { value: new THREE.Vector3(0, 0, 1) },
      planetAxis: { value: new THREE.Vector3(0, 1, 0) },
      planetSpin: { value: 0 },
      planetColorA: { value: new THREE.Color(0xe6e5e1) },
      planetColorB: { value: new THREE.Color(0x4c4e53) },
      planetR: { value: 0 },
      planetGlow: { value: 0 },
      // Weather (weather.js): a dust storm or rain cloud smothering the whole dome.
      haze: { value: 0 },
      hazeColor: { value: new THREE.Color() },
      // Night sky extras: time for the meteors, and Mars's two little moons
      // (xyz direction, w angular radius; w = 0 hides one).
      time: { value: 0 },
      meteors: { value: PLANET === 'verdanta' ? 0 : 1 },
      moonA: { value: new THREE.Vector4(0, 1, 0, 0) },
      moonB: { value: new THREE.Vector4(0, 1, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform float blueHalo;
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 ground;
      uniform vec3 tint;
      uniform float stars;
      uniform float glow;
      uniform float core;
      uniform float discA;
      uniform float discB;
      uniform float disc;
      uniform vec3 planetDir;
      uniform vec3 planetTangent;
      uniform vec3 planetBitangent;
      uniform vec3 planetColorA;
      uniform vec3 planetColorB;
      uniform vec3 planetAxis;
      uniform float planetSpin;
      uniform float planetR;
      uniform float planetGlow;
      uniform float haze;
      uniform vec3 hazeColor;
      uniform float time;
      uniform float meteors;
      uniform vec4 moonA;
      uniform vec4 moonB;
      varying vec3 vDir;


      // Ring span, in planet radii.
      const float RING_IN = 1.35;
      const float RING_OUT = 2.15;

      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      // Trilinear value noise off the same hash, for the companion planet's terrain —
      // craters and continents, not the pinprick stars above.
      float vnoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n00 = mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x);
        float n10 = mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x);
        float n01 = mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x);
        float n11 = mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x);
        return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
      }
      float fbm3(vec3 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          s += a * vnoise3(p);
          p *= 2.02;
          a *= 0.5;
        }
        return s;
      }

      vec3 hash33(float n) {
        return fract(sin(vec3(n, n + 1.7, n + 3.1) * vec3(43758.5453, 22578.1459, 19642.3490)));
      }
      // A small potato of a moon: lit sphere with a rough, cratered face.
      vec4 littleMoon(vec3 d, vec4 m, vec3 sunD, float seed) {
        if (m.w <= 0.0) return vec4(0.0);
        vec3 md = normalize(m.xyz);
        float c = dot(d, md);
        float sr = sin(m.w);
        vec3 off = (d - md * c) / sr;
        float r2 = dot(off, off);
        if (c < 0.0 || r2 > 1.0) return vec4(0.0);
        vec3 n = normalize(off - md * sqrt(1.0 - r2));
        float lit = clamp(dot(n, sunD) * 1.1, 0.0, 1.0);
        float rough = 0.75 + 0.25 * hash31(floor(off * 9.0 + seed) + seed);
        vec3 surf = vec3(0.62, 0.55, 0.48) * rough * (0.03 + lit);
        return vec4(surf, smoothstep(1.0, 0.85, r2));
      }

      // How much ring material a sight-line crosses at radius rho (planet radii):
      // broad bands, a couple of clean gaps, and soft inner and outer edges.
      float ringDensity(float rho) {
        if (rho < RING_IN || rho > RING_OUT) return 0.0;
        float t = (rho - RING_IN) / (RING_OUT - RING_IN);
        float bands = 0.55 + 0.45 * sin(t * 14.0) * sin(t * 5.0 + 1.1);
        float gaps = smoothstep(0.0, 0.05, abs(t - 0.46)) * smoothstep(0.0, 0.04, abs(t - 0.78));
        float ends = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.88, 1.0, t));
        return clamp(bands, 0.0, 1.0) * gaps * ends;
      }

      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.45);
        vec3 col = mix(horizon, zenith, t);
        col = mix(col, ground, smoothstep(0.0, -0.35, d.y));

        if (stars > 0.0) {
          vec3 sp = d * 170.0;
          vec3 id = floor(sp);
          vec3 f = fract(sp) - 0.5;
          float r = hash31(id);
          float star = step(0.975, r) * smoothstep(0.32, 0.0, length(f));
          // The Milky Way: a broad band, mottled with dust lanes and thick with
          // faint stars, brighter towards its core.
          vec3 gAxis = normalize(vec3(0.3, 0.8, 0.5));
          float gl = dot(d, gAxis);
          float core = 0.6 + 0.4 * max(dot(d, normalize(vec3(0.9, 0.1, -0.4))), 0.0);
          float lanes = smoothstep(0.25, 0.75, fbm3(d * 9.0 + 3.0)) * (1.0 - 0.7 * smoothstep(0.45, 0.7, fbm3(d * 22.0)));
          float band = exp(-pow(gl * 3.2, 2.0)) * (0.03 + 0.07 * lanes) * core;
          float dense = step(0.965, hash31(floor(d * 420.0))) * exp(-pow(gl * 3.4, 2.0)) * 0.22;
          float up = smoothstep(0.02, 0.3, d.y);
          col += stars * up * (star * (0.35 + 0.65 * r) * vec3(0.85, 0.9, 1.0) + band * vec3(0.55, 0.62, 1.0) + dense * vec3(0.8, 0.85, 1.0));

          // Now and then a meteor: a short bright streak across a random patch of sky.
          if (meteors > 0.0) {
            float period = 7.0;
            float k = floor(time / period);
            float tt = time - k * period;
            if (tt < 0.9) {
              vec3 h = hash33(k);
              vec3 start = normalize(vec3(h.x * 2.0 - 1.0, 0.45 + h.y * 0.5, h.z * 2.0 - 1.0));
              vec3 dir = normalize(cross(start, normalize(vec3(h.z - 0.5, 0.2, h.x - 0.5))));
              vec3 head = normalize(start + dir * tt * 0.4);
              vec3 tail = normalize(start + dir * max(0.0, tt * 0.4 - 0.12));
              vec3 ab = head - tail;
              float u = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
              float dist = length(d - (tail + ab * u));
              float fade = sin(tt / 0.9 * 3.14159);
              col += stars * up * vec3(1.0, 0.95, 0.85) * smoothstep(0.0025, 0.0, dist) * u * u * fade * 1.6;
            }
          }
        }

        // Phobos and Deimos (Mars only; zero radius elsewhere hides them).
        vec4 mA = littleMoon(d, moonA, sunDir, 3.0);
        col = mix(col, mA.rgb, mA.a);
        vec4 mB = littleMoon(d, moonB, sunDir, 7.0);
        col = mix(col, mB.rgb, mB.a);

        float s = max(dot(d, sunDir), 0.0);
        col += tint * (pow(s, 6.0) * glow + pow(s, 60.0) * core);
        col += mix(vec3(1.0, 0.95, 0.85), tint, 0.5) * smoothstep(discA, discB, s) * disc;
        // Mars at dusk: dust scatters blue forward, so the sky round a low sun goes blue while
        // the rest stays butterscotch. A ring from ~3 degrees out, fading wide.
        // Mixed in, not added: the sky beside a low sun is already near white, and adding blue
        // to white only clips.
        col = mix(col, vec3(0.34, 0.52, 0.92) * (0.7 + 0.45 * pow(s, 24.0)), clamp(blueHalo * pow(s, 5.0) * 1.25, 0.0, 0.92) * (1.0 - smoothstep(0.9985, 0.99995, s)));

        // A small ringed world, fixed in the dome (see planetOrbit in sky.js),
        // drawn as a lit sphere rather than a flat disc: (u, v) plus the implied depth
        // sqrt(1 - r*r) give a real sphere normal in the planet's own frame, which is
        // what makes the terminator land where it should. That same frame then carries
        // the ring plane, so the rings, their shadow on the planet and the planet's
        // shadow on them all fall out of one piece of geometry instead of three.
        if (planetR > 0.0) {
          float ps = dot(d, planetDir);
          vec3 rel = d - planetDir * ps;
          float maxSin = sqrt(max(1.0 - planetR * planetR, 1e-5));
          vec2 disc = vec2(dot(rel, planetTangent), dot(rel, planetBitangent)) / maxSin;
          float r2 = dot(disc, disc);

          if (r2 < RING_OUT * RING_OUT) {
            // Planet-local frame: x = tangent, y = bitangent, z = away from the eye,
            // because planetDir points from the camera out towards the planet. The
            // visible half of the sphere is therefore the one at negative z — getting
            // that sign wrong lights the planet from behind and inverts every phase.
            vec3 axis = normalize(vec3(dot(planetTangent, planetAxis), dot(planetBitangent, planetAxis), dot(planetDir, planetAxis)));
            vec3 sunL = vec3(dot(planetTangent, sunDir), dot(planetBitangent, sunDir), dot(planetDir, sunDir));
            float nz = sqrt(max(1.0 - min(r2, 1.0), 0.0));
            vec3 sNormal = vec3(disc, -nz);
            float openness = abs(axis.z); // 1 = rings face-on, 0 = edge-on

            vec3 body = vec3(0.0);
            float bodyA = 0.0;
            if (r2 < 1.0) {
              // Slow axial spin. Turning the point we sample is the same thing as
              // turning the planet, and costs one Rodrigues rotation instead of a
              // matrix upload.
              float cs = cos(planetSpin);
              float sn = sin(planetSpin);
              vec3 pr = sNormal * cs + cross(axis, sNormal) * sn + axis * dot(axis, sNormal) * (1.0 - cs);
              float shade = clamp(fbm3(pr * 2.4 + 11.0) * 0.72 + fbm3(pr * 13.0 + 40.0) * 0.28, 0.0, 1.0);
              vec3 surfCol = mix(planetColorB, planetColorA, smoothstep(0.3, 0.7, shade));
              float lit = clamp(dot(sNormal, sunL), 0.0, 1.0);

              // Ring shadow on the planet: walk from the surface point towards the sun
              // and see whether it crosses the ring plane inside the rings themselves.
              float denom = dot(sunL, axis);
              if (abs(denom) > 0.001) {
                float tHit = -dot(sNormal, axis) / denom;
                if (tHit > 0.0) lit *= 1.0 - 0.75 * ringDensity(length(sNormal + sunL * tHit));
              }
              // Almost no atmosphere means almost nothing scatters light onto the dark
              // side — it reads close to black, not a dim grey crescent.
              body = surfCol * (0.02 + 0.98 * lit);
              bodyA = 1.0;
            }

            // The rings. In this orthographic impostor a sight-line runs straight down
            // the depth axis, so where it meets the ring plane is one division.
            vec3 ring = vec3(0.0);
            float ringA = 0.0;
            if (openness > 0.02) {
              float w = -dot(disc, axis.xy) / axis.z;
              vec3 rp = vec3(disc, w);
              float dens = ringDensity(length(rp));
              // The sphere hides any ring lying behind its near surface.
              bool hidden = r2 < 1.0 && w > -nz;
              if (dens > 0.0 && !hidden) {
                float tc = -dot(rp, sunL);
                float shadow = (tc > 0.0 && length(rp + sunL * tc) < 1.0) ? 0.22 : 1.0;
                ring = mix(planetColorB, planetColorA, 0.5 + 0.3 * sin(length(rp) * 9.0)) * shadow;
                // Seen edge-on the same dust covers far less screen, so thin it out.
                ringA = dens * mix(0.25, 0.9, openness);
              }
            }

            // A real body blocks whatever is behind it — mix (replace), not add, or it
            // reads as a translucent smear of light instead of a solid disc.
            float edge = smoothstep(1.0, 0.965, r2);
            col = mix(col, body, edge * bodyA);
            col = mix(col, ring, ringA);
            col += planetColorA * pow(max(ps, 0.0), 80.0) * planetGlow * (1.0 - edge);
          }
        }
        col = mix(col, hazeColor, haze * mix(1.0, 0.75, smoothstep(0.0, 1.0, d.y)));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const DAY = PLANET === 'moon' ? PRESETS.moonDay : PLANET === 'verdanta' ? PRESETS.verdantaDay : PRESETS.day;
const NIGHT = PLANET === 'verdanta' ? PRESETS.verdantaNight : PRESETS.night;

// Blend the two presets by how high the sun is, so dusk and dawn pass through
// smoothly instead of snapping between day and night.
const _c = new THREE.Color();
export function updateSky(material, sunDir, daylight, planet) {
  const u = material.uniforms;
  const d = DAY;
  const n = NIGHT;
  u.sunDir.value.copy(sunDir).normalize();
  u.horizon.value.copy(n.horizon).lerp(_c.copy(d.horizon), daylight);
  u.zenith.value.copy(n.zenith).lerp(_c.copy(d.zenith), daylight);
  u.ground.value.copy(n.ground).lerp(_c.copy(d.ground), daylight);
  u.tint.value.copy(n.tint).lerp(_c.copy(d.tint), daylight);
  // No air to fade the stars out behind a lit sky, so on the Moon they never dim.
  u.stars.value = PLANET === 'moon' ? 1 : 1 - Math.min(1, daylight * 1.6);
  u.glow.value = n.glow + (d.glow - n.glow) * daylight;
  // The blue sunset halo (see the shader): only on Mars, only with the sun low and not yet set.
  u.blueHalo.value = PLANET === 'mars' ? 0.9 * Math.max(0, 1 - sunDir.y / 0.32) * Math.min(1, Math.max(0, (sunDir.y + 0.1) / 0.1)) : 0;
  u.core.value = n.core + (d.core - n.core) * daylight;
  u.discA.value = n.discA + (d.discA - n.discA) * daylight;
  u.discB.value = n.discB + (d.discB - n.discB) * daylight;
  u.disc.value = n.disc + (d.disc - n.disc) * daylight;
  if (planet) {
    u.planetDir.value.copy(planet.dir);
    u.planetTangent.value.copy(planet.tangent);
    u.planetBitangent.value.copy(planet.bitangent);
    u.planetAxis.value.copy(planet.axis);
    u.planetSpin.value = planet.spin;
    u.planetR.value = 0.9985; // ~3.1° of sphere, ~6.7° once the rings are counted. An
    // earlier pass at ~11° of bare sphere filled a third of the screen and read as a
    // mistake rather than a moon, so the rings, not the rock, carry the size now.
    u.planetGlow.value = 0.04; // almost no atmosphere to haze its edge — should read crisp, not glowing
  } else {
    u.planetR.value = 0;
    u.planetGlow.value = 0;
  }
}

// Верданта's companion world: fixed in the dome, not drifting — a moon that visibly
// crawled across the sky on its own (the first version of this did) reads as broken,
// not "always there". It still turns with you as you turn, exactly like the stars.
// Kept fairly low (not overhead) on purpose: the chase camera looks mostly forward
// with only a slight upward allowance, so a moon parked near the zenith would sit
// outside the player's normal view almost all the time — exactly the "where did it
// go" problem this is meant to fix.
const _pDir = new THREE.Vector3(-0.38, 0.16, 0.91).normalize();
const _pTan = new THREE.Vector3();
const _pBit = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
_pTan.crossVectors(_worldUp, _pDir).normalize();
_pBit.crossVectors(_pDir, _pTan).normalize();
// Tilt of the spin axis, and with it the ring plane. Chosen so the rings sit maybe
// 20° off edge-on from here: face-on reads as a flat bullseye and dead edge-on
// disappears into a line, and neither looks like a planet.
const _pAxis = new THREE.Vector3(0.2, 0.9, 0.35).normalize();
const _planet = { dir: _pDir, tangent: _pTan, bitangent: _pBit, axis: _pAxis, spin: 0 };
// Mars's moons: Phobos races round in under a third of a sol, rising in the west;
// Deimos crawls the other way and hangs up there for days. Both orbit near the
// equator, here a tilted great circle. Drawn a few times their true size, or they
// would be single pixels.
const _mAxis = new THREE.Vector3(0.25, 0.25, 1).normalize();
const _mU = new THREE.Vector3(1, 0, -0.25).normalize();
const _mV = new THREE.Vector3().crossVectors(_mAxis, _mU).normalize();
export function marsMoons(material, timeOfDay, time) {
  const u = material.uniforms;
  u.time.value = time;
  if (PLANET !== 'mars') return;
  const a = -timeOfDay * Math.PI * 2 * 3.2 + 1.1; // Phobos, retrograde as seen
  const b = timeOfDay * Math.PI * 2 * 0.25 + 2.4; // Deimos
  const dA = _mU.clone().multiplyScalar(Math.cos(a)).addScaledVector(_mV, Math.sin(a));
  const dB = _mU.clone().multiplyScalar(Math.cos(b)).addScaledVector(_mV, Math.sin(b));
  dB.y = Math.abs(dB.y) * 0.7 + 0.15;
  dB.normalize();
  u.moonA.value.set(dA.x, dA.y, dA.z, 0.016);
  u.moonB.value.set(dB.x, dB.y, dB.z, 0.008);
}

export function planetOrbit(timeOfDay) {
  // One turn per sol. It is the only thing in that sky that moves, and a world you can
  // watch turning is worth the one cosine it costs.
  _planet.spin = (timeOfDay || 0) * Math.PI * 2;
  return _planet;
}

// The sky shader prints its colours as-is, but three converts the fog colour from
// linear to sRGB before blending. Storing the sky's numbers unchanged therefore made
// the fog several times brighter than the sky behind it (a cream smear by day, a grey
// haze by night). Store the linear equivalent instead, so the fog is *rendered* as
// exactly the horizon colour and distant terrain melts into the sky.
const _mix = new THREE.Color();
export function horizonColor(daylight, out) {
  _mix.copy(NIGHT.horizon).lerp(_c.copy(DAY.horizon), daylight);
  return out.setRGB(_mix.r, _mix.g, _mix.b, THREE.SRGBColorSpace);
}
