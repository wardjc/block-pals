import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { MYTHICAL } from '../../src/core/mythical';
import {
  ATLAS_COLS, ATLAS_ROWS, createAtlas, MYTHICAL_TILES, paintMythical, SHIMMER_TILES, TILE_NAMES, tileFor,
  type MythicalTile,
} from '../../src/render/atlas';
import type { Face } from '../../src/render/mesher';
import { hsl, installFakeDocument, luma, PixelCanvas, shaded, type RGBA } from './pixelCanvas';

const FACES: Face[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];
type Frame = 0 | 1 | 2 | 3;
const FRAMES: Frame[] = [0, 1, 2, 3];

function render(name: MythicalTile, frame: Frame = 0): RGBA[] {
  const c = new PixelCanvas(16, 16);
  paintMythical(name, c, frame);
  return c.cell(0, 0);
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const changed = (a: RGBA[], b: RGBA[]): number => a.filter((p, i) => p.some((v, k) => v !== b[i][k])).length;

describe('mythical tiles', () => {
  test('there are eight, appended after the farm tiles; the old positions never move', () => {
    expect(MYTHICAL_TILES).toEqual(['starlight', 'rainbow', 'cloud', 'moon', 'sun', 'dragonScale', 'star', 'mirror']);
    expect(TILE_NAMES.indexOf('potato3')).toBe(37);
    expect(TILE_NAMES.slice(38)).toEqual(MYTHICAL_TILES);
    expect(ATLAS_ROWS).toBe(12);
    expect(TILE_NAMES.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_ROWS);
  });

  test('all eight tiles are 16×16 and every pixel is set (Magic mirror may be partly see-through)', () => {
    for (const name of MYTHICAL_TILES) {
      const px = render(name);
      expect(px.length).toBe(256);
      for (const p of px) {
        expect(p[3]).toBeGreaterThan(0);
        if (name !== 'mirror') expect(p[3]).toBe(1);
      }
    }
    const mirror = render('mirror');
    expect(mirror.some(p => p[3] < 0.6)).toBe(true); // the see-through middle
    expect(mirror.some(p => p[3] === 1)).toBe(true); // the frame
  });

  test('no tile is dark: every tile, Star block included, has mean luminance at least 0.45 and darkest pixel at least 0.15', () => {
    for (const name of MYTHICAL_TILES) {
      for (const frame of FRAMES) {
        const px = render(name, frame);
        const ls = px.map(luma);
        expect(mean(ls), `${name} mean`).toBeGreaterThanOrEqual(0.45);
        expect(Math.min(...ls), `${name} darkest`).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  test('light tiles stay bright in shade: Starlight, Moon and Sun at half light still have mean luminance 0.55', () => {
    // The lamp trick: lighting multiplies the linear colour, so a very bright tile stays bright even on
    // the worst-lit face (factor 0.5; the real worst, the bottom face, gets about 0.6).
    const lit = MYTHICAL.filter(id => BLOCKS[id].light).map(id => tileFor(id, 'north'));
    expect(lit).toEqual(['starlight', 'moon', 'sun']);
    for (const name of lit as MythicalTile[]) {
      for (const frame of FRAMES) {
        const ls = render(name, frame).map(p => luma(shaded(p, 0.5)));
        expect(mean(ls), name).toBeGreaterThanOrEqual(0.55);
      }
    }
  });

  test('shimmer frames differ pairwise and the cycle wraps after four frames', () => {
    expect([...SHIMMER_TILES].sort()).toEqual(['mirror', 'rainbow', 'star', 'starlight']);
    for (const name of SHIMMER_TILES) {
      const frames = FRAMES.map(f => render(name, f));
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(changed(frames[a], frames[b]), `${name} ${a}/${b}`).toBeGreaterThan(0);
      expect(render(name, (4 % 4) as Frame)).toEqual(frames[0]);
    }
  });

  test('non-shimmer tiles ignore the frame', () => {
    for (const name of MYTHICAL_TILES.filter(n => !SHIMMER_TILES.includes(n))) {
      const f0 = render(name, 0);
      for (const f of FRAMES) expect(render(name, f)).toEqual(f0);
    }
  });

  test('gentle, never flashing: Star block changes at most 6 pixels a frame, every shimmer tile at most 25%', () => {
    for (const name of SHIMMER_TILES) {
      for (const f of FRAMES) {
        const n = changed(render(name, f), render(name, ((f + 1) % 4) as Frame));
        expect(n, `${name} ${f}`).toBeLessThanOrEqual(name === 'star' ? 6 : 64);
      }
    }
  });

  test('no strong dark red and no near-black pixel in any tile', () => {
    for (const name of MYTHICAL_TILES) {
      for (const frame of FRAMES) {
        for (const p of render(name, frame)) {
          const { h, s, l } = hsl(p);
          const reddish = h <= 15 || h >= 345;
          expect(reddish && s > 0.8 && l < 0.5, `${name} red ${p}`).toBe(false);
          expect(l, `${name} black ${p}`).toBeGreaterThanOrEqual(0.1);
        }
      }
    }
  });

  test('tiles are deterministic', () => {
    for (const name of MYTHICAL_TILES) for (const f of FRAMES) expect(render(name, f)).toEqual(render(name, f));
  });

  test('tileFor maps each new block to its own tile on every face', () => {
    const seen = new Set<string>();
    for (const id of MYTHICAL) {
      const tiles = new Set(FACES.map(face => tileFor(id, face)));
      expect(tiles.size).toBe(1);
      const [tile] = tiles;
      expect(MYTHICAL_TILES).toContain(tile);
      expect(tile).toBe(BLOCKS[id].icon);
      seen.add(tile);
    }
    expect(seen.size).toBe(8);
    // No older block falls onto a mythical tile.
    for (let id = 0; id < 40; id++) {
      if (!Object.hasOwn(BLOCKS, id)) continue;
      for (const face of FACES) expect(MYTHICAL_TILES).not.toContain(tileFor(id as BlockId, face));
    }
  });
});

describe('the atlas canvas', () => {
  let fake: ReturnType<typeof installFakeDocument>;
  beforeAll(() => { fake = installFakeDocument(); });
  afterAll(() => fake.restore());

  test('iconDataUrl gives a picture for every new block, and the atlas holds the frame-0 tiles', () => {
    const atlas = createAtlas();
    const sheet = fake.canvases[0];
    expect(sheet.width).toBe(16 * ATLAS_COLS);
    expect(sheet.height).toBe(16 * ATLAS_ROWS);
    for (const id of MYTHICAL) expect(atlas.iconDataUrl(id)).toMatch(/^data:image\/png/);
    MYTHICAL_TILES.forEach(name => {
      const i = TILE_NAMES.indexOf(name);
      expect(sheet.ctx!.cell(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS))).toEqual(render(name, 0));
    });
  });
});
