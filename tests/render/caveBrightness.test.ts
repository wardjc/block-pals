import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import {
  ATLAS_COLS, ATLAS_ROWS, CAVE_TILES, paintCave, TILE_NAMES, tileFor, type CaveTile, type TileName,
} from '../../src/render/atlas';
import { caveLook, OUTDOOR_LOOK, type CaveLook } from '../../src/render/caveLook';
import type { Face } from '../../src/render/mesher';
import { luma, PixelCanvas, type RGBA } from './pixelCanvas';

/**
 * The "dark" guard for the cave art (plan Task 12). Caves are mostly stone lit by these tiles, so
 * every cave tile must be bright, the glow tiles must stay bright on the darkest face the scene's
 * lights give, and plain Stone, Dirt and Bricks must not go gloomy under the cave light either.
 */

const FACES: Face[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];
const NORMAL: Record<Face, [number, number, number]> = {
  top: [0, 1, 0], bottom: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0],
};
const SUN = (() => { const v = [0.5, 1, 0.3]; const l = Math.hypot(...v); return v.map(c => c / l); })();
const SUN_INTENSITY = 0.6;

const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v: number): number => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055);
const hexLinear = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(toLinear) as [number, number, number];

/**
 * The light a face gets in the scene (src/render/scene.ts): a white-sky hemisphere light with the
 * look's ground colour and intensity, plus a white sun of 0.6 from (0.5, 1, 0.3), on Lambert
 * materials (LIGHT_SCALE cancels the 1/pi of the Lambert BRDF). Per channel, linear.
 */
function faceLight(face: Face, look: CaveLook): [number, number, number] {
  const n = NORMAL[face];
  const w = n[1] * 0.5 + 0.5;
  const ground = hexLinear(look.groundColor);
  const sun = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]) * SUN_INTENSITY;
  return ground.map(g => (g + (1 - g) * w) * look.hemiIntensity + sun) as [number, number, number];
}

/** The darkest face (by luma of the light): the underside, for both looks. */
function darkestFace(look: CaveLook): [number, number, number] {
  let best: [number, number, number] = [9, 9, 9];
  const l = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const f of FACES) { const c = faceLight(f, look); if (l(c) < l(best)) best = c; }
  return best;
}

const lit = ([r, g, b, a]: RGBA, light: [number, number, number]): RGBA =>
  [toSrgb(toLinear(r) * light[0]), toSrgb(toLinear(g) * light[1]), toSrgb(toLinear(b) * light[2]), a];

function renderCave(name: CaveTile): RGBA[] {
  const c = new PixelCanvas(16, 16);
  paintCave(name, c);
  return c.cell(0, 0);
}

/** Any atlas tile, through the real atlas (fake document canvas). */
async function renderAtlasTile(name: TileName): Promise<RGBA[]> {
  const { installFakeDocument } = await import('./pixelCanvas');
  const { createAtlas } = await import('../../src/render/atlas');
  const fake = installFakeDocument();
  try {
    createAtlas();
    const sheet = fake.canvases[0].getContext();
    const i = TILE_NAMES.indexOf(name);
    return sheet.cell(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS));
  } finally {
    fake.restore();
  }
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const GLOW: CaveTile[] = ['glowMushroom', 'crystalBlue', 'crystalPink', 'crystalGreen', 'ruinCrystal'];

describe('cave tiles', () => {
  test('ten cave tiles appended after the mythical tiles; the atlas has room and old positions never move', () => {
    expect(CAVE_TILES).toEqual(['glowMushroom', 'crystalBlue', 'crystalPink', 'crystalGreen', 'ruinCrystal', 'gemOre', 'mossyBricks', 'chestSide', 'chestTop', 'chestOpenTop']);
    expect(TILE_NAMES.slice(46)).toEqual(CAVE_TILES);
    expect(TILE_NAMES.indexOf('lamp')).toBe(16);
    expect(TILE_NAMES.indexOf('mirror')).toBe(45);
    expect(ATLAS_ROWS).toBe(14);
    expect(TILE_NAMES.length).toBe(56);
    expect(TILE_NAMES.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_ROWS);
  });

  test('every cave block maps to its own tiles on every face (none falls back to dirt)', () => {
    for (let id = 56; id <= 64; id++) {
      for (const face of FACES) {
        const t = tileFor(id as BlockId, face);
        expect(CAVE_TILES as readonly string[], `${BLOCKS[id as BlockId].name} ${face}`).toContain(t);
      }
    }
    expect(tileFor(BlockId.Chest, 'top')).toBe('chestTop');
    expect(tileFor(BlockId.ChestOpen, 'top')).toBe('chestOpenTop');
    expect(tileFor(BlockId.ChestOpen, 'north')).toBe('chestSide');
  });

  test('every pixel is set and opaque', () => {
    for (const name of CAVE_TILES) {
      const px = renderCave(name);
      expect(px.length).toBe(256);
      for (const p of px) expect(p[3], name).toBe(1);
    }
  });

  test('no tile is dark: mean luminance at least 0.45 (Ruin crystal 0.65) and the darkest pixel at least 0.15', () => {
    for (const name of CAVE_TILES) {
      const ls = renderCave(name).map(luma);
      console.log(`caveBrightness: ${name} mean ${mean(ls).toFixed(3)} darkest ${Math.min(...ls).toFixed(3)}`);
      expect(mean(ls), `${name} mean`).toBeGreaterThanOrEqual(name === 'ruinCrystal' ? 0.65 : 0.45);
      expect(Math.min(...ls), `${name} darkest`).toBeGreaterThanOrEqual(0.15);
    }
  });

  test('glow tiles stay at least 0.6 mean luminance on the darkest face of the cave light, and 0.55 at half light outdoors', () => {
    const deep = darkestFace(caveLook(1));
    expect(FACES.map(f => faceLight(f, caveLook(1)))).toContainEqual(deep);
    for (const name of GLOW) {
      const px = renderCave(name);
      const inCave = mean(px.map(p => luma(lit(p, deep))));
      const half = mean(px.map(p => luma(lit(p, [0.5, 0.5, 0.5]))));
      console.log(`caveBrightness: ${name} darkest cave face ${inCave.toFixed(3)}, half light ${half.toFixed(3)}`);
      expect(inCave, name).toBeGreaterThanOrEqual(0.6);
      expect(half, name).toBeGreaterThanOrEqual(0.55);
    }
  });

  test('the glow blocks use the glow tiles and carry the light flag', () => {
    for (const id of [BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.RuinCrystal]) {
      expect(BLOCKS[id].light).toBe(true);
      expect(GLOW).toContain(tileFor(id, 'bottom'));
    }
  });

  test('Stone, Dirt and Bricks, shaded by the darkest face of the cave light, keep mean luminance at least 0.30 (never gloomy)', async () => {
    const deep = darkestFace(caveLook(1));
    for (const name of ['stone', 'dirt', 'bricks', 'mossyBricks', 'gemOre'] as TileName[]) {
      const px = await renderAtlasTile(name);
      const m = mean(px.map(p => luma(lit(p, deep))));
      console.log(`caveBrightness: ${name} on the darkest cave face ${m.toFixed(3)}`);
      expect(m, name).toBeGreaterThanOrEqual(0.30);
    }
  });

  test('the cave light is never darker than outdoors on any face', () => {
    for (const f of FACES) {
      const out = faceLight(f, OUTDOOR_LOOK);
      const cave = faceLight(f, caveLook(1));
      for (let i = 0; i < 3; i++) expect(cave[i], `${f} ${i}`).toBeGreaterThanOrEqual(out[i] - 1e-9);
    }
  });

  test('the Lamp and path tiles still meet the old brightness rule', async () => {
    for (const name of ['lamp', 'pathStone'] as TileName[]) {
      const ls = (await renderAtlasTile(name)).map(luma);
      expect(mean(ls), name).toBeGreaterThanOrEqual(0.45);
      expect(Math.min(...ls), name).toBeGreaterThanOrEqual(0.15);
    }
  });
});
