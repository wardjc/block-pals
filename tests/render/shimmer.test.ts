// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import {
  ATLAS_COLS, ATLAS_ROWS, createAtlas, MYTHICAL_TILES, paintMythical, SHIMMER_FRAME_SECONDS, SHIMMER_TILES, shimmerFrame,
  TILE_NAMES, type MythicalTile, type ShimmerFrame,
} from '../../src/render/atlas';
import { PixelCanvas } from './pixelCanvas';

// No WebGL in tests: the renderer is a stub, everything else in the scene is real.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class StubRenderer {
    domElement = document.createElement('canvas');
    info = { render: { triangles: 0, calls: 0 } };
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
  }
  return { ...three, WebGLRenderer: StubRenderer };
});

const contexts = new WeakMap<HTMLCanvasElement, PixelCanvas>();
const ctxOf = (c: HTMLCanvasElement): PixelCanvas => {
  let ctx = contexts.get(c);
  if (!ctx) { ctx = new PixelCanvas(c.width, c.height); contexts.set(c, ctx); }
  return ctx;
};

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return ctxOf(this) as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ZmFrZQ==');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe(): void {} disconnect(): void {} };
});
afterAll(() => vi.restoreAllMocks());

function render(name: MythicalTile, frame: ShimmerFrame): ReturnType<PixelCanvas['cell']> {
  const c = new PixelCanvas(16, 16);
  paintMythical(name, c, frame);
  return c.cell(0, 0);
}

function sheetOf(atlas: ReturnType<typeof createAtlas>): PixelCanvas {
  return ctxOf(atlas.texture.image as HTMLCanvasElement);
}

const cellOf = (sheet: PixelCanvas, name: string) => {
  const i = TILE_NAMES.indexOf(name as never);
  return sheet.cell(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS));
};

describe('shimmerFrame', () => {
  test('cycles 0, 1, 2, 3 every 0.4 s', () => {
    expect(SHIMMER_FRAME_SECONDS).toBe(0.4);
    const frames = [0, 0.39, 0.4, 0.79, 0.8, 1.2, 1.59, 1.6, 2.0].map(shimmerFrame);
    expect(frames).toEqual([0, 0, 1, 1, 2, 3, 3, 0, 1]);
  });

  test('survives NaN, negatives, infinities and huge values', () => {
    for (const t of [NaN, -1, -0.5, -1e9, Infinity, -Infinity, 1e15, Number.MAX_VALUE]) {
      const f = shimmerFrame(t);
      expect([0, 1, 2, 3]).toContain(f);
    }
    expect(shimmerFrame(NaN)).toBe(0);
  });
});

describe('Atlas.shimmer', () => {
  test('repaints once per frame change and not between, and marks the texture for upload', () => {
    const atlas = createAtlas();
    const sheet = sheetOf(atlas);
    const v0 = atlas.texture.version;
    // The atlas starts on frame 0: nothing to do at t = 0.
    const before = sheet.fillRects;
    expect(atlas.shimmer(0)).toBe(false);
    expect(atlas.shimmer(0.2)).toBe(false);
    expect(sheet.fillRects).toBe(before);
    expect(atlas.texture.version).toBe(v0);

    expect(atlas.shimmer(0.45)).toBe(true);
    const after1 = sheet.fillRects;
    expect(after1).toBeGreaterThan(before);
    expect(atlas.texture.version).toBe(v0 + 1);
    expect(atlas.shimmer(0.5)).toBe(false);
    expect(atlas.shimmer(0.79)).toBe(false);
    expect(sheet.fillRects).toBe(after1);

    // 10 seconds at 60 fps: one repaint per 0.4 s frame change, 25 in all (frame 1 already painted).
    let repaints = 0;
    for (let i = 0; i <= 600; i++) if (atlas.shimmer(0.45 + i / 60)) repaints++;
    expect(repaints).toBe(25);
  });

  test('a repaint touches only the four shimmer tiles, and draws exactly that frame', () => {
    const atlas = createAtlas();
    const sheet = sheetOf(atlas);
    const others = TILE_NAMES.filter(n => !SHIMMER_TILES.includes(n as MythicalTile));
    const snapshot = others.map(n => cellOf(sheet, n));
    for (const t of [0.4, 0.8, 1.2, 1.6, 2.0]) {
      expect(atlas.shimmer(t)).toBe(true);
      expect(others.map(n => cellOf(sheet, n))).toEqual(snapshot);
      for (const name of SHIMMER_TILES) expect(cellOf(sheet, name)).toEqual(render(name, shimmerFrame(t)));
    }
    // The static, non-shimmer mythical tiles are still frame 0.
    for (const name of MYTHICAL_TILES.filter(n => !SHIMMER_TILES.includes(n))) expect(cellOf(sheet, name)).toEqual(render(name, 0));
  });

  test('bag icons are always the still frame 0, even mid-shimmer', () => {
    const atlas = createAtlas();
    expect(atlas.shimmer(0.9)).toBe(true); // the atlas is on frame 2 now
    const made: HTMLCanvasElement[] = [];
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = real(tag);
      if (tag === 'canvas') made.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement);
    atlas.iconDataUrl(BlockId.RainbowBlock);
    spy.mockRestore();
    expect(made.length).toBe(1);
    const icon = ctxOf(made[0]);
    const want = render('rainbow', 0);
    // The 64 px icon is the 16 px tile scaled by 4: sample one pixel per texel.
    const got: typeof want = [];
    const big = icon.cell(0, 0, 64);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) got.push(big[(y * 4 + 1) * 64 + x * 4 + 1]);
    expect(got).toEqual(want);
    expect(want).not.toEqual(render('rainbow', 2));
  });

  test('UVs never change with the frame', () => {
    const atlas = createAtlas();
    const uvs = () => [BlockId.RainbowBlock, BlockId.StarBlock, BlockId.MagicMirror, BlockId.Grass].map(id => atlas.uvFor(id, 'north'));
    const a = uvs();
    atlas.shimmer(0.4);
    atlas.shimmer(1.3);
    expect(uvs()).toEqual(a);
  });

  test('upload size is the whole atlas, 64 × 192 pixels (about 48 KB)', () => {
    const atlas = createAtlas();
    const img = atlas.texture.image as HTMLCanvasElement;
    expect([img.width, img.height]).toEqual([16 * ATLAS_COLS, 16 * ATLAS_ROWS]);
    expect(img.width * img.height * 4).toBe(49_152);
  });
});

describe('the scene drives the shimmer', () => {
  async function sceneWith(block: [number, number, number] | null, player: [number, number, number]) {
    const { GameScene } = await import('../../src/render/scene');
    const THREE = await import('three');
    const world = new World(96, 16, 96);
    for (let z = 0; z < 96; z++) for (let x = 0; x < 96; x++) world.set(x, 0, z, BlockId.Grass);
    if (block) world.set(...block, BlockId.RainbowBlock);
    const host = document.createElement('div');
    const scene = new GameScene(host, world);
    scene.followTarget(new THREE.Vector3(...player), 1 / 60);
    return scene;
  }

  test('a Rainbow block in view repaints the tiles for 10 simulated seconds and rebuilds no chunk', async () => {
    const scene = await sceneWith([8, 1, 12], [8, 1, 8]);
    expect(scene.anyVisibleShimmer()).toBe(true);
    const builds = scene.stats().chunkBuilds;
    expect(builds).toBe(36); // the first build of every chunk
    for (let i = 0; i <= 600; i++) scene.render(i / 60);
    const s = scene.stats();
    expect(s.chunkBuilds).toBe(builds);
    expect(s.shimmerRepaints).toBe(25);
  });

  test('no repaint when no chunk has a shimmer block', async () => {
    const scene = await sceneWith(null, [8, 1, 8]);
    expect(scene.anyVisibleShimmer()).toBe(false);
    for (let i = 0; i <= 600; i++) scene.render(i / 60);
    expect(scene.stats().shimmerRepaints).toBe(0);
  });

  test('no repaint while the only shimmer chunk is hidden in the far fog', async () => {
    // The camera looks along +z (yaw 0); a block 80 cells ahead is past the fog.
    const scene = await sceneWith([8, 1, 90], [8, 1, 4]);
    expect(scene.anyVisibleShimmer()).toBe(false);
    for (let i = 0; i <= 120; i++) scene.render(i / 60);
    expect(scene.stats().shimmerRepaints).toBe(0);
  });

  test('a dug shimmer block stops the repaint once its chunk is rebuilt', async () => {
    const scene = await sceneWith([8, 1, 12], [8, 1, 8]);
    scene.render(0.5);
    expect(scene.stats().shimmerRepaints).toBe(1);
    (scene as unknown as { world: World }).world.set(8, 1, 12, BlockId.Air);
    scene.rebuildChunkAt(8, 12);
    scene.flush();
    expect(scene.anyVisibleShimmer()).toBe(false);
    for (let i = 0; i < 60; i++) scene.render(1 + i / 60);
    expect(scene.stats().shimmerRepaints).toBe(1);
  });
});
