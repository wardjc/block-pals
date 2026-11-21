// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import { PixelCanvas } from './pixelCanvas';

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

beforeAll(() => {
  const contexts = new WeakMap<HTMLCanvasElement, PixelCanvas>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) { ctx = new PixelCanvas(this.width, this.height); contexts.set(this, ctx); }
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ZmFrZQ==');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe(): void {} disconnect(): void {} };
});
afterAll(() => vi.restoreAllMocks());

/** A 64 x 40 x 64 world: stone to y 20, grass on top (sections 0, 1 and 2). */
function smallWorld(): World {
  const w = new World(64, 40, 64);
  for (let y = 0; y < 20; y++) w.fillLayer(y, BlockId.Stone);
  w.fillLayer(20, BlockId.Grass);
  return w;
}

async function sceneOf(world: World) {
  const { GameScene, DIRTY_PER_FRAME } = await import('../../src/render/scene');
  const THREE = await import('three');
  const scene = new GameScene(document.createElement('div'), world);
  scene.followTarget(new THREE.Vector3(32, 21, 32), 1 / 60);
  scene.flush();
  scene.render(0);
  return { scene, DIRTY_PER_FRAME };
}

describe('the scene draws 16 x 16 x 16 sections', () => {
  test('many changes in one frame rebuild each dirty section once, at most DIRTY_PER_FRAME a frame', async () => {
    const world = smallWorld();
    const { scene, DIRTY_PER_FRAME } = await sceneOf(world);
    world.onChange((x, y, z) => scene.markSectionDirty(x, y, z));
    expect(DIRTY_PER_FRAME).toBe(4);
    const before = scene.stats().chunkBuilds;
    // 6 sections' worth of changes (middle cells, so no border neighbours), many per section.
    const spots = [[8, 8], [24, 8], [40, 8], [8, 24], [24, 24], [40, 24]];
    for (const [x, z] of spots) for (let i = 0; i < 5; i++) world.set(x + i, 25, z, BlockId.Planks);
    scene.render(0.1);
    expect(scene.stats().chunkBuilds - before).toBe(4);
    scene.render(0.2);
    expect(scene.stats().chunkBuilds - before).toBe(6);
    scene.render(0.3);
    expect(scene.stats().chunkBuilds - before).toBe(6);
  });

  test('a dig rebuilds only its own section (plus the one across a border)', async () => {
    const world = smallWorld();
    const { scene } = await sceneOf(world);
    world.onChange((x, y, z) => scene.markSectionDirty(x, y, z));
    const before = scene.stats().chunkBuilds;
    world.set(20, 20, 20, BlockId.Air); // y 20 is inside section 1, mid-column
    scene.render(1);
    expect(scene.stats().chunkBuilds - before).toBe(1);
    world.set(20, 31, 20, BlockId.Planks); // the top layer of section 1: section 2 shares the border
    scene.render(2);
    expect(scene.stats().chunkBuilds - before).toBe(3);
    // Below the ground outdoors (section 0 is never drawn here) nothing is built for a change.
    world.set(20, 3, 20, BlockId.Air);
    scene.render(3);
    expect(scene.stats().chunkBuilds - before).toBe(3);
  });
});
