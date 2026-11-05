// Draws an original green grass block icon and writes PNGs (no dependencies).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

// Deterministic tiny hash for speckle texture.
const noise = (x, y) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 255) / 255;
};

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const cell = size / 16; // 16x16 chunky pixel art
  const margin = Math.round(size * 0.1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0x78, g = 0xc6, b = 0xff; // sky blue background
      if (x >= margin && x < size - margin && y >= margin && y < size - margin) {
        const u = Math.floor((x - margin) / ((size - 2 * margin) / 16));
        const v = Math.floor((y - margin) / ((size - 2 * margin) / 16));
        const n = noise(u, v);
        const edge = u === 0 || v === 0 || u === 15 || v === 15;
        if (v < 5) { // grass top
          const base = [0x4c, 0xb8, 0x3c];
          const k = 0.85 + n * 0.3;
          [r, g, b] = base.map((c) => Math.min(255, c * k));
        } else if (v < 7 && n > 0.45) { // grass fringe
          [r, g, b] = [0x45, 0xa8, 0x36];
        } else { // dirt
          const k = 0.85 + n * 0.3;
          [r, g, b] = [0x8a, 0x5a, 0x34].map((c) => Math.min(255, c * k));
        }
        if (edge) { r *= 0.7; g *= 0.7; b *= 0.7; }
      }
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, render(s));
console.log('Wrote icons');
