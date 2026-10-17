// Just enough of a browser for the game's modules to load in Node: storage, and a
// canvas whose 2D context swallows every drawing call. Physics never draws, but some
// modules paint textures at import time.
const noop = () => {};
const ctx = new Proxy({}, {
  get: (t, k) => (k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop })
    : k === 'measureText' ? () => ({ width: 0 })
    : k in t ? t[k] : noop),
  set: (t, k, v) => { t[k] = v; return true; },
});
// TEST_CHASSIS / TEST_PLANET pick what the game modules load as.
const store = new Map();
if (process.env.TEST_CHASSIS) store.set('rover.chassis', process.env.TEST_CHASSIS);
if (process.env.TEST_PLANET) store.set('rover.planet', process.env.TEST_PLANET);
if (process.env.TEST_REGION) store.set('rover.region', process.env.TEST_REGION); // 'classic' = the procedural Mars
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
};
globalThis.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror(new Error('no images in tests')), 0); } };
