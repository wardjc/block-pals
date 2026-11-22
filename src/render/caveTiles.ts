import type { Paint } from './mythicalTiles';

/**
 * Original 16×16 art for the cave blocks (spec 7h, plan Task 12). Everything is bright and soft:
 * caves must never look dark. Glow tiles are pale enough that even the darkest face of the cave
 * light (the underside) stays bright: they are the cave's "lights", as the Lamp is outdoors (no real
 * light is used). Patterns only, never anything like a face. Painters use only `fillRect` and
 * `fillStyle`, so tests render them into a pixel array without a browser canvas.
 */

export type CaveTile =
  | 'glowMushroom' | 'crystalBlue' | 'crystalPink' | 'crystalGreen' | 'ruinCrystal'
  | 'gemOre' | 'mossyBricks' | 'chestSide' | 'chestTop' | 'chestOpenTop';

/** Appended after the mythical tiles; this order never changes once shipped. */
export const CAVE_TILES: readonly CaveTile[] = [
  'glowMushroom', 'crystalBlue', 'crystalPink', 'crystalGreen', 'ruinCrystal',
  'gemOre', 'mossyBricks', 'chestSide', 'chestTop', 'chestOpenTop',
];

const T = 16;

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const hexByte = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Multiply a colour by f (above 1 lightens, clamped). */
const tone = (hex: string, f: number): string => '#' + rgb(hex).map(c => hexByte(c * f)).join('');
/** Mix a colour towards white by t (0..1). */
const lift = (hex: string, t: number): string => '#' + rgb(hex).map(c => hexByte(c + (255 - c) * t)).join('');
/** Mix two colours (t = 0 gives a, 1 gives b). */
const mix = (a: string, b: string, t: number): string => {
  const ca = rgb(a), cb = rgb(b);
  return '#' + ca.map((c, i) => hexByte(c + (cb[i] - c) * t)).join('');
};

const dot = (p: Paint, colour: string, x: number, y: number, w = 1, h = 1): void => {
  p.fillStyle = colour;
  p.fillRect(x, y, w, h);
};

function noisy(p: Paint, base: string, seed: number, amount: number): void {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) dot(p, tone(base, 1 + (hash(x, y, seed) - 0.5) * amount), x, y);
}

/** A soft glowing border one pixel wide. */
function border(p: Paint, colour: string): void {
  dot(p, colour, 0, 0, T, 1);
  dot(p, colour, 0, T - 1, T, 1);
  dot(p, colour, 0, 0, 1, T);
  dot(p, colour, T - 1, 0, 1, T);
}

/** Warm cream mushroom-cap block with soft orange spots on lighter rings, and a pale glow border. */
function glowMushroom(p: Paint): void {
  noisy(p, '#fff0d2', 61, 0.04);
  const spots: Array<[number, number, number]> = [[4, 4, 2.6], [11, 5, 2.2], [7, 11, 2.8], [13, 12, 1.6], [2, 12, 1.4]];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      for (const [sx, sy, r] of spots) {
        const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (d <= r) dot(p, d < r * 0.45 ? '#ffd19a' : '#ffc27e', x, y);
        else if (d <= r + 1) dot(p, '#fffaf0', x, y); // the lighter ring round each spot
      }
    }
  }
  border(p, '#ffe7b0');
  dot(p, '#ffffff', 5, 3);
  dot(p, '#ffffff', 10, 4);
}

/** A faceted crystal cube in one pastel colour: diamond facets, a white ridge, glints, a light border. */
function crystal(p: Paint, base: string, seed: number): void {
  const light = lift(base, 0.55);
  const mid = lift(base, 0.3);
  noisy(p, light, seed, 0.04);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d > 7.5) continue;
      if (d > 6.5) dot(p, mid, x, y); // the facet edge
      else if (x === 7 || x === 8) dot(p, '#ffffff', x, y); // the bright ridge
      else if (x < 7) dot(p, y < 8 ? lift(base, 0.42) : mid, x, y);
      else dot(p, y < 8 ? lift(base, 0.62) : lift(base, 0.5), x, y);
    }
  }
  border(p, lift(base, 0.72));
  for (const [gx, gy] of [[3, 3], [12, 2], [2, 12], [13, 13], [5, 6], [10, 10]]) dot(p, '#ffffff', gx, gy);
}

/** Warm amber core fading to rose, a white four-point star glint, a pale gold glowing border. */
function ruinCrystal(p: Paint): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 10.6;
      const c = mix('#ffcf7a', '#ffb3c4', Math.min(1, d * 1.2));
      dot(p, tone(c, 1 + (hash(x, y, 64) - 0.5) * 0.05), x, y);
    }
  }
  // Facet lines, lighter (never darker) than the crystal.
  for (let i = 2; i < 14; i++) {
    dot(p, '#ffe2b8', i, i);
    dot(p, '#ffe2b8', i, 15 - i);
  }
  // The star: a long white plus with a soft halo.
  dot(p, '#fff6dc', 6, 5, 4, 6);
  dot(p, '#ffffff', 7, 2, 2, 12);
  dot(p, '#ffffff', 2, 7, 12, 2);
  dot(p, '#ffffff', 6, 6, 4, 4);
  border(p, '#ffe9a8');
  dot(p, '#fff6cc', 1, 1, 2, 1);
  dot(p, '#fff6cc', 13, 14, 2, 1);
}

/** Pale stone with four big bright facets (white, sky, pink, mint) and tiny sparkles. */
function gemOre(p: Paint): void {
  noisy(p, '#a9a9ad', 60, 0.16);
  const gems: Array<[number, number, string]> = [[4, 4, '#ffffff'], [11, 4, '#8fe6ff'], [5, 11, '#ffa6d6'], [12, 11, '#9ff0c0']];
  for (const [gx, gy, c] of gems) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const d = Math.abs(x) + Math.abs(y);
        if (d > 2) continue;
        dot(p, d === 2 ? tone(c, 0.92) : d === 1 ? c : lift(c, 0.6), gx + x, gy + y);
      }
    }
    dot(p, '#ffffff', gx - 1, gy - 1);
  }
  for (const [sx, sy] of [[8, 1], [1, 8], [14, 7], [8, 14], [8, 8]]) dot(p, '#ffffff', sx, sy);
}

/** The village brick tile with soft green moss patches growing over it. */
function mossyBricks(p: Paint): void {
  dot(p, '#d8cfc4', 0, 0, T, T);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 === 0 ? 0 : 4;
    for (let bx = -1; bx < 3; bx++) {
      const x = bx * 8 + off;
      const x0 = Math.max(0, x), x1 = Math.min(T, x + 7);
      if (x1 > x0) dot(p, tone('#b5543c', 1 + (hash(bx + 5, row, 8) - 0.5) * 0.2), x0, row * 4, x1 - x0, 3);
    }
  }
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      // Moss settles in clumps, more on the lower half.
      const clump = Math.hypot(x - 4, y - 12) < 4.5 || Math.hypot(x - 12, y - 9) < 3.5 || Math.hypot(x - 9, y - 2) < 2.2;
      if (clump && hash(x, y, 61) > 0.25) dot(p, hash(x, y, 62) > 0.5 ? '#9bd06a' : '#86c25a', x, y);
    }
  }
}

const WOOD = '#cf9150';
const WOOD_DARK = '#b77a3e';
const GOLD = '#ffd34f';
const GOLD_LIGHT = '#fff0a8';

/** Warm wooden boards with grain (the chest's sides and lid). */
function boards(p: Paint, base: string, seed: number): void {
  dot(p, base, 0, 0, T, T);
  for (let y = 0; y < T; y++) {
    if (y % 5 === 4) dot(p, tone(base, 0.86), 0, y, T, 1);
    for (let x = 0; x < T; x++) if (hash(x, y, seed) > 0.86) dot(p, tone(base, 0.93), x, y);
  }
}

/** The chest's side: boards, a gold band and a gold clasp in the middle, light corner posts. */
function chestSide(p: Paint): void {
  boards(p, WOOD, 71);
  dot(p, WOOD_DARK, 0, 0, 2, T);
  dot(p, WOOD_DARK, T - 2, 0, 2, T);
  dot(p, GOLD, 0, 5, T, 2);
  dot(p, '#e8b83c', 0, 7, T, 1);
  // The clasp.
  dot(p, '#e8b83c', 6, 4, 4, 5);
  dot(p, GOLD, 7, 5, 2, 3);
  dot(p, GOLD_LIGHT, 7, 5, 1, 1);
  dot(p, '#fff8d8', 0, 0, T, 1);
}

/** The closed lid: boards with a gold band across and gold corners. */
function chestTop(p: Paint): void {
  boards(p, WOOD, 72);
  dot(p, GOLD, 6, 0, 4, T);
  dot(p, GOLD_LIGHT, 7, 0, 1, T);
  for (const [cx, cy] of [[0, 0], [14, 0], [0, 14], [14, 14]]) dot(p, GOLD, cx, cy, 2, 2);
}

/** The open chest from above: a lighter lid rim round a soft gold glow inside. */
function chestOpenTop(p: Paint): void {
  boards(p, '#e2ac6e', 73);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      dot(p, mix('#fff6c8', '#ffd98a', Math.min(1, d)), x, y);
    }
  }
  dot(p, '#ffffff', 6, 6, 2, 2);
  dot(p, '#ffffff', 9, 9, 1, 1);
  dot(p, GOLD, 0, 0, T, 1);
  dot(p, GOLD, 0, T - 1, T, 1);
}

export function paintCave(name: CaveTile, p: Paint): void {
  switch (name) {
    case 'glowMushroom': glowMushroom(p); break;
    case 'crystalBlue': crystal(p, '#7cc4ff', 57); break;
    case 'crystalPink': crystal(p, '#ff8fc0', 58); break;
    case 'crystalGreen': crystal(p, '#6fe3a8', 59); break;
    case 'ruinCrystal': ruinCrystal(p); break;
    case 'gemOre': gemOre(p); break;
    case 'mossyBricks': mossyBricks(p); break;
    case 'chestSide': chestSide(p); break;
    case 'chestTop': chestTop(p); break;
    case 'chestOpenTop': chestOpenTop(p); break;
  }
}
