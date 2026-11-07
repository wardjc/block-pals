import { test, expect, type Page } from '@playwright/test';

const URL = '/block-pals/?debug';
const WOOD = 4;
const PLANKS = 8;

type Cell = [number, number, number];
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
  game: {
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
