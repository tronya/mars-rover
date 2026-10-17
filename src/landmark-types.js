// What stands out in the wilds of each planet, as plain data: a name, how much
// ground it flattens (r), how often it turns up (weight) and its solid shapes.
// terrain.js places them and folds the shapes into groundHeight, so the rover hits
// a wall rather than driving through it; landmarks.js draws them. No imports here,
// so both can read it without a cycle.
//
// Collider shapes, in the landmark's own frame (x right, z forward, y up from its
// ground level), rotated with it:
//   box  { x, z, w, d, h }      upright block
//   cyl  { x, z, r, h }         upright cylinder
//   dome { x, z, r, h }         rounded cap (same profile as a boulder)
//   ring { x, z, r, w, y0, h }  torus band between y0 and h (y0 > 0 leaves a gap to drive under — not used)
//   seg  { x, z, x2, z2, r, h } a corridor lying from (x, z) to (x2, z2), r thick (the bases' tubes)

export const LANDMARK_TYPES = {
  mars: [
    {
      id: 'outpost', name: 'Покинутий аванпост', r: 20, weight: 3,
      colliders: [
        { k: 'dome', x: 0, z: 0, r: 5.2, h: 5 },
        { k: 'dome', x: 9.5, z: 2, r: 3.6, h: 3.4 },
        { k: 'box', x: 4.8, z: 1, w: 4.4, d: 1.8, h: 2.2 },
        { k: 'cyl', x: -6, z: -6, r: 0.4, h: 12 },
      ],
    },
    {
      id: 'geodome', name: 'Теплиця-геодезик', r: 14, weight: 2,
      colliders: [{ k: 'dome', x: 0, z: 0, r: 8.2, h: 8 }],
    },
    {
      id: 'drill', name: 'Бурова вишка', r: 14, weight: 2,
      colliders: [
        { k: 'box', x: 0, z: 0, w: 4.4, d: 4.4, h: 16 },
        { k: 'cyl', x: 6, z: -2, r: 1.6, h: 4.5 },
        { k: 'cyl', x: 6, z: 2.4, r: 1.6, h: 4.5 },
        { k: 'box', x: -5.5, z: 0, w: 3.5, d: 5, h: 2.6 },
      ],
    },
    {
      id: 'comms', name: 'Вежа зв’язку', r: 12, weight: 2,
      colliders: [
        { k: 'cyl', x: 0, z: 0, r: 0.9, h: 30 },
        { k: 'box', x: 4, z: 3, w: 4, d: 3, h: 2.8 },
      ],
    },
    {
      id: 'depot', name: 'Склад контейнерів', r: 16, weight: 3,
      colliders: [
        { k: 'box', x: -4, z: -3, w: 6.2, d: 2.6, h: 5.2 },
        { k: 'box', x: -4, z: 1.2, w: 6.2, d: 2.6, h: 2.6 },
        { k: 'box', x: 4, z: -3, w: 6.2, d: 2.6, h: 2.6 },
        { k: 'box', x: 4.5, z: 3.5, w: 2.6, d: 6.2, h: 2.6 },
      ],
    },
    {
      id: 'wreck', name: 'Уламки посадкового модуля', r: 12, weight: 2,
      colliders: [
        { k: 'cyl', x: 0, z: 0, r: 3.4, h: 3.2 },
        { k: 'box', x: 5.5, z: 3, w: 3, d: 2, h: 0.8 },
      ],
    },
    {
      id: 'ring', name: 'Кільцева станція', r: 22, weight: 1,
      colliders: [
        { k: 'dome', x: 0, z: 0, r: 5, h: 6 },
        { k: 'ring', x: 0, z: 0, r: 15, w: 2.4, y0: 0, h: 5 },
      ],
    },
  ],
  moon: [
    {
      id: 'lander', name: 'Посадковий ступінь', r: 10, weight: 3,
      colliders: [{ k: 'box', x: 0, z: 0, w: 4.4, d: 4.4, h: 3.6 }],
    },
    {
      id: 'dish', name: 'Радіотелескоп', r: 16, weight: 2,
      colliders: [
        { k: 'cyl', x: 0, z: 0, r: 2, h: 6 },
        { k: 'box', x: 8, z: 4, w: 3, d: 3, h: 2.4 },
      ],
    },
    {
      id: 'roverwreck', name: 'Старий ровер', r: 7, weight: 3,
      colliders: [{ k: 'box', x: 0, z: 0, w: 2.4, d: 3.4, h: 1.4 }],
    },
    {
      id: 'miner', name: 'Видобувна машина', r: 14, weight: 2,
      colliders: [
        { k: 'box', x: 0, z: 0, w: 5, d: 9, h: 4.5 },
        { k: 'cyl', x: 0, z: 6.5, r: 2.6, h: 5.5 },
      ],
    },
    {
      id: 'reflector', name: 'Масив відбивачів', r: 9, weight: 2,
      colliders: [{ k: 'box', x: 0, z: 0, w: 7, d: 5, h: 0.9 }],
    },
    {
      id: 'habmound', name: 'Засипаний модуль', r: 14, weight: 2,
      colliders: [
        { k: 'dome', x: 0, z: 0, r: 7.5, h: 3.8 },
        { k: 'box', x: 0, z: 7.5, w: 2.6, d: 2.4, h: 2.6 },
      ],
    },
  ],
  verdanta: [
    {
      id: 'hut', name: 'Дослідницька хатка', r: 10, weight: 3,
      colliders: [
        { k: 'box', x: 0, z: 0, w: 5.2, d: 4.2, h: 5.2 },
      ],
    },
    {
      id: 'weather', name: 'Метеовежа', r: 9, weight: 2,
      colliders: [{ k: 'box', x: 0, z: 0, w: 2.4, d: 2.4, h: 18 }],
    },
    {
      id: 'pod', name: 'Посадкова капсула', r: 12, weight: 2,
      colliders: [{ k: 'cyl', x: 0, z: 0, r: 2.3, h: 3.2 }],
    },
    {
      id: 'arch', name: 'Кам’яна арка', r: 16, weight: 2,
      colliders: [
        { k: 'cyl', x: -6.5, z: 0, r: 2.6, h: 13 },
        { k: 'cyl', x: 6.5, z: 0, r: 2.6, h: 13 },
      ],
    },
    {
      id: 'orangery', name: 'Купол-оранжерея', r: 16, weight: 2,
      colliders: [{ k: 'dome', x: 0, z: 0, r: 10, h: 9.5 }],
    },
    {
      id: 'beacon', name: 'Навігаційний маяк', r: 6, weight: 3,
      colliders: [{ k: 'cyl', x: 0, z: 0, r: 1.3, h: 4.5 }],
    },
  ],
};

// ---------- the settlement ----------
// One proper town on Mars, «Обрій»: two crossing streets with lamps, a plaza, rows
// of homes of three kinds, a hall, greenhouses, a garage, tanks, a solar farm and a
// landing pad. All in its own frame (streets along z and x through the origin),
// deterministic, axis-aligned so its boxes collide as boxes. terrain.js levels the
// ground and builds the colliders from this; landmarks.js draws it; npc.js walks
// people along `walk` and drives rovers round `loop`.
export const SETTLEMENT_R = 112;

export function settlementLayout() {
  const homes = [];
  const kinds = ['hab', 'module', 'stack'];
  let n = 0;
  const home = (x, z, face) => homes.push({ kind: kinds[(n++ * 7 + 3) % 3], x, z, face });
  // Along the main street (z), both sides, doors facing the street.
  for (const z of [-84, -64, 44, 64, 84]) {
    home(-15, z, 1);
    home(15, z, -1);
  }
  for (const z of [-44, -24, 24]) home(15, z, -1);
  for (const z of [-24, 24]) home(-15, z, 1);
  // Along the cross street (x).
  for (const x of [-76, -56, 56, 76]) {
    home(x, -14, 2);
    home(x, 14, -2);
  }
  home(36, 14, -2);
  home(-36, -14, 2);

  const solids = [];
  for (const h of homes) {
    if (h.kind === 'hab') solids.push({ k: 'dome', x: h.x, z: h.z, r: 4.6, h: 4.4 });
    else if (h.kind === 'module') solids.push({ k: 'box', x: h.x, z: h.z, w: 7, d: 5.4, h: 3.6 });
    else solids.push({ k: 'box', x: h.x, z: h.z, w: 6, d: 6, h: 6.4 });
  }
  const hall = { x: 38, z: 36, r: 12 };
  const greenhouses = [{ x: -42, z: 42, r: 9 }, { x: -44, z: -46, r: 9 }];
  const garage = { x: 44, z: -48, w: 16, d: 11, h: 5.5 };
  const tanks = [[-74, 34], [-80, 42], [-72, 48]].map(([x, z]) => ({ x, z, r: 2.6, h: 6 }));
  const pad = { x: 72, z: 56, r: 14 };
  const mast = { x: 0, z: 0, r: 0.5, h: 16 };
  const solar = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) solar.push({ x: -78 + j * 9, z: -88 + i * 7 });
  solids.push({ k: 'dome', x: hall.x, z: hall.z, r: hall.r, h: 10 });
  for (const g of greenhouses) solids.push({ k: 'dome', x: g.x, z: g.z, r: g.r, h: 9 });
  solids.push({ k: 'box', x: garage.x, z: garage.z, w: garage.w, d: garage.d, h: garage.h });
  for (const t of tanks) solids.push({ k: 'cyl', x: t.x, z: t.z, r: t.r, h: t.h });
  solids.push({ k: 'cyl', x: mast.x, z: mast.z, r: mast.r, h: mast.h });
  for (const s of solar) solids.push({ k: 'cyl', x: s.x, z: s.z, r: 0.3, h: 2.2 });

  // Street lamps every 18 m along both streets, set back on the kerb.
  const lamps = [];
  for (let t = -90; t <= 90; t += 18) {
    if (Math.abs(t) < 14) continue;
    lamps.push({ x: 7, z: t }, { x: -7, z: t + 9 });
    lamps.push({ x: t, z: 6 }, { x: t + 9, z: -6 });
  }
  for (const l of lamps) solids.push({ k: 'cyl', x: l.x, z: l.z, r: 0.18, h: 5 });

  // Walk graph for people: street nodes, plus each door linked to the street.
  const nodes = [];
  for (let t = -84; t <= 84; t += 12) nodes.push({ x: 0, z: t }, { x: t, z: 0 });
  const doors = homes.map((h) => {
    const out = 6.5;
    if (Math.abs(h.face) === 1) return { x: h.x + h.face * out, z: h.z };
    return { x: h.x, z: h.z + Math.sign(h.face) * out };
  });

  // A loop the town's own rovers drive: round the plaza and out along the streets.
  const loop = [
    [4, -80], [4, -20], [20, -4], [80, -4], [80, 4], [20, 4], [4, 20], [4, 80],
    [-4, 80], [-4, 20], [-20, 4], [-80, 4], [-80, -4], [-20, -4], [-4, -20], [-4, -80],
  ].map(([x, z]) => ({ x, z }));

  return { homes, doors, hall, greenhouses, garage, tanks, pad, mast, solar, lamps, nodes, loop, solids };
}
