import fs from 'node:fs';
import { PNG } from 'pngjs';
const dir = new URL('../textures/mars/', import.meta.url).pathname;
const m = JSON.parse(fs.readFileSync(dir + (process.argv[3]||'jezero')+'-meta.json'));
const b = fs.readFileSync(dir + (process.argv[3]||'jezero')+'-height.bin');
const u = new Uint16Array(b.buffer, b.byteOffset, b.length / 2);
const H = (i) => m.minH + (u[i] / 65535) * (m.maxH - m.minH);
const png = new PNG({ width: m.width, height: m.height });
for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) {
  const i = y * m.width + x;
  const dx = (H(i + 1) - H(i - 1)) / (2 * m.mppX), dz = (H(i + m.width) - H(i - m.width)) / (2 * m.mppY);
  const shade = Math.max(0, Math.min(1, 0.55 + 1.6 * (-dx * 0.6 - dz * 0.8) / Math.hypot(1, dx, dz)));
  const e = (H(i) - m.minH) / (m.maxH - m.minH);
  const o = i * 4;
  png.data[o] = 255 * shade * (0.5 + e * 0.5); png.data[o + 1] = 255 * shade * 0.7; png.data[o + 2] = 255 * shade * (1 - e) * 0.6 + 20; png.data[o + 3] = 255;
}
fs.writeFileSync(process.argv[2], PNG.sync.write(png));
