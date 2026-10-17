// The air thins with height, so the haze thins too: the same dusty air you could see
// ~1.2 km through at the base shows more of the world from up on a slope. Heights are
// metres above where the road starts (АЛЬФА is 0 on real Mars). A scale height of 7 km is a
// little under the real one, which keeps the effect readable across a few hundred metres.
const SCALE_HEIGHT = 7000;

// How far the fog distances stretch at height y: 1 at the base, up to 1.4 high up, down to
// 0.85 in a hollow.
export function fogAltitudeScale(y) {
  return Math.min(1.4, Math.max(0.85, Math.exp(y / SCALE_HEIGHT)));
}
