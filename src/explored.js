// Which parts of the map the rover has actually been near. A grid laid over the map
// (the same vertices as the minimap's relief mesh); driving past marks everything within a
// radius. Pure data, so it can be tested and saved: `encode` packs it into a short string.
export function createExplored(nx, nz, x0, z0, step) {
  const seen = new Uint8Array(nx * nz);
  let count = 0;

  // Mark every vertex within r metres of (x, z). Returns the indices that were new.
  function mark(x, z, r) {
    const out = [];
    const i0 = Math.max(0, Math.floor((x - r - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((z - r - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((z + r - z0) / step));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + i * step - x, dz = z0 + j * step - z;
      const k = j * nx + i;
      if (dx * dx + dz * dz <= r2 && !seen[k]) { seen[k] = 1; count++; out.push(k); }
    }
    return out;
  }

  // run-length packing: "<n of unseen>,<n of seen>,..." compact for the mostly empty or
  // mostly full maps this produces
  function encode() {
    const runs = [];
    let cur = 0, len = 0;
    for (let k = 0; k < seen.length; k++) {
      if (seen[k] === cur) len++;
      else { runs.push(len); cur = seen[k]; len = 1; }
    }
    runs.push(len);
    return `${nx}x${nz}:${runs.join(',')}`;
  }

  // Returns the indices set, or null when the saved map has another shape (the region or
  // the route changed since it was saved).
  function decode(str) {
    const m = /^(\d+)x(\d+):([\d,]*)$/.exec(str || '');
    if (!m || +m[1] !== nx || +m[2] !== nz) return null;
    seen.fill(0);
    count = 0;
    const out = [];
    let k = 0, v = 0;
    for (const n of m[3].split(',').map(Number)) {
      if (v) for (let e = k + n; k < e && k < seen.length; k++) { seen[k] = 1; count++; out.push(k); }
      else k += n;
      v ^= 1;
    }
    return out;
  }

  return { mark, encode, decode, has: (k) => seen[k] === 1, fraction: () => count / seen.length, size: seen.length };
}
