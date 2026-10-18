// Speed governor for the autopilot: how fast it is sensible to go right now, given the
// ground ahead and across, how sharp the turn to the next waypoint is, and how close
// the last waypoint is. Pure — the caller hands in a ground-height sampler.
export const AP_CRUISE = 12.5; // m/s, the old fixed speed — the ceiling on good ground
export const AP_MIN = 2.5;     // never crawl slower than this just for caution

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// pos {x,z}, heading = direction of travel (rad, atan2(x,z) convention),
// turnErr = signed angle to the waypoint bearing, dist = metres to the next waypoint,
// last = it is the final waypoint (so stop there), upY = how upright the hull is.
export function apSpeed({ ground, x, z, heading, turnErr, dist, last, upY = 1 }) {
  const sx = Math.sin(heading), cz = Math.cos(heading);
  const h0 = ground(x, z);
  const ahead = (d) => ground(x + sx * d, z + cz * d);
  // Slope along the way: a steep drop wants engine braking, a steep climb wants nothing.
  const down = (h0 - ahead(18)) / 18;       // + = going downhill
  // Slope across: the roll-over risk on Mars's weak gravity.
  const lx = cz, lz = -sx;
  const cross = Math.abs(ground(x + lx * 3.5, z + lz * 3.5) - ground(x - lx * 3.5, z - lz * 3.5)) / 7;
  // A step ahead (rock, crater rim) shows as a bump between the near and far samples.
  const bump = Math.abs(ahead(9) - (h0 + ahead(18)) / 2) / 9;

  let v = AP_CRUISE;
  v *= 1 - 0.7 * clamp(Math.abs(turnErr) / 1.1, 0, 1);       // sharp turn
  v *= 1 - 0.65 * clamp((down - 0.08) / 0.3, 0, 1);          // steep downhill
  v *= 1 - 0.7 * clamp((cross - 0.1) / 0.3, 0, 1);           // side slope
  v *= 1 - 0.5 * clamp((bump - 0.05) / 0.2, 0, 1);           // rough ahead
  if (upY < 0.9) v *= clamp((upY - 0.5) / 0.4, 0.2, 1);      // already leaning
  if (last) v = Math.min(v, Math.sqrt(2 * 1.6 * Math.max(0, dist - 3)) + 1.5); // stop at the end
  return clamp(v, Math.min(AP_MIN, v), AP_CRUISE);
}
