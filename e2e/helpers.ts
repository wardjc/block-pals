import { expect, type Page } from '@playwright/test';

export const URL = '/block-pals/?debug';
export type Cell = [number, number, number];
export type Rect = { x0: number; z0: number; x1: number; z1: number };

/** The debug hooks the farm story uses (main.ts registers them under ?debug). */
export interface FarmDbg {
  playerPos(): { x: number; y: number; z: number };
  pipPos(): { x: number; y: number; z: number };
  giveItem(id: number, n: number): void;
  selectStack(id: number | 'hand'): void;
  openBag(): void;
  bag(): Array<{ id: number; count: number }>;
  screenOf(x: number, y: number, z: number): { x: number; y: number };
  screenOfAnimal(id: number): { x: number; y: number } | null;
  pick(x: number, y: number): { cell: Cell; normal: Cell } | null;
  setCamera(yaw: number, pitch: number): void;
  camera(): { position: { x: number; y: number; z: number }; yaw: number; pitch: number; distance: number; close: boolean };
  teleport(x: number, y: number, z: number): boolean;
  saveNow(): void;
  resumeAudio(): void;
  audioState(): { ctx: string | null; tapped: boolean; locked: boolean; pending: string | null; busy: boolean };
  voiceLast(): { source: 'clip' | 'tts' | 'none'; key: string };
  flags(): { ledToVillage: boolean; fernSeeds?: boolean; hints?: string[] };
  eating(): { active: boolean; progress: number; bite: number; food: number | null };
  layoutFarm(): { beds: Rect[]; pool: Rect; irrigation: Rect; pasture: Rect; gate: Cell[]; fence: Cell[]; path: Rect };
  herd(): Array<{ id: number; kind: string; x: number; y: number; z: number; state: string; giftIn: number }>;
  farm(): { crops: Array<{ x: number; y: number; z: number; p: number }>; trees: unknown[]; seeds: { seeds: number; growing: number } };
  village(): { houses: Array<{ id: string; doorFront: Cell; doorInside: Cell; floor: Cell[] }> };
  stats(): { chunks: number; visible: number; triangles: number; drawCalls: number; fps: number; worldTriangles: number; animals: number; particles: number };
  worldSize(): { x: number; y: number; z: number };
  game: {
    applyIntent(i: unknown): void;
    selected: number | 'hand';
    tryCraft(id: string): boolean;
    paused: boolean;
    inventory: { count(id: number): number };
    world: { get(x: number, y: number, z: number): number; topSolidY(x: number, z: number): number; set(x: number, y: number, z: number, id: number): void };
  };
}

export async function frames(page: Page, n = 5): Promise<void> {
  await page.evaluate(count => new Promise<void>(res => {
    const tick = () => (--count <= 0 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

export async function ready(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
  await frames(page, 10);
}

/** A real touch press held for `ms`, with an optional look at the page half way. */
export async function press(page: Page, x: number, y: number, ms: number, during?: () => Promise<void>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  if (during) { await page.waitForTimeout(ms / 2); await during(); await page.waitForTimeout(ms / 2); } else await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function drag(page: Page, x: number, y: number, dx: number, dy: number, steps = 20): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Puts him on a standable cell and turns the camera so it looks at (tx, tz). */
export async function standLooking(page: Page, stand: { x: number; z: number }, tx: number, tz: number): Promise<void> {
  const ok = await page.evaluate(([sx, sz, ax, az]) => {
    const d = window.__debug as unknown as FarmDbg;
    const y = d.game.world.topSolidY(sx, sz) + 1;
    const placed = d.teleport(sx + 0.5, y, sz + 0.5);
    d.setCamera(Math.atan2(ax - (sx + 0.5), az - (sz + 0.5)), 0.55);
    return placed;
  }, [stand.x, stand.z, tx, tz]);
  expect(ok).toBe(true);
  await frames(page, 25);
}

/** The screen point of a world cell's middle, checked to pick that very cell. */
export async function screenOfCell(page: Page, cell: Cell, dy = 0.5): Promise<{ x: number; y: number }> {
  const s = await page.evaluate(([x, y, z, off]) => {
    const d = window.__debug as unknown as FarmDbg;
    const p = d.screenOf(x + 0.5, y + off, z + 0.5);
    const hit = d.pick(p.x, p.y);
    return { ...p, hit };
  }, [cell[0], cell[1], cell[2], dy]);
  expect(s.hit, `a tap at ${cell} should pick it`).not.toBeNull();
  return { x: s.x, y: s.y };
}

export async function walkTo(page: Page, cell: Cell, tol = 1.3, capMs = 40_000): Promise<void> {
  await page.evaluate(c => (window.__debug as unknown as FarmDbg).game.applyIntent({ kind: 'walk', to: c }), cell);
  await expect.poll(() => page.evaluate(c => {
    const p = (window.__debug as unknown as FarmDbg).playerPos();
    return Math.hypot(p.x - (c[0] + 0.5), p.z - (c[2] + 0.5));
  }, cell), { timeout: capMs, intervals: [100] }).toBeLessThan(tol);
}
