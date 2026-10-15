// Read once at load — the menu's planet switch works by setting this and reloading
// the page (see main.js), not a live in-game swap. Shared by physics.js (gravity)
// and terrain.js (heightfield/colours) so both agree without importing each other.
export const PLANET = (() => {
  // A save may name a planet that no longer exists; fall back to Mars.
  try {
    const p = localStorage.getItem('rover.planet');
    return ['mars', 'moon', 'verdanta'].includes(p) ? p : 'mars';
  } catch (e) { return 'mars'; }
})();
