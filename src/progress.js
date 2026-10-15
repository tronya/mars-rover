// The campaign's own save: which planets are open, what has been done, and the
// bonuses earned along the way. Deliberately separate from the things that already
// persist themselves — upgrades.js, debris.js and missions.js each own their own
// key — so this file is about the story, not about re-implementing their storage.
//
// Chapter order:
//   Марс      deliver the four Гермес-3 modules, spend мотлох at БЕТА's workshop
//   Місяць    a flashback, opened once two modules are down: the same crossing years
//             earlier in a rover with none of the upgrades (see upgrades.js, which
//             forces stock gear there — that restriction is the point of the level)
//   Верданта  opens once Марс is finished, and you bring your upgraded rover with you

const KEY = 'rover.progress';
const SKIP_MENU = 'rover.skipMenu'; // survives the reload a new game needs

export const FLASHBACK_AT = 2; // modules delivered before the Moon opens
export const FLASHBACK_REWARD = 12; // мотлох for finishing it

// `briefed` starts behind `step` so the very first briefing still plays.
const FRESH = () => ({ started: false, flashbackDone: false, bonusScrap: 0, seen: {}, step: 0, briefed: -1 });

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') return { ...FRESH(), ...raw };
  } catch (e) { /* storage may be blocked or hold junk */ }
  return FRESH();
}

const state = load();

// Test switch: localStorage['rover.unlockAll'] = '1' opens every planet regardless
// of the campaign. Not reachable from the UI and never set by the game itself.
const UNLOCK_ALL = (() => {
  try { return localStorage.getItem('rover.unlockAll') === '1'; } catch (e) { return false; }
})();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage may be blocked */ }
}

export const progress = {
  get started() { return state.started; },
  // Where the radio chain has got to (see story.js), and how much of it has been read
  // out loud — kept apart so a reload does not replay a briefing you already heard.
  get step() { return state.step; },
  set step(v) { state.step = v; save(); },
  get briefed() { return state.briefed; },
  set briefed(v) { state.briefed = v; save(); },
  get flashbackDone() { return state.flashbackDone; },
  get bonusScrap() { return state.bonusScrap; },

  // Which planets the campaign has opened. Марс is always there; the other two are
  // earned, and both gates read the mission count rather than a flag of their own so
  // they can never drift out of step with what you have actually done.
  unlocked(planet, delivered) {
    if (planet === 'mars' || UNLOCK_ALL) return true;
    if (planet === 'moon') return delivered >= FLASHBACK_AT;
    if (planet === 'verdanta') return delivered >= 4;
    return false;
  },

  // Pay for a finished side job (jobs.js), into the same pot as the flashback reward.
  addBonusScrap(n) {
    state.bonusScrap += n;
    save();
  },

  finishFlashback() {
    if (state.flashbackDone) return false;
    state.flashbackDone = true;
    state.bonusScrap += FLASHBACK_REWARD;
    save();
    return true;
  },

  // One-shot story beats: returns true the first time each is asked for.
  firstTime(id) {
    if (state.seen[id]) return false;
    state.seen[id] = true;
    save();
    return true;
  },

  markStarted() {
    if (state.started) return;
    state.started = true;
    save();
  },
};

export function hasSave() {
  return state.started;
}

// A new game wipes every key the game owns, not just this one — otherwise the old
// rover's upgrades, scrap and delivered modules would quietly survive into it. The
// reload is what actually resets the world, since planet.js and the mission and
// debris pools all read their storage once at module load.
export function newGame() {
  for (const k of ['rover.progress', 'rover.upgrades', 'rover.debris', 'rover.missions', 'rover.verdanta', 'rover.odo']) {
    try { localStorage.removeItem(k); } catch (e) { /* storage may be blocked */ }
  }
  try {
    localStorage.setItem('rover.planet', 'mars');
    localStorage.setItem('rover.chassis', 'truck'); // every expedition starts in the scout
    localStorage.setItem(KEY, JSON.stringify({ ...FRESH(), started: true }));
    sessionStorage.setItem(SKIP_MENU, '1');
  } catch (e) { /* storage may be blocked */ }
  location.reload();
}

export function travelTo(planet) {
  try { localStorage.setItem('rover.planet', planet); } catch (e) { /* storage may be blocked */ }
  try { sessionStorage.setItem(SKIP_MENU, '1'); } catch (e) { /* storage may be blocked */ }
  location.reload();
}

// True when we have just come back from a reload the player asked for, so the start
// menu should not appear again in their face.
export function consumeSkipMenu() {
  try {
    if (sessionStorage.getItem(SKIP_MENU)) { sessionStorage.removeItem(SKIP_MENU); return true; }
  } catch (e) { /* storage may be blocked */ }
  return false;
}
