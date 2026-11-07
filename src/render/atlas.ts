import * as THREE from 'three';
import { BlockId } from '../core/blocks';
import type { Face } from './mesher';

const TILE = 16;
const COLS = 4;
const ROWS = 6;

type TileName =
  | 'grassTop' | 'grassSide' | 'dirt' | 'stone' | 'woodSide' | 'woodTop' | 'leaves'
  | 'sand' | 'water' | 'planks' | 'glass' | 'bricks' | 'bedrock'
  | 'pathStone' | 'roofTile' | 'doorFrame' | 'lamp';

const TILE_NAMES: TileName[] = [
  'grassTop', 'grassSide', 'dirt', 'stone', 'woodSide', 'woodTop', 'leaves',
  'sand', 'water', 'planks', 'glass', 'bricks', 'bedrock',
  'pathStone', 'roofTile', 'doorFrame', 'lamp',
];

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

function drawTile(ctx: CanvasRenderingContext2D, name: TileName): void {
  switch (name) {
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

function tileFor(id: BlockId, face: Face): TileName {
  switch (id) {
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
    const i = TILE_NAMES.indexOf(tileFor(id, id === BlockId.Grass ? 'top' : 'south'));
    octx.drawImage(canvas, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE, 0, 0, 64, 64);
    const url = out.toDataURL('image/png');
    icons.set(id, url);
    return url;
  };

  return { texture, uvFor, iconDataUrl };
}
