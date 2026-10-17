// How much of the headlight beam reaches a point, 0..1. The two lamps sit about a metre
// either side of the nose and throw a cone (~0.38 rad spread) that widens with distance
// and thins out towards `range`. Used to light the dust and the blowing sand at night:
// out in the dark they should only be visible where the beam is, nowhere else.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// (px, py, pz): the point. (ox, oy, oz): the lamps' mount. (dx, dz): unit heading.
export function beamLit(px, py, pz, ox, oy, oz, dx, dz, range = 75) {
  const rx = px - ox, rz = pz - oz;
  const f = rx * dx + rz * dz; // metres ahead of the lamps
  if (f < 0.8 || f > range) return 0;
  const l = rx * dz - rz * dx; // metres to the side
  const cone = Math.max(0, 1 - Math.max(0, Math.abs(l) - 1) / (f * 0.38 + 0.6));
  if (cone <= 0) return 0;
  // The beam is aimed a little down and spreads vertically too
  const centre = oy - 0.15 + f * 0.03, half = 1.1 + f * 0.18;
  const height = 1 - smooth(half * 0.6, half * 1.4, Math.abs(py - centre));
  const fall = Math.pow(1 - f / range, 0.7);
  return cone * height * fall;
}
