import * as THREE from 'three';
import { lamp } from './glow.js';
import { groundHeight, ROUTE_PTS } from './terrain.js';
import { PLANET } from './planet.js';

// Road finds (S-7): a few meteorite fragments lie a short way off the road. They glint
// on the ground and show on the compass once you are close; drive over one and it is
// yours. Placed along the route with a fixed spread, a different side and distance each
// time, so a trip is never exactly the same.

const N_FINDS = 6;
const PICK_R = 5;
const SHOW_R = 260; // how close before the beacon and compass pin appear

// Where finds go: evenly spaced along the route, alternating sides, 45–120 m off it.
export function placeFinds(pts, rand, n = N_FINDS) {
  const out = [];
  if (!pts || pts.length < 4) return out;
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5 + (rand() - 0.5) * 0.5) / n;
    const i = Math.min(pts.length - 2, Math.max(0, Math.floor(f * (pts.length - 1))));
    const a = pts[i], b = pts[i + 1];
    let nx = -(b.z - a.z), nz = b.x - a.x;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const side = (k % 2 ? 1 : -1) * (rand() < 0.2 ? -1 : 1);
    const off = 45 + rand() * 75;
    out.push({ x: a.x + nx * side * off, z: a.z + nz * side * off, got: false, worth: 2 + Math.floor(rand() * 3) });
  }
  return out;
}

export function createFinds() {
  const group = new THREE.Group();
  if (PLANET !== 'mars') return { group, update: () => null, targets: () => [], count: 0 };
  let seed = (Date.now() & 0xffff) + 99;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const finds = placeFinds(ROUTE_PTS, rand);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x3c3a3a, metalness: 0.7, roughness: 0.35 });
  const beamMat = new THREE.MeshBasicMaterial({ color: lamp(0x9fe8ff, 2), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 40, 6, 1, true).translate(0, 20, 0);
  for (const f of finds) {
    f.y = groundHeight(f.x, f.z);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), rockMat);
    rock.scale.set(1.3, 0.7, 1);
    rock.position.y = 0.2;
    rock.rotation.set(rand() * 3, rand() * 3, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    g.add(rock, beam);
    g.position.set(f.x, f.y, f.z);
    g.visible = false;
    f.mesh = g;
    group.add(g);
  }
  let found = 0;
  return {
    group,
    get count() { return found; },
    get total() { return finds.length; },
    update(t, x, z) {
      let ev = null;
      for (const f of finds) {
        if (f.got) continue;
        const d = Math.hypot(x - f.x, z - f.z);
        f.mesh.visible = d < SHOW_R;
        if (d < PICK_R) {
          f.got = true;
          f.mesh.visible = false;
          found++;
          ev = { type: 'find', pay: f.worth, text: `Знахідка: уламок метеорита · +${f.worth} мотлоху (${found}/${finds.length})` };
        }
      }
      return ev;
    },
    targets(x, z) {
      return finds.filter((f) => !f.got && Math.hypot(x - f.x, z - f.z) < SHOW_R)
        .map((f) => ({ x: f.x, z: f.z, kind: 'circle', text: '◆', color: '#9fe8ff' }));
    },
  };
}
