// The two bases, АЛЬФА and БЕТА, as plain data: base.js draws them, terrain.js turns
// them into solids (baseSolids) so the rover stops at a dome instead of driving into
// it. No imports here, so both can read it without a cycle — the same arrangement as
// landmark-types.js.
//
// Each layout is in the base's own frame: x right, z along the road as it leaves the
// base, y up from the pad. terrain.js turns every base so its +z faces the road, so a
// lane down +z from the road to the main pad (x ≈ 0, z > 0) stays open by design;
// nothing stands there. Everything sits inside BASE_FLAT_R * 0.55, where the ground is
// flattened dead level.
//
//   pads   { x, z, r }                 round landing/parking pads; pads[0] is the main
//                                      one the road runs onto, pads[1] the cargo pad
//   domes  { x, z, r, kind }           'glass' a clear habitat, 'green' a greenhouse
//                                      with plants, 'shell' an opaque panelled dome
//   tubes  [i, j, r]                   a corridor between domes[i] and domes[j]
//   ring   { x, z, r, tr }             БЕТА's circular corridor round its hub
//   spokes [{ x, z, x2, z2, r }]       corridors from the hub out to the ring
//   solar  { x, z, w, d }              a fenced rectangular field of tilted panels
//   mast   { x, z }                    the comms mast that carries the beacon

// АЛЬФА: a cluster of domes round a big glass habitat, joined by tube corridors,
// greenhouses at the edge, solar fields front-right and back-left. The left flank
// stays open: Верданта parks its seed lab there (LAB in terrain.js, about x -58,
// z -12 in this frame), and the way to it from the road and the pad must be clear.
const ALPHA = {
  pads: [{ x: 0, z: 6, r: 11 }, { x: -24, z: 22, r: 8 }],
  domes: [
    { x: 14, z: -22, r: 9, kind: 'glass' },
    { x: 36, z: -2, r: 7, kind: 'green' },
    { x: -8, z: -38, r: 7.5, kind: 'green' },
    { x: -22, z: -20, r: 6.5, kind: 'shell' },
    { x: 36, z: -34, r: 5, kind: 'shell' },
  ],
  tubes: [[0, 1, 1.5], [0, 2, 1.5], [0, 3, 1.5], [0, 4, 1.3]],
  ring: null,
  spokes: [],
  solar: [{ x: 36, z: 24, w: 16, d: 18 }, { x: -34, z: -40, w: 12, d: 12 }],
  mast: { x: 14, z: 2 },
};

// БЕТА: a hub-and-ring station — a greenhouse hub, a circular corridor round it with
// four modules on it, spokes between the two — and solar fields on both flanks.
const BETA_HUB = { x: 0, z: -28 };
const BETA_RING_R = 18;
const BETA = {
  pads: [{ x: 0, z: 12, r: 11 }, { x: -24, z: 18, r: 8 }],
  domes: [
    { ...BETA_HUB, r: 8, kind: 'green' },
    { x: BETA_RING_R, z: BETA_HUB.z, r: 4.5, kind: 'glass' },
    { x: 0, z: BETA_HUB.z - BETA_RING_R, r: 4.5, kind: 'shell' },
    { x: -BETA_RING_R, z: BETA_HUB.z, r: 4.5, kind: 'green' },
    { x: 0, z: BETA_HUB.z + BETA_RING_R, r: 4.5, kind: 'shell' },
  ],
  tubes: [],
  ring: { ...BETA_HUB, r: BETA_RING_R, tr: 1.5 },
  // Diagonal, so they come out between the modules rather than into them.
  spokes: [1, 3, 5, 7].map((k) => {
    const a = (k / 8) * Math.PI * 2;
    return { x: BETA_HUB.x, z: BETA_HUB.z, x2: BETA_HUB.x + Math.cos(a) * BETA_RING_R, z2: BETA_HUB.z + Math.sin(a) * BETA_RING_R, r: 1.1 };
  }),
  solar: [{ x: 34, z: -26, w: 12, d: 26 }, { x: -34, z: -26, w: 12, d: 26 }],
  mast: { x: 16, z: 2 },
};

// Same order as BASES in terrain.js.
export const BASE_LAYOUTS = [ALPHA, BETA];

// How high a corridor's axis rides: on short legs, just clear of the ground.
export const tubeY = (r) => r + 0.3;
// A solar field's panels stand this tall; its fence is the collider.
export const SOLAR_H = 2;

// The solid shapes of a layout, in the collider format landmark-types.js describes.
// Pads and the field between the buildings stay drivable; everything standing is solid.
export function baseSolids(L) {
  const out = [];
  for (const d of L.domes) out.push({ k: 'dome', x: d.x, z: d.z, r: d.r + 0.2, h: d.r });
  for (const [i, j, r] of L.tubes) {
    const a = L.domes[i];
    const b = L.domes[j];
    out.push({ k: 'seg', x: a.x, z: a.z, x2: b.x, z2: b.z, r: r + 0.15, h: tubeY(r) + r });
  }
  for (const s of L.spokes) out.push({ k: 'seg', x: s.x, z: s.z, x2: s.x2, z2: s.z2, r: s.r + 0.15, h: tubeY(s.r) + s.r });
  if (L.ring) out.push({ k: 'ring', x: L.ring.x, z: L.ring.z, r: L.ring.r, w: L.ring.tr * 2 + 0.3, y0: 0, h: tubeY(L.ring.tr) + L.ring.tr });
  for (const f of L.solar) out.push({ k: 'box', x: f.x, z: f.z, w: f.w + 0.4, d: f.d + 0.4, h: SOLAR_H });
  out.push({ k: 'cyl', x: L.mast.x, z: L.mast.z, r: 0.8, h: 34 });
  return out;
}
