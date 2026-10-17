// How hard the ground is to drive, as a colour weight for the map: 0 on ground any chassis
// takes without thinking, 1 where it is a climb or a slide. Slope is rise over run
// (0.30 = 30 %, about 17 degrees); the graded road never exceeds ~10 %, and the first
// chassis start to struggle past 25 %.
export function slopeRedness(slope) {
  const t = Math.min(1, Math.max(0, (slope - 0.12) / (0.3 - 0.12)));
  return t * t * (3 - 2 * t);
}
