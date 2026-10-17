import * as THREE from 'three';
import { surfaceHeight } from './terrain.js';
import { PLANET } from './planet.js';

// Tyre ruts pressed into the regolith. Each segment is a shallow channel: the middle
// sits low and dark where the wheel packed the dust down, and the dust pushed aside
// piles into a lighter berm on either side. Each wheel owns a ring of segments, so
// the oldest is reused once the ring wraps and the trail stays a few hundred metres.

const STEP = 1.5; // metres of travel between segments
const TELEPORT = 25; // a jump bigger than this is a reset, not driving

// Cross-section from one side to the other. Nothing dips below the rendered surface:
// the groove reads from the height difference between berm and floor, which also
// keeps it clear of the terrain mesh instead of z-fighting it.
// Vertex colours go into the buffer already linear, so writing sRGB-looking numbers
// here made the berms glow almost white. THREE.Color does the conversion.
// Per planet: Martian dust, grey lunar regolith, dark Verdantan mud.
const TINTS = {
  mars: [0xc08a5a, 0x6a3e26],
  moon: [0xa4a4a0, 0x464646],
  verdanta: [0x6e5c44, 0x2e241a],
}[PLANET] || [0xc08a5a, 0x6a3e26];
// Scaled down to the ground's own albedo: the terrain is darkened by its texture
// layers and these flat colours are not, so at full strength the ruts glowed as pale
// lines across the ground at night.
const BERM = new THREE.Color(TINTS[0]).multiplyScalar(0.5).toArray(); // dust thrown clear of the tyre
const FLOOR = new THREE.Color(TINTS[1]).multiplyScalar(0.5).toArray(); // packed down under it
const LANES = [
  // `a` is how opaque each lane is: the outer edge of the berm dissolves into the ground
  // instead of ending on a ruled line.
  { off: -1.05, lift: 0.005, tint: BERM, a: 0.0 },
  { off: -0.7, lift: 0.17, tint: BERM, a: 0.6 },
  { off: -0.42, lift: 0.015, tint: FLOOR, a: 0.72 },
  { off: 0.42, lift: 0.015, tint: FLOOR, a: 0.72 },
  { off: 0.7, lift: 0.17, tint: BERM, a: 0.6 },
  { off: 1.05, lift: 0.005, tint: BERM, a: 0.0 },
];
// No wind on the Moon: a rut stays exactly as it was made, so there they never fade
// (the ring is just long — a couple of kilometres per wheel — before it reuses).
const FOREVER = PLANET === 'moon';
const STRIPS = LANES.length - 1;
const VERTS_PER_SEG = STRIPS * 6;
// Which lane each vertex of a strip belongs to, for colouring.
const LANE_OF_VERT = [];
for (let l = 0; l < STRIPS; l++) LANE_OF_VERT.push(l, l, l + 1, l + 1, l, l + 1);

// `width` is one number for every wheel, or one per wheel for a chassis whose rear
// tyres are wider than the fronts.
export function createTracks(wheels = 4, segments = 170, width = 1.05) {
  const total = wheels * segments * VERTS_PER_SEG;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 4);
  const birth = new Float32Array(total);
  const tuv = new Float32Array(total * 2); // across the track (-1..1 of the half width) and metres along it
  const along = new Float64Array(wheels); // distance driven per wheel, for the tread pattern

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('birth', new THREE.BufferAttribute(birth, 1));
  geo.setAttribute('tuv', new THREE.BufferAttribute(tuv, 2));
  const A = ['position', 'normal', 'color', 'birth', 'tuv'].map((n) => geo.attributes[n]);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  // Fade by age in the shader: each vertex carries the sequence number of the segment
  // it was laid in, and `seq` is the newest. So adding a segment uploads only that
  // segment, instead of rewriting every alpha in the ring each time.
  const seqU = { value: 0 };
  const life = segments * wheels;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.seq = seqU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float birth;\nattribute vec2 tuv;\nvarying vec2 vTuv;\nuniform float seq;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        float trackF = ${FOREVER ? '1.0' : `max( 0.0, 1.0 - ( seq - birth ) / ${life.toFixed(1)} )`};
        vColor.a *= trackF * trackF;
        vTuv = tuv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vTuv;
        float trH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float trN( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( trH( i ), trH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( trH( i + vec2( 0.0, 1.0 ) ), trH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // Tread: chevron lugs pressed into the packed floor of the rut, worn and patchy,
          // and a ragged edge where the berm crumbles, so it reads as a tyre, not a stripe.
          float a = abs( vTuv.x );
          float ph = vTuv.y * 3.3 + a * 2.4;
          float lug = smoothstep( 0.3, 0.46, abs( fract( ph ) - 0.5 ) );
          float inPatch = 1.0 - smoothstep( 0.42, 0.56, a );
          float cell = trN( vec2( vTuv.y * 2.2, vTuv.x * 3.0 ) ) * 0.65 + trN( vec2( vTuv.y * 7.0, vTuv.x * 9.0 ) ) * 0.35;
          float wear = 0.5 + 0.5 * trN( vec2( vTuv.y * 0.35 + 3.0, 1.7 ) );
          diffuseColor.rgb *= mix( 1.0, 0.6, lug * inPatch * 0.85 * wear ) * ( 0.93 + 0.14 * cell );
          diffuseColor.a *= 1.0 - 0.45 * smoothstep( 0.62, 1.0, a ) * cell;
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the ring spans hundreds of metres and moves
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;

  const halves = Array.from({ length: wheels }, (_, w) => (Array.isArray(width) ? width[w] : width) / 2);
  const ringSize = wheels * segments;
  let ringHead = 0;
  let upLo = Infinity;
  let upHi = -1;
  let upAll = false;
  const last = Array.from({ length: wheels }, () => ({ x: 0, z: 0, has: false }));

  const cx = new Float64Array(LANES.length * 2);
  const cy = new Float64Array(LANES.length * 2);
  const cz = new Float64Array(LANES.length * 2);

  function emit(w, fromX, fromZ, toX, toZ) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    const half = halves[w];
    const rx = (dz / len) * half;
    const rz = (-dx / len) * half;

    for (let e = 0; e < 2; e++) {
      const bx = e ? toX : fromX;
      const bz = e ? toZ : fromZ;
      for (let l = 0; l < LANES.length; l++) {
        const k = e * LANES.length + l;
        // The berms are loose dust: wavering a few centimetres in and out and in height,
        // never a ruled line (the floor lanes stay put so the tread keeps its shape).
        const loose = LANES[l].lift > 0.1 ? 1 : 0;
        const jx = loose * 0.09 * (Math.sin(bx * 0.9 + bz * 0.7 + l * 3.1) + Math.sin(bx * 2.7 - bz * 1.9 + l));
        cx[k] = bx + rx * (LANES[l].off + jx);
        cz[k] = bz + rz * (LANES[l].off + jx);
        cy[k] = surfaceHeight(cx[k], cz[k]) + LANES[l].lift * (1 + loose * 0.35 * Math.sin(bx * 1.3 + bz * 1.1 + l));
      }
    }

    const a0d = along[w];
    along[w] += len;
    const a1d = along[w];

    // One ring shared by all the wheels, so a frame's new segments sit side by side in
    // the buffers and go up to the GPU as one small contiguous range.
    const seg = ringHead;
    ringHead = (ringHead + 1) % ringSize;
    if (seg < upLo) upLo = seg;
    if (seg > upHi) upHi = seg;
    if (seg === 0 && upHi > 0) upAll = true; // wrapped mid-frame
    let o = seg * VERTS_PER_SEG * 3;
    for (let l = 0; l < STRIPS; l++) {
      const a0 = l;
      const b0 = l + 1;
      const a1 = LANES.length + l;
      const b1 = LANES.length + l + 1;
      // One flat normal per strip, so the berm walls actually catch the light.
      const ux = cx[b0] - cx[a0];
      const uy = cy[b0] - cy[a0];
      const uz = cz[b0] - cz[a0];
      const vx = cx[a1] - cx[a0];
      const vy = cy[a1] - cy[a0];
      const vz = cz[a1] - cz[a0];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }

      // Wound counter-clockwise seen from above, so the faces point up (the other
      // way round they were back-face culled and never drawn at all).
      for (const idx of [a0, a1, b0, b0, a1, b1]) {
        const tv = (seg * VERTS_PER_SEG + (o / 3 - seg * VERTS_PER_SEG)) * 2;
        tuv[tv] = LANES[idx % LANES.length].off;
        tuv[tv + 1] = idx >= LANES.length ? a1d : a0d;
        pos[o] = cx[idx];
        pos[o + 1] = cy[idx];
        pos[o + 2] = cz[idx];
        nrm[o] = nx;
        nrm[o + 1] = ny;
        nrm[o + 2] = nz;
        o += 3;
      }
    }

    seqU.value++;
    const v0 = seg * VERTS_PER_SEG;
    for (let v = 0; v < VERTS_PER_SEG; v++) {
      const tint = LANES[LANE_OF_VERT[v]].tint;
      const c = (v0 + v) * 4;
      col[c] = tint[0];
      col[c + 1] = tint[1];
      col[c + 2] = tint[2];
      col[c + 3] = LANES[LANE_OF_VERT[v]].a;
      birth[v0 + v] = seqU.value;
    }
  }

  function clear() {
    pos.fill(0);
    col.fill(0);
    birth.fill(0);
    tuv.fill(0);
    along.fill(0);
    for (const a of A) a.clearUpdateRanges();
    ringHead = 0;
    for (const l of last) l.has = false;
    for (const a of A) a.needsUpdate = true;
  }

  // contacts: one {x, z, contact} per wheel, in world space
  function update(contacts) {
    let touched = false;
    for (let w = 0; w < wheels && w < contacts.length; w++) {
      const c = contacts[w];
      const l = last[w];
      if (!c.contact) {
        l.has = false; // airborne: break the trail rather than bridging the gap
        continue;
      }
      if (!l.has) {
        l.x = c.x;
        l.z = c.z;
        l.has = true;
        continue;
      }
      const d = Math.hypot(c.x - l.x, c.z - l.z);
      if (d > TELEPORT) {
        l.x = c.x;
        l.z = c.z;
        continue;
      }
      if (d < STEP) continue;
      emit(w, l.x, l.z, c.x, c.z);
      l.x = c.x;
      l.z = c.z;
      touched = true;
    }
    if (touched) {
      // A single range per attribute (three r170 mis-merges several of them).
      const sizes = [3, 3, 4, 1, 2];
      A.forEach((a, i) => {
        a.clearUpdateRanges();
        if (!upAll) {
          const k = VERTS_PER_SEG * sizes[i];
          a.addUpdateRange(upLo * k, (upHi - upLo + 1) * k);
        }
        a.needsUpdate = true;
      });
      upLo = Infinity;
      upHi = -1;
      upAll = false;
    }
  }

  return { mesh, update, clear };
}
