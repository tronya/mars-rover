// Dust settles on the solar wings. Driving through soft ground throws it up and some lands
// on them (more with speed and on deep dust, a lot in a dust storm); the wind blows a little
// away on its own, and unfolding the wings shakes a good part off. A dusty wing charges
// less, down to about half. Pure maths: main.js owns the state and the HUD.
const MAX = 1;
export const SHAKE_KEEP = 0.55; // what is left after unfolding the wings
const WIND_PER_MIN = 0.03; // cleaned by the breeze, when the air is calm
const FULL_LOSS = 0.5; // charge lost at full dust

export function stepDust(dust, dt, { speed = 0, soft = 0, storm = 0, open = false } = {}) {
  // settles: ~1 % per minute rolling on bare ground at 10 m/s, ~6 % on deep dust, 25 % in a storm.
  // (the breeze below beats the bare-ground rate: only soft ground and storms really build up)
  const settle = Math.abs(speed) * (0.0000167 + 0.0000833 * soft) + storm * 0.25 / 60;
  // the breeze only helps when it is not the storm itself dropping dust
  const clean = open ? 0 : WIND_PER_MIN / 60 * (1 - storm);
  return Math.min(MAX, Math.max(0, dust + (settle - clean) * dt));
}

export const shakeOff = (dust) => dust * SHAKE_KEEP;
export const chargeFactor = (dust) => 1 - FULL_LOSS * Math.min(MAX, Math.max(0, dust));
