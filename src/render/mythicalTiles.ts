/**
 * Original 16×16 art for the wizard's eight mythical blocks. All bright and friendly: nothing dark,
 * nothing strong red. Painters only use `fillRect` and `fillStyle`, so tests can render them into a
 * pixel array without a browser canvas. Four tiles shimmer: a frame (0..3) moves a glint, sheen or
 * twinkle; frame 0 is what static icons show.
 */

export type Paint = { fillRect(x: number, y: number, w: number, h: number): void; fillStyle: string | CanvasGradient | CanvasPattern };

export type MythicalTile = 'starlight' | 'rainbow' | 'cloud' | 'moon' | 'sun' | 'dragonScale' | 'star' | 'mirror';
export type ShimmerFrame = 0 | 1 | 2 | 3;

export const MYTHICAL_TILES: readonly MythicalTile[] = ['starlight', 'rainbow', 'cloud', 'moon', 'sun', 'dragonScale', 'star', 'mirror'];
export const SHIMMER_TILES: readonly MythicalTile[] = ['rainbow', 'starlight', 'star', 'mirror'];

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

const dot = (p: Paint, colour: string, x: number, y: number, w = 1, h = 1): void => {
  p.fillStyle = colour;
  p.fillRect(x, y, w, h);
};

function noisy(p: Paint, base: string, seed: number, amount: number): void {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) dot(p, tone(base, 1 + (hash(x, y, seed) - 0.5) * amount), x, y);
}

/** Blue-white faceted crystal on pale sky blue; a facet glint moves round with the frame. */
function starlight(p: Paint, frame: ShimmerFrame): void {
  noisy(p, '#cfe8ff', 41, 0.06);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d > 7.5) continue;
      if (d > 6.5) dot(p, '#a9d4ff', x, y); // the crystal's edge
      else if (x === 7 || x === 8) dot(p, '#f6fbff', x, y); // the bright ridge
      else if (x < 7) dot(p, y < 8 ? '#d6ebff' : '#c8e3ff', x, y);
      else dot(p, y < 8 ? '#e4f2ff' : '#d4eaff', x, y);
    }
  }
  // Two still twinkles in the corners.
  dot(p, '#ffffff', 2, 2);
  dot(p, '#ffffff', 13, 13);
  // The moving glint: a small white plus on one of four facets.
  const [gx, gy] = ([[5, 5], [10, 5], [10, 10], [5, 10]] as const)[frame];
  dot(p, '#ffffff', gx - 1, gy, 3, 1);
  dot(p, '#ffffff', gx, gy - 1, 1, 3);
}

const RAINBOW = ['#ff7a7a', '#ffad5e', '#ffe066', '#86d982', '#72b6ff', '#b993ff'];

/**
 * Six soft colour bands running diagonally; a pale sheen line sweeps across them. (The bands
 * themselves cannot slide and still loop in four frames: six 4-pixel bands repeat every 24 pixels.)
 */
function rainbow(p: Paint, frame: ShimmerFrame): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const band = RAINBOW[Math.floor(((x + y) % 24) / 4)];
      const sheen = (x + y) % 16 === frame * 4;
      dot(p, sheen ? lift(band, 0.45) : tone(band, 1 + (hash(x, y, 42) - 0.5) * 0.05), x, y);
    }
  }
}

/** Soft white and fluffy, with pale blue shading under each puff. */
function cloud(p: Paint): void {
  const puffs: Array<[number, number, number]> = [[4, 5, 4], [11, 4, 4], [7, 11, 4.5], [14, 12, 3.5], [0, 13, 3.5]];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let colour = tone('#f7fbff', 1 + (hash(x, y, 43) - 0.5) * 0.03);
      for (const [cx, cy, r] of puffs) {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        if (d > r - 1 && dy > 0) colour = '#dbe8f7'; // the soft shade under a puff
        else if (dy < -r / 2 && dx < 0) colour = '#ffffff'; // its sunny top
      }
      dot(p, colour, x, y);
    }
  }
}

/** Silver-white with a few soft craters and a gentle cream glow round the edge. */
function moon(p: Paint): void {
  noisy(p, '#e9edf5', 44, 0.05);
  const craters: Array<[number, number, number]> = [[5, 5, 2.5], [11, 9, 2], [6, 11, 1.5], [12, 3, 1.2]];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      for (const [cx, cy, r] of craters) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) dot(p, x + y < cx + cy ? '#d3d9e6' : '#dde2ec', x, y);
        else if (d <= r + 0.8 && x + y > cx + cy) dot(p, '#f8fafd', x, y); // the lit rim
      }
    }
  }
  // Cream glow border.
  dot(p, '#fff3c8', 0, 0, T, 1);
  dot(p, '#fff3c8', 0, T - 1, T, 1);
  dot(p, '#fff3c8', 0, 0, 1, T);
  dot(p, '#fff3c8', T - 1, 0, 1, T);
  dot(p, '#fbf5df', 1, 1, T - 2, 1);
  dot(p, '#fbf5df', 1, T - 2, T - 2, 1);
  dot(p, '#fbf5df', 1, 1, 1, T - 2);
  dot(p, '#fbf5df', T - 2, 1, 1, T - 2);
}

/** Warm gold with lighter rays and a cream centre. */
function sun(p: Paint): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const ray = Math.cos(a * 8) > 0.55;
      let colour: string;
      if (d < 2.5) colour = '#fffbe6';
      else if (d < 4.5) colour = '#fff1bd';
      else if (ray) colour = d < 6.5 ? '#ffe68a' : '#ffdd70';
      else colour = tone('#ffd04a', 1 + (hash(x, y, 45) - 0.5) * 0.04);
      dot(p, colour, x, y);
    }
  }
}

/** Overlapping scales, alternating green and gold, each with a pale highlight and a soft lip. */
function dragonScale(p: Paint): void {
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / 4);
    const off = (row % 2) * 2;
    const ly = y % 4;
    for (let x = 0; x < T; x++) {
      const lx = (x + off) % 4;
      const gold = (Math.floor((x + off) / 4) + row) % 2 === 1;
      const base = gold ? '#f2c94c' : '#62cf6c';
      let colour = base;
      if (ly === 3 && (lx === 0 || lx === 3)) colour = gold ? '#d9a93a' : '#45b259'; // the lip between scales
      else if (ly === 3) colour = tone(base, 0.92);
      else if (ly === 0 && (lx === 1 || lx === 2)) colour = gold ? '#fff0b0' : '#d6f7a8'; // highlight
      dot(p, colour, x, y);
    }
  }
}

const STARS: Array<[number, number]> = [[3, 3], [11, 4], [7, 9], [2, 12], [13, 12]];

/** A bright, rich sky blue (never night-dark) with white and pale yellow stars; four of them take turns to twinkle, one a frame. */
function star(p: Paint, frame: ShimmerFrame): void {
  noisy(p, '#5b7cec', 46, 0.06);
  for (let i = 0; i < 9; i++) dot(p, '#c8d4ff', Math.floor(hash(i, 1, 46) * T), Math.floor(hash(i, 2, 46) * T)); // tiny far stars
  STARS.forEach(([x, y], i) => {
    dot(p, i % 2 ? '#fff3a0' : '#ffffff', x, y);
    dot(p, '#fff7c4', x - 1, y);
    dot(p, '#fff7c4', x + 1, y);
    dot(p, '#fff7c4', x, y - 1);
    dot(p, '#fff7c4', x, y + 1);
    if (i === frame) {
      dot(p, '#ffffff', x - 2, y);
      dot(p, '#ffffff', x + 2, y);
      dot(p, '#ffffff', x, y - 2);
    }
  });
}

/** Pale cyan see-through glass in a white frame, with sparkles and a diagonal glimmer that sweeps. */
function mirror(p: Paint, frame: ShimmerFrame): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const edge = x === 0 || y === 0 || x === T - 1 || y === T - 1;
      const inner = x === 1 || y === 1 || x === T - 2 || y === T - 2;
      if (edge) dot(p, '#ffffff', x, y);
      else if (inner) dot(p, '#c8f4ff', x, y);
      else if ((x + y) % 16 === frame * 4) dot(p, 'rgba(255,255,255,0.85)', x, y);
      else dot(p, 'rgba(190,240,255,0.35)', x, y);
    }
  }
  for (const [x, y] of [[4, 3], [11, 6], [6, 12]] as const) dot(p, '#ffffff', x, y);
}

/** Paints one 16×16 mythical tile at (0, 0) of `p` (translate first). Frame 0 for static icons. */
export function paintMythical(name: MythicalTile, p: Paint, frame: ShimmerFrame): void {
  const f = (((Math.floor(frame) % 4) + 4) % 4) as ShimmerFrame;
  switch (name) {
    case 'starlight': starlight(p, f); break;
    case 'rainbow': rainbow(p, f); break;
    case 'cloud': cloud(p); break;
    case 'moon': moon(p); break;
    case 'sun': sun(p); break;
    case 'dragonScale': dragonScale(p); break;
    case 'star': star(p, f); break;
    case 'mirror': mirror(p, f); break;
  }
}
