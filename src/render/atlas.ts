import * as THREE from 'three';
import { BLOCKS, BlockId } from '../core/blocks';
import type { Face } from './mesher';
import { MYTHICAL_TILES, paintMythical, type MythicalTile } from './mythicalTiles';

export { MYTHICAL_TILES, paintMythical, SHIMMER_TILES, type MythicalTile, type Paint, type ShimmerFrame } from './mythicalTiles';

const TILE = 16;
const COLS = 4;
/** 12 rows since the mythical blocks (46 tiles). New tiles are appended; existing positions never move. */
const ROWS = 12;

export type TileName =
  | 'grassTop' | 'grassSide' | 'dirt' | 'stone' | 'woodSide' | 'woodTop' | 'leaves'
  | 'sand' | 'water' | 'planks' | 'glass' | 'bricks' | 'bedrock'
  | 'pathStone' | 'roofTile' | 'doorFrame' | 'lamp'
  | 'farmTop' | 'farmSide' | 'fence' | 'woolWhite' | 'woolRed' | 'woolBlue' | 'woolYellow' | 'sapling' | 'appleLeaves'
  | 'wheat0' | 'wheat1' | 'wheat2' | 'wheat3'
  | 'carrot0' | 'carrot1' | 'carrot2' | 'carrot3'
  | 'potato0' | 'potato1' | 'potato2' | 'potato3'
  | MythicalTile;

export const TILE_NAMES: TileName[] = [
  'grassTop', 'grassSide', 'dirt', 'stone', 'woodSide', 'woodTop', 'leaves',
  'sand', 'water', 'planks', 'glass', 'bricks', 'bedrock',
  'pathStone', 'roofTile', 'doorFrame', 'lamp',
  'farmTop', 'farmSide', 'fence', 'woolWhite', 'woolRed', 'woolBlue', 'woolYellow', 'sapling', 'appleLeaves',
  'wheat0', 'wheat1', 'wheat2', 'wheat3',
  'carrot0', 'carrot1', 'carrot2', 'carrot3',
  'potato0', 'potato1', 'potato2', 'potato3',
  ...MYTHICAL_TILES,
];
export const ATLAS_COLS = COLS;
export const ATLAS_ROWS = ROWS;

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function noisy(ctx: CanvasRenderingContext2D, base: string, seed: number, amount: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      ctx.fillStyle = shade(base, 1 + (hash(x, y, seed) - 0.5) * amount);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

const px = (ctx: CanvasRenderingContext2D, colour: string, x: number, y: number, w = 1, h = 1): void => {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
};

/** A soft knitted block: rows of little stitches in one colour. */
function wool(ctx: CanvasRenderingContext2D, base: string, seed: number): void {
  noisy(ctx, base, seed, 0.08);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const stitch = (x + (y >> 1) * 2) % 4;
      if (y % 4 === 3) px(ctx, shade(base, 0.8), x, y);
      else if (stitch === 0) px(ctx, shade(base, 0.9), x, y);
      else if (stitch === 2 && y % 4 === 1) px(ctx, shade(base, 1.12), x, y);
    }
  }
}

/** Stalks growing from the bottom edge: x, height, colour (the top pixel is a little lighter). */
function stalk(ctx: CanvasRenderingContext2D, x: number, h: number, colour: string, tip?: string): void {
  px(ctx, colour, x, TILE - h, 1, h);
  if (tip) px(ctx, tip, x, TILE - h, 1, 1);
}

function wheatTile(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.clearRect(0, 0, TILE, TILE);
  const xs = [1, 3, 5, 7, 9, 11, 13, 14];
  const heights = [[3, 4, 3, 5, 4, 3, 4, 3], [6, 8, 7, 9, 8, 7, 9, 6], [10, 12, 11, 13, 12, 11, 13, 10], [11, 13, 12, 14, 13, 12, 14, 11]][stage];
  xs.forEach((x, i) => {
    const h = heights[i];
    if (stage < 3) {
      stalk(ctx, x, h, stage === 2 ? '#7cc040' : '#4fae3a', '#8ad84c');
      if (stage > 0) px(ctx, '#3d9a30', x + 1, TILE - Math.floor(h / 2), 1, 2);
    } else {
      stalk(ctx, x, h - 4, '#d6b24a');
      // golden ear with little grains
      px(ctx, '#f2c230', x, TILE - h, 1, 5);
      px(ctx, '#ffd84a', x - 1, TILE - h + 1, 1, 1);
      px(ctx, '#ffd84a', x + 1, TILE - h + 2, 1, 1);
      px(ctx, '#c99a1e', x, TILE - h + 4, 1, 1);
    }
  });
}

function carrotTile(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.clearRect(0, 0, TILE, TILE);
  const fronds = [[7, 8], [5, 7, 9, 10], [3, 5, 7, 9, 11, 12], [3, 5, 7, 9, 11, 12]][stage];
  const top = [11, 8, 5, 5][stage];
  fronds.forEach((x, i) => {
    const h = TILE - top - (i % 2) * 2;
    stalk(ctx, x, Math.max(2, h - 2), '#3fae3a', '#7ad64a');
    px(ctx, '#58c440', x + (i % 2 ? 1 : -1), TILE - Math.max(2, h - 2) + 1, 1, 2);
  });
  if (stage >= 2) px(ctx, '#e8832a', 6, TILE - 2, 4, 2);
  if (stage === 3) {
    px(ctx, '#ff9a2e', 5, TILE - 3, 6, 3);
    px(ctx, '#ffb552', 6, TILE - 3, 2, 1);
  }
}

function potatoTile(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.clearRect(0, 0, TILE, TILE);
  const h = [4, 7, 10, 11][stage];
  const green = stage === 2 ? '#2f8f3a' : '#3fa63a';
  // a bushy plant: a stem and leaf clumps on both sides
  px(ctx, '#2f7d2f', 7, TILE - h, 2, h);
  for (let k = 0; k < Math.max(1, stage + 1); k++) {
    const y = TILE - h + k * 3;
    px(ctx, green, 4 - (k % 2), y, 3, 2);
    px(ctx, green, 9 + (k % 2), y + 1, 3, 2);
    px(ctx, '#58c440', 5 - (k % 2), y, 1, 1);
    px(ctx, '#58c440', 10 + (k % 2), y + 1, 1, 1);
  }
  if (stage === 3) {
    for (const [x, y] of [[4, 2], [11, 3], [7, 0], [3, 6], [12, 7]]) {
      px(ctx, '#fff6ff', x, TILE - h + y, 2, 2);
      px(ctx, '#ffd23f', x, TILE - h + y, 1, 1);
    }
    px(ctx, '#c9985a', 5, TILE - 2, 3, 2);
    px(ctx, '#b9854a', 9, TILE - 2, 3, 2);
  }
}

const isMythicalTile = (name: TileName): name is MythicalTile => (MYTHICAL_TILES as readonly string[]).includes(name);

function drawTile(ctx: CanvasRenderingContext2D, name: TileName): void {
  if (isMythicalTile(name)) {
    paintMythical(name, ctx, 0);
    return;
  }
  switch (name) {
    case 'farmTop':
      noisy(ctx, '#5b3a20', 21, 0.18);
      for (let y = 0; y < TILE; y++) {
        if (y % 4 === 1) px(ctx, '#7a5230', 0, y, TILE, 1);
        if (y % 4 === 3) px(ctx, '#3e2814', 0, y, TILE, 1);
      }
      break;
    case 'farmSide':
      noisy(ctx, '#6b4423', 22, 0.22);
      px(ctx, '#4a2e17', 0, 0, TILE, 2);
      break;
    case 'fence':
      px(ctx, '#5e3f20', 0, 0, TILE, TILE);
      for (let x = 0; x < TILE; x += 4) {
        px(ctx, hash(x, 3, 23) > 0.5 ? '#c8964f' : '#d6a55c', x, 0, 3, TILE);
        px(ctx, '#e6b872', x, 0, 1, TILE);
      }
      px(ctx, '#8c6430', 0, 3, TILE, 2);
      px(ctx, '#8c6430', 0, 11, TILE, 2);
      break;
    case 'woolWhite': wool(ctx, '#f0f0ea', 24); break;
    case 'woolRed': wool(ctx, '#d8473f', 25); break;
    case 'woolBlue': wool(ctx, '#4172dc', 26); break;
    case 'woolYellow': wool(ctx, '#f3c632', 27); break;
    case 'sapling':
      ctx.clearRect(0, 0, TILE, TILE);
      px(ctx, '#7a5530', 7, 8, 2, 8);
      px(ctx, '#5e3f20', 7, 8, 1, 8);
      px(ctx, '#2f9f3a', 4, 3, 8, 6);
      px(ctx, '#3fbf4a', 5, 2, 6, 2);
      px(ctx, '#58d25a', 5, 4, 2, 2);
      px(ctx, '#1f7f2f', 9, 7, 3, 2);
      break;
    case 'appleLeaves':
      drawTile(ctx, 'leaves');
      for (const [x, y] of [[2, 3], [9, 2], [12, 9], [5, 11], [1, 13], [8, 7]]) {
        px(ctx, '#d62a2a', x, y, 2, 2);
        px(ctx, '#ff6b5a', x, y, 1, 1);
      }
      break;
    case 'wheat0': wheatTile(ctx, 0); break;
    case 'wheat1': wheatTile(ctx, 1); break;
    case 'wheat2': wheatTile(ctx, 2); break;
    case 'wheat3': wheatTile(ctx, 3); break;
    case 'carrot0': carrotTile(ctx, 0); break;
    case 'carrot1': carrotTile(ctx, 1); break;
    case 'carrot2': carrotTile(ctx, 2); break;
    case 'carrot3': carrotTile(ctx, 3); break;
    case 'potato0': potatoTile(ctx, 0); break;
    case 'potato1': potatoTile(ctx, 1); break;
    case 'potato2': potatoTile(ctx, 2); break;
    case 'potato3': potatoTile(ctx, 3); break;
    case 'grassTop':
      noisy(ctx, '#5aa83a', 1, 0.25);
      break;
    case 'dirt':
      noisy(ctx, '#8b5a2b', 2, 0.25);
      break;
    case 'grassSide':
      noisy(ctx, '#8b5a2b', 2, 0.25);
      for (let x = 0; x < TILE; x++) {
        const depth = 4 + (hash(x, 0, 9) > 0.55 ? 1 : 0) + (hash(x, 1, 9) > 0.85 ? 1 : 0);
        for (let y = 0; y < depth; y++) {
          ctx.fillStyle = shade('#5aa83a', 1 + (hash(x, y, 1) - 0.5) * 0.25);
          ctx.fillRect(x, y, 1, 1);
        }
      }
      break;
    case 'stone':
      noisy(ctx, '#9a9a9a', 3, 0.2);
      for (let i = 0; i < 22; i++) {
        const x = Math.floor(hash(i, 1, 33) * TILE);
        const y = Math.floor(hash(i, 2, 33) * TILE);
        ctx.fillStyle = hash(i, 3, 33) > 0.5 ? '#7c7c7c' : '#b4b4b4';
        ctx.fillRect(x, y, 1 + (i % 2), 1);
      }
      break;
    case 'woodSide':
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let x = 0; x < TILE; x++) {
        const dark = x % 4 === 0 || hash(x, 0, 5) > 0.8;
        ctx.fillStyle = dark ? '#5e3f20' : '#8a6238';
        ctx.fillRect(x, 0, 1, TILE);
        if (hash(x, 4, 5) > 0.7) {
          ctx.fillStyle = '#6a4727';
          ctx.fillRect(x, Math.floor(hash(x, 7, 5) * TILE), 1, 3);
        }
      }
      break;
    case 'woodTop':
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          const ring = Math.floor(d) % 2 === 0;
          ctx.fillStyle = d > 6.5 ? '#5e3f20' : ring ? '#c39a5c' : '#a8803f';
          ctx.fillRect(x, y, 1, 1);
        }
      }
      break;
    case 'leaves':
      ctx.clearRect(0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const r = hash(x, y, 7);
          if (r < 0.14) continue; // gap
          ctx.fillStyle = shade('#2f8f2f', 0.8 + r * 0.5);
          ctx.fillRect(x, y, 1, 1);
        }
      }
      break;
    case 'sand':
      noisy(ctx, '#e6d690', 4, 0.14);
      break;
    case 'water':
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          ctx.fillStyle = `rgba(${shade('#3f8fe0', 1 + (hash(x, y, 6) - 0.5) * 0.15).slice(4, -1)},0.7)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      break;
    case 'planks':
      ctx.fillStyle = '#b8874a';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let y = 0; y < TILE; y++) {
        if (y % 4 === 3) {
          ctx.fillStyle = '#8c6430';
          ctx.fillRect(0, y, TILE, 1);
        }
      }
      for (let p = 0; p < 4; p++) {
        ctx.fillStyle = '#8c6430';
        ctx.fillRect(p % 2 === 0 ? 5 : 11, p * 4, 1, 3);
      }
      break;
    case 'glass':
      ctx.clearRect(0, 0, TILE, TILE);
      ctx.fillStyle = 'rgba(200,235,250,0.25)';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = 'rgba(220,245,255,0.95)';
      ctx.fillRect(0, 0, TILE, 1);
      ctx.fillRect(0, TILE - 1, TILE, 1);
      ctx.fillRect(0, 0, 1, TILE);
      ctx.fillRect(TILE - 1, 0, 1, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(3, 3, 1, 3);
      ctx.fillRect(4, 3, 2, 1);
      break;
    case 'bricks':
      ctx.fillStyle = '#d8cfc4';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 4;
        for (let bx = -1; bx < 3; bx++) {
          const x = bx * 8 + off;
          ctx.fillStyle = shade('#a8452f', 1 + (hash(bx + 5, row, 8) - 0.5) * 0.2);
          ctx.fillRect(Math.max(0, x), row * 4, Math.min(TILE, x + 7) - Math.max(0, x), 3);
        }
      }
      break;
    case 'bedrock':
      noisy(ctx, '#3d3d3d', 5, 0.6);
      break;
    case 'pathStone': {
      // Warm sandy cobbles (3x3 stones in offset rows) with darker gaps.
      ctx.fillStyle = '#a88f62';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 2;
        for (let bx = -1; bx < 4; bx++) {
          const x = bx * 5 + off;
          ctx.fillStyle = shade('#d9c08c', 1 + (hash(bx + 7, row, 11) - 0.5) * 0.18);
          const x0 = Math.max(0, x);
          const x1 = Math.min(TILE, x + 4);
          if (x1 > x0) ctx.fillRect(x0, row * 4, x1 - x0, 3);
        }
      }
      break;
    }
    case 'roofTile': {
      // Red-orange shingles in offset rows, a darker lip under each row.
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 4;
        for (let bx = -1; bx < 3; bx++) {
          const x = bx * 8 + off;
          const x0 = Math.max(0, x);
          const x1 = Math.min(TILE, x + 8);
          if (x1 <= x0) continue;
          ctx.fillStyle = shade('#d4542f', 1 + (hash(bx + 3, row, 12) - 0.5) * 0.16);
          ctx.fillRect(x0, row * 4, x1 - x0, 3);
          ctx.fillStyle = '#9c3a22';
          ctx.fillRect(x0, row * 4 + 3, x1 - x0, 1);
          ctx.fillRect(x0, row * 4, 1, 3);
        }
      }
      break;
    }
    case 'doorFrame':
      // Dark brown wood with long vertical grain.
      ctx.fillStyle = '#5a3a1c';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let x = 0; x < TILE; x++) {
        ctx.fillStyle = x % 5 === 0 ? '#472c14' : hash(x, 0, 13) > 0.5 ? '#6a4524' : '#5f3d1f';
        ctx.fillRect(x, 0, 1, TILE);
        if (hash(x, 2, 13) > 0.75) {
          ctx.fillStyle = '#4b2f16';
          ctx.fillRect(x, Math.floor(hash(x, 5, 13) * 12), 1, 4);
        }
      }
      break;
    case 'lamp': {
      // Always bright: every pixel is at least #ffe9a0 so side shading cannot make it dim.
      ctx.fillStyle = '#ffeaa4';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#fff2c0';
      ctx.fillRect(2, 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#fff9dc';
      ctx.fillRect(4, 4, TILE - 8, TILE - 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(6, 6, 4, 4);
      for (const [sx, sy] of [[1, 1], [14, 1], [1, 14], [14, 14]]) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, 1, 1);
      }
      break;
    }
  }
}

export function tileFor(id: BlockId, face: Face): TileName {
  const plant = BLOCKS[id]?.plant;
  if (plant) {
    return id === BlockId.Sapling ? 'sapling' : (`${plant.kind}${plant.stage}` as TileName);
  }
  switch (id) {
    case BlockId.Farmland: return face === 'top' ? 'farmTop' : face === 'bottom' ? 'dirt' : 'farmSide';
    case BlockId.Fence: return 'fence';
    case BlockId.WoolWhite: return 'woolWhite';
    case BlockId.WoolRed: return 'woolRed';
    case BlockId.WoolBlue: return 'woolBlue';
    case BlockId.WoolYellow: return 'woolYellow';
    case BlockId.AppleLeaves: return 'appleLeaves';
    case BlockId.Grass: return face === 'top' ? 'grassTop' : face === 'bottom' ? 'dirt' : 'grassSide';
    case BlockId.Dirt: return 'dirt';
    case BlockId.Stone: return 'stone';
    case BlockId.Wood: return face === 'top' || face === 'bottom' ? 'woodTop' : 'woodSide';
    case BlockId.Leaves: return 'leaves';
    case BlockId.Sand: return 'sand';
    case BlockId.Water: return 'water';
    case BlockId.Planks: return 'planks';
    case BlockId.Glass: return 'glass';
    case BlockId.Bricks: return 'bricks';
    case BlockId.Bedrock: return 'bedrock';
    case BlockId.PathStone: return 'pathStone';
    case BlockId.RoofTile: return 'roofTile';
    case BlockId.DoorFrame: return 'doorFrame';
    case BlockId.Lamp: return 'lamp';
    case BlockId.StarlightCrystal: return 'starlight';
    case BlockId.RainbowBlock: return 'rainbow';
    case BlockId.CloudBlock: return 'cloud';
    case BlockId.MoonBlock: return 'moon';
    case BlockId.SunBlock: return 'sun';
    case BlockId.DragonScaleBlock: return 'dragonScale';
    case BlockId.StarBlock: return 'star';
    case BlockId.MagicMirror: return 'mirror';
    default: return 'dirt';
  }
}

export function createAtlas(): {
  texture: THREE.CanvasTexture;
  uvFor: (id: BlockId, face: Face) => [number, number, number, number];
  iconDataUrl: (id: BlockId) => string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * COLS;
  canvas.height = TILE * ROWS;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  TILE_NAMES.forEach((name, i) => {
    ctx.save();
    ctx.translate((i % COLS) * TILE, Math.floor(i / COLS) * TILE);
    ctx.beginPath();
    ctx.rect(0, 0, TILE, TILE);
    ctx.clip();
    drawTile(ctx, name);
    ctx.restore();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const W = canvas.width;
  const H = canvas.height;
  const eps = 0.02; // fraction of a texel, avoids bleeding between tiles
  const uvFor = (id: BlockId, face: Face): [number, number, number, number] => {
    const i = TILE_NAMES.indexOf(tileFor(id, face));
    const px = (i % COLS) * TILE;
    const py = Math.floor(i / COLS) * TILE;
    return [(px + eps) / W, 1 - (py + TILE - eps) / H, (px + TILE - eps) / W, 1 - (py + eps) / H];
  };

  const icons = new Map<BlockId, string>();
  const iconDataUrl = (id: BlockId): string => {
    const cached = icons.get(id);
    if (cached) return cached;
    const out = document.createElement('canvas');
    out.width = out.height = 64;
    const octx = out.getContext('2d')!;
    octx.imageSmoothingEnabled = false;
    const i = TILE_NAMES.indexOf(tileFor(id, id === BlockId.Grass || id === BlockId.Farmland ? 'top' : 'south'));
    octx.drawImage(canvas, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE, 0, 0, 64, 64);
    const url = out.toDataURL('image/png');
    icons.set(id, url);
    return url;
  };

  return { texture, uvFor, iconDataUrl };
}
