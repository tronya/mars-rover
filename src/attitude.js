// What the HUD says about where the rover is in the world and how it sits: height above
// Mars's own zero (the datum the orbiter maps use, not the base), nose-up pitch and roll.
// Pure, so it can be tested; main.js feeds it the sim and writes the strings.
const MINUS = '−';
export function formatAltitude(metres) {
  const n = Math.round(metres);
  return `${n < 0 ? MINUS : ''}${Math.abs(n).toLocaleString('en-US').replace(/,/g, ' ')} м`;
}

// pitch: + nose up; roll: + right side down. Degrees, whole numbers, arrows for direction.
export function formatTilt(pitchDeg, rollDeg) {
  const p = Math.round(pitchDeg), r = Math.round(rollDeg);
  const pitch = p === 0 ? '0°' : `${p > 0 ? '↗' : '↘'} ${Math.abs(p)}°`;
  const roll = r === 0 ? '0°' : `${r > 0 ? '⟳' : '⟲'} ${Math.abs(r)}°`;
  return `${pitch} · ${roll}`;
}

// from the rover's forward and right unit vectors' world-up components
export function pitchRollDeg(fwdY, rightY) {
  const d = 180 / Math.PI;
  return { pitch: Math.asin(Math.max(-1, Math.min(1, fwdY))) * d, roll: Math.asin(Math.max(-1, Math.min(1, -rightY))) * d };
}
