import { test, expect, type Page } from '@playwright/test';

const URL = '/block-pals/?debug';
const WOOD = 4;
const PLANKS = 8;

type Cell = [number, number, number];
type Rect = { x0: number; z0: number; x1: number; z1: number };
type VillageData = {
  houses: Array<{ id: string; rect: Rect; interior: Rect; floor: Cell[]; doorCells: Cell[]; groundY: number; doorFront: Cell; doorInside: Cell; npcSpot: Cell; greetRect: Rect }>;
  route: Cell[]; square: Rect; gate: Cell;
};
type Dbg = {
  playerPos(): { x: number; y: number; z: number };
  pipPos(): { x: number; y: number; z: number };
  giveItem(id: number, n: number): void;
  screenOf(x: number, y: number, z: number): { x: number; y: number };
  pick(x: number, y: number): { cell: Cell; normal: Cell } | null;
  outlineVisible(): boolean;
  voiceLast(): { source: 'clip' | 'tts' | 'none'; key: string };
  digSound(): { starts: number; stops: number; active: boolean };
  camera(): { position: { x: number; y: number; z: number }; yaw: number; pitch: number; distance: number; close: boolean };
  village(): VillageData;
  flags(): { ledToVillage: boolean };
  leadState(): string;
  saveNow(): void;
  teleport(x: number, y: number, z: number): boolean;
  setCamera(yaw: number, pitch: number): void;
  stats(): { chunks: number; visible: number; triangles: number; drawCalls: number; fps: number; worldTriangles: number };
  worldSize(): { x: number; y: number; z: number };
  game: {
    applyIntent(i: { kind: 'walk'; to: Cell } | { kind: 'place'; cell: Cell } | { kind: 'dig'; cell: Cell }): void;
    selected: number | 'hand';
    tryCraft(id: string): boolean;
    inventory: { count(id: number): number; hotbar(): number[] };
    world: { get(x: number, y: number, z: number): number; topSolidY(x: number, z: number): number };
  };
};
declare global { interface Window { __debug: Dbg } }

/** A grass or dirt top a couple of blocks in front of the player, in reach, not under anyone, that a tap there hits. */
async function nearbyGround(page: Page): Promise<{ cell: Cell; id: number; x: number; y: number }> {
  const found = await page.evaluate(() => {
    const d = window.__debug;
    const p = d.playerPos();
    const pip = d.pipPos();
    const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
    for (const dz of [2, 3, 1]) for (const dx of [0, -1, 1, -2, 2]) {
      const x = fx + dx, z = fz + dz;
      const y = d.game.world.topSolidY(x, z);
      const id = d.game.world.get(x, y, z);
      if (id !== 1 && id !== 2) continue; // grass or dirt
      if (Math.abs(y - fy) > 3 || (x === Math.floor(pip.x) && z === Math.floor(pip.z))) continue;
      const s = d.screenOf(x + 0.5, y + 1, z + 0.5);
      const hit = d.pick(s.x, s.y);
      if (hit && hit.cell[0] === x && hit.cell[1] === y && hit.cell[2] === z) return { cell: [x, y, z] as Cell, id, ...s };
    }
    return null;
  });
  if (!found) throw new Error('no nearby ground block found');
  return found;
}

/** Horizontal distance the player has moved from `from`. */
function moved(page: Page, from: { x: number; z: number }): Promise<number> {
  return page.evaluate(f => {
    const p = window.__debug.playerPos();
    return Math.hypot(p.x - f.x, p.z - f.z);
  }, from);
}

/** A real touch press (pointerType touch) held for `ms`. */
async function press(page: Page, x: number, y: number, ms: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Resolves once `frames` animation frames have run, so the game loop is alive. */
async function frames(page: Page, frames = 5): Promise<void> {
  await page.evaluate(n => new Promise<void>(res => {
    const tick = () => (--n <= 0 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), frames);
}

async function ready(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__debug);
  // Let Pip settle beside the player.
  await expect.poll(() => page.evaluate(() => {
    const p = window.__debug.playerPos(), q = window.__debug.pipPos();
    return Math.hypot(p.x - q.x, p.z - q.z);
  })).toBeLessThan(4);
}

test('loads with canvas and hotbar and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hotbar')).toBeVisible();
  await page.waitForFunction(() => !!window.__debug);
  await frames(page, 60);
  expect(errors).toEqual([]);
});

test('tap on ground moves the player', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__debug);
  await frames(page);
  const before = await page.evaluate(() => window.__debug.playerPos());
  await page.touchscreen.tap(640, 300);
  await expect.poll(() => moved(page, before)).toBeGreaterThan(0.5);
  // Spec §7a: a tap never digs.
  expect(await page.evaluate(() => window.__debug.game.inventory.hotbar().length)).toBe(0);
});

test('press and hold on a nearby block digs it', async ({ page }) => {
  await ready(page);
  const target = await nearbyGround(page);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await press(page, target.x, target.y, 700);
  // The scraping loop started with the hold and is fully stopped once it completes.
  await expect.poll(() => page.evaluate(() => window.__debug.digSound().stops)).toBe(1);
  const dig = await page.evaluate(() => window.__debug.digSound());
  expect(dig.starts).toBe(1);
  expect(dig.active).toBe(false);
  expect(errors).toEqual([]);
  const [x, y, z] = target.cell;
  await expect.poll(() => page.evaluate(([x, y, z]) => window.__debug.game.world.get(x, y, z), [x, y, z])).toBe(0);
  expect(await page.evaluate(id => window.__debug.game.inventory.count(id), target.id)).toBe(1);
  await expect(page.locator('.dig-ring')).toBeHidden();
});

test('a quick tap on the same nearby block walks and digs nothing', async ({ page }) => {
  await ready(page);
  const target = await nearbyGround(page);
  const before = await page.evaluate(() => window.__debug.playerPos());
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(() => moved(page, before)).toBeGreaterThan(0.5);
  const [x, y, z] = target.cell;
  expect(await page.evaluate(([x, y, z]) => window.__debug.game.world.get(x, y, z), [x, y, z])).toBe(target.id);
  expect(await page.evaluate(() => window.__debug.game.inventory.hotbar().length)).toBe(0);
});

/** A real one-finger touch drag from (x, y) by (dx, dy) in small steps. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number, steps = 20): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('drag turns the camera and does not walk or dig', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => ({
    cam: window.__debug.camera(), pos: window.__debug.playerPos(), bag: window.__debug.game.inventory.hotbar().length,
  }));
  // Start on the ground in front of him (a press there could dig), then slide 400 px right.
  const target = await nearbyGround(page);
  await drag(page, target.x - 200, target.y, 400, 0);
  await frames(page, 30);
  const after = await page.evaluate(() => ({
    cam: window.__debug.camera(), pos: window.__debug.playerPos(), bag: window.__debug.game.inventory.hotbar().length,
  }));
  const turned = Math.abs(Math.atan2(Math.sin(after.cam.yaw - before.cam.yaw), Math.cos(after.cam.yaw - before.cam.yaw)));
  expect(turned).toBeGreaterThan(0.8);
  expect(Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)).toBeLessThan(0.01);
  expect(after.bag).toBe(before.bag);
  const [x, y, z] = target.cell;
  expect(await page.evaluate(([x, y, z]) => window.__debug.game.world.get(x, y, z), [x, y, z])).toBe(target.id);
  await expect(page.locator('.dig-ring')).toBeHidden();
  // Tap-to-walk still works the way the camera now faces.
  await page.touchscreen.tap(640, 300);
  await expect.poll(() => moved(page, after.pos)).toBeGreaterThan(0.5);
});

test('craft planks via debug inventory', async ({ page }) => {
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__debug);
  const planksBefore = await page.evaluate(id => window.__debug.game.inventory.count(id), PLANKS);
  await page.evaluate(id => window.__debug.giveItem(id, 2), WOOD);
  const ok = await page.evaluate(() => window.__debug.game.tryCraft('planks'));
  expect(ok).toBe(true);
  const planksAfter = await page.evaluate(id => window.__debug.game.inventory.count(id), PLANKS);
  expect(planksAfter).toBe(planksBefore + 2);
});

test('works offline after first load', async ({ page, context }) => {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Reload once so the service worker controls the page.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hotbar')).toBeVisible();
  // The service worker cache served this reload, not the HTTP cache.
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});

test('Pip speaks from a pre-generated clip, also offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const clipOk: boolean[] = [];
  page.on('response', r => { if (r.url().endsWith('.ogg')) clipOk.push(r.ok()); });

  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // The first tap greets (and unlocks audio).
  await page.locator('canvas').click({ position: { x: 640, y: 120 } });
  await expect.poll(() => page.evaluate(() => window.__debug.voiceLast().source), { timeout: 15_000 }).toBe('clip');
  expect(clipOk.length).toBeGreaterThan(0);
  expect(clipOk.every(Boolean)).toBe(true);

  // Offline: a new page load plays a (precached) clip again, not the tablet voice.
  await context.setOffline(true);
  const fromSw: boolean[] = [];
  page.on('response', r => { if (r.url().endsWith('.ogg')) fromSw.push(r.fromServiceWorker()); });
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('canvas').click({ position: { x: 640, y: 120 } });
  await expect.poll(() => page.evaluate(() => window.__debug.voiceLast().source), { timeout: 15_000 }).toBe('clip');
  expect(fromSw.length).toBeGreaterThan(0);
  expect(fromSw.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Village step 1: the browser story.

const SPAWN_KEYS = ['blockpals.save.v2', 'blockpals.save.v1', 'blockpals.save.v1.backup'];

/** Walks with a tap-style intent and waits until he is within `tol` of the cell (cap in ms). */
async function walkTo(page: Page, cell: Cell, tol = 1.3, capMs = 40_000): Promise<void> {
  await page.evaluate(c => window.__debug.game.applyIntent({ kind: 'walk', to: c }), cell);
  await expect.poll(() => page.evaluate(c => {
    const p = window.__debug.playerPos();
    return Math.hypot(p.x - (c[0] + 0.5), p.z - (c[2] + 0.5));
  }, cell), { timeout: capMs, intervals: [100] }).toBeLessThan(tol);
}

const insideRect = (p: { x: number; z: number }, r: Rect): boolean => p.x >= r.x0 && p.x < r.x1 + 1 && p.z >= r.z0 && p.z < r.z1 + 1;

async function freshVillage(page: Page): Promise<VillageData> {
  await ready(page);
  return page.evaluate(() => window.__debug.village());
}

test.describe('the village', () => {
  test('new world is 96 wide and loads fast', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(URL);
    await page.waitForFunction(() => !!window.__debug);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(await page.evaluate(() => window.__debug.worldSize())).toEqual({ x: 96, y: 20, z: 96 });
    await frames(page, 30);
    const st = await page.evaluate(() => window.__debug.stats());
    expect(st.worldTriangles).toBeLessThan(110_000);
    expect(st.chunks).toBe(36);
    expect(errors).toEqual([]);
  });

  test('walk the path to the village and home', async ({ page }) => {
    const v = await freshVillage(page);
    const start = await page.evaluate(() => window.__debug.playerPos());
    let lastY = start.y;
    let maxJump = 0;
    const sample = setInterval(() => {
      void page.evaluate(() => window.__debug.playerPos().y).then(y => { maxJump = Math.max(maxJump, Math.abs(y - lastY)); lastY = y; }).catch(() => {});
    }, 100);
    try {
      // Every ~8th route cell is a waypoint; the last is the square.
      const wps = v.route.filter((_, i) => i % 8 === 0 || i === v.route.length - 1);
      for (const c of wps) await walkTo(page, c);
      const at = await page.evaluate(() => window.__debug.playerPos());
      expect(insideRect(at, v.square) || Math.hypot(at.x - (v.route[v.route.length - 1][0] + 0.5), at.z - (v.route[v.route.length - 1][2] + 0.5)) < 2).toBe(true);
      for (const c of [...wps].reverse()) await walkTo(page, c);
      await walkTo(page, [Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)], 1.5);
    } finally {
      clearInterval(sample);
    }
    expect(maxJump).toBeLessThan(1.5);
  });

  test('enter each house, turn the view, come out', async ({ page }) => {
    test.setTimeout(240_000);
    const v = await freshVillage(page);
    expect(v.houses).toHaveLength(5);
    for (const h of v.houses) {
      await page.evaluate(([x, y, z]) => window.__debug.teleport(x + 0.5, y, z + 0.5), h.doorFront);
      await walkTo(page, h.doorFront, 1.2, 15_000);
      await walkTo(page, h.doorInside, 1.2, 15_000);
      const mid = h.floor[Math.floor(h.floor.length / 2)];
      await walkTo(page, mid, 1.2, 15_000);
      const p = await page.evaluate(() => window.__debug.playerPos());
      expect(insideRect(p, h.interior)).toBe(true);
      await page.evaluate(() => window.__debug.setCamera(0.3, 0.5));
      await frames(page, 20);

      const before = await page.evaluate(() => ({ cam: window.__debug.camera(), pos: window.__debug.playerPos(), bag: window.__debug.game.inventory.hotbar().length }));
      // Start the slide in the upper part of the screen; the slide is long enough that a hold cannot start.
      await drag(page, 440, 200, 400, 0);
      await frames(page, 20);
      const after = await page.evaluate(() => ({ cam: window.__debug.camera(), pos: window.__debug.playerPos(), bag: window.__debug.game.inventory.hotbar().length }));
      const turned = Math.abs(Math.atan2(Math.sin(after.cam.yaw - before.cam.yaw), Math.cos(after.cam.yaw - before.cam.yaw)));
      expect(turned, h.id).toBeGreaterThan(0.8);
      expect(Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)).toBeLessThan(0.01);
      expect(after.bag).toBe(before.bag);
      const camBlock = await page.evaluate(() => {
        const c = window.__debug.camera().position;
        return window.__debug.game.world.get(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z));
      });
      expect([0, 7]).toContain(camBlock); // air or water
      await drag(page, 640, 300, 0, 160);
      await frames(page, 10);
      const pitch = await page.evaluate(() => window.__debug.camera().pitch);
      expect(pitch).not.toBeCloseTo(before.cam.pitch, 2);
      expect(pitch).toBeGreaterThanOrEqual(-0.15 - 1e-6);
      expect(pitch).toBeLessThanOrEqual((70 * Math.PI) / 180 + 1e-6);

      await walkTo(page, h.doorFront, 1.2, 15_000);
    }
  });

  test('a villager says hello', async ({ page }) => {
    const v = await freshVillage(page);
    await page.touchscreen.tap(640, 120); // unlocks audio (the first tap)
    const bakery = v.houses.find(h => h.id === 'bakery')!;
    await page.evaluate(([x, y, z]) => window.__debug.teleport(x + 0.5, y, z + 0.5), bakery.doorFront);
    await walkTo(page, bakery.doorInside, 1.2, 15_000);
    await expect(page.locator('.bubble')).toContainText('Hi!', { timeout: 4000 });
    await expect(page.locator('.bubble-picture')).toHaveText('🍞');
    await expect.poll(() => page.evaluate(() => window.__debug.voiceLast().source), { timeout: 15_000 }).toBe('clip');
    await expect(page.locator('.bubble')).toBeHidden({ timeout: 4500 });
  });

  test('Pip leads once, and does not fight taps or drags', async ({ page }) => {
    test.setTimeout(180_000);
    const v = await freshVillage(page);
    // His first action starts the 8 s timer.
    await page.touchscreen.tap(640, 300);
    await expect.poll(() => page.evaluate(() => window.__debug.leadState()), { timeout: 40_000 }).toBe('leading');
    expect((await page.evaluate(() => window.__debug.flags())).ledToVillage).toBe(false);

    // A tap still walks him, a drag still turns the view, a hold still digs; Pip never moves him.
    const here = await page.evaluate(() => window.__debug.playerPos());
    await page.waitForTimeout(1500);
    expect(await moved(page, here)).toBeLessThan(0.01);
    await page.touchscreen.tap(700, 330);
    await expect.poll(() => moved(page, here)).toBeGreaterThan(0.5);
    const yaw0 = await page.evaluate(() => window.__debug.camera().yaw);
    const ground = await nearbyGround(page);
    await drag(page, ground.x - 200, ground.y, 400, 0);
    const yaw1 = await page.evaluate(() => window.__debug.camera().yaw);
    expect(Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0)))).toBeGreaterThan(0.8);
    await page.waitForTimeout(800);
    const g2 = await nearbyGround(page);
    await press(page, g2.x, g2.y, 700);
    const [x, y, z] = g2.cell;
    await expect.poll(() => page.evaluate(([x, y, z]) => window.__debug.game.world.get(x, y, z), [x, y, z])).toBe(0);

    // Follow the route to the village.
    for (const c of v.route.filter((_, i) => i % 8 === 0 || i === v.route.length - 1)) await walkTo(page, c);
    await expect.poll(() => page.evaluate(() => window.__debug.flags().ledToVillage), { timeout: 10_000 }).toBe(true);
    await page.evaluate(() => window.__debug.saveNow());

    // He has arrived: after a reload Pip does not lead again.
    await page.reload();
    await page.waitForFunction(() => !!window.__debug);
    expect((await page.evaluate(() => window.__debug.flags())).ledToVillage).toBe(true);
    await page.touchscreen.tap(640, 300);
    await page.waitForTimeout(12_000);
    expect(await page.evaluate(() => window.__debug.leadState())).toBe('done');
  });

  test('save and reload keeps position and edits', async ({ page }) => {
    const v = await freshVillage(page);
    const cottage = v.houses.find(h => h.id === 'cottage')!;
    // A saved spot inside a house footprint deliberately loads at the spawn (never under a roof), so stand at the door.
    await page.evaluate(([x, y, z]) => window.__debug.teleport(x + 0.5, y, z + 0.5), cottage.doorFront);
    await frames(page, 10);
    await page.evaluate(id => { window.__debug.giveItem(id, 5); }, PLANKS);
    // Choose planks, then a quick tap on a floor block in front of him places one.
    await page.evaluate(id => { window.__debug.game.selected = id; }, PLANKS);
    const target = await page.evaluate(() => {
      const d = window.__debug;
      const p = d.playerPos();
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2]]) {
        const cell: Cell = [Math.floor(p.x) + dx, Math.floor(p.y) - 1, Math.floor(p.z) + dz];
        const s = d.screenOf(cell[0] + 0.5, cell[1] + 1, cell[2] + 0.5);
        const hit = d.pick(s.x, s.y);
        if (hit && hit.cell[0] === cell[0] && hit.cell[1] === cell[1] && hit.cell[2] === cell[2] && hit.normal[1] === 1) return { cell, ...s };
      }
      return null;
    });
    expect(target).not.toBeNull();
    await page.touchscreen.tap(target!.x, target!.y);
    const placed: Cell = [target!.cell[0], target!.cell[1] + 1, target!.cell[2]];
    await expect.poll(() => page.evaluate(c => window.__debug.game.world.get(c[0], c[1], c[2]), placed)).toBe(PLANKS);
    expect(await page.evaluate(id => window.__debug.game.inventory.count(id), PLANKS)).toBe(4);
    const pos = await page.evaluate(() => window.__debug.playerPos());
    await page.evaluate(() => window.__debug.saveNow());
    await page.reload();
    await page.waitForFunction(() => !!window.__debug);
    const pos2 = await page.evaluate(() => window.__debug.playerPos());
    expect(Math.hypot(pos2.x - pos.x, pos2.y - pos.y, pos2.z - pos.z)).toBeLessThan(0.01);
    expect(await page.evaluate(c => window.__debug.game.world.get(c[0], c[1], c[2]), placed)).toBe(PLANKS);
    expect(await page.evaluate(id => window.__debug.game.inventory.count(id), PLANKS)).toBe(4);
  });

  test('an old v1 save loads with his edits and leaves the v1 key untouched', async ({ page: first }) => {
    let page = first;
    // Learn the spawn spot of a fresh world, then forget everything.
    await ready(page);
    const spawn = await page.evaluate(() => window.__debug.playerPos());
    const v1 = JSON.stringify({
      version: 1, seed: 2026,
      edits: [[47, 6, 47, 3], [30, 6, 30, 8], [10, 12, 10, 9]],
      inventory: { 4: 7, 3: 2 }, order: [4, 3],
      player: { x: spawn.x, y: spawn.y, z: spawn.z },
    });
    const old = page;
    page = await old.context().newPage();
    await old.close();
    // Seed once per tab (sessionStorage survives reloads), after the old tab's own save on the way out.
    await page.addInitScript(raw => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      localStorage.setItem('blockpals.save.v1', raw);
    }, v1);
    await page.goto(URL);
    await page.waitForFunction(() => !!window.__debug);
    expect(await page.evaluate(() => window.__debug.worldSize())).toEqual({ x: 96, y: 20, z: 96 });
    for (const [x, y, z, id] of [[47, 6, 47, 3], [30, 6, 30, 8], [10, 12, 10, 9]]) {
      expect(await page.evaluate(c => window.__debug.game.world.get(c[0], c[1], c[2]), [x, y, z])).toBe(id);
    }
    const p = await page.evaluate(() => window.__debug.playerPos());
    expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(0.5);
    expect(await page.evaluate(() => window.__debug.game.inventory.count(4))).toBe(7);
    await page.evaluate(() => window.__debug.saveNow());
    const keys = await page.evaluate(ks => Object.fromEntries(ks.map(k => [k, localStorage.getItem(k)])), SPAWN_KEYS);
    expect(keys['blockpals.save.v1']).toBe(v1); // byte-identical, never written
    expect(keys['blockpals.save.v1.backup']).toBe(v1);
    const v2 = JSON.parse(keys['blockpals.save.v2']!);
    expect(v2.version).toBe(2);
    expect(v2.edits).toEqual(expect.arrayContaining([[47, 6, 47, 3], [30, 6, 30, 8]]));
  });

  test('walled-in player can dig out', async ({ page }) => {
    const v = await freshVillage(page);
    const h = v.houses.find(x => x.id === 'cottage')!;
    await page.evaluate(([x, y, z]) => window.__debug.teleport(x + 0.5, y, z + 0.5), h.doorInside);
    await frames(page, 5);
    // Fill the whole doorway (2 wide, 2 high is the walkable part) with planks from inside.
    const wall: Cell[] = h.doorCells.flatMap(([x, y, z]) => [[x, y, z], [x, y + 1, z]] as Cell[]);
    await page.evaluate(([id, cells]) => {
      window.__debug.giveItem(id as number, 8);
      window.__debug.game.selected = id as number;
      for (const c of cells as Cell[]) window.__debug.game.applyIntent({ kind: 'place', cell: c });
    }, [PLANKS, wall] as const);
    for (const c of wall) expect(await page.evaluate(c2 => window.__debug.game.world.get(c2[0], c2[1], c2[2]), c)).toBe(PLANKS);
    // Digging is always allowed: take out one column (two blocks), then walk out.
    const column = wall.filter(c => c[0] === h.doorCells[0][0] && c[2] === h.doorCells[0][2]);
    for (const c of column) await page.evaluate(c2 => window.__debug.game.applyIntent({ kind: 'dig', cell: c2 }), c);
    for (const c of column) await expect.poll(() => page.evaluate(c2 => window.__debug.game.world.get(c2[0], c2[1], c2[2]), c)).toBe(0);
    await walkTo(page, h.doorFront, 1.3, 15_000);
  });
});
