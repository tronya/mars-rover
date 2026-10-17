import * as THREE from 'three';
import { lamp } from './glow.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHASSIS as GAME_CHASSIS, chassisKit } from './chassis.js';

// Everything below builds one chassis's model. It is a factory so the garage can
// build any vehicle, not only the one the game loaded with (vehicleKit(id)); the
// game's own is built once and exported as before.
export function vehicleKit(id) {
  const { CHASSIS, SPEC, WHEEL_DEFS, steerAngle } = chassisKit(id);

  // Vehicle-local space: origin on the suspension mount plane, forward = +Z, left = +X.
  // Ground sits WHEEL_R + L below the mount plane, so y = -1.43 at static ride height.
  const WHEEL_SCALE = SPEC.wheelScale; // wheel model is built at radius 0.855, then scaled up
  const WHEEL_R = 0.855 * WHEEL_SCALE;
  const WHEEL_X = SPEC.wheelX;
  const HULL_W = SPEC.hullW; // narrower than the track, so the tyres are the widest point
  // Suspension length = distance from the mount plane down to the wheel centre.
  const SUSP = SPEC.susp;

  const std = (color, metalness = 0, roughness = 0.6, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

  const M = {
    armor: std(0x26282e, 0.55, 0.45),
    armorLit: std(0x34373f, 0.5, 0.42), // upward-facing panels, reads apart from the flanks
    armorDark: std(0x1a1c21, 0.5, 0.5),
    black: std(0x101216, 0.35, 0.55),
    metal: std(0x6e747e, 0.9, 0.3),
    metalDark: std(0x3a3e46, 0.8, 0.4),
    tire: std(0x14151a, 0, 0.92, { side: THREE.DoubleSide }),
    rim: std(0x2c2f36, 0.75, 0.38),
    glass: std(0x1b2a3a, 0.5, 0.06, { transparent: true, opacity: 0.42, depthWrite: false }),
    suit: std(0x3f434b, 0, 0.7),
    suitOrange: std(0x8a4a22, 0, 0.7),
    visor: std(0xc98a2e, 0.85, 0.15),
    // Unlit, so the running lights read as emissive at night.
    amber: new THREE.MeshBasicMaterial({ color: lamp(0xff9420) }),
    amberDim: new THREE.MeshBasicMaterial({ color: lamp(0xa8560f, 2) }),
    // Painted steel, not a lamp: as an unlit material the coil springs glowed under
    // the rover all night.
    spring: std(0x9c4a16, 0.55, 0.45),
    headlight: new THREE.MeshBasicMaterial({ color: lamp(0xd8c49a, 5) }),
    tail: new THREE.MeshBasicMaterial({ color: lamp(0x7e1a0b, 2) }),
    screen: new THREE.MeshBasicMaterial({ color: lamp(0xff8a2a, 2.5) }),
    // АТЛАС-8 livery: pale armour over a black running gear, orange trim and rims.
    hull: std(0xa9adb0, 0.3, 0.5),
    hullLit: std(0xc4c7c9, 0.25, 0.48),
    hullDark: std(0x1d1f23, 0.45, 0.55),
    trim: std(0xd0761c, 0.35, 0.5),
    hazard: std(0xe0b020, 0.2, 0.6),
  };
  // КОЙОТ: burnished copper. СТРІЛА: graphite over orange with lime accents.
  M.copper = std(0xb4643a, 0.6, 0.36);
  M.copperDark = std(0x6e3a22, 0.55, 0.45);
  M.graphite = std(0x55595f, 0.45, 0.42);
  M.orange = std(0xd8662a, 0.35, 0.45);
  M.lime = new THREE.MeshBasicMaterial({ color: lamp(0xb8f03a, 1.4) });
  M.glassDark = std(0x0c1218, 0.8, 0.06, { transparent: true, opacity: 0.78, depthWrite: false });
  M.teal = new THREE.MeshBasicMaterial({ color: lamp(0x3ad6b0, 1.6) });
  // ГАЛАТЕЯ: off-white shell, gunmetal modules, and warm glowing hex-grid panels.
  M.gWhite = std(0xdcdfe1, 0.2, 0.45);
  M.gGrey = std(0x4c5057, 0.55, 0.38);
  M.gSteel = std(0x8d939b, 0.85, 0.3);
  M.gPanel = std(0xffa448, 0.1, 0.32, { emissive: 0xff7414, emissiveIntensity: 0.55 });
  // КОЛІБРІ: safety-yellow paint over gunmetal, a hot glow in the lift jets.
  M.kYellow = std(0xe3a01e, 0.25, 0.5);
  M.kDark = std(0x2b2e33, 0.5, 0.42);
  M.kJet = new THREE.MeshBasicMaterial({ color: lamp(0x6fd8ff, 2.2) });
  if (CHASSIS === 'hauler') M.rim.color.set(0xc9831c);
  if (CHASSIS === 'buggy' || CHASSIS === 'speedster') M.rim.color.set(0x17181c);
  if (CHASSIS === 'galatea') M.rim.color.set(0xcfd3d6);
  function solarTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#10203c';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = j % 2 === i % 2 ? '#16294a' : '#122442';
        ctx.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
      }
    }
    ctx.strokeStyle = 'rgba(150,180,220,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 4);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  M.solar = new THREE.MeshStandardMaterial({ map: solarTexture(), metalness: 0.45, roughness: 0.28, side: THREE.DoubleSide });
  M.panelBack = std(0x2a2d34, 0.5, 0.5);

  // ---------- paint, glass and dirt ----------
  // The painted panels get a clear coat, so the sky and the sun slide across them as
  // the rover turns; the glass and bare metal reflect more of the sky too.
  for (const k of ['hull', 'hullLit', 'trim', 'hazard', 'copper', 'graphite', 'orange', 'armorLit', 'gWhite', 'kYellow']) {
    const o = M[k];
    M[k] = new THREE.MeshPhysicalMaterial({
      color: o.color, metalness: o.metalness, roughness: Math.max(0.3, o.roughness - 0.1),
      clearcoat: 0.65, clearcoatRoughness: 0.12,
    });
  }
  M.glass.envMapIntensity = 2.4;
  M.glassDark.envMapIntensity = 2.2;
  M.visor.envMapIntensity = 1.8;
  M.metal.envMapIntensity = 1.5;
  M.solar.envMapIntensity = 1.6;

  // Dust and mud build up as you drive (main.js sets the amount): heaviest low down and
  // round the wheels, blotchy, flattening the shine. Washed off by rain and wading.
  // Worked out in the rover's own frame, so the grime rides with the body; the wheels
  // use their own frame, so it turns with the tyre.
  const DIRT = {
    amount: { value: 0 },
    color: { value: new THREE.Color(0x9a6a44) },
    inv: { value: new THREE.Matrix4() },
  };
  function dirtify(mat, spinning) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.dirtAmt = DIRT.amount;
      sh.uniforms.dirtCol = DIRT.color;
      sh.uniforms.dirtInv = DIRT.inv;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 dirtInv;\nvarying vec3 vDirtP;\nvarying float vDirtLow;\nvarying float vDirtUp;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          {
            vec4 dw = modelMatrix * vec4( transformed, 1.0 );
            vec3 rp = ( dirtInv * dw ).xyz;
            vDirtP = ${spinning ? 'transformed * 1.6' : 'rp'};
            vDirtLow = ${spinning ? '0.8' : '1.0 - smoothstep( -0.6, 1.6, rp.y )'};
            vDirtUp = normalize( ( dirtInv * modelMatrix * vec4( objectNormal, 0.0 ) ).xyz ).y;
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
  uniform float dirtAmt;
  uniform vec3 dirtCol;
  varying vec3 vDirtP;
  varying float vDirtLow;
  varying float vDirtUp;
  float dHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
  // Three octaves, each turned and shifted against the last: stacked on the same axes the
  // value-noise lattice showed through as a coat of square blocks ("digital camo").
  const mat3 dRot = mat3( 0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64 );
  float dNoise( vec3 p );
  float dFbm( vec3 p ) {
    float a = 0.5; float s = 0.0;
    for ( int i = 0; i < 3; i ++ ) { s += a * dNoise( p ); p = dRot * p * 3.0 + vec3( 1.7, 9.2, 3.1 ); a *= 0.5; }
    return s / 0.875;
  }
  float dNoise( vec3 p ) {
    vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( dHash( i ), dHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 0 ) ), dHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( dHash( i + vec3( 0, 0, 1 ) ), dHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 1 ) ), dHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dirtK = 0.0;
          if ( dirtAmt > 0.001 ) {
            float n = dFbm( vDirtP * 1.3 );
            float where = vDirtLow * 0.8 + max( vDirtUp, 0.0 ) * 0.25 + 0.05;
            float cover = dirtAmt * where;
            float film = cover * 0.45;                                        // a fine even coat
            float clump = smoothstep( 0.85 - cover, 1.25 - cover, n ) * 0.75; // and soft patches
            dirtK = clamp( max( film, clump ), 0.0, 0.8 );
            diffuseColor.rgb = mix( diffuseColor.rgb, dirtCol, dirtK );
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = mix( roughnessFactor, 0.97, dirtK );')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n        metalnessFactor *= 1.0 - dirtK;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n        #ifdef USE_CLEARCOAT\n        material.clearcoat *= 1.0 - dirtK;\n        #endif');
    };
  }
  for (const [k, m] of Object.entries(M)) {
    if (!m.isMeshStandardMaterial || m.transparent || m === M.solar) continue;
    dirtify(m, k === 'tire' || k === 'rim');
  }

  // Lamps and glazing never cast: they are unlit strips or transparent.
  const NO_CAST = new Set([M.amber, M.amberDim, M.headlight, M.tail, M.screen, M.glass, M.glassDark, M.lime, M.teal, M.kJet]);

  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }
  const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

  function cyl(rt, rb, h, mat, x, y, z, axis = 'y', seg = 20) {
    const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  }

  // Collapse a tree of static meshes into one mesh per material. The body is ~300
  // parts; every shadow-casting light redraws each one, so merging is the difference
  // between ~900 draw calls a frame and ~40.
  // mergeGeometries demands an identical attribute set, and the primitives disagree:
  // ExtrudeGeometry is non-indexed, the rest are indexed, and the attribute order
  // varies. Rebuild each one into exactly position/normal/uv, non-indexed.
  function normalize(geo, matrix) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute(
      'uv',
      g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)
    );
    return out;
  }

  function mergeStatic(group) {
    group.updateMatrixWorld(true);
    const byMat = new Map();
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(normalize(o.geometry, o.matrixWorld));
    });

    const out = new THREE.Group();
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) throw new Error('vehicle: geometry merge failed');
      const m = new THREE.Mesh(merged, mat);
      m.receiveShadow = true;
      m.castShadow = !NO_CAST.has(mat);
      out.add(m);
    }
    return out;
  }

  // Unit-height, unit-radius cylinder stretched between two points by place().
  const UNIT = new THREE.CylinderGeometry(1, 1, 1, 12);
  const UP = V(0, 1, 0);
  const _d = V(0, 0, 0);

  function place(m, a, b, r) {
    _d.subVectors(b, a);
    const len = _d.length();
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len || 1));
    m.scale.set(r, len, r);
  }

  function tube(a, b, r, mat) {
    const m = new THREE.Mesh(UNIT, mat);
    place(m, V(...a), V(...b), r);
    return m;
  }

  // Side profile [z, y] extruded across the vehicle. A single-segment bevel pulled
  // inward keeps the silhouette as drawn and gives flat armour chamfers.
  function extrude(points, width, mat, bevel = 0.1, x = 0, y = 0, z = 0) {
    const shape = new THREE.Shape(points.map(([pz, py]) => new THREE.Vector2(pz, py)));
    const depth = Math.max(0.02, width - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -depth / 2);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = -Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }

  class Helix extends THREE.Curve {
    constructor(turns, radius) {
      super();
      this.turns = turns;
      this.radius = radius;
    }
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * this.turns * Math.PI * 2;
      return target.set(Math.cos(a) * this.radius, t - 0.5, Math.sin(a) * this.radius);
    }
  }
  const SPRING_GEO = new THREE.TubeGeometry(new Helix(8, 0.085), 220, 0.028, 6, false);

  // ---------- wheel ----------

  // [radius, half-width] from the bead out to the tread centre. The crawler runs fat,
  // low-pressure balloon tyres: nearly half again as wide, with a round shoulder
  // instead of the scout's squared-off one.
  const CRAWLER = CHASSIS !== 'truck' && CHASSIS !== 'speedster'; // the rest run fat tyres
  // The speedster's is a narrow tyre with a fully rounded crown, like a rally tyre.
  const SPEEDSTER = CHASSIS === 'speedster';
  const halfProfile = CRAWLER
    ? [[0.36, 0.5], [0.52, 0.53], [0.64, 0.52], [0.74, 0.47], [0.805, 0.38], [0.84, 0.26], [0.855, 0.12], [0.858, 0]]
    : SPEEDSTER
      ? [[0.36, 0.37], [0.56, 0.39], [0.68, 0.375], [0.76, 0.34], [0.81, 0.28], [0.84, 0.2], [0.855, 0.1], [0.86, 0]]
      : [[0.34, 0.36], [0.56, 0.37], [0.73, 0.32], [0.815, 0.2], [0.835, 0]];
  const RIM_FACE = CRAWLER ? 0.43 : 0.3; // how far out the rim faces sit
  const TYRE_HALF_W = halfProfile[1][1] * WHEEL_SCALE;
  const tireGeo = new THREE.LatheGeometry(
    [...halfProfile.map(([r, a]) => [r, -a]), ...halfProfile.slice(0, -1).reverse().map(([r, a]) => [r, a])].map(
      ([r, a]) => new THREE.Vector2(r, a)
    ),
    CRAWLER || SPEEDSTER ? 56 : 40
  );
  const lugGeo = new THREE.BoxGeometry(0.3, 0.1, 0.26);
  const spokeGeo = new THREE.BoxGeometry(0.09, 0.42, 0.14);
  const rimRingGeo = new THREE.TorusGeometry(0.47, 0.045, 8, 40);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.2, 18);
  const boltGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6);

  // Everything here turns with the wheel, so it merges into a handful of meshes.
  let wheelProto = null;
  function buildWheel() {
    if (!wheelProto) {
      const parts = new THREE.Group();

      const tire = new THREE.Mesh(tireGeo, M.tire);
      tire.rotation.z = Math.PI / 2;
      parts.add(tire);

      if (CRAWLER) {
        // Chevron tread wrapping round the shoulder: a centre block and two blocks
        // tipped over onto each rounded edge, so the tyre reads round, not square.
        const LUGS = 20;
        for (let i = 0; i < LUGS; i++) {
          const pivot = new THREE.Group();
          pivot.rotation.x = (i * Math.PI * 2) / LUGS;
          const c = new THREE.Mesh(lugGeo, M.tire);
          c.position.set(0, 0.825, 0);
          c.scale.set(0.8, 0.9, 0.8);
          pivot.add(c);
          for (const k of [-1, 1]) {
            const lug = new THREE.Mesh(lugGeo, M.tire);
            lug.position.set(k * 0.3, 0.79, k * 0.08);
            lug.rotation.set(0, k * 0.4, -k * 0.5);
            pivot.add(lug);
            const edge = new THREE.Mesh(lugGeo, M.tire);
            edge.position.set(k * 0.46, 0.68, -k * 0.05);
            edge.rotation.set(0, 0, -k * 1.0);
            edge.scale.set(0.6, 0.8, 0.7);
            pivot.add(edge);
          }
          parts.add(pivot);
        }
      } else if (SPEEDSTER) {
        // Fine, dense tread that follows the round crown: a centre row and two rows
        // tipped onto each shoulder, staggered — reads as a round tyre, not a cog.
        const LUGS = 30;
        const small = new THREE.BoxGeometry(0.13, 0.04, 0.11);
        for (let i = 0; i < LUGS; i++) {
          const pivot = new THREE.Group();
          pivot.rotation.x = (i * Math.PI * 2) / LUGS;
          const odd = i % 2 ? 1 : -1;
          const c = new THREE.Mesh(small, M.tire);
          c.position.set(odd * 0.06, 0.862, 0);
          pivot.add(c);
          for (const k of [-1, 1]) {
            const sh = new THREE.Mesh(small, M.tire);
            sh.position.set(k * 0.22, 0.83, odd * 0.03);
            sh.rotation.z = -k * 0.45;
            pivot.add(sh);
            const ed = new THREE.Mesh(small, M.tire);
            ed.position.set(k * 0.32, 0.77, -odd * 0.03);
            ed.rotation.z = -k * 0.95;
            ed.scale.set(0.8, 1, 0.9);
            pivot.add(ed);
          }
          parts.add(pivot);
        }
      } else {
        // Two staggered rows of chunky tread blocks.
        const LUGS = 18;
        for (let i = 0; i < LUGS; i++) {
          const pivot = new THREE.Group();
          pivot.rotation.x = (i * Math.PI * 2) / LUGS;
          for (const k of [-1, 1]) {
            const lug = new THREE.Mesh(lugGeo, M.tire);
            lug.position.set(k * 0.17, 0.795, k * 0.06);
            lug.rotation.y = k * 0.3;
            pivot.add(lug);
          }
          parts.add(pivot);
        }
      }

      // Ten-spoke rim, recessed into the tyre on both faces.
      for (const side of [-1, 1]) {
        const face = new THREE.Group();
        face.position.x = side * RIM_FACE;
        if (CRAWLER) {
          // Beadlock ring: a bolted clamp band round the rim lip.
          const lock = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.035, 6, 40), M.metalDark);
          lock.rotation.y = Math.PI / 2;
          lock.position.x = side * 0.02;
          face.add(lock);
          for (let i = 0; i < 16; i++) {
            const a = (i * Math.PI * 2) / 16;
            const b = new THREE.Mesh(boltGeo, M.metal);
            b.rotation.z = Math.PI / 2;
            b.position.set(side * 0.05, Math.cos(a) * 0.53, Math.sin(a) * 0.53);
            face.add(b);
          }
        }
        const ring = new THREE.Mesh(rimRingGeo, M.rim);
        ring.rotation.y = Math.PI / 2;
        face.add(ring);
        if (CHASSIS === 'speedster') {
          // The racer's signature: a thin lime ring round the rim lip.
          const lip = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.018, 6, 48), M.lime);
          lip.rotation.y = Math.PI / 2;
          lip.position.x = side * 0.085; // out on the sidewall, clear of the tyre
          face.add(lip);
        }
        face.add(mesh(new THREE.CircleGeometry(0.47, 28), M.armorDark, side * -0.03, 0, 0).rotateY((side * Math.PI) / 2));
        for (let i = 0; i < 10; i++) {
          const arm = new THREE.Group();
          arm.rotation.x = (i * Math.PI * 2) / 10;
          const sp = new THREE.Mesh(spokeGeo, M.rim);
          sp.position.y = 0.27;
          arm.add(sp);
          face.add(arm);
        }
        const hub = new THREE.Mesh(hubGeo, M.metalDark);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = side * 0.06;
        face.add(hub);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI * 2) / 6;
          const b = new THREE.Mesh(boltGeo, M.metal);
          b.rotation.z = Math.PI / 2;
          b.position.set(side * 0.14, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
          face.add(b);
        }
        parts.add(face);
      }
      wheelProto = mergeStatic(parts);
    }

    const spin = new THREE.Group();
    spin.scale.setScalar(WHEEL_SCALE);
    for (const m of wheelProto.children) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.castShadow = m.castShadow;
      c.receiveShadow = true;
      spin.add(c);
    }
    return spin;
  }

  // ---------- suspension corner: wishbones, coil-over, drive shaft ----------

  function buildCorner(shellAll, rootAll, s, z, wx = WHEEL_X, my = 0) {
    // Drawn for the scout's 1.75 m half-track; a wider track pushes the outboard ends.
    const ox = wx - 1.75;
    // A raised mount (a bigger rear wheel) lifts the whole corner by `my`.
    const shell = new THREE.Group();
    const root = new THREE.Group();
    shell.position.y = my;
    root.position.y = my;
    shellAll.add(shell);
    rootAll.add(root);
    const arms = Array.from({ length: 4 }, () => new THREE.Mesh(UNIT, M.metalDark));
    const spring = new THREE.Mesh(SPRING_GEO, M.spring);
    const damper = new THREE.Mesh(UNIT, M.black);
    const piston = new THREE.Mesh(UNIT, M.metal);
    const shaft = new THREE.Mesh(UNIT, M.metalDark);
    const knuckle = box(0.14, 0.44, 0.24, M.metalDark, 0, 0, 0);
    root.add(...arms, spring, damper, piston, shaft, knuckle);

    // A low body (the speedster) drops the shock tower and upper arms to meet it, and
    // braces the tower back to the tub; everyone else keeps the scout's heights.
    const CN = SPEC.corner || {};
    const top = V(s * (0.95 + ox), CN.topY ?? 0.55, z);
    const bot = V(0, 0, 0);
    const pA = V(0, 0, 0);
    const pB = V(0, 0, 0);
    const diff = V(s * 0.3, -0.12, z);
    const lowIn = [V(s * 0.72, -0.34, z - 0.42), V(s * 0.72, -0.34, z + 0.42)];
    const upIn = [V(s * 0.74, CN.upY ?? 0.16, z - 0.32), V(s * 0.74, CN.upY ?? 0.16, z + 0.32)];
    const lowOut = V(0, 0, 0);
    const upOut = V(0, 0, 0);

    // Mounts and the diff housing never move: they belong to the merged shell.
    for (const p of [...lowIn, ...upIn]) shell.add(box(0.13, 0.13, 0.15, M.armorDark, p.x, p.y, p.z));
    shell.add(box(0.2, 0.14, 0.2, M.armorDark, top.x, top.y, top.z));
    if (CN.brace) {
      for (const dz of [-0.38, 0.38]) shell.add(tube([top.x, top.y, z], [s * CN.brace.x, CN.brace.y(z), z + dz], 0.035, M.metalDark));
    }
    shell.add(box(0.42, 0.3, 0.42, M.black, diff.x, diff.y, diff.z));

    return (L) => {
      lowOut.set(s * (1.22 + ox), -L - 0.1, z);
      upOut.set(s * (1.2 + ox), -L + 0.28, z);
      place(arms[0], lowIn[0], lowOut, 0.055);
      place(arms[1], lowIn[1], lowOut, 0.055);
      place(arms[2], upIn[0], upOut, 0.045);
      place(arms[3], upIn[1], upOut, 0.045);
      knuckle.position.set(s * (1.24 + ox), -L + 0.08, z);
      place(shaft, diff, V(s * (1.2 + ox), -L, z), 0.055);

      bot.set(s * (1.0 + ox), -L - 0.08, z);
      place(spring, pA.lerpVectors(bot, top, 0.06), pB.lerpVectors(top, bot, 0.06), 1);
      place(damper, bot, pA.lerpVectors(bot, top, 0.5), 0.055);
      place(piston, top, pA.lerpVectors(top, bot, 0.55), 0.032);
    };
  }

  // A box stretched between two points (like place() does for round tubes), so
  // structural arms can be square-section.
  const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
  function placeBox(m, a, b, w, d) {
    _d.subVectors(b, a);
    const len = _d.length();
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len || 1));
    m.scale.set(w, len, d);
  }
  // A round joint housing whose axle runs along z: dark drum, white cap, bolt ring.
  function jointDrum(g, x, y, z, r, len, s) {
    g.add(cyl(r, r, len, M.gGrey, x, y, z, 'z'));
    for (const e of [-1, 1]) {
      g.add(cyl(r * 0.78, r * 0.78, 0.04, M.gWhite, x, y, z + e * (len / 2 + 0.02), 'z'));
      g.add(cyl(r * 0.3, r * 0.3, 0.06, M.gGrey, x, y, z + e * (len / 2 + 0.05), 'z'));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.add(cyl(0.025, 0.025, 0.03, M.gSteel, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, z + e * (len / 2 + 0.05), 'z', 6));
      }
    }
    g.add(box(0.06, 0.05, 0.05, M.amber, x + s * r * 0.2, y + r * 0.95, z));
  }

  // Rigid two-bar linkage: given the two ends and the bar lengths, where the joint
  // between them sits — bent toward `bend` (a world direction), straight if the ends
  // are as far apart as the bars reach. Keeps metal parts from stretching.
  const _u = V(0, 0, 0);
  const _n = V(0, 0, 0);
  function elbow(out, A, B, la, lb, bend) {
    _u.subVectors(B, A);
    let d = _u.length();
    _u.divideScalar(d || 1);
    d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-3), la + lb - 1e-3);
    const along = (la * la - lb * lb + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, la * la - along * along));
    _n.copy(bend).addScaledVector(_u, -bend.dot(_u)).normalize();
    return out.copy(A).addScaledVector(_u, along).addScaledVector(_n, h);
  }
  // A hydraulic ram between two points: a barrel of fixed length from the base and a
  // rod of fixed length from the tip, so it telescopes instead of stretching.
  function ramParts(root) {
    const barrel = new THREE.Mesh(UNIT, M.black);
    const rodM = new THREE.Mesh(UNIT, M.gSteel);
    root.add(barrel, rodM);
    const t = V(0, 0, 0);
    let lb = 0;
    let lr = 0;
    return (base, tip) => {
      const d = base.distanceTo(tip);
      if (!lb) { lb = d * 0.62; lr = d * 0.62; }
      place(barrel, base, t.copy(base).lerp(tip, Math.min(1, lb / d)), 0.08);
      place(rodM, tip, t.copy(tip).lerp(base, Math.min(1, lr / d)), 0.042);
    };
  }
  function hubMotor(root, s) {
    const hub = new THREE.Group();
    hub.add(cyl(0.36, 0.36, 0.5, M.gGrey, 0, 0, 0, 'x'));
    hub.add(cyl(0.28, 0.28, 0.08, M.gWhite, -s * 0.28, 0, 0, 'x'));
    for (let k = 0; k < 4; k++) hub.add(box(0.06, 0.1, 0.5, M.gSteel, 0, Math.cos((k * Math.PI) / 2) * 0.36, Math.sin((k * Math.PI) / 2) * 0.36));
    root.add(hub);
    return hub;
  }
  const LEG_UP = V(0, 1, 0);

  // ГАЛАТЕЯ's front leg: a shoulder joint on the hull, an upper arm out to a knee, a
  // lower arm down to the hub motor. Both arms keep their length: as the wheel rises
  // and falls the knee folds and opens, and a ram from the hull follows the lower arm.
  function buildLeg(shellAll, rootAll, s, z, wx, my) {
    const shell = new THREE.Group();
    const root = new THREE.Group();
    shell.position.y = my;
    root.position.y = my;
    shellAll.add(shell);
    rootAll.add(root);
    const zs = z * 0.8; // the leg sweeps forward from a shoulder set back on the hull
    const S = V(s * 1.72, 0.5, zs);
    shell.add(box(0.3, 0.7, 0.9, M.gGrey, s * 1.5, 0.5, zs));
    jointDrum(shell, S.x, S.y, S.z, 0.4, 0.62, s);
    const ramTop = V(s * 1.5, 1.08, zs - Math.sign(z || 1) * 0.55);
    shell.add(box(0.22, 0.22, 0.22, M.gGrey, ramTop.x, ramTop.y, ramTop.z));

    const upper = new THREE.Mesh(UNIT_BOX, M.gWhite);
    const upperRib = new THREE.Mesh(UNIT_BOX, M.gGrey);
    const lower = new THREE.Mesh(UNIT_BOX, M.gWhite);
    const lowerRib = new THREE.Mesh(UNIT_BOX, M.gGrey);
    const knee = new THREE.Group();
    jointDrum(knee, 0, 0, 0, 0.3, 0.56, s);
    knee.add(box(0.05, 0.12, 0.3, M.hazard, s * 0.28, 0, 0));
    const hub = hubMotor(root, s);
    const lamp = box(0.12, 0.06, 0.14, M.amber, 0, 0, 0);
    root.add(upper, upperRib, lower, lowerRib, knee, lamp);
    const ram = ramParts(root);

    const halfW = TYRE_HALF_W * 1.05;
    const E = V(0, 0, 0);
    const K = V(0, 0, 0);
    const a = V(0, 0, 0);
    const b = V(0, 0, 0);
    const mid = V(0, 0, 0);
    // Bar lengths from the leg at its resting sag, knee raised over the line.
    const E0 = V(s * (wx - halfW - 0.3), -SUSP.Lstatic, z);
    const K0 = V(s * (1.72 + (Math.abs(E0.x) - 1.72) * 0.5), Math.max(S.y, E0.y) + 0.7, zs + (z - zs) * 0.5);
    const la = S.distanceTo(K0);
    const lb = K0.distanceTo(E0);
    return (L) => {
      E.set(s * (wx - halfW - 0.3), -L, z);
      hub.position.set(s * (wx - halfW - 0.05), -L, z);
      elbow(K, S, E, la, lb, LEG_UP);
      knee.position.copy(K);
      placeBox(upper, S, K, 0.4, 0.34);
      placeBox(upperRib, a.copy(S).setY(S.y + 0.19), b.copy(K).setY(K.y + 0.19), 0.2, 0.36);
      placeBox(lower, K, E, 0.36, 0.32);
      placeBox(lowerRib, a.copy(K).setY(K.y + 0.17), b.copy(E).setY(E.y + 0.17), 0.18, 0.34);
      lamp.position.lerpVectors(K, E, 0.5).y += 0.2;
      ram(ramTop, mid.lerpVectors(K, E, 0.55));
    };
  }

  // ГАЛАТЕЯ's middle and rear wheels on each side share one rocker beam, like a
  // planetary rover's bogie: two rigid arms meeting at a pivot, the pivot carried by
  // a telescopic pylon from a shoulder joint on the hull. The sim springs each wheel
  // on its own; the beam just follows both hubs (the middle wheel's corner records its
  // hub, the rear one, called right after, draws the whole bogie).
  const BOGIES = {};
  function buildBogie(shellAll, rootAll, s, z, wx, my, axle) {
    const side = BOGIES[s] || (BOGIES[s] = { first: V(0, 0, 0), z: [] });
    side.z[axle] = z;
    const shell = new THREE.Group();
    const root = new THREE.Group();
    shell.position.y = my;
    root.position.y = my;
    shellAll.add(shell);
    rootAll.add(root);
    const halfW = TYRE_HALF_W * 1.05;
    const hub = hubMotor(root, s);
    const E = V(0, 0, 0);
    const firstAxle = Math.min(...Object.keys(side.z).map(Number));

    if (axle === firstAxle) {
      return (L) => {
        E.set(s * (wx - halfW - 0.3), -L, z);
        hub.position.set(s * (wx - halfW - 0.05), -L, z);
        side.first.copy(E);
      };
    }

    const zc = (side.z[firstAxle] + z) / 2;
    const S = V(s * 1.72, 0.5, zc);
    shell.add(box(0.3, 0.75, 1.0, M.gGrey, s * 1.5, 0.5, zc));
    jointDrum(shell, S.x, S.y, S.z, 0.44, 0.66, s);
    const ramTop = V(s * 1.5, 1.1, zc + 0.75 * Math.sign(z - side.z[firstAxle]));
    shell.add(box(0.22, 0.22, 0.22, M.gGrey, ramTop.x, ramTop.y, ramTop.z));
    const sleeve = new THREE.Mesh(UNIT_BOX, M.gWhite);
    const sleeveRib = new THREE.Mesh(UNIT_BOX, M.gGrey);
    const slide = new THREE.Mesh(UNIT_BOX, M.gSteel);
    const armA = new THREE.Mesh(UNIT_BOX, M.gWhite);
    const armB = new THREE.Mesh(UNIT_BOX, M.gWhite);
    const ribA = new THREE.Mesh(UNIT_BOX, M.gGrey);
    const ribB = new THREE.Mesh(UNIT_BOX, M.gGrey);
    const pivot = new THREE.Group();
    jointDrum(pivot, 0, 0, 0, 0.36, 0.6, s);
    pivot.rotation.y = Math.PI / 2;
    const lamps = [box(0.12, 0.06, 0.14, M.amber, 0, 0, 0), box(0.12, 0.06, 0.14, M.amber, 0, 0, 0)];
    const chev = [0, 1].map(() => box(0.04, 0.12, 0.22, M.hazard, 0, 0, 0));
    root.add(sleeve, sleeveRib, slide, armA, armB, ribA, ribB, pivot, ...lamps, ...chev);
    const ram = ramParts(root);

    const C = V(0, 0, 0);
    const a = V(0, 0, 0);
    const b = V(0, 0, 0);
    const mid = V(0, 0, 0);
    const u = V(0, 0, 0);
    const up = (p, dy) => a.copy(p).setY(p.y + dy);
    // Arm lengths from the beam at rest: pivot 0.75 m over the middle of the hubs.
    const A0 = V(s * (wx - halfW - 0.3), -SUSP.Lstatic, side.z[firstAxle]);
    const B0 = V(s * (wx - halfW - 0.3), -SUSP.Lstatic, z);
    const C0 = V(0, 0, 0).lerpVectors(A0, B0, 0.5);
    C0.y += 0.75;
    C0.x = s * (Math.abs(C0.x) - 0.1);
    const la = A0.distanceTo(C0) + 0.12; // a little slack so the pair never locks straight
    const lb = B0.distanceTo(C0) + 0.12;
    const pyl = S.distanceTo(C0);
    return (L) => {
      E.set(s * (wx - halfW - 0.3), -L, z);
      hub.position.set(s * (wx - halfW - 0.05), -L, z);
      elbow(C, side.first, E, la, lb, LEG_UP);
      pivot.position.copy(C);
      placeBox(armA, side.first, C, 0.38, 0.34);
      placeBox(armB, C, E, 0.38, 0.34);
      placeBox(ribA, up(side.first, 0.18), b.copy(C).setY(C.y + 0.18), 0.18, 0.36);
      placeBox(ribB, up(C, 0.18), b.copy(E).setY(E.y + 0.18), 0.18, 0.36);
      // Telescopic pylon: a fixed-length sleeve from the shoulder, a steel slide from
      // the pivot back up into it.
      u.subVectors(C, S).normalize();
      placeBox(sleeve, S, b.copy(S).addScaledVector(u, pyl * 0.62), 0.46, 0.42);
      placeBox(sleeveRib, up(S, 0.22), b.copy(S).addScaledVector(u, pyl * 0.62).setY(b.y + 0.22), 0.22, 0.44);
      placeBox(slide, C, b.copy(C).addScaledVector(u, -pyl * 0.55), 0.3, 0.28);
      lamps[0].position.lerpVectors(side.first, C, 0.5).y += 0.22;
      lamps[1].position.lerpVectors(C, E, 0.5).y += 0.22;
      chev[0].position.copy(S).addScaledVector(u, pyl * 0.3).x += s * 0.24;
      chev[1].position.copy(S).addScaledVector(u, pyl * 0.45).x += s * 0.24;
      ram(ramTop, mid.copy(S).addScaledVector(u, pyl * 0.5));
    };
  }

  // Jet flame: an open cone pointing down its own -y, drawn additively with a hot
  // white-yellow core fading through orange to nothing at the tip, flickering with a
  // little travelling noise. `power` (0..1+) sets brightness; the mesh is scaled by
  // the caller for length.
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, power: { value: 0.6 } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vT = 1.0 - uv.y; // 0 at the nozzle, 1 at the tip
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float power;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      float h(float n) { return fract(sin(n) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = h(i.x + i.y * 57.0), b = h(i.x + 1.0 + i.y * 57.0), c = h(i.x + (i.y + 1.0) * 57.0), d = h(i.x + 1.0 + (i.y + 1.0) * 57.0);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float ang = atan(vP.x, vP.z);
        float n = noise(vec2(ang * 3.0, vT * 6.0 - time * 14.0)) * 0.6 + noise(vec2(ang * 7.0 + 3.0, vT * 13.0 - time * 23.0)) * 0.4;
        float body = (1.0 - smoothstep(0.05, 1.0, vT + (n - 0.5) * 0.3)) * smoothstep(0.0, 0.05, vT + 0.05);
        vec3 core = vec3(1.0, 0.95, 0.75);
        vec3 mid = vec3(1.0, 0.55, 0.12);
        vec3 tail = vec3(0.9, 0.18, 0.04);
        vec3 col = mix(core, mid, smoothstep(0.0, 0.18, vT));
        col = mix(col, tail, smoothstep(0.3, 0.8, vT));
        float a = body * edge * power * (0.75 + 0.5 * n);
        gl_FragColor = vec4(col * a * 1.9, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  NO_CAST.add(flameMat); // light, not matter: no shadow
  const FLAME_GEO = (() => {
    const g = new THREE.CylinderGeometry(1, 0.04, 1, 20, 6, true); // nozzle-wide top, a point at the tip
    g.translate(0, -0.5, 0); // top at the nozzle (y = 0), tip down at -1
    return g;
  })();
  // A flame on a nozzle at `at`, pointing along `dir` (a unit vector in the body).
  function flame(root, at, dir, radius) {
    const m = new THREE.Mesh(FLAME_GEO, flameMat);
    m.position.copy(at);
    m.quaternion.setFromUnitVectors(V(0, -1, 0), dir);
    m.renderOrder = 6;
    m.frustumCulled = false;
    m.userData.r = radius;
    root.add(m);
    return m;
  }

  // КОЛІБРІ, the hover glider: a boxy safety-yellow hull with a glass cockpit up
  // front, a ducted turbine slung on each side (its fan really turns), a tail wing and
  // fin, lift jets glowing underneath, and the clutter of a working machine — ladder,
  // hatch, hull number, hazard stripes, rivets, vents, exhaust stacks, aerials.
  function gliderBody(shell, root) {
    shell.add(loft([
      { z: -2.75, w: 1.9, yb: -0.45, yt: 0.7, rt: 0.2, rb: 0.2 },
      { z: -2.45, w: 2.3, yb: -0.62, yt: 1.05, rt: 0.25, rb: 0.22 },
      { z: 0.6, w: 2.45, yb: -0.72, yt: 1.18, rt: 0.28, rb: 0.24 },
      { z: 1.5, w: 2.4, yb: -0.72, yt: 1.0, rt: 0.28, rb: 0.24 },
      { z: 2.6, w: 2.1, yb: -0.62, yt: 0.32, rt: 0.3, rb: 0.24 },
      { z: 3.2, w: 1.6, yb: -0.48, yt: 0.0, rt: 0.28, rb: 0.2 },
    ], M.kYellow));
    // Gunmetal belly and chin, and the cockpit glass over the nose.
    shell.add(loft([
      { z: -2.5, w: 2.2, yb: -0.78, yt: -0.45, rt: 0.12, rb: 0.15 },
      { z: 2.7, w: 2.0, yb: -0.78, yt: -0.45, rt: 0.12, rb: 0.15 },
      { z: 3.3, w: 1.5, yb: -0.6, yt: -0.35, rt: 0.1, rb: 0.12 },
    ], M.kDark));
    shell.add(loft([
      { z: 1.35, w: 1.9, yb: 0.3, yt: 1.12, rt: 0.45, rb: 0.1 },
      { z: 2.3, w: 1.85, yb: 0.12, yt: 0.82, rt: 0.42, rb: 0.1 },
      { z: 2.95, w: 1.5, yb: -0.05, yt: 0.35, rt: 0.3, rb: 0.08 },
    ], M.glassDark));
    shell.add(box(1.95, 0.08, 0.1, M.kDark, 0, 1.12, 1.32)); // canopy frame
    for (const sd of [-1, 1]) shell.add(tube([sd * 0.93, 1.1, 1.35], [sd * 0.75, 0.4, 2.9], 0.03, M.kDark));
    // Seat and the stick inside the glass.
    shell.add(box(0.6, 0.12, 0.6, M.black, 0, 0.05, 1.6));
    shell.add(box(0.6, 0.7, 0.12, M.black, 0, 0.4, 1.3));

    // Side turbines: a yellow nacelle with dark bands, an intake grille at the front
    // with the fan behind it, an exhaust nozzle at the back.
    const fans = [];
    for (const sd of [-1, 1]) {
      const x = sd * 1.78;
      shell.add(cyl(0.6, 0.6, 2.4, M.kYellow, x, -0.12, -0.3, 'z', 24));
      for (const z of [-1.2, 0.2, 0.7]) shell.add(cyl(0.62, 0.62, 0.12, M.kDark, x, -0.12, z, 'z', 24));
      shell.add(cyl(0.64, 0.6, 0.18, M.kDark, x, -0.12, 0.98, 'z', 24)); // intake lip
      for (let k = -4; k <= 4; k++) shell.add(box(0.02, Math.sqrt(Math.max(0, 0.53 ** 2 - (k * 0.12) ** 2)) * 2, 0.03, M.gSteel, x + k * 0.12, -0.12, 1.08));
      shell.add(cyl(0.45, 0.32, 0.5, M.kDark, x, -0.12, -1.7, 'z', 20)); // nozzle
      shell.add(cyl(0.3, 0.3, 0.04, M.kJet, x, -0.12, -1.96, 'z', 20));
      shell.add(box(0.5, 0.25, 0.9, M.kDark, sd * 1.2, -0.1, -0.3)); // pylon to the hull
      for (let k = 0; k < 5; k++) shell.add(box(0.05, 0.12, 0.25, k % 2 ? M.black : M.hazard, x + sd * 0.58, 0.05, -0.9 + k * 0.25));
      const fan = new THREE.Group();
      fan.position.set(x, -0.12, 0.9);
      fan.add(cyl(0.16, 0.16, 0.2, M.kDark, 0, 0, 0, 'z', 12));
      for (let k = 0; k < 9; k++) {
        const blade = box(0.09, 0.5, 0.03, M.gSteel, 0, 0.27, 0);
        const arm = new THREE.Group();
        arm.rotation.z = (k / 9) * Math.PI * 2;
        blade.rotation.y = 0.5;
        arm.add(blade);
        fan.add(arm);
      }
      root.add(fan);
      fans.push(fan);
    }
    // The fans turn: spun from the clock each time they are drawn.
    fans[0].children[0].onBeforeRender = () => {
      const a = performance.now() * 0.02;
      fans[0].rotation.z = a;
      fans[1].rotation.z = -a;
    };

    // Lift jets under the belly, each with its flame; and the turbines' exhaust.
    const lift = [];
    for (const [x, z] of [[-0.6, -1.7], [0.6, -1.7], [-0.6, 1.6], [0.6, 1.6]]) {
      shell.add(cyl(0.3, 0.34, 0.12, M.kDark, x, -0.8, z));
      shell.add(cyl(0.22, 0.22, 0.02, M.kJet, x, -0.87, z));
      lift.push(flame(root, V(x, -0.88, z), V(0, -1, 0), 0.17));
    }
    const push = [-1, 1].map((sd) => flame(root, V(sd * 1.78, -0.12, -1.97), V(0, 0, -1), 0.27));
    // Tail: a swept fin and a stub wing with hazard-striped tips.
    const fin = box(0.12, 1.0, 1.0, M.kYellow, 0, 1.55, -2.3);
    fin.rotation.x = -0.45;
    shell.add(fin);
    shell.add(box(3.4, 0.08, 0.75, M.kYellow, 0, 1.12, -2.45));
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 4; k++) shell.add(box(0.12, 0.09, 0.76, k % 2 ? M.black : M.hazard, sd * (1.35 + k * 0.1), 1.12, -2.45));
      shell.add(box(0.06, 0.05, 0.05, sd > 0 ? M.amber : M.tail, sd * 1.7, 1.14, -2.1));
    }
    // Exhaust stacks along the back of the roof, curling aft.
    for (let k = 0; k < 4; k++) {
      for (const sd of [-1, 1]) {
        const x = sd * (0.35 + k * 0.17);
        shell.add(tube([x, 1.15, -1.0 - k * 0.22], [x, 1.42, -1.15 - k * 0.22], 0.045, M.gSteel));
        shell.add(tube([x, 1.42, -1.15 - k * 0.22], [x, 1.47, -1.4 - k * 0.22], 0.045, M.gSteel));
      }
    }
    // Left side: a ladder, a hatch outline with a handle and a window, the hull number
    // ring, a vent, warning plates. Right side gets a vent and plates too.
    for (const sd of [-1, 1]) {
      const x = sd * 1.235;
      if (sd > 0) {
        for (const dz of [-1.75, -1.4]) shell.add(box(0.04, 1.6, 0.04, M.gSteel, x + 0.12, 0.25, dz));
        for (let k = 0; k < 6; k++) shell.add(box(0.04, 0.035, 0.35, M.gSteel, x + 0.12, -0.42 + k * 0.27, -1.575));
        for (const [y, h] of [[0.98, 0.03], [-0.28, 0.03]]) shell.add(box(0.03, h, 1.0, M.kDark, x, y, 0.2));
        for (const z of [-0.3, 0.7]) shell.add(box(0.03, 1.29, 0.03, M.kDark, x, 0.35, z));
        shell.add(box(0.04, 0.05, 0.2, M.gSteel, x + 0.02, 0.35, 0.6));
        shell.add(box(0.035, 0.32, 0.36, M.glassDark, x, 0.65, 0.95));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 24), M.black);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(x + 0.02, 0.45, 0.2);
        shell.add(ring);
        shell.add(box(0.03, 0.26, 0.05, M.black, x + 0.02, 0.45, 0.1)); // «0»
        shell.add(box(0.03, 0.26, 0.05, M.black, x + 0.02, 0.45, 0.3)); // «5»
      }
      for (let k = 0; k < 6; k++) shell.add(box(0.03, 0.035, 0.5, M.black, x, 0.62 + k * 0.07, sd > 0 ? 1.55 : 0.4));
      shell.add(box(0.03, 0.14, 0.24, M.gWhite, x, 0.0, sd > 0 ? 1.2 : -0.6));
      shell.add(box(0.035, 0.05, 0.05, M.hazard, x, -0.2, sd > 0 ? 1.2 : -0.6));
      // Rivets along the top edge and the belly seam.
      for (let k = 0; k < 14; k++) {
        shell.add(cyl(0.022, 0.022, 0.02, M.gSteel, x + sd * 0.01, 1.02, -2.2 + k * 0.3, 'x', 6));
        shell.add(cyl(0.022, 0.022, 0.02, M.gSteel, x + sd * 0.01, -0.52, -2.2 + k * 0.3, 'x', 6));
      }
      shell.add(box(0.05, 0.05, 0.4, M.amber, sd * 1.24, -0.1, 2.3));
    }
    // Roof: a hatch, a sensor pod, two aerials, a beacon.
    shell.add(box(0.7, 0.05, 0.6, M.kDark, 0, 1.2, -0.2));
    shell.add(box(0.5, 0.06, 0.06, M.gSteel, 0, 1.24, -0.4));
    shell.add(cyl(0.16, 0.18, 0.2, M.kDark, -0.55, 1.28, 0.7));
    shell.add(mesh(new THREE.SphereGeometry(0.14, 12, 8), M.glassDark, -0.55, 1.4, 0.7));
    shell.add(tube([0.6, 1.18, 0.4], [0.75, 2.1, 0.2], 0.012, M.metalDark));
    shell.add(tube([-0.2, 1.18, -2.0], [-0.25, 2.3, -2.2], 0.012, M.metalDark));
    shell.add(cyl(0.07, 0.07, 0.08, M.amber, 0.2, 1.24, 0.9));
    // Nose: twin headlamps under the glass, amber marker strip, a tow eye.
    for (const sd of [-1, 1]) {
      shell.add(cyl(0.13, 0.12, 0.16, M.black, sd * 0.55, -0.15, 3.12, 'z'));
      shell.add(cyl(0.1, 0.1, 0.03, M.headlight, sd * 0.55, -0.15, 3.2, 'z'));
    }
    shell.add(box(0.9, 0.04, 0.03, M.amber, 0, -0.32, 3.22));
    shell.add(new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12), M.gSteel).translateZ(3.32).translateY(-0.5));
    // Tail lamps on the back face.
    for (const sd of [-1, 1]) shell.add(box(0.3, 0.1, 0.04, M.tail, sd * 0.6, 0.55, -2.77));

    const setPanels = buildPanels(root, { x: 0.85, y: 1.22, z: -0.9 });
    const yokePivot = new THREE.Group();
    yokePivot.position.set(0, 0.55, 1.95);
    yokePivot.rotation.x = -0.5;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), M.black));
    root.add(yokePivot);
    // lift 0..1+ (hover effort, more when climbing), thrust 0..1 (throttle).
    function setThrust(liftK, thrustK) {
      const t = performance.now() / 1000;
      flameMat.uniforms.time.value = t;
      flameMat.uniforms.power.value = 1;
      lift.forEach((m, i) => {
        const fl = 1 + 0.12 * Math.sin(t * 31 + i * 1.7) + 0.08 * Math.sin(t * 57 + i);
        const len = (2.2 + 2.8 * liftK) * fl;
        m.scale.set(m.userData.r, len, m.userData.r);
        m.visible = liftK > 0.02;
      });
      push.forEach((m, i) => {
        const fl = 1 + 0.1 * Math.sin(t * 27 + i * 2.3);
        const len = (0.3 + 3.2 * thrustK) * fl;
        m.scale.set(m.userData.r, len, m.userData.r);
        m.visible = thrustK > 0.03;
      });
    }

    return { yokePivot, setPanels, setThrust, tailLamps: [V(0.6, 0.55, -2.8), V(-0.6, 0.55, -2.8)] };
  }

  // ГАЛАТЕЯ: an off-white oval hull with a gunmetal command module up front, glowing
  // hex-grid panels, and the small kit that makes a machine read as real — seams,
  // hatches, a sensor dome, vents, cables, status lights.
  function galateaBody(shellOuter, root) {
    // Authored with the module at +z, then turned round: the oval nose leads and the
    // gunmetal module (with its bogie wheels under it) is the tail.
    const shell = new THREE.Group();
    shell.rotation.y = Math.PI;
    shellOuter.add(shell);
    shell.add(loft([
      { z: -4.25, w: 2.0, yb: 0.3, yt: 1.0, rt: 0.45, rb: 0.3 },
      { z: -4.0, w: 2.8, yb: 0.08, yt: 1.3, rt: 0.55, rb: 0.35 },
      { z: -3.4, w: 3.15, yb: 0.0, yt: 1.45, rt: 0.6, rb: 0.35 },
      { z: -1.0, w: 3.25, yb: 0.0, yt: 1.5, rt: 0.62, rb: 0.35 },
      { z: 1.6, w: 3.25, yb: 0.0, yt: 1.5, rt: 0.62, rb: 0.35 },
      { z: 2.5, w: 3.15, yb: 0.0, yt: 1.45, rt: 0.6, rb: 0.35 },
    ], M.gWhite));
    // Command module: a gunmetal block over the nose.
    shell.add(loft([
      { z: 2.3, w: 3.05, yb: -0.02, yt: 1.38, rt: 0.22, rb: 0.2 },
      { z: 4.35, w: 3.05, yb: -0.02, yt: 1.3, rt: 0.22, rb: 0.2 },
      { z: 4.7, w: 2.75, yb: 0.08, yt: 1.08, rt: 0.2, rb: 0.18 },
    ], M.gGrey));
    shell.add(box(2.4, 0.1, 7.6, M.black, 0, -0.04, -0.6)); // belly pan

    // Glowing hex-grid panels: two slanted on top of the module, one each side.
    const panel = (w, d, x, y, z, rx, rz = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.set(rx, 0, rz);
      g.add(box(w + 0.08, 0.05, d + 0.08, M.black, 0, -0.02, 0));
      g.add(box(w, 0.05, d, M.gPanel, 0, 0.01, 0));
      for (let i = 1; i < 4; i++) g.add(box(w, 0.06, 0.012, M.black, 0, 0.012, -d / 2 + (i * d) / 4));
      for (let i = 1; i < 3; i++) g.add(box(0.012, 0.06, d, M.black, -w / 2 + (i * w) / 3, 0.012, 0));
      for (let i = 0; i < 4; i++) g.add(box(Math.hypot(w, d) * 0.9, 0.06, 0.01, M.black, 0, 0.012, 0).rotateY(0.6 + i * 0.12));
      shell.add(g);
    };
    for (const sd of [-1, 1]) {
      panel(1.05, 1.1, sd * 0.68, 1.38, 3.55, -0.2);
      panel(0.95, 0.75, sd * 1.54, 0.78, 3.55, 0, -sd * Math.PI / 2);
    }
    // Round dials between the panels, and a sliding pod on each shoulder.
    for (const z of [2.75, 4.25]) {
      shell.add(cyl(0.24, 0.27, 0.16, M.gGrey, 0, 1.42, z));
      shell.add(cyl(0.18, 0.18, 0.04, M.gSteel, 0, 1.51, z));
      shell.add(box(0.08, 0.06, 0.3, M.black, 0, 1.54, z));
    }
    for (const sd of [-1, 1]) {
      shell.add(box(0.36, 0.22, 0.7, M.gGrey, sd * 1.2, 1.46, 2.75));
      shell.add(box(0.06, 0.08, 0.3, M.tail, sd * 1.2, 1.58, 2.8));
    }
    // Front face: a pair of round camera eyes, lamps under them, grille slots, bumper.
    for (const sd of [-1, 1]) {
      shell.add(cyl(0.24, 0.24, 0.24, M.black, sd * 0.3, 0.72, 4.7, 'z'));
      shell.add(new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.035, 8, 22), M.gWhite).translateX(sd * 0.3).translateY(0.72).translateZ(4.83));
      shell.add(cyl(0.12, 0.12, 0.03, M.glassDark, sd * 0.3, 0.72, 4.83, 'z'));
      shell.add(cyl(0.05, 0.05, 0.02, M.teal, sd * 0.3, 0.72, 4.85, 'z'));
      shell.add(cyl(0.13, 0.13, 0.1, M.black, sd * 0.62, 0.42, 4.72, 'z'));
      shell.add(cyl(0.1, 0.1, 0.03, M.tail, sd * 0.62, 0.42, 4.78, 'z'));
      shell.add(cyl(0.13, 0.13, 0.1, M.black, sd * 0.95, 0.42, 4.68, 'z'));
      shell.add(cyl(0.1, 0.1, 0.03, M.tail, sd * 0.95, 0.42, 4.74, 'z'));
      for (let k = 0; k < 3; k++) shell.add(box(0.06, 0.06, 0.04, M.amber, sd * (0.62 + k * 0.16), 0.95, 4.72));
    }
    for (let k = 0; k < 5; k++) shell.add(box(1.2, 0.04, 0.05, M.black, 0, 0.12 + k * 0.08, 4.73));
    shell.add(box(2.9, 0.22, 0.3, M.black, 0, -0.06, 4.75));
    // A plate with the hull number on the module side: a white tag and dark text bars.
    for (const sd of [-1, 1]) {
      shell.add(box(0.03, 0.26, 0.8, M.gWhite, sd * 1.535, 0.3, 3.0));
      for (let k = 0; k < 3; k++) shell.add(box(0.035, 0.04, 0.5 - k * 0.12, M.black, sd * 1.54, 0.38 - k * 0.08, 3.0));
    }
    // Work lamps along the back of the module roof.
    shell.add(box(1.7, 0.12, 0.18, M.black, 0, 1.47, 3.32));
    shell.add(box(1.5, 0.07, 0.03, M.amber, 0, 1.47, 3.42));
    // Long-range light bar up on the nose.
    shell.add(box(1.8, 0.14, 0.2, M.black, 0, 1.5, -3.2));
    shell.add(box(1.6, 0.08, 0.03, M.headlight, 0, 1.5, -3.31));
    for (const sd of [-1, 1]) shell.add(tube([sd * 0.8, 1.42, -3.1], [sd * 0.8, 1.5, -3.2], 0.03, M.metalDark));

    // Hull seams: thin dark lines across the roof and down the flanks.
    for (const z of [-3.0, -1.9, -0.6, 0.7, 1.9]) shell.add(box(2.4, 0.015, 0.025, M.gGrey, 0, 1.505, z));
    for (const x of [-0.75, 0.75]) shell.add(box(0.025, 0.015, 5.0, M.gGrey, x, 1.505, -0.55));
    for (const sd of [-1, 1]) {
      shell.add(box(0.02, 0.03, 6.2, M.gGrey, sd * 1.626, 0.62, -0.9));
      shell.add(box(0.02, 0.03, 3.4, M.gGrey, sd * 1.626, 1.05, -0.4));
      for (const z of [-3.2, -1.6, 0.2, 1.8]) shell.add(box(0.02, 0.9, 0.025, M.gGrey, sd * 1.626, 0.62, z));
      // A row of small inset service plates low along each side.
      for (let k = 0; k < 6; k++) shell.add(box(0.03, 0.18, 0.34, k % 2 ? M.gGrey : M.black, sd * 1.63, 0.3, -2.9 + k * 0.85));
      // The X-braced vent slot behind the module.
      shell.add(box(0.05, 0.36, 1.5, M.black, sd * 1.61, 1.02, 1.55));
      for (const r of [-1, 1]) shell.add(box(0.06, 0.04, 1.6, M.gSteel, sd * 1.635, 1.02, 1.55).rotateX(r * 0.22));
      // Grab handles, red status dots, a little hazard tab.
      shell.add(tube([sd * 1.66, 0.85, -1.9], [sd * 1.66, 0.85, -1.3], 0.025, M.gSteel));
      for (let k = 0; k < 4; k++) shell.add(box(0.03, 0.04, 0.04, k ? M.tail : M.teal, sd * 1.63, 1.18, -2.6 + k * 0.12));
      shell.add(box(0.03, 0.12, 0.3, M.hazard, sd * 1.63, 0.95, -3.4));
      // Cables running back from the module along the shoulder.
      shell.add(tube([sd * 1.38, 1.36, 2.25], [sd * 1.45, 1.3, 0.5], 0.035, M.black));
      shell.add(tube([sd * 1.45, 1.3, 0.5], [sd * 1.5, 1.2, -1.2], 0.035, M.black));
    }
    // Roof: a row of three hatches (one hazard-striped), a round hatch, a sensor dome
    // with two whip antennas, a beacon at the back.
    for (let k = 0; k < 3; k++) {
      shell.add(box(0.62, 0.05, 0.55, M.gGrey, -0.2 + k * 0.7 - 0.5, 1.52, 1.2));
      shell.add(box(0.5, 0.06, 0.06, M.black, -0.2 + k * 0.7 - 0.5, 1.53, 1.0));
    }
    shell.add(box(0.62, 0.055, 0.2, M.hazard, 0.9, 1.53, 1.2));
    shell.add(cyl(0.34, 0.34, 0.06, M.gGrey, -0.7, 1.52, -0.3));
    const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24), M.gSteel);
    hatchRing.rotation.x = Math.PI / 2;
    hatchRing.position.set(-0.7, 1.55, -0.3);
    shell.add(hatchRing);
    shell.add(box(0.36, 0.07, 0.06, M.gSteel, -0.7, 1.57, -0.3));
    shell.add(cyl(0.16, 0.2, 0.18, M.gGrey, 0.35, 1.58, 0.3));
    shell.add(mesh(new THREE.SphereGeometry(0.22, 16, 10), M.gSteel, 0.35, 1.78, 0.3));
    shell.add(cyl(0.08, 0.08, 0.04, M.glassDark, 0.35, 1.78, 0.5, 'z'));
    for (const x of [0.05, 0.65]) {
      shell.add(cyl(0.05, 0.06, 0.1, M.black, x, 1.55, 0.75));
      shell.add(tube([x, 1.55, 0.75], [x, 2.6, 0.75], 0.012, M.metalDark));
      shell.add(mesh(new THREE.SphereGeometry(0.03, 6, 4), M.tail, x, 2.62, 0.75));
    }
    shell.add(cyl(0.12, 0.14, 0.2, M.gGrey, 0, 1.36, -3.95));
    shell.add(cyl(0.08, 0.08, 0.08, M.amber, 0, 1.5, -3.95));
    // Nose: twin headlamp pods each side, amber running lights, a bumper bar.
    for (const sd of [-1, 1]) {
      for (const dx of [0.62, 0.95]) {
        shell.add(cyl(0.15, 0.13, 0.24, M.black, sd * dx, 0.62, -4.16, 'z'));
        shell.add(cyl(0.12, 0.12, 0.03, M.headlight, sd * dx, 0.62, -4.29, 'z'));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 20), M.gSteel);
        ring.position.set(sd * dx, 0.62, -4.3);
        shell.add(ring);
      }
      shell.add(box(0.14, 0.08, 0.05, M.amber, sd * 0.4, 0.62, -4.24));
    }
    shell.add(box(2.4, 0.2, 0.25, M.black, 0, 0.18, -4.25));
    // A little ladder up the back of the module.
    for (const sd of [-1, 1]) shell.add(box(0.04, 0.9, 0.04, M.gSteel, 1.12 + sd * 0.22, 0.6, 4.8));
    for (let k = 0; k < 4; k++) shell.add(box(0.44, 0.035, 0.04, M.gSteel, 1.12, 0.25 + k * 0.22, 4.8));

    const setPanels = buildPanels(root, { x: 1.0, y: 1.53, z: 1.1 });
    const yokePivot = new THREE.Group();
    yokePivot.position.set(0.45, 0.9, -3.4);
    root.add(yokePivot);
    return { yokePivot, setPanels, tailLamps: [V(0.62, 0.42, -4.8), V(-0.62, 0.42, -4.8)] };
  }

  // ---------- pilots ----------

  function buildPilot(x, suit) {
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    g.add(mesh(new THREE.CapsuleGeometry(0.18, 0.28, 6, 10), suit, 0, 0.5, 0.95));
    g.add(mesh(new THREE.SphereGeometry(0.19, 16, 12), M.suit, 0, 0.98, 0.98));
    g.add(
      mesh(new THREE.SphereGeometry(0.195, 16, 10, Math.PI / 2 - 0.9, 1.8, Math.PI * 0.3, Math.PI * 0.36), M.visor, 0, 0.98, 0.98)
    );
    for (const dx of [-0.1, 0.1]) {
      g.add(mesh(new THREE.CapsuleGeometry(0.09, 0.34, 4, 6), suit, dx, 0.32, 1.24).rotateX(Math.PI / 2));
      g.add(cyl(0.08, 0.08, 0.26, suit, dx, 0.24, 1.52));
    }
    return g;
  }

  // Fold-out solar wings on the rear deck. Two hinged segments per side: stowed they
  // lie folded flat on the deck, deployed they swing out into one long wing.
  const PANEL_L = 1.25;
  const PANEL_D = 1.9;
  const panelGeo = new THREE.BoxGeometry(PANEL_L, 0.05, PANEL_D);

  function buildPanels(root, at = { x: 1.28, y: 1.41, z: -2.05 }) {
    const hinges = [];
    for (const s of [-1, 1]) {
      // Inner segment hinges at the deck edge; the sides sit at slightly different
      // heights so they nest instead of z-fighting when folded.
      const inner = new THREE.Group();
      inner.position.set(s * at.x, at.y + (s > 0 ? 0 : 0.14), at.z);
      root.add(inner);
      inner.add(mesh(panelGeo, M.solar, (s * PANEL_L) / 2, 0, 0));
      inner.add(box(0.06, 0.09, PANEL_D * 0.92, M.panelBack, s * 0.06, -0.06, 0));

      const outer = new THREE.Group();
      outer.position.set(s * PANEL_L, 0.07, 0); // stacks above the inner when folded
      inner.add(outer);
      outer.add(mesh(panelGeo, M.solar, (s * PANEL_L) / 2, 0, 0));
      outer.add(box(0.05, 0.07, PANEL_D * 0.9, M.panelBack, s * 0.05, -0.05, 0));

      hinges.push({ s, inner, outer });
    }

    // t = 0 stowed, 1 fully deployed.
    return (t) => {
      const e = t * t * (3 - 2 * t);
      for (const { s, inner, outer } of hinges) {
        // Folded: inner lies flat pointing inboard, outer folds back on top of it.
        inner.rotation.z = s * (1 - e) * Math.PI;
        outer.rotation.z = -s * (1 - e) * Math.PI;
        inner.rotation.x = e * 0.12; // slight tilt toward the sky once open
      }
    };
  }

  // The crawler's array: nine panels in a 3×3 grid that open in two stages. First the
  // two side wings flip out from on top of the centre panel; then, from all three of
  // those, a leaf swings out fore and aft. Folded it is one low pack on the cage roof.
  const ARR_W = 1.3; // wing width; the centre panel is two of these
  const ARR_D = 1.9;
  function buildArray(root, at) {
    const panel = (w) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(w, 0.04, ARR_D), M.solar, 0, 0, 0));
      g.add(box(w * 0.94, 0.05, 0.06, M.panelBack, 0, -0.035, 0));
      g.add(box(0.06, 0.05, ARR_D * 0.94, M.panelBack, 0, -0.035, 0));
      return g;
    };
    const leaves = [];
    // Fore and aft leaves on a panel of width w centred at x. They fold back over the
    // panel's own face, at two heights so the pair nests instead of intersecting.
    function addLeaves(parent, w, x) {
      for (const d of [1, -1]) {
        const hinge = new THREE.Group();
        hinge.position.set(x, d > 0 ? 0.05 : 0.1, (d * ARR_D) / 2);
        const leaf = panel(w - 0.04);
        leaf.position.z = (d * ARR_D) / 2;
        hinge.add(leaf);
        hinge.add(box(w * 0.9, 0.04, 0.05, M.metalDark, 0, -0.02, 0)); // hinge barrel
        parent.add(hinge);
        leaves.push({ hinge, d });
      }
    }

    const base = new THREE.Group();
    base.position.set(0, at.y, at.z);
    root.add(base);
    base.add(panel(ARR_W * 2));
    addLeaves(base, ARR_W * 2, 0);

    // Wings hinge on short posts at the centre panel's edges, high enough to fold over
    // the centre panel's own folded leaves.
    const WING_Y = 0.3;
    const wings = [];
    for (const s of [-1, 1]) {
      base.add(box(0.08, WING_Y, 0.08, M.metalDark, s * ARR_W, WING_Y / 2, ARR_D * 0.4));
      base.add(box(0.08, WING_Y, 0.08, M.metalDark, s * ARR_W, WING_Y / 2, -ARR_D * 0.4));
      const hinge = new THREE.Group();
      hinge.position.set(s * ARR_W, WING_Y, 0);
      base.add(hinge);
      const wing = panel(ARR_W - 0.04);
      wing.position.x = (s * ARR_W) / 2;
      hinge.add(wing);
      addLeaves(hinge, ARR_W - 0.04, (s * ARR_W) / 2);
      wings.push({ s, hinge });
    }

    const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
    return (t) => {
      const e1 = ease(t / 0.5); // wings
      const e2 = ease((t - 0.5) / 0.5); // then the leaves
      // Folded, each wing lies upside down over its own half of the centre panel.
      for (const { s, hinge } of wings) hinge.rotation.z = s * (1 - e1) * Math.PI;
      // Leaves swing up and over the top: +z leaves turn negative about x, -z positive.
      for (const { hinge, d } of leaves) hinge.rotation.x = -d * (1 - e2) * Math.PI;
      base.rotation.x = e2 * 0.06; // a slight tilt to the sky once fully open
    };
  }

  // The speedster's array lives under the floor: a stack of three panels on each
  // side, between the axles. Opening, each stack first slides out sideways from under
  // the sill like a drawer, rising as it clears the body, then the stack spreads —
  // the lower panels running out past the top one — into a wide strip either side.
  const DR_L = 2.5;
  const DR_W = 0.7;
  function buildDrawer(root, at) {
    const geo = new THREE.BoxGeometry(DR_W, 0.03, DR_L);
    const blades = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        g.add(mesh(geo, M.solar, 0, 0, 0));
        g.add(box(DR_W * 0.94, 0.03, 0.05, M.panelBack, 0, -0.025, DR_L * 0.47));
        g.add(box(DR_W * 0.94, 0.03, 0.05, M.panelBack, 0, -0.025, -DR_L * 0.47));
        g.add(box(0.04, 0.035, DR_L, M.orange, s * DR_W * 0.5, 0, 0)); // outer edge trim
        root.add(g);
        blades.push({ s, i, g });
      }
    }
    const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
    return (t) => {
      const out = ease(t / 0.45); // the whole stack slides out
      const spread = ease((t - 0.4) / 0.6); // then fans apart sideways
      for (const { s, i, g } of blades) {
        const x = at.xIn + out * (at.xOut - at.xIn) + spread * i * (DR_W + 0.03);
        const y = at.yIn - i * 0.035 + out * (at.yOut - at.yIn) + spread * i * 0.035;
        g.position.set(s * x, y, at.z);
        g.rotation.z = -s * 0.06 * spread; // tipped a touch outward, toward the sky
        g.visible = t > 0.001 || i === 0; // stowed, only the bottom plate shows under the floor
      }
    };
  }

  // A wheel-arch band in the ZY plane, extruded across x.
  function fenderProfile(z0) {
    return [
      [z0 - 1.32, -0.05], [z0 - 1.24, 0.42], [z0 - 0.72, 0.76], [z0 + 0.72, 0.76],
      [z0 + 1.24, 0.42], [z0 + 1.32, -0.05], [z0 + 1.06, -0.05], [z0 + 0.99, 0.35],
      [z0 + 0.58, 0.6], [z0 - 0.58, 0.6], [z0 - 0.99, 0.35], [z0 - 1.06, -0.05],
    ];
  }

  // ---------- bodies ----------

  // ГЕРМЕС-3, the four-wheel scout: long low wedge, greenhouse cab, armoured box aft.
  function truckBody(shell, root) {
    // Exposed chassis spine and skid plate, visible between the wheels.
    shell.add(box(1.5, 0.5, 5.4, M.black, 0, -0.2, 0));
    shell.add(box(2.5, 0.12, 4.6, M.armorDark, 0, -0.52, 0.1));
    for (const s of [-1, 1]) shell.add(box(0.16, 0.3, 4.4, M.metalDark, s * 1.2, -0.34, 0.1));

    // Main hull: one long low wedge, nose down at +Z.
    shell.add(
      extrude(
        [
          [3.9, 0.05], [3.62, 0.5], [2.35, 0.74], [0.6, 0.82], [-2.55, 0.85],
          [-3.58, 0.58], [-3.62, -0.42], [2.85, -0.48], [3.72, -0.22],
        ],
        HULL_W,
        M.armor
      )
    );
    shell.add(extrude([[2.2, 0.8], [-2.5, 0.83], [-2.5, 0.72], [2.2, 0.7]], HULL_W - 0.5, M.armorLit));

    // Angular fender flares; the tyres rise past them as in the reference.
    for (const s of [-1, 1]) {
      for (const z of SPEC.axleZ) {
        shell.add(extrude(fenderProfile(z), 0.46, M.armorDark, 0.05, s * (HULL_W / 2 + 0.18), 0, 0));
      }
      // Sill runner with a glowing strip underneath.
      shell.add(box(0.22, 0.16, 3.0, M.armorDark, s * (HULL_W / 2 + 0.05), -0.36, 0.1));
      shell.add(box(0.1, 0.04, 2.6, M.amber, s * (HULL_W / 2 + 0.12), -0.44, 0.1));
    }

    // Nose: sharp wedge, recessed light bar, skid bumper and winch.
    shell.add(box(2.6, 0.3, 0.14, M.black, 0, 0.36, 3.7));
    for (const s of [-1, 1]) shell.add(box(0.95, 0.075, 0.08, M.headlight, s * 0.6, 0.37, 3.78));
    shell.add(box(0.26, 0.05, 0.07, M.amber, 0, 0.37, 3.78));
    for (const s of [-1, 1]) {
      shell.add(box(0.2, 0.07, 0.07, M.amber, s * 1.33, 0.26, 3.66));
      shell.add(box(0.12, 0.09, 0.06, M.amber, s * 1.6, -0.08, 3.3));
      shell.add(box(0.26, 0.5, 0.5, M.armorDark, s * 1.42, 0.12, 3.35));
    }
    shell.add(box(2.7, 0.3, 0.34, M.armorDark, 0, -0.26, 3.62));
    shell.add(box(1.0, 0.26, 0.26, M.metalDark, 0, -0.24, 3.78));
    shell.add(cyl(0.11, 0.11, 0.9, M.metal, 0, -0.24, 3.8, 'x'));

    // Cab: dark armoured greenhouse with a slit windscreen.
    shell.add(extrude([[2.3, 0.8], [1.98, 1.24], [0.15, 1.28], [-0.3, 0.82]], 2.55, M.glass, 0.04));
    shell.add(extrude([[2.05, 1.3], [0.1, 1.34], [0.1, 1.2], [2.05, 1.16]], 2.75, M.armorLit, 0.05));
    for (const s of [-1, 1]) {
      shell.add(tube([s * 1.3, 1.26, 0.2], [s * 1.35, 0.82, -0.28], 0.08, M.armor));
      shell.add(tube([s * 1.3, 1.26, 1.95], [s * 1.38, 0.82, 2.3], 0.08, M.armor));
      shell.add(box(0.06, 0.46, 2.1, M.armor, s * 1.29, 1.04, 1.05));
      shell.add(box(0.05, 0.05, 1.9, M.amberDim, s * 1.33, 1.2, 1.05));
    }
    shell.add(box(1.15, 0.055, 0.09, M.headlight, 0, 1.35, 1.92));

    // Rear: raised armoured box with a round port, stacks and tail bar.
    shell.add(extrude([[-0.55, 0.85], [-1.0, 1.34], [-3.1, 1.36], [-3.56, 1.02], [-3.58, 0.85]], 2.9, M.armor));
    shell.add(extrude([[-1.1, 1.38], [-3.05, 1.4], [-3.05, 1.28], [-1.1, 1.26]], 2.5, M.armorLit, 0.05));
    for (const s of [-1, 1]) {
      shell.add(cyl(0.3, 0.3, 0.12, M.armorDark, s * 1.46, 1.08, -2.2, 'x'));
      shell.add(cyl(0.21, 0.21, 0.06, M.glass, s * 1.53, 1.08, -2.2, 'x'));
      shell.add(cyl(0.12, 0.12, 0.7, M.metalDark, s * 1.0, 1.25, -3.2));
      shell.add(cyl(0.13, 0.13, 0.08, M.black, s * 1.0, 1.6, -3.2));
      shell.add(box(0.6, 0.12, 0.06, M.tail, s * 0.95, 0.5, -3.66));
      shell.add(box(0.1, 0.06, 0.05, M.amber, s * 1.5, 0.2, -3.6));
    }
    shell.add(box(2.6, 0.32, 0.34, M.armorDark, 0, -0.22, -3.66));
    shell.add(box(0.9, 0.5, 0.12, M.armorDark, 0, 0.55, -3.64));

    // Roof gear: sensor pod, rails, antennas.
    shell.add(box(0.8, 0.2, 0.5, M.black, -0.6, 1.5, -1.3));
    shell.add(box(0.22, 0.07, 0.12, M.amber, -0.6, 1.5, -1.07));
    for (const s of [-1, 1]) shell.add(box(0.08, 0.1, 2.0, M.metalDark, s * 0.95, 1.46, -2.1));
    for (const [x, z, hh] of [[1.2, -3.0, 0.9], [-1.2, -3.05, 0.7]]) {
      shell.add(tube([x, 1.3, z], [x, 1.3 + hh, z], 0.025, M.metalDark));
    }

    // Panel lines and markings along the flanks.
    for (const s of [-1, 1]) {
      const x = s * (HULL_W / 2 + 0.015);
      shell.add(box(0.02, 0.05, 2.4, M.armorDark, x, 0.34, -0.4));
      shell.add(box(0.02, 0.52, 0.04, M.armorDark, x, 0.3, 0.9));
      shell.add(box(0.02, 0.52, 0.04, M.armorDark, x, 0.3, -1.7));
      shell.add(box(0.02, 0.3, 0.55, M.black, x, 0.1, -2.7));
      shell.add(box(0.02, 0.1, 0.34, M.amberDim, x, 0.62, 1.45));
    }

    // Interior: dash, seats, two pilots. The yoke turns, so it stays separate.
    shell.add(box(2.3, 0.26, 0.4, M.black, 0, 0.5, 2.1));
    for (const x of [-0.6, 0.6]) {
      shell.add(box(0.42, 0.02, 0.22, M.screen, x, 0.64, 2.05));
      shell.add(box(0.56, 0.12, 0.56, M.black, x, 0.36, 1.15));
      shell.add(box(0.56, 0.7, 0.1, M.black, x, 0.72, 0.8));
    }
    shell.add(buildPilot(0.6, M.suitOrange));
    shell.add(buildPilot(-0.6, M.suit));
    shell.add(tube([0.6, 0.56, 2.0], [0.6, 0.8, 1.68], 0.028, M.black));

    const setPanels = buildPanels(root);

    const yokePivot = new THREE.Group();
    yokePivot.position.set(0.6, 0.82, 1.62);
    yokePivot.rotation.x = -0.45;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 8, 20), M.black));
    root.add(yokePivot);

    return { yokePivot, setPanels, tailLamps: [V(0.95, 0.5, -3.66), V(-0.95, 0.5, -3.66)] };
  }

  // ---------- sculpted shapes (crawler) ----------

  // A rounded rectangle in the XY plane, counter-clockwise seen from +z. Top and bottom
  // corners take separate radii; every section has the same point count so they loft.
  function rrect(w, yb, yt, rt, rb = rt, seg = 5) {
    const hw = w / 2;
    const h = yt - yb;
    rt = Math.min(rt, hw, h / 2);
    rb = Math.min(rb, hw, h / 2);
    const corners = [
      [hw - rb, yb + rb, rb, -Math.PI / 2],
      [hw - rt, yt - rt, rt, 0],
      [-hw + rt, yt - rt, rt, Math.PI / 2],
      [-hw + rb, yb + rb, rb, Math.PI],
    ];
    const pts = [];
    for (const [cx, cy, r, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    }
    return pts;
  }

  // Skin a run of rounded sections (ascending z) into one smooth hull, capped flat at
  // both ends. This is what takes the crawler off the box: noses taper, roofs roll
  // over, edges catch a highlight instead of ending in a hard corner.
  function loft(list, mat, smooth = false) {
    const S = list.map((q) => q.pts || rrect(q.w, q.yb, q.yt, q.rt, q.rb ?? q.rt));
    const n = S[0].length;
    const pos = [];
    list.forEach((q, k) => { for (const [x, y] of S[k]) pos.push(x, y, q.z); });
    const idx = [];
    for (let k = 0; k < list.length - 1; k++) {
      for (let i = 0; i < n; i++) {
        const a = k * n + i;
        const b = k * n + ((i + 1) % n);
        const c = a + n;
        const d = b + n;
        idx.push(a, b, c, b, d, c);
      }
    }
    let skin = new THREE.BufferGeometry();
    skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    skin.setIndex(idx);
    // Faceted (hex) sections shade flat, so every chamfer reads as a crisp plane;
    // rounded ones keep smooth normals. `smooth` keeps a faceted shape soft-shaded —
    // the speedster looks better with its planes melting into each other.
    if (list[0].pts && !smooth) skin = skin.toNonIndexed();
    skin.computeVertexNormals();

    const cap = [];
    for (const [k, dir] of [[0, -1], [list.length - 1, 1]]) {
      const P = S[k];
      const z = list[k].z;
      let cx = 0;
      let cy = 0;
      for (const [x, y] of P) { cx += x / n; cy += y / n; }
      for (let i = 0; i < n; i++) {
        const [x0, y0] = P[i];
        const [x1, y1] = P[(i + 1) % n];
        if (dir > 0) cap.push(cx, cy, z, x0, y0, z, x1, y1, z);
        else cap.push(cx, cy, z, x1, y1, z, x0, y0, z);
      }
    }
    const caps = new THREE.BufferGeometry();
    caps.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
    caps.computeVertexNormals();

    const g = new THREE.Group();
    g.add(new THREE.Mesh(skin, mat), new THREE.Mesh(caps, mat));
    return g;
  }

  // A faceted section: a hard-edged hexagon, widths at bottom / shoulder / top. Loft
  // these for slab-sided armour with chamfered edges instead of rolled ones.
  const hex = (wb, yb, wm, ym, wt, yt) => [
    [wb / 2, yb], [wm / 2, ym], [wt / 2, yt], [-wt / 2, yt], [-wm / 2, ym], [-wb / 2, yb],
  ];

  // A rounded bar of constant section between z0 and z1, ends eased in.
  const bar = (w, yb, yt, r, z0, z1, mat, x = 0, ease = 0.08) => {
    const g = loft([
      { z: z0, w: w - ease * 2, yb: yb + ease, yt: yt - ease, rt: r },
      { z: z0 + ease, w, yb, yt, rt: r },
      { z: z1 - ease, w, yb, yt, rt: r },
      { z: z1, w: w - ease * 2, yb: yb + ease, yt: yt - ease, rt: r },
    ], mat);
    g.position.x = x;
    return g;
  };

  // A bent tube through the given points (smooth, not kinked).
  function bentTube(points, r, mat) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)), false, 'centripetal');
    return new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 12, r, 8, false), mat);
  }

  // ТИТАН-6, the six-wheel crawler: a narrow, tapered armoured tub slung between the
  // wheels so all six fat tyres stand bare, with no arches over them; a rounded
  // cab-over with a raked screen up front; an open deck under a bent-tube cage aft,
  // with the solar array folded on the cage roof.
  function crawlerBody(shell, root) {
    const D = 0.6; // deck height

    // Tub: tapered, chamfered nose and tail, rounded bilge. The tyres start 1.43 m out.
    shell.add(loft([
      { z: -4.7, w: 2.1, yb: -0.2, yt: 0.46, rt: 0.16, rb: 0.2 },
      { z: -4.45, w: 2.46, yb: -0.46, yt: D, rt: 0.2, rb: 0.32 },
      { z: 3.9, w: 2.5, yb: -0.5, yt: D, rt: 0.2, rb: 0.32 },
      { z: 4.45, w: 2.3, yb: -0.28, yt: D - 0.02, rt: 0.2, rb: 0.3 },
      { z: 4.72, w: 1.86, yb: 0.02, yt: 0.52, rt: 0.2, rb: 0.2 },
    ], M.armor));
    shell.add(box(2.0, 0.1, 8.0, M.armorDark, 0, -0.56, 0));
    for (const s of [-1, 1]) shell.add(box(0.18, 0.3, 8.8, M.metalDark, s * 1.08, -0.34, 0));
    for (const z of [-4.1, -1.7, 1.7, 4.1]) shell.add(box(2.3, 0.14, 0.18, M.black, 0, -0.44, z));

    for (const s of [-1, 1]) {
      // Rounded lockers and marker strips in the gaps between the wheels.
      for (const z of [-1.67, 1.67]) {
        shell.add(bar(0.24, -0.1, 0.5, 0.08, z - 0.5, z + 0.5, M.armorDark, s * 1.28));
        shell.add(box(0.02, 0.4, 0.03, M.black, s * 1.41, 0.2, z));
        shell.add(box(0.05, 0.05, 0.8, M.amber, s * 1.41, -0.16, z));
      }
    }

    // Cab-over: armoured lower half, then a glass bubble with a raked screen under a
    // rolled armour roof. The glass is a hull of its own so the crew show through it.
    shell.add(loft([
      { z: 1.5, w: 2.78, yb: D - 0.05, yt: 1.12, rt: 0.12, rb: 0.05 },
      { z: 4.15, w: 2.78, yb: D - 0.05, yt: 1.12, rt: 0.12, rb: 0.05 },
      { z: 4.62, w: 2.2, yb: D - 0.05, yt: 1.02, rt: 0.2, rb: 0.05 },
    ], M.armor));
    shell.add(loft([
      { z: 1.58, w: 2.6, yb: 1.08, yt: 1.86, rt: 0.42, rb: 0.02 },
      { z: 3.6, w: 2.58, yb: 1.08, yt: 1.84, rt: 0.42, rb: 0.02 },
      { z: 4.05, w: 2.42, yb: 1.08, yt: 1.66, rt: 0.36, rb: 0.02 },
      { z: 4.4, w: 2.2, yb: 1.08, yt: 1.14, rt: 0.03, rb: 0.02 },
    ], M.glass));
    shell.add(loft([
      { z: 1.45, w: 2.7, yb: 1.6, yt: 1.94, rt: 0.45, rb: 0.04 },
      { z: 3.45, w: 2.68, yb: 1.6, yt: 1.92, rt: 0.45, rb: 0.04 },
      { z: 3.78, w: 2.5, yb: 1.6, yt: 1.84, rt: 0.38, rb: 0.04 },
    ], M.armorLit));
    shell.add(loft([
      { z: 1.44, w: 2.66, yb: 1.08, yt: 1.9, rt: 0.44, rb: 0.03 },
      { z: 1.56, w: 2.66, yb: 1.08, yt: 1.9, rt: 0.44, rb: 0.03 },
    ], M.armor));
    for (const s of [-1, 1]) {
      shell.add(bentTube([[s * 1.1, 1.1, 4.42], [s * 1.2, 1.5, 4.18], [s * 1.28, 1.78, 3.72]], 0.06, M.armor));
      shell.add(box(0.05, 0.04, 2.3, M.amberDim, s * 1.4, 1.1, 2.95));
      // Mirrors on stalks.
      shell.add(bentTube([[s * 1.3, 1.4, 4.1], [s * 1.6, 1.5, 4.2], [s * 1.78, 1.52, 4.18]], 0.025, M.metalDark));
      shell.add(bar(0.07, 1.36, 1.72, 0.03, 4.08, 4.3, M.black, s * 1.8, 0.02));
    }
    // Roof light bar (the long-range beam lives in it, see mounts.far).
    shell.add(bar(2.2, 1.9, 2.06, 0.07, 3.28, 3.5, M.black, 0, 0.03));
    shell.add(box(1.9, 0.06, 0.04, M.headlight, 0, 1.97, 3.52));
    for (const s of [-1, 1]) shell.add(box(0.12, 0.1, 0.05, M.amber, s * 1.02, 1.97, 3.52));
    // Sensor mast with a round head.
    shell.add(tube([-0.9, 1.9, 2.0], [-0.9, 2.62, 2.0], 0.04, M.metalDark));
    shell.add(cyl(0.2, 0.2, 0.24, M.black, -0.9, 2.72, 2.0, 'x'));
    shell.add(cyl(0.12, 0.12, 0.26, M.glass, -0.9, 2.72, 2.02, 'x'));
    shell.add(tube([0.9, 1.9, 1.9], [0.9, 2.9, 1.9], 0.02, M.metalDark));

    // Nose: rolled bumper, winch, round lamps in pods.
    shell.add(loft([
      { z: 4.5, w: 3.0, yb: -0.34, yt: 0.06, rt: 0.16 },
      { z: 4.82, w: 3.0, yb: -0.34, yt: 0.06, rt: 0.16 },
      { z: 4.98, w: 2.6, yb: -0.3, yt: 0.0, rt: 0.14 },
    ], M.armorDark));
    shell.add(cyl(0.13, 0.13, 0.95, M.metal, 0, -0.14, 5.02, 'x'));
    for (const s of [-1, 1]) {
      shell.add(cyl(0.2, 0.22, 0.2, M.black, s * 1.0, 0.32, 4.6, 'z'));
      shell.add(cyl(0.16, 0.16, 0.04, M.headlight, s * 1.0, 0.32, 4.7, 'z'));
      shell.add(cyl(0.05, 0.05, 0.04, M.amber, s * 1.36, 0.1, 4.95, 'z'));
      shell.add(bentTube([[s * 1.35, -0.14, 4.9], [s * 1.34, 0.3, 4.72], [s * 1.2, 0.56, 4.5]], 0.05, M.metalDark));
    }

    // Interior.
    shell.add(box(2.3, 0.24, 0.36, M.black, 0, 0.94, 3.9));
    for (const x of [-0.55, 0.55]) {
      shell.add(box(0.42, 0.02, 0.22, M.screen, x, 1.07, 3.85));
      shell.add(box(0.56, 0.12, 0.56, M.black, x, 0.71, 2.7));
      shell.add(box(0.56, 0.7, 0.1, M.black, x, 1.07, 2.35));
    }
    for (const [x, suit] of [[0.55, M.suitOrange], [-0.55, M.suit]]) {
      const pilot = buildPilot(x, suit);
      pilot.position.y += 0.35;
      pilot.position.z += 1.55;
      shell.add(pilot);
    }
    shell.add(tube([0.55, 0.98, 3.8], [0.55, 1.15, 3.28], 0.028, M.black));

    // Cargo deck with rolled edge rails, and a bent-tube cage: three hoops that round
    // over at the shoulders, tied by rails that sit on those shoulders.
    shell.add(box(2.9, 0.08, 5.9, M.armorLit, 0, D, -1.5));
    for (let i = 0; i < 7; i++) shell.add(box(2.8, 0.03, 0.05, M.armorDark, 0, D + 0.05, -4.2 + i * 0.85));
    for (const s of [-1, 1]) shell.add(tube([s * 1.45, D + 0.08, 1.4], [s * 1.45, D + 0.08, -4.4], 0.06, M.metalDark));
    const cy = 1.8;
    const hoop = (z) => bentTube([
      [-1.35, D, z], [-1.35, cy - 0.35, z], [-1.22, cy - 0.08, z], [-0.95, cy, z],
      [0.95, cy, z], [1.22, cy - 0.08, z], [1.35, cy - 0.35, z], [1.35, D, z],
    ], 0.06, M.metalDark);
    for (const z of [1.4, -1.5, -4.35]) shell.add(hoop(z));
    for (const s of [-1, 1]) {
      shell.add(tube([s * 1.24, cy - 0.06, 1.4], [s * 1.24, cy - 0.06, -4.35], 0.055, M.metalDark));
      shell.add(tube([s * 1.35, D + 0.1, 0.9], [s * 1.3, cy - 0.3, -1.5], 0.04, M.metalDark));
    }

    // Load: rounded crates, a capsule fuel cell lying lengthwise, a spare at the tail.
    shell.add(bar(0.95, D, D + 0.72, 0.08, 0.08, 1.02, M.armorDark, 0.62, 0.03));
    shell.add(bar(0.95, D, D + 0.52, 0.08, -0.98, -0.04, M.panelBack, 0.62, 0.03));
    shell.add(box(0.96, 0.05, 0.9, M.amberDim, 0.62, D + 0.5, 0.55));
    const tank = mesh(new THREE.CapsuleGeometry(0.36, 1.5, 6, 16), M.metal, -0.72, D + 0.41, -1.2);
    tank.rotation.x = Math.PI / 2;
    shell.add(tank);
    for (const z of [-0.6, -1.8]) shell.add(cyl(0.38, 0.38, 0.08, M.armorDark, -0.72, D + 0.41, z, 'z'));
    const spare = mesh(new THREE.TorusGeometry(0.46, 0.2, 12, 28), M.tire, 0, D + 0.68, -3.95);
    shell.add(spare);
    shell.add(cyl(0.3, 0.3, 0.3, M.rim, 0, D + 0.68, -3.95, 'z'));

    // Tail: rolled panel and bumper.
    shell.add(loft([
      { z: -4.66, w: 2.9, yb: 0.12, yt: 0.64, rt: 0.12 },
      { z: -4.54, w: 2.9, yb: 0.12, yt: 0.64, rt: 0.12 },
    ], M.armor));
    shell.add(loft([
      { z: -4.9, w: 2.6, yb: -0.36, yt: -0.02, rt: 0.14 },
      { z: -4.78, w: 3.0, yb: -0.38, yt: 0.02, rt: 0.16 },
      { z: -4.45, w: 3.0, yb: -0.38, yt: 0.02, rt: 0.16 },
    ], M.armorDark));
    for (const s of [-1, 1]) {
      shell.add(box(0.6, 0.12, 0.05, M.tail, s * 1.0, 0.45, -4.68));
      shell.add(cyl(0.05, 0.05, 0.04, M.amber, s * 1.4, 0.24, -4.68, 'z'));
      shell.add(bentTube([[s * 1.35, D, -4.35], [s * 1.33, 0.2, -4.6], [s * 1.2, -0.18, -4.7]], 0.05, M.metalDark));
    }

    const setPanels = buildArray(root, { y: cy + 0.1, z: -1.45 });

    const yokePivot = new THREE.Group();
    yokePivot.position.set(0.55, 1.17, 3.17);
    yokePivot.rotation.x = -0.45;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 8, 20), M.black));
    root.add(yokePivot);

    return { yokePivot, setPanels, tailLamps: [V(1.0, 0.45, -4.68), V(-1.0, 0.45, -4.68)] };
  }

  // АТЛАС-8, the eight-wheel transporter: a tall, pale, slab-sided armour body with
  // chamfered edges, sitting over the wheels on a narrow black tub; a forward cab
  // with a big raked screen under an armour brow; the solar array on the long roof.
  function haulerBody(shell, root) {
    // Running gear tub between the wheels — narrower up front, where both steered
    // axles swing their tyres inboard.
    shell.add(loft([
      { z: -6.05, w: 2.1, yb: -0.3, yt: 0.95, rt: 0.12, rb: 0.2 },
      { z: -5.8, w: 2.5, yb: -0.6, yt: 1.0, rt: 0.12, rb: 0.28 },
      { z: 0.4, w: 2.5, yb: -0.6, yt: 1.0, rt: 0.12, rb: 0.28 },
      { z: 1.2, w: 1.9, yb: -0.58, yt: 1.0, rt: 0.12, rb: 0.24 },
      { z: 5.6, w: 1.9, yb: -0.5, yt: 1.0, rt: 0.12, rb: 0.24 },
      { z: 5.95, w: 1.7, yb: -0.1, yt: 0.95, rt: 0.12, rb: 0.2 },
    ], M.hullDark));
    for (const s of [-1, 1]) shell.add(box(0.16, 0.26, 11.2, M.metalDark, s * 0.8, -0.5, -0.2));
    for (const z of [-4.05, -0.4, 3.35]) shell.add(box(2.2, 0.12, 0.2, M.black, 0, -0.56, z));

    // Main armour body, from the tail to the back of the cab.
    shell.add(loft([
      { z: -6.35, pts: hex(3.1, 1.12, 3.4, 1.8, 2.6, 2.28) },
      { z: -6.1, pts: hex(3.75, 0.95, 3.95, 1.95, 3.2, 2.5) },
      { z: 2.5, pts: hex(3.75, 0.95, 3.95, 1.95, 3.2, 2.5) },
    ], M.hull));
    // Upper deck plate a shade lighter, so the roof reads apart from the flanks.
    shell.add(box(3.1, 0.04, 8.4, M.hullLit, 0, 2.51, -1.8));

    // Cab: armour lower half, a glass canopy with a raked screen, an armour brow.
    shell.add(loft([
      { z: 2.4, pts: hex(3.75, 0.9, 3.95, 1.3, 3.85, 1.6) },
      { z: 5.15, pts: hex(3.75, 0.9, 3.95, 1.3, 3.85, 1.6) },
      { z: 5.85, pts: hex(3.3, 0.72, 3.5, 1.05, 3.4, 1.52) },
      { z: 6.15, pts: hex(2.7, 0.8, 2.85, 1.0, 2.75, 1.36) },
    ], M.hull));
    shell.add(loft([
      { z: 2.5, pts: hex(3.7, 1.55, 3.72, 2.2, 3.2, 2.66) },
      { z: 4.0, pts: hex(3.7, 1.55, 3.72, 2.2, 3.2, 2.66) },
      { z: 5.0, pts: hex(3.62, 1.55, 3.5, 2.0, 2.9, 2.24) },
      { z: 5.8, pts: hex(3.34, 1.5, 3.24, 1.6, 2.7, 1.64) },
    ], M.glass));
    shell.add(loft([
      { z: 2.4, pts: hex(3.3, 2.58, 3.7, 2.7, 3.0, 2.92) },
      { z: 4.3, pts: hex(3.3, 2.58, 3.7, 2.7, 3.0, 2.92) },
      { z: 4.8, pts: hex(2.9, 2.46, 3.2, 2.52, 2.5, 2.66) },
    ], M.hullLit));
    for (const s of [-1, 1]) {
      // A-pillars and a door frame, so the canopy reads as a cab, not a bubble.
      shell.add(bentTube([[s * 1.66, 1.56, 5.82], [s * 1.74, 2.12, 4.9], [s * 1.62, 2.64, 4.1]], 0.06, M.hullDark));
      shell.add(tube([s * 1.86, 1.58, 3.3], [s * 1.84, 2.4, 3.3], 0.05, M.hullDark));
      shell.add(tube([s * 1.86, 1.58, 2.5], [s * 1.84, 2.6, 2.5], 0.06, M.hullDark));
      // Mirrors.
      shell.add(bentTube([[s * 1.8, 1.9, 5.0], [s * 2.1, 2.0, 5.2], [s * 2.3, 2.0, 5.2]], 0.025, M.metalDark));
      shell.add(bar(0.08, 1.8, 2.2, 0.03, 5.1, 5.34, M.black, s * 2.32, 0.02));
    }
    shell.add(tube([0, 1.58, 5.8], [0, 2.22, 4.95], 0.035, M.hullDark));

    // Flanks: orange trim line, panel seams, hatches, amber markers.
    for (const s of [-1, 1]) {
      const x = s * 1.985;
      shell.add(box(0.03, 0.07, 12.2, M.trim, x, 1.28, -0.1));
      for (const z of [-4.4, -1.4, 1.2]) shell.add(box(0.02, 0.9, 0.03, M.black, x, 1.55, z));
      shell.add(box(0.02, 0.03, 8.5, M.black, x, 1.92, -1.9));
      shell.add(box(0.03, 0.55, 0.9, M.hullLit, x, 1.6, -2.9));
      shell.add(box(0.035, 0.08, 0.35, M.hullDark, x, 1.6, -2.65));
      for (const z of [-5.6, -2.0, 1.6]) shell.add(box(0.04, 0.08, 0.3, M.amber, x, 1.05, z));
      // Side ladder and grab rail at the back.
      shell.add(tube([s * 2.0, 1.1, -5.4], [s * 2.0, 2.5, -5.4], 0.03, M.metalDark));
      shell.add(tube([s * 2.0, 1.1, -5.0], [s * 2.0, 2.5, -5.0], 0.03, M.metalDark));
      for (let i = 0; i < 5; i++) shell.add(tube([s * 2.0, 1.2 + i * 0.3, -5.4], [s * 2.0, 1.2 + i * 0.3, -5.0], 0.02, M.metalDark));
    }

    // Roof: rails, equipment boxes, the cab light bar with amber pods, masts.
    for (const s of [-1, 1]) shell.add(tube([s * 1.55, 2.62, 2.2], [s * 1.55, 2.62, -6.0], 0.035, M.metalDark));
    shell.add(bar(1.1, 2.5, 2.95, 0.06, -6.0, -4.6, M.hullDark, 0.9, 0.04));
    shell.add(bar(0.8, 2.5, 2.8, 0.06, -6.0, -5.0, M.hull, -0.9, 0.04));
    shell.add(bar(2.6, 2.9, 3.06, 0.06, 4.0, 4.24, M.black, 0, 0.03));
    shell.add(box(2.2, 0.06, 0.04, M.headlight, 0, 2.98, 4.26));
    for (const s of [-1, 1]) {
      shell.add(box(0.22, 0.16, 0.18, M.black, s * 1.45, 3.0, 4.12));
      shell.add(box(0.16, 0.1, 0.04, M.amber, s * 1.45, 3.0, 4.22));
    }
    shell.add(tube([-1.2, 2.92, 2.8], [-1.2, 3.9, 2.8], 0.02, M.metalDark));
    shell.add(tube([1.2, 2.92, 2.6], [1.2, 3.6, 2.6], 0.025, M.metalDark));
    shell.add(cyl(0.16, 0.16, 0.2, M.black, 1.2, 3.66, 2.6, 'x'));

    // Nose: dark bumper with hazard chevrons, lamps set in the lower cab face, winch.
    shell.add(loft([
      { z: 5.6, w: 3.4, yb: 0.1, yt: 0.62, rt: 0.08 },
      { z: 6.25, w: 3.4, yb: 0.1, yt: 0.62, rt: 0.08 },
      { z: 6.4, w: 3.0, yb: 0.16, yt: 0.56, rt: 0.06 },
    ], M.hullDark));
    for (let i = 0; i < 6; i++) {
      const x = -1.25 + i * 0.5;
      const stripe = box(0.16, 0.36, 0.03, i % 2 ? M.black : M.hazard, x, 0.36, 6.41);
      stripe.rotation.z = 0.6;
      shell.add(stripe);
    }
    shell.add(cyl(0.12, 0.12, 0.8, M.metal, 0, 0.36, 6.43, 'x'));
    for (const s of [-1, 1]) {
      shell.add(box(0.7, 0.2, 0.06, M.black, s * 1.25, 1.05, 6.0));
      shell.add(box(0.6, 0.12, 0.04, M.headlight, s * 1.25, 1.05, 6.03));
      shell.add(box(0.2, 0.08, 0.04, M.amber, s * 1.55, 0.86, 5.95));
    }
    shell.add(box(1.4, 0.04, 0.04, M.trim, 0, 1.3, 6.1));

    // Interior: dash, screens, seats, crew.
    shell.add(box(3.1, 0.26, 0.4, M.black, 0, 1.72, 5.05));
    for (const x of [-0.7, 0.7]) {
      shell.add(box(0.5, 0.02, 0.24, M.screen, x, 1.86, 5.0));
      shell.add(box(0.6, 0.14, 0.6, M.black, x, 1.72, 3.9));
      shell.add(box(0.6, 0.8, 0.1, M.black, x, 2.1, 3.55));
    }
    for (const [x, suit] of [[0.7, M.suitOrange], [-0.7, M.suit]]) {
      const pilot = buildPilot(x, suit);
      pilot.position.y += 1.36;
      pilot.position.z += 2.75;
      shell.add(pilot);
    }

    // Tail: lamps in a dark band, a rear door, bumper.
    shell.add(box(3.2, 0.3, 0.06, M.hullDark, 0, 1.5, -6.38));
    shell.add(box(1.3, 0.9, 0.05, M.hullLit, 0, 1.75, -6.36));
    shell.add(box(3.4, 0.36, 0.3, M.hullDark, 0, 0.9, -6.3));
    for (const s of [-1, 1]) {
      shell.add(box(0.55, 0.12, 0.04, M.tail, s * 1.2, 1.5, -6.42));
      shell.add(box(0.12, 0.12, 0.04, M.amber, s * 1.6, 1.5, -6.42));
    }

    const setPanels = buildArray(root, { y: 2.62, z: -2.3 });

    const yokePivot = new THREE.Group();
    yokePivot.position.set(0.7, 2.05, 4.65);
    yokePivot.rotation.x = -0.5;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20), M.black));
    root.add(yokePivot);

    return { yokePivot, setPanels, tailLamps: [V(1.2, 1.5, -6.42), V(-1.2, 1.5, -6.42)] };
  }

  // КОЙОТ, the buggy: a narrow faceted copper wedge riding high between big tyres on
  // long arms, a dark glass canopy over the nose, a teal light line under it.
  function buggyBody(shell, root) {
    shell.add(loft([
      { z: -3.35, pts: hex(1.7, -0.1, 2.0, 0.5, 1.6, 0.85) },
      { z: -2.6, pts: hex(2.1, -0.3, 2.5, 0.6, 2.0, 1.0) },
      { z: -0.6, pts: hex(2.2, -0.35, 2.6, 0.6, 2.1, 1.05) },
      { z: 1.0, pts: hex(2.2, -0.3, 2.5, 0.5, 1.9, 0.75) },
      { z: 2.6, pts: hex(2.0, -0.2, 2.3, 0.35, 1.7, 0.55) },
      { z: 3.35, pts: hex(1.4, 0.0, 1.6, 0.25, 1.2, 0.35) },
    ], M.copper));
    // Canopy: dark glass from the roof line down over the nose.
    shell.add(loft([
      { z: -0.4, pts: hex(1.9, 0.6, 1.9, 0.9, 1.4, 1.1) },
      { z: 0.6, pts: hex(1.9, 0.5, 1.85, 0.85, 1.35, 1.02) },
      { z: 1.8, pts: hex(1.8, 0.4, 1.7, 0.62, 1.2, 0.72) },
      { z: 2.7, pts: hex(1.5, 0.34, 1.4, 0.44, 1.0, 0.48) },
    ], M.glassDark));
    // Belly pan, rear vents, door seams, fins on the rear deck.
    shell.add(box(1.6, 0.1, 5.8, M.hullDark, 0, -0.38, -0.1));
    for (const x of [-0.5, 0.5]) shell.add(box(0.5, 0.08, 0.9, M.hullDark, x, 1.07, -2.2));
    for (const s of [-1, 1]) {
      shell.add(box(0.02, 0.6, 0.03, M.copperDark, s * 1.3, 0.35, -0.3));
      shell.add(box(0.02, 0.03, 2.0, M.copperDark, s * 1.28, 0.62, -1.4));
      shell.add(box(0.3, 0.12, 0.6, M.copperDark, s * 1.05, 0.95, -0.9));
      shell.add(box(0.05, 0.06, 0.3, M.amber, s * 1.1, 0.35, 2.7));
    }
    shell.add(box(1.8, 0.04, 0.03, M.teal, 0, 0.3, 2.85));
    for (const s of [-1, 1]) {
      // Round lamp pods standing proud of the nose on short brackets, so you can see
      // where the light comes from — flush strips just vanished into the copper.
      for (const dx of [0, 0.34]) {
        const x = s * (0.58 + dx);
        shell.add(cyl(0.15, 0.13, 0.26, M.black, x, 0.2, 3.4, 'z'));
        shell.add(cyl(0.12, 0.12, 0.03, M.headlight, x, 0.2, 3.53, 'z'));
        shell.add(new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 6, 20), M.metal).translateX(x).translateY(0.2).translateZ(3.54));
      }
      shell.add(box(0.5, 0.05, 0.2, M.metalDark, s * 0.75, 0.04, 3.36));
      shell.add(box(0.5, 0.1, 0.04, M.tail, s * 0.72, 0.62, -3.37));
    }
    // Exposed drivetrain under the tail: motor cans and a cross-member.
    for (const s of [-1, 1]) shell.add(cyl(0.22, 0.22, 0.5, M.metalDark, s * 0.5, -0.45, -2.5, 'x'));
    shell.add(box(2.2, 0.12, 0.16, M.black, 0, -0.3, -3.2));
    shell.add(box(2.0, 0.12, 0.16, M.black, 0, -0.25, 3.1));

    // Crew under the canopy.
    shell.add(box(1.6, 0.18, 0.3, M.black, 0, 0.62, 1.7));
    for (const [x, suit] of [[0.45, M.suitOrange], [-0.45, M.suit]]) {
      shell.add(box(0.5, 0.1, 0.5, M.black, x, 0.3, 0.4));
      const pilot = buildPilot(x, suit);
      pilot.position.y -= 0.12;
      pilot.position.z -= 0.25;
      shell.add(pilot);
    }

    // Long-range light bar on two struts above the roof, behind the canopy — the
    // beam used to come out of the cabin itself, from between the crew's helmets.
    for (const s of [-1, 1]) shell.add(tube([s * 0.7, 1.02, -0.62], [s * 0.7, 1.4, -0.46], 0.03, M.metalDark));
    shell.add(bar(1.7, 1.36, 1.54, 0.05, -0.56, -0.36, M.black, 0, 0.03));
    shell.add(box(1.5, 0.08, 0.03, M.headlight, 0, 1.46, -0.35));
    for (const s of [-1, 1]) shell.add(box(0.1, 0.08, 0.03, M.amber, s * 0.8, 1.46, -0.35));

    const setPanels = buildPanels(root, { x: 1.0, y: 1.1, z: -1.8 });

    const yokePivot = new THREE.Group();
    yokePivot.position.set(0.45, 0.72, 1.35);
    yokePivot.rotation.x = -0.6;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), M.black));
    root.add(yokePivot);

    return { yokePivot, setPanels, tailLamps: [V(0.72, 0.62, -3.4), V(-0.72, 0.62, -3.4)] };
  }

  // СТРІЛА, the speedster: a low graphite monocoque over orange side pods, open
  // wheels, a single-seat glass canopy, a spine running back to a rear wing.
  function speedsterBody(shell, root) {
    const sections = [
      { z: -3.35, pts: hex(1.5, -0.8, 1.6, -0.2, 1.2, 0.1) },
      { z: -1.6, pts: hex(1.8, -0.9, 1.9, -0.1, 1.5, 0.35) },
      { z: -1.2, pts: hex(2.4, -0.95, 2.7, -0.1, 2.0, 0.45) },
      { z: 1.3, pts: hex(2.3, -0.95, 2.6, -0.2, 1.9, 0.35) },
      { z: 1.6, pts: hex(1.8, -0.95, 1.9, -0.3, 1.5, 0.1) },
      { z: 2.9, pts: hex(1.7, -0.95, 1.8, -0.4, 1.4, -0.1) },
      { z: 3.6, pts: hex(1.2, -0.85, 1.3, -0.6, 1.0, -0.45) },
    ];
    shell.add(loft(sections, M.graphite, true));
    // Orange side pods: a skin over the lower flanks, a touch proud of the grey.
    shell.add(loft([
      { z: -1.15, pts: hex(2.44, -0.93, 2.74, -0.35, 2.7, -0.3) },
      { z: 1.25, pts: hex(2.34, -0.93, 2.64, -0.45, 2.6, -0.4) },
      { z: 2.8, pts: hex(1.74, -0.93, 1.84, -0.55, 1.8, -0.5) },
    ], M.orange, true));
    // Canopy.
    shell.add(loft([
      { z: -0.4, pts: hex(1.5, 0.3, 1.4, 0.8, 0.8, 0.98) },
      { z: 0.8, pts: hex(1.5, 0.25, 1.4, 0.72, 0.8, 0.9) },
      { z: 1.8, pts: hex(1.4, 0.05, 1.3, 0.35, 0.8, 0.45) },
      { z: 2.6, pts: hex(1.2, -0.1, 1.1, 0.0, 0.7, 0.02) },
    ], M.glass, true));
    // Spine from the canopy back to the wing, and the wing on two struts.
    shell.add(loft([
      { z: -3.0, pts: hex(0.5, 0.3, 0.5, 0.62, 0.3, 0.7) },
      { z: -0.5, pts: hex(0.6, 0.4, 0.6, 0.9, 0.35, 1.02) },
      { z: -0.2, pts: hex(0.5, 0.5, 0.5, 0.95, 0.3, 1.0) },
    ], M.graphite, true));
    for (const s of [-1, 1]) shell.add(box(0.06, 0.5, 0.3, M.black, s * 0.8, 0.55, -3.2));
    shell.add(box(2.3, 0.06, 0.55, M.graphite, 0, 0.85, -3.3));
    shell.add(box(2.3, 0.03, 0.05, M.orange, 0, 0.9, -3.03));
    for (const s of [-1, 1]) shell.add(box(0.05, 0.3, 0.6, M.graphite, s * 1.15, 0.8, -3.3));
    // Splitter, lime running lights, headlamp slits, air intakes on the pods.
    shell.add(box(1.8, 0.05, 1.0, M.black, 0, -0.97, 3.3));
    for (const s of [-1, 1]) {
      shell.add(box(0.5, 0.06, 0.05, M.headlight, s * 0.5, -0.5, 3.58));
      shell.add(box(0.05, 0.05, 0.4, M.lime, s * 1.34, -0.7, 0.6));
      shell.add(box(0.04, 0.3, 0.9, M.hullDark, s * 1.36, -0.25, -0.4));
      for (let i = 0; i < 3; i++) shell.add(box(0.05, 0.02, 0.8, M.black, s * 1.38, -0.35 + i * 0.1, -0.4));
      shell.add(box(0.5, 0.06, 0.04, M.tail, s * 0.7, 0.8, -3.58));
    }
    // Exposed rear mechanicals: motor, radiators, cross-brace.
    shell.add(cyl(0.28, 0.28, 0.9, M.metalDark, 0, -0.4, -2.6, 'x'));
    for (const s of [-1, 1]) shell.add(box(0.4, 0.5, 0.12, M.hullDark, s * 0.6, 0.05, -2.3));
    shell.add(box(1.8, 0.1, 0.12, M.black, 0, -0.6, -3.35));

    // Long-range lamp pod on the nose of the spine, ahead of the solar pack.
    shell.add(bar(0.56, 1.06, 1.26, 0.06, -0.42, -0.2, M.black, 0, 0.03));
    shell.add(box(0.44, 0.08, 0.03, M.headlight, 0, 1.16, -0.19));

    // Cockpit: dash with a screen.
    shell.add(box(1.0, 0.16, 0.3, M.black, 0, 0.18, 1.55));
    shell.add(box(0.2, 0.02, 0.14, M.screen, 0, 0.27, 1.52));
    // No driver: the canopy is too low for a seated crew figure. An empty bucket
    // seat and headrest read right through the glass instead.
    shell.add(box(0.55, 0.12, 0.6, M.black, 0, -0.45, 0.55));
    shell.add(box(0.55, 0.62, 0.12, M.black, 0, -0.12, 0.2));
    shell.add(box(0.3, 0.2, 0.1, M.black, 0, 0.3, 0.18));

    const setPanels = buildDrawer(root, { xIn: 0.42, xOut: 1.82, yIn: -0.99, yOut: -0.68, z: 0.05 });

    const yokePivot = new THREE.Group();
    yokePivot.position.set(0, 0.3, 1.25);
    yokePivot.rotation.x = -0.9;
    yokePivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 20), M.black));
    root.add(yokePivot);

    return { yokePivot, setPanels, tailLamps: [V(0.7, 0.8, -3.6), V(-0.7, 0.8, -3.6)] };
  }

  // ---------- vehicle ----------

  function buildVehicle() {
    const root = new THREE.Group();
    const shell = new THREE.Group(); // static body, merged at the end
    const { yokePivot, setPanels, tailLamps, setThrust = () => {} } = ({ truck: truckBody, crawler: crawlerBody, hauler: haulerBody, buggy: buggyBody, speedster: speedsterBody, galatea: galateaBody, glider: gliderBody }[CHASSIS])(shell, root);

    // Wheels + suspension, one corner per entry in the shared wheel table.
    const wheels = WHEEL_DEFS.map((d) => {
      const setCorner = SPEC.legs
        ? (d.axle === 0 ? buildLeg(shell, root, d.s, d.z, Math.abs(d.x), d.my) : buildBogie(shell, root, d.s, d.z, Math.abs(d.x), d.my, d.axle))
        : buildCorner(shell, root, d.s, d.z, Math.abs(d.x), d.my);
      const hub = new THREE.Group();
      const steer = new THREE.Group();
      const spin = buildWheel();
      spin.scale.set(WHEEL_SCALE * d.rs * d.wk, WHEEL_SCALE * d.rs, WHEEL_SCALE * d.rs);
      steer.add(spin);
      hub.add(steer);
      root.add(hub);
      return { ...d, hub, steer, spin, setCorner };
    });

    root.add(mergeStatic(shell));
    root.traverse((o) => {
      if (!o.isMesh || o.castShadow) return;
      o.receiveShadow = true;
      o.castShadow = !NO_CAST.has(o.material);
    });

    function setSuspension(i, L) {
      const w = wheels[i];
      w.hub.position.set(w.x, w.my - L, w.z);
      w.setCorner(L);
    }

    // 0 = running lights, 1 = on the brakes.
    const tailDim = lamp(0x7e1a0b, 2);
    const tailLit = lamp(0xff3a1c, 6);
    function setBrake(k) {
      M.tail.color.copy(tailDim).lerp(tailLit, k);
    }

    function setSteer(delta, speed = 0) {
      for (const w of wheels) w.steer.rotation.y = steerAngle(w, delta, speed);
      yokePivot.rotation.z = -delta * 2.5;
    }

    wheels.forEach((_, i) => setSuspension(i, SUSP.Lstatic));
    setPanels(0);
    // amount 0..1; color the planet's dust or mud.
    function setDirt(amount, color) {
      DIRT.amount.value = amount;
      if (color) DIRT.color.value.copy(color);
      DIRT.inv.value.copy(root.matrixWorld).invert();
    }

    return { root, wheels, setSuspension, setSteer, setPanels, setBrake, setDirt, setThrust, TAIL_LAMPS: tailLamps, MOUNTS: SPEC.mounts };
  }

  return { buildVehicle, WHEEL_R, WHEEL_X, SUSP, TYRE_HALF_W };
}

const KIT = vehicleKit(GAME_CHASSIS);
export const { buildVehicle, WHEEL_R, WHEEL_X, SUSP, TYRE_HALF_W } = KIT;
