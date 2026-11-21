// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { generateWorld } from '../../src/core/worldgen';
import { radialFactor, visibleSections } from '../../src/render/chunkCull';
import { DirtySections } from '../../src/render/chunkDirty';
import { cameraFar, currentCameraFar } from '../../src/render/depthPolicy';
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

type Scene = import('../../src/render/scene').GameScene;
interface Internals {
  chunks: Map<string, unknown>;
  queue: { size: number; pending: Map<string, number> };
  shown: Set<string> | null;
  priority(cx: number, sy: number, cz: number, c: { x: number; y: number; z: number }, f: { x: number; z: number }): number;
  rebuildSection(cx: number, sy: number, cz: number): void;
}
const inner = (s: Scene): Internals => s as unknown as Internals;

async function sceneAt(x = 96.5, z = 96.5, yaw = 0.6) {
  const { GameScene } = await import('../../src/render/scene');
  const THREE = await import('three');
  const g = generateWorld(2026);
  const scene = new GameScene(document.createElement('div'), g.world);
  // The tablet's shape (the stub renderer sizes nothing).
  scene.camera.aspect = 1.6;
  scene.camera.updateProjectionMatrix();
  scene.rig.yaw = yaw;
  scene.rig.pitch = 0.3;
  const feet = new THREE.Vector3(x, g.world.topSolidY(Math.floor(x), Math.floor(z)) + 1, z);
  const step = (dt = 1 / 30): void => { scene.followTarget(feet, dt); scene.render(0); };
  return { scene, g, feet, step, THREE };
}

describe('the scene follows the view distance', () => {
  test('a new distance eases fog.far to the value within 1.5 s and no frame moves it by more than 8 blocks', async () => {
    const { scene, step } = await sceneAt();
    step();
    expect((scene.scene.fog as { far: number }).far).toBe(40);
    scene.setViewDistance(96);
    let prev = 40;
    for (let i = 0; i < 46; i++) {
      step();
      const far = (scene.scene.fog as { far: number }).far;
      expect(Math.abs(far - prev)).toBeLessThanOrEqual(8);
      prev = far;
    }
    expect((scene.scene.fog as { far: number; near: number }).far).toBe(96);
    expect((scene.scene.fog as { far: number; near: number }).near).toBe(48);
    scene.setViewDistance(40);
    for (let i = 0; i < 46; i++) step();
    expect((scene.scene.fog as { far: number; near: number }).far).toBe(40);
    expect((scene.scene.fog as { far: number; near: number }).near).toBe(20);
  });

  test('camera.far equals cameraFar of the larger of the fog and its target, and updateProjectionMatrix runs only when it changes', async () => {
    const { scene, step } = await sceneAt();
    for (let i = 0; i < 30; i++) step(); // the near plane settles
    // Record the far plane at every projection update (the near plane also eases, which updates too).
    const fars: number[] = [];
    const real = scene.camera.updateProjectionMatrix.bind(scene.camera);
    scene.camera.updateProjectionMatrix = () => { fars.push(scene.camera.far); real(); };
    for (let i = 0; i < 30; i++) step();
    expect(fars).toHaveLength(0); // a still camera at a steady view updates nothing
    scene.setViewDistance(96);
    step();
    expect(scene.camera.far).toBe(cameraFar(96));
    expect(currentCameraFar()).toBe(100);
    for (let i = 0; i < 60; i++) step();
    expect(new Set(fars)).toEqual(new Set([100])); // the far plane moved once, straight to 100
    const updates = fars.length;
    for (let i = 0; i < 30; i++) step();
    expect(fars.length).toBe(updates); // settled again: nothing per frame
    scene.setViewDistance(40);
    for (let i = 0; i < 60; i++) step();
    expect(scene.camera.far).toBe(44);
    expect(fars.filter(f => f === 44).length).toBeGreaterThanOrEqual(1);
    expect(fars.slice(updates).every(f => f === 100 || f === 44)).toBe(true);
  });

  test('at load only sections the camera sees at 40 are built (at most 60); the rest queue', async () => {
    const { scene, feet } = await sceneAt(72.5, 72.5);
    scene.followTarget(feet, 1 / 30);
    const s = scene.stats();
    console.log(`first frame at spawn: ${s.chunkBuilds} sections built, ${s.meshed} with geometry, ${s.queued} queued`);
    expect(s.chunkBuilds).toBeLessThanOrEqual(60);
    const shown = inner(scene).shown!;
    for (const k of inner(scene).chunks.keys()) expect(shown.has(k)).toBe(true);
    expect(s.queued).toBeGreaterThan(0);
  });

  test('after growing only the new ring is queued and nothing built is rebuilt', async () => {
    const { scene, step, feet } = await sceneAt();
    for (let i = 0; i < 30; i++) step(); // the camera settles behind him
    scene.flush();
    const built = new Set(inner(scene).chunks.keys());
    const builds = scene.stats().chunkBuilds;
    scene.setViewDistance(48);
    scene.followTarget(feet, 1 / 30);
    // Every queued key is new; nothing built is queued again.
    const pending = [...inner(scene).queue.pending.keys()];
    expect(pending.length).toBeGreaterThan(0);
    for (const k of pending) expect(built.has(k)).toBe(false);
    scene.flush();
    const added = [...inner(scene).chunks.keys()].filter(k => !built.has(k)).length;
    expect(scene.stats().chunkBuilds - builds).toBe(added);
  });

  test('the section ahead of him builds before one beside him at equal distance', async () => {
    const { scene } = await sceneAt();
    const c = { x: 96, y: 60, z: 96 };
    const f = { x: 0, z: 1 };
    const ahead = inner(scene).priority(6, 3, 8, c, f); // centre (104, 136): 40 ahead
    const beside = inner(scene).priority(8, 3, 6, c, f); // centre (136, 104): 40 to the side
    expect(ahead).toBeLessThan(beside);
  });

  test('a dig section rebuilds before a lazy one, and no frame builds more than 2 lazy sections, a stall frame included', async () => {
    const { scene, g, feet, step } = await sceneAt();
    step();
    g.world.onChange((x, y, z) => scene.markSectionDirty(x, y, z));
    expect(scene.stats().queued).toBeGreaterThan(4);
    const order: string[] = [];
    const real = inner(scene).rebuildSection.bind(scene);
    inner(scene).rebuildSection = (cx, sy, cz) => { order.push(`${cx},${sy},${cz}`); real(cx, sy, cz); };
    const x = Math.floor(feet.x) + 2, z = Math.floor(feet.z) + 3;
    const y = g.world.topSolidY(x, z);
    const marks = new DirtySections(192, 68, 192);
    marks.mark(x, y, z);
    const dirtyCount = marks.size;
    g.world.set(x, y, z, BlockId.Air);
    const dug = `${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`;
    scene.render(0);
    expect(order.slice(0, dirtyCount)).toContain(dug);
    expect(order.length).toBeLessThanOrEqual(dirtyCount + 2);
    for (const dt of [1 / 30, 0.4, 1 / 30, 2]) {
      order.length = 0;
      scene.followTarget(feet, dt);
      scene.render(0);
      expect(order.length).toBeLessThanOrEqual(2);
    }
  });

  test('shrinking frees sections beyond the reach after the 20 s grace, at most 4 a frame, farthest first', async () => {
    const { scene, step, feet, g } = await sceneAt();
    scene.setViewDistance(96);
    for (let i = 0; i < 50; i++) step();
    scene.flush();
    const before = inner(scene).chunks.size;
    scene.setViewDistance(40);
    // Move to a corner so much of the world is beyond the reach.
    feet.set(10.5, g.world.topSolidY(10, 10) + 1, 10.5);
    for (let i = 0; i < 30; i++) step(0.5); // 15 s: still inside the grace
    expect(inner(scene).chunks.size).toBeGreaterThan(before - 40);
    const sizes: number[] = [];
    for (let i = 0; i < 40; i++) {
      const n = inner(scene).chunks.size;
      step(0.25);
      sizes.push(n - inner(scene).chunks.size);
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // Whatever is left is inside the reach plus the slack (or still waiting for its grace).
    const set40 = visibleSections(192, 68, 192, scene.rig.position.x, scene.rig.position.y, scene.rig.position.z,
      scene.rig.forward.x, scene.rig.forward.y, scene.rig.forward.z, 'outdoors', feet.x, feet.z, 40, { radialFactor: radialFactor(60, 1.6) });
    for (const k of set40) if (!inner(scene).chunks.has(k)) expect(inner(scene).queue.pending.has(k)).toBe(true);
  });

  test('underground the look eases to the brighter cave haze over about a second, and back out again', async () => {
    const { scene, g, feet, step } = await sceneAt();
    step();
    expect(scene.lookNow()).toMatchObject({ depthFactor: 0, fogColor: 0x78c6ff, zone: 'outdoors' });
    // A room deep in the rock: the camera is inside the ground mass.
    for (let x = 88; x < 106; x++) for (let z = 88; z < 106; z++) for (let y = 20; y < 27; y++) g.world.set(x, y, z, BlockId.Air);
    feet.set(96.5, 20, 96.5);
    const outdoorLum = scene.lookNow().luminance;
    let prev = outdoorLum;
    for (let i = 0; i < 40; i++) {
      step();
      const l = scene.lookNow();
      expect(l.luminance).toBeGreaterThanOrEqual(prev - 1e-9); // never darker on the way in
      prev = l.luminance;
    }
    const deep = scene.lookNow();
    expect(deep.zone).toBe('underground');
    expect(deep.depthFactor).toBe(1);
    expect(deep.luminance).toBeGreaterThanOrEqual(0.62);
    expect(deep.fogFar).toBe(36);
    expect((scene.scene.fog as { far: number }).far).toBe(36);
    expect((scene.scene.background as { getHex(): number }).getHex()).toBe(deep.fogColor);
    feet.set(96.5, g.world.topSolidY(96, 96) + 1, 96.5);
    for (let i = 0; i < 40; i++) step();
    expect(scene.lookNow()).toMatchObject({ depthFactor: 0, fogColor: 0x78c6ff, zone: 'outdoors' });
  });

  test('160 meshed sections is a hard cap for sections outside the draw set', async () => {
    const { MAX_BUILT_SECTIONS } = await import('../../src/render/scene');
    expect(MAX_BUILT_SECTIONS).toBe(160);
    const { scene, step } = await sceneAt();
    step();
    // Build every surface section of the world by hand (more than the cap), then let the scene tidy up.
    for (let cz = 0; cz < 12; cz++) for (let cx = 0; cx < 12; cx++) for (const sy of [3, 4]) inner(scene).rebuildSection(cx, sy, cz);
    expect(scene.stats().meshed).toBeGreaterThan(MAX_BUILT_SECTIONS);
    for (let i = 0; i < 200; i++) step(0.3);
    const s = scene.stats();
    const shownMeshed = [...inner(scene).chunks.keys()].filter(k => inner(scene).shown!.has(k)).length;
    expect(s.meshed <= MAX_BUILT_SECTIONS || s.meshed <= shownMeshed).toBe(true);
  });
});
