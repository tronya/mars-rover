import { BASES, BASE_FLAT_R } from './terrain.js';
import { PLANET } from './planet.js';
import { progress } from './progress.js';
import { CHASSIS } from './chassis.js';

// Spend at БЕТА's workshop: мотлох found on the map, plus Гермес-3 modules actually
// delivered (worth more — there are only 4 of those, ever). Two kinds of branch:
// "levels" is a 0/1/2 dial (motor, suspension, panels, battery) that scales a number
// the game already has; "unlock" is a one-shot 0/1 (far light, sonar, its own
// avoidance logic, autopilot) — features that don't exist at all until bought, not
// just weaker versions of themselves. `avoidance` also requires `sonar` first: no
// point steering around what you can't see yet.
const STORE_KEY = 'rover.upgrades';
const MODULE_VALUE = 5; // one delivered Гермес-3 module is worth this many мотлох
const BASE = BASES[1]; // БЕТА
const WORKSHOP_R = BASE_FLAT_R + 40;

export const BRANCHES = [
  { id: 'motor', icon: '⚙', label: 'ДВИГУН', hint: 'потужність', kind: 'levels', costs: [4, 6], vals: [1, 2, 3], fmt: (v) => `${Math.round(180 * v)} кВт` },
  { id: 'wheels', icon: '🛞', label: 'КОЛЕСА', hint: 'зчеплення з ґрунтом', kind: 'levels', costs: [4, 6], vals: [1, 1.25, 1.45], fmt: (v) => `×${v.toFixed(2)}` },
  { id: 'suspension', icon: '🔧', label: 'ПІДВІСКА', hint: 'амортизація', kind: 'levels', costs: [4, 6], vals: [1, 1.6, 2.4], fmt: (v) => `×${v.toFixed(1)}` },
  { id: 'panels', icon: '☀', label: 'ПАНЕЛІ', hint: 'заряджання', kind: 'levels', costs: [3, 4], vals: [1, 1.45, 2], fmt: (v) => `×${v.toFixed(2)}` },
  { id: 'battery', icon: '🔋', label: 'ЖИВЛЕННЯ', hint: 'витрата', kind: 'levels', costs: [3, 4], vals: [1, 0.8, 0.62], fmt: (v) => `×${v.toFixed(2)}` },
  { id: 'farlight', icon: '🔦', label: 'ДАЛЬНЄ СВІТЛО', hint: 'промінь на 800 м', short: 'промінь 800 м', kind: 'unlock', costs: [6], vals: [0, 1] },
  { id: 'sonar', icon: '📡', label: 'СОНАР', hint: 'бачить перешкоди попереду', short: 'бачить перешкоди', kind: 'unlock', costs: [6], vals: [0, 1] },
  // Levels here are how far ahead it starts steering round obstacles, in metres.
  { id: 'avoidance', icon: '↩', label: 'АВТОУНИКНЕННЯ', hint: 'сам обʼїжджає перешкоди, потребує сонар', kind: 'levels', costs: [5, 6, 8], vals: [0, 30, 50, 80], fmt: (v) => (v ? `${v} м` : 'нема'), requires: 'sonar' },
  { id: 'autopilot', icon: '🤖', label: 'АВТОПІЛОТ', hint: 'їде сам за маршрутом', short: 'їде маршрутом', kind: 'unlock', costs: [6], vals: [0, 1] },
];
const BY_ID = Object.fromEntries(BRANCHES.map((b) => [b.id, b]));

// Vehicles in the garage, bought with the same мотлох. The scout is what every
// expedition starts with; the glider is not for sale yet (`null`).
export const VEHICLE_PRICES = { truck: 0, buggy: 8, crawler: 12, speedster: 16, hauler: 20, galatea: 24, glider: null };

// The same upgrades laid out as a tech tree in three branches. Each node is one
// level of one upgrade; `req` lists what must be owned first ("id:level"), on top
// of the previous level of the same upgrade. `x` (0..2) and `row` place it.
export const TREE = [
  {
    title: 'ХОДОВА',
    nodes: [
      { id: 'motor', lvl: 1, x: 1, row: 0 },
      { id: 'wheels', lvl: 1, x: 0, row: 1, req: ['motor:1'] },
      { id: 'suspension', lvl: 1, x: 2, row: 1, req: ['motor:1'] },
      { id: 'motor', lvl: 2, x: 1, row: 2, req: ['wheels:1', 'suspension:1'] },
      { id: 'wheels', lvl: 2, x: 0, row: 3, req: ['motor:2'] },
      { id: 'suspension', lvl: 2, x: 2, row: 3, req: ['motor:2'] },
    ],
  },
  {
    title: 'ЕНЕРГІЯ',
    nodes: [
      { id: 'panels', lvl: 1, x: 1, row: 0 },
      { id: 'battery', lvl: 1, x: 0, row: 1, req: ['panels:1'] },
      { id: 'farlight', lvl: 1, x: 2, row: 1, req: ['panels:1'] },
      { id: 'panels', lvl: 2, x: 1, row: 2, req: ['battery:1'] },
      { id: 'battery', lvl: 2, x: 1, row: 3, req: ['panels:2'] },
    ],
  },
  {
    title: 'ЕЛЕКТРОНІКА',
    nodes: [
      { id: 'sonar', lvl: 1, x: 1, row: 0 },
      { id: 'avoidance', lvl: 1, x: 0, row: 1, req: ['sonar:1'] },
      { id: 'autopilot', lvl: 1, x: 2, row: 1, req: ['sonar:1'] },
      { id: 'avoidance', lvl: 2, x: 0, row: 2 },
      { id: 'avoidance', lvl: 3, x: 0, row: 3 },
    ],
  },
];
const NODE_OF = {};
for (const br of TREE) for (const n of br.nodes) NODE_OF[`${n.id}:${n.lvl}`] = n;

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && raw.levels) return raw;
  } catch (e) { /* storage may be blocked or empty */ }
  return { levels: {} };
}
function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage may be blocked */ }
}

// `debris` (debris.js) and `missions` (missions.js) — their own lifetime counters
// double as the wallet, so there's nothing separate to keep in sync.
export function createUpgrades(debris, missions) {
  const state = loadState();
  for (const b of BRANCHES) if (!(b.id in state.levels)) state.levels[b.id] = 0;
  // Owned vehicles: id → what was paid. A save from before the garage keeps the
  // vehicle it was driving, free, alongside the scout.
  if (!state.vehicles) {
    state.vehicles = { truck: 0 };
    if (VEHICLE_PRICES[CHASSIS] != null) state.vehicles[CHASSIS] = 0;
    saveState(state);
  }

  // The Moon chapter is a flashback to before any of this existed, so it is always
  // the bare rover whatever the save says — that restriction is the level. Everywhere
  // else you drive the rover you actually built, Верданта included: carrying your
  // upgrades to the next planet is the whole point of earning them.
  const level = (id) => {
    if (PLANET === 'moon') return 0;
    return state.levels[id] || 0;
  };
  const mul = (id) => BY_ID[id].vals[level(id)];
  const unlocked = (id) => mul(id) > 0;
  const spent = () => {
    let s = 0;
    for (const b of BRANCHES) for (let i = 0; i < level(b.id); i++) s += b.costs[i];
    for (const id in state.vehicles) s += state.vehicles[id];
    return s;
  };
  // Scrap found on the map, modules delivered, plus whatever the campaign has handed
  // out for story beats (see progress.js — the Moon flashback pays out this way).
  const currency = () => debris.collectedCount() + missions.deliveredCount() * MODULE_VALUE + progress.bonusScrap - spent();
  const nextCost = (id) => {
    const b = BY_ID[id];
    const lv = level(id);
    return lv >= b.costs.length ? null : b.costs[lv];
  };
  const owns = (key) => {
    const [id, lv] = key.split(':');
    return level(id) >= Number(lv);
  };
  // What still blocks the next level of `id` in the tree (empty = nothing).
  const missing = (id) => {
    const n = NODE_OF[`${id}:${level(id) + 1}`];
    return n && n.req ? n.req.filter((k) => !owns(k)) : [];
  };
  const canBuy = (id) => {
    const b = BY_ID[id];
    if (b.requires && !unlocked(b.requires)) return false;
    if (missing(id).length) return false;
    const c = nextCost(id);
    return c !== null && currency() >= c;
  };
  const buy = (id) => {
    if (!canBuy(id)) return false;
    state.levels[id]++;
    saveState(state);
    return true;
  };
  const nearWorkshop = (x, z) => Math.hypot(x - BASE.x, z - BASE.z) < WORKSHOP_R;
  const ownsVehicle = (id) => id in state.vehicles;
  const canBuyVehicle = (id) => !ownsVehicle(id) && VEHICLE_PRICES[id] != null && currency() >= VEHICLE_PRICES[id];
  const buyVehicle = (id) => {
    if (!canBuyVehicle(id)) return false;
    state.vehicles[id] = VEHICLE_PRICES[id];
    saveState(state);
    return true;
  };

  return { level, mul, unlocked, currency, nextCost, canBuy, buy, nearWorkshop, owns, missing, ownsVehicle, canBuyVehicle, buyVehicle };
}
