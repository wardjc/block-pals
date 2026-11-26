import { expect, test, type Page } from '@playwright/test';
import { BlockId } from '../src/core/blocks';
import { ItemId } from '../src/core/items';
import { frames, ready, standLooking, type Cell, type FarmDbg } from './helpers';

// Grumps and friendly weapons: the browser story. Long waits use the debug hooks; the gestures that
// matter (quick tap with a weapon, with the hand, press and hold) use real touch.
interface GrumpDbg extends Omit<FarmDbg, 'stats'> {
  grumps(): Array<{ id: number; kind: string; x: number; y: number; z: number; mood: number; hits: number; state: string }>;
  friends(): Array<{ id: number; kind: string; variant: number; x: number; y: number; z: number; jobIn: number }>;
  spawnGrump(kind?: string): number | null;
  spawnGrumpAt(x: number, z: number, kind?: string): number;
  spawnerState(): { timer: number; interval: number; first: boolean; cheered: number };
  fire(id: number): string[];
  giveWeapon(kind: string): void;
  makeFriend(id: number): number | null;
  setCheered(n: number): void;
  advanceSpawner(s: number): void;
  advanceFriendJobs(s: number): void;
  advanceFarmPaused(ms: number): void;
  plantAt(x: number, z: number, kind: string): boolean;
  screenOfGrump(id: number): { x: number; y: number } | null;
  markers(): number;
  lastFire(): { weapon: string; sfx: string; projectile: string };
  saveNow(): void;
  stats(): FarmDbg['stats'] extends () => infer R ? R & { grumps: number; friends: number; markers: number } : never;
}
const call = <T>(page: Page, body: string, arg?: unknown): Promise<T> =>
  page.evaluate(([src, a]) => new Function('d', 'a', `return (${src})(d, a)`)(window.__debug, a), [body, arg] as [string, unknown]) as Promise<T>;

const WHEAT0 = 24;

/** Near the beds, looking at the plot, with one crop planted. Returns the crop's cell and where he stands. */
async function atFarm(page: Page): Promise<{ crop: Cell; stand: { x: number; z: number } }> {
  const layout = await call<{ beds: Array<{ x0: number; z0: number; x1: number; z1: number }> }>(page, '(d) => d.layoutFarm()');
  const b = layout.beds[0];
  const stand = { x: b.x0 + 3, z: b.z1 + 1 };
  await standLooking(page, stand, stand.x + 0.5, b.z1 - 6);
  const cx = b.x0 + 5, cz = b.z0;
  expect(await call<boolean>(page, '(d, a) => d.plantAt(a[0], a[1], "wheat")', [cx, cz])).toBe(true);
  const y = await call<number>(page, '(d, a) => d.game.world.topSolidY(a[0], a[1])', [cx, cz]);
  return { crop: [cx, y + 1, cz], stand };
}
const grumps = (page: Page) => call<Array<{ id: number; mood: number; x: number; y: number; z: number }>>(page, '(d) => d.grumps()');
const bag = (page: Page, id: number) => call<number>(page, '(d, a) => d.game.inventory.count(a)', id);
/** A grump six blocks from him, in view, and the screen point of it. */
async function grumpInView(page: Page, stand: { x: number; z: number }): Promise<number> {
  const id = await call<number>(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "jelly")', [stand.x + 0.5, stand.z - 6]);
  await call(page, '(d, a) => d.setCamera(Math.PI, 0.5)', 0); // looking along -z, towards the grump
  await frames(page, 15);
  return id;
}
async function tapGrump(page: Page, id: number): Promise<void> {
  const p = await call<{ x: number; y: number } | null>(page, '(d, a) => d.screenOfGrump(a)', id);
  expect(p, 'the grump should be on screen').not.toBeNull();
  await page.touchscreen.tap(p!.x, p!.y);
}

test.describe('grumps and friendly weapons', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
  });
  test.afterEach(() => { expect(errors).toEqual([]); });

  test('a grump arrives, keeps away and pauses a plant', async ({ page }) => {
    const { crop, stand } = await atFarm(page);
    await call(page, '(d) => d.advanceSpawner(46)');
    const arrived = await grumps(page);
    expect(arrived.length).toBe(1);
    const p = await call<{ x: number; z: number }>(page, '(d) => d.playerPos()');
    expect(Math.hypot(arrived[0].x - p.x, arrived[0].z - p.z)).toBeGreaterThanOrEqual(7.5);
    // Standing still, it never comes closer than it was (sampled over 5 s).
    let first = Math.hypot(arrived[0].x - p.x, arrived[0].z - p.z);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      const g = (await grumps(page))[0];
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      expect(d).toBeGreaterThanOrEqual(Math.min(first, 12) - 0.2);
      first = Math.max(first, d);
    }
    // A sulky one beside the crop pauses it and shows a sad mark; the stage does not move.
    await call(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "cloud")', [crop[0] + 0.5, crop[2] + 2.5]);
    await page.waitForTimeout(600);
    expect(await call<number>(page, '(d) => d.markers()')).toBeGreaterThan(0);
    await call(page, '(d) => d.advanceFarmPaused(450000)');
    await frames(page, 6);
    expect(await call<number>(page, '(d, a) => d.game.world.get(a[0], a[1], a[2])', crop)).toBe(WHEAT0);
    expect(stand.x).toBeGreaterThan(0);
  });

  test('craft a weapon, cheer a grump up with two real taps', async ({ page }) => {
    const { crop, stand } = await atFarm(page);
    await call(page, '(d, a) => { d.giveItem(a.glass, 3); d.giveItem(a.planks, 2); }', { glass: BlockId.Glass, planks: BlockId.Planks });
    expect(await call<boolean>(page, '(d) => d.game.tryCraft("bubble-blaster")')).toBe(true);
    expect(await bag(page, ItemId.BubbleBlaster)).toBe(1);
    expect(await call<boolean>(page, '(d) => d.game.tryCraft("bubble-blaster")')).toBe(false); // once each
    const id = await grumpInView(page, stand);
    await call(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "cloud")', [crop[0] + 0.5, crop[2] + 2.5]);
    await tapGrump(page, id);
    await expect.poll(async () => (await grumps(page)).find(g => g.id === id)?.mood).toBe(1);
    await page.waitForTimeout(700);
    await tapGrump(page, id);
    await expect.poll(async () => (await grumps(page)).some(g => g.id === id)).toBe(false);
    await expect.poll(async () => (await call<{ particles: number }>(page, '(d) => d.stats()')).particles).toBeGreaterThan(0);
    const got = (await Promise.all([ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.Gem, ItemId.AppleSapling].map(i => bag(page, i)))).reduce((a, b) => a + b, 0);
    expect(got).toBeGreaterThan(0);
    expect(await bag(page, ItemId.BubbleBlaster)).toBe(1);
  });

  test('a weapon on empty ground walks; the hand on a grump walks and never fires; a hold never digs', async ({ page }) => {
    const { stand } = await atFarm(page);
    const id = await grumpInView(page, stand);
    await call(page, '(d, a) => { d.giveWeapon("wand"); d.selectStack(a); }', ItemId.MagicWand);
    const before = await call<{ x: number; z: number }>(page, '(d) => d.playerPos()');
    // Empty ground, a few blocks off to the side: he walks, nothing fires.
    const ground = await call<{ x: number; y: number }>(page, '(d, a) => d.screenOf(a[0], a[1], a[2])', [stand.x + 3.5, 1 + (await call<number>(page, '(d, a) => d.game.world.topSolidY(a[0], a[1])', [stand.x + 3, stand.z])), stand.z + 0.5]);
    await page.touchscreen.tap(ground.x, ground.y);
    await page.waitForTimeout(800);
    const after = await call<{ x: number; z: number }>(page, '(d) => d.playerPos()');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.3);
    expect((await grumps(page)).find(g => g.id === id)?.mood).toBe(0);
    // The hand on a grump walks (never fires), and a hold on it digs nothing behind it.
    await call(page, '(d) => d.selectStack("hand")');
    const g = (await grumps(page)).find(o => o.id === id)!;
    const below = await call<number>(page, '(d, a) => d.game.world.get(a[0], a[1] - 1, a[2])', [Math.floor(g.x), g.y, Math.floor(g.z)]);
    await tapGrump(page, id);
    await page.waitForTimeout(600);
    expect((await grumps(page)).find(o => o.id === id)?.mood).toBe(0);
    const p = await call<{ x: number; y: number } | null>(page, '(d, a) => d.screenOfGrump(a)', id);
    if (p) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await page.waitForTimeout(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    const gg = (await grumps(page)).find(o => o.id === id)!;
    expect(await call<number>(page, '(d, a) => d.game.world.get(a[0], a[1] - 1, a[2])', [Math.floor(gg.x), gg.y, Math.floor(gg.z)])).not.toBe(BlockId.Air);
    expect(below).not.toBe(BlockId.Air);
  });

  test('three weapons look and sound different', async ({ page }) => {
    const { stand } = await atFarm(page);
    const seen = new Set<string>();
    for (const w of ['bubble', 'wand', 'water']) {
      const id = await call<number>(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "jelly")', [stand.x + 0.5, stand.z - 5]);
      await call(page, '(d, a) => { d.giveWeapon(a); d.selectStack({ bubble: 120, wand: 121, water: 122 }[a]); }', w);
      await page.waitForTimeout(650);
      expect((await call<string[]>(page, '(d, a) => d.fire(a)', id))).toContain('fired');
      const last = await call<{ weapon: string; sfx: string; projectile: string }>(page, '(d) => d.lastFire()');
      expect(last.weapon).toBe(w);
      seen.add(`${last.sfx}/${last.projectile}`);
    }
    expect(seen.size).toBe(3);
  });

  test('every fifth cheer-up makes a friend who helps a plant; at five friends no more', async ({ page }) => {
    const { crop, stand } = await atFarm(page);
    await call(page, '(d) => d.giveWeapon("bubble")');
    await call(page, '(d) => d.selectStack(120)');
    const cheer = async (): Promise<void> => {
      const id = await call<number>(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "cloud")', [stand.x + 0.5, stand.z - 5]);
      await page.waitForTimeout(650);
      await call(page, '(d, a) => d.fire(a)', id);
      await page.waitForTimeout(650);
      await call(page, '(d, a) => d.fire(a)', id);
    };
    await call(page, '(d) => d.setCheered(4)');
    await cheer();
    expect((await call<unknown[]>(page, '(d) => d.friends()')).length).toBe(1);
    await call(page, '(d) => d.advanceFriendJobs(250)');
    await frames(page, 6);
    expect(await call<number>(page, '(d, a) => d.game.world.get(a[0], a[1], a[2])', crop)).toBeGreaterThan(WHEAT0);
    for (let n = 0; n < 5; n++) {
      const c = await call<number>(page, '(d) => d.spawnerState().cheered');
      await call(page, '(d, a) => d.setCheered(a)', c - (c % 5) + 4);
      await cheer();
    }
    expect((await call<unknown[]>(page, '(d) => d.friends()')).length).toBe(5);
  });

  test('no grump with nothing planted, and none (and no timer) with a menu open', async ({ page }) => {
    // Nothing planted: no grump, however long.
    await standLooking(page, { x: 80, z: 40 }, 80.5, 30);
    await call(page, '(d) => d.advanceSpawner(600)');
    expect((await grumps(page)).length).toBe(0);
    const { stand } = await atFarm(page);
    expect(stand.x).toBeGreaterThan(0);
    // A menu open: nothing arrives and the timer does not move.
    await call(page, '(d) => d.openBag()');
    await call(page, '(d) => d.advanceSpawner(600)');
    expect((await grumps(page)).length).toBe(0);
    expect((await call<{ timer: number }>(page, '(d) => d.spawnerState()')).timer).toBeLessThan(2); // only the frames before the menu opened
  });

  test('placing a block into a grump is refused', async ({ page }) => {
    const { stand } = await atFarm(page);
    const id = await grumpInView(page, stand);
    const g = (await grumps(page)).find(o => o.id === id)!;
    const cell: Cell = [Math.floor(g.x), g.y, Math.floor(g.z)];
    await call(page, '(d, a) => { d.giveItem(a, 3); d.selectStack(a); }', BlockId.Stone);
    await call(page, '(d, a) => d.game.applyIntent({ kind: "place", cell: a })', cell);
    expect(await call<number>(page, '(d, a) => d.game.world.get(a[0], a[1], a[2])', cell)).toBe(BlockId.Air);
  });

  test('save and reload keep grumps, friends, the counter and the weapon; an older save without grump fields loads', async ({ page }) => {
    await atFarm(page);
    await call(page, '(d) => { d.giveWeapon("water"); d.setCheered(7); }');
    const b = await call<number | null>(page, '(d) => d.spawnGrump("cloud")');
    expect(b).not.toBeNull();
    await call(page, '(d, a) => d.makeFriend(a)', b);
    await call(page, '(d) => d.saveNow()');
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
    await frames(page, 10);
    expect((await call<unknown[]>(page, '(d) => d.friends()')).length).toBe(1);
    expect((await call<{ cheered: number }>(page, '(d) => d.spawnerState()')).cheered).toBe(7);
    expect(await bag(page, ItemId.WaterSquirter)).toBe(1);
    // The same save with the grump fields removed (as the step before wrote it) loads with no grumps.
    // (The page saves again as it unloads, so the stripped copy is put back before the next page starts.)
    const stripped = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('blockpals.save.v3')!) as Record<string, unknown>;
      delete data.grumps; delete data.friends; delete data.grumpStats;
      return JSON.stringify(data);
    });
    await page.addInitScript(raw => localStorage.setItem('blockpals.save.v3', raw), stripped);
    const v1Before = await page.evaluate(() => localStorage.getItem('blockpals.save.v1'));
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
    await frames(page, 10);
    expect((await call<unknown[]>(page, '(d) => d.grumps()')).length).toBe(0);
    expect((await call<unknown[]>(page, '(d) => d.friends()')).length).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('blockpals.save.v1'))).toBe(v1Before);
  });

  test('fps with grumps, friends and a confetti burst in view is reported and nothing errors', async ({ page }) => {
    const { stand } = await atFarm(page);
    for (let i = 0; i < 3; i++) await call(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "jelly")', [stand.x + i * 2, stand.z - 7]);
    for (let i = 0; i < 5; i++) {
      const id = await call<number>(page, '(d, a) => d.spawnGrumpAt(a[0], a[1], "cloud")', [stand.x - 4 + i, stand.z - 9]);
      await call(page, '(d, a) => d.makeFriend(a)', id);
    }
    await call(page, '(d) => d.burst("heart")');
    await page.waitForTimeout(1500);
    const stats = await call<{ fps: number; grumps: number; friends: number }>(page, '(d) => d.stats()');
    expect(stats.grumps).toBeGreaterThanOrEqual(3);
    expect(stats.fps).toBeGreaterThan(0);
    console.log(`grumps e2e: ${stats.fps} fps with ${stats.grumps} grumps and ${stats.friends} friends`);
  });
});
