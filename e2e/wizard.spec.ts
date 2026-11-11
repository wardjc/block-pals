/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';
import { drag, frames, press, ready, URL, walkTo, type Cell } from './helpers';

// The wizard's tower (spec §7g): the browser story. Mythical blocks are ids 40..47 (Starlight,
// Rainbow, Cloud, Moon, Sun, Dragon-scale, Star, Magic mirror). The gem item (123) arrives with the
// grumps step: the gem tests run once giveGem() really adds one, and are skipped (with a note) before.
const MYTHICAL = [40, 41, 42, 43, 44, 45, 46, 47];
const RAINBOW = 41;
const SAVE = 'blockpals.save.v2';
type Tower = {
  groundY: number; doorFront: Cell; doorInside: Cell; wizardSpot: Cell; route: Cell[];
  floors: Array<{ y: number; cells: Cell[]; ceilingY: number }>; rect: { x0: number; z0: number; x1: number; z1: number };
  beacon: { x: number; y: number; z: number };
};

const ev = <T>(page: Page, fn: (d: any, arg: any) => T, arg?: unknown): Promise<T> =>
  page.evaluate(([src, a]) => (new Function('d', 'a', `return (${src})(d, a);`))((window as any).__debug, a), [fn.toString(), arg] as const) as Promise<T>;

const tower = (page: Page) => ev<Tower>(page, d => d.tower());
const total = (page: Page) => ev<number>(page, (d, ids) => ids.reduce((s: number, id: number) => s + d.game.inventory.count(id), 0), MYTHICAL);
const wizardState = (page: Page) => ev<any>(page, d => d.wizard().state);

/** Stands him at a floor cell of the ground room, looking at Orlo. */
async function faceWizard(page: Page): Promise<Tower> {
  const t = await tower(page);
  const [wx, wy, wz] = t.wizardSpot;
  const ok = await ev<boolean>(page, (d, a) => {
    const placed = d.teleport(a.x + 2.5, a.y, a.z - 1.5);
    d.setCamera(Math.atan2(-2, 2), 0.3);
    return placed;
  }, { x: wx, y: wy, z: wz });
  expect(ok).toBe(true);
  await frames(page, 30);
  return t;
}

/** A real touch tap on Orlo. */
async function tapWizard(page: Page): Promise<void> {
  const p = await ev<{ x: number; y: number }>(page, d => d.wizard().screenOf());
  expect(await ev(page, (d, a) => d.wizard().entityAt(a.x, a.y), p)).toEqual({ type: 'wizard', id: -1 });
  await page.touchscreen.tap(p.x, p.y);
}

async function tapEl(page: Page, selector: string, nth = 0): Promise<void> {
  const box = await page.locator(selector).nth(nth).boundingBox();
  expect(box, selector).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(220); // past the screen's 150 ms tap debounce
}

async function openScreen(page: Page): Promise<void> {
  await faceWizard(page);
  await tapWizard(page);
  await expect.poll(() => ev(page, d => d.wizard().isOpen)).toBe(true);
}

/** Opens the puzzle tab until a puzzle of `kind` shows. */
async function puzzleOf(page: Page, kind: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const p = await ev<any>(page, d => d.wizard().puzzle());
    if (p && p.kind === kind && !p.solved) return p;
    await ev(page, d => { d.wizard().tab('trade'); d.wizard().tab('puzzle'); });
  }
  throw new Error(`no ${kind} puzzle`);
}

async function giftTaken(page: Page): Promise<void> {
  await ev(page, d => { d.wizard().open(); });
  await tapEl(page, '.wiz-card', 0);
  expect((await wizardState(page)).gift).toBe(true);
}

test.describe('the wizard\'s tower', () => {
  test('the tower stands, its path is walkable to the door and up to the star room', async ({ page }) => {
    test.setTimeout(150_000);
    await ready(page);
    const t = await tower(page);
    expect(t.route.length).toBeGreaterThan(50);
    const start = t.route[0];
    expect(await ev(page, (d, c) => d.teleport(c[0] + 0.5, c[1], c[2] + 0.5), start)).toBe(true);
    for (let i = 20; i < t.route.length; i += 20) await walkTo(page, t.route[i], 2, 30_000);
    await walkTo(page, t.doorFront, 1.5, 30_000);
    const pos = await ev<any>(page, d => d.playerPos());
    expect(Math.floor(pos.y)).toBe(t.groundY + 1);
    const star = t.floors[1].cells[0];
    await walkTo(page, star, 1.3, 30_000);
    expect(Math.floor((await ev<any>(page, d => d.playerPos())).y)).toBe(t.floors[1].y);
  });

  test('the light: seen when he looks up, a star marker otherwise, gone for good after his first visit', async ({ page }) => {
    await ready(page);
    const t = await tower(page);
    await ev(page, (d, b) => { const p = d.playerPos(); d.setCamera(Math.atan2(b.x - p.x, b.z - p.z), -0.12); }, t.beacon);
    await frames(page, 20);
    await expect.poll(() => ev<any>(page, d => d.beacon().onScreen)).toBe(true);
    expect(await ev(page, d => d.beacon().spriteVisible)).toBe(true);
    await ev(page, (d, b) => { const p = d.playerPos(); d.setCamera(Math.atan2(b.x - p.x, b.z - p.z) + Math.PI, 0.55); }, t.beacon);
    await expect.poll(() => ev<any>(page, d => d.beacon().markerVisible)).toBe(true);
    const marker = page.locator('.edge-marker');
    await expect(marker).toBeVisible();
    expect(await marker.evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
    // Into the tower: met, saved, marker gone; and still gone after a reload.
    await faceWizard(page);
    await expect.poll(async () => (await wizardState(page)).met).toBe(true);
    await ev(page, (d, b) => { d.teleport(24.5, d.game.world.topSolidY(24, 24) + 1, 24.5); const p = d.playerPos(); d.setCamera(Math.atan2(b.x - p.x, b.z - p.z) + Math.PI, 0.55); }, t.beacon);
    await frames(page, 20);
    expect(await ev(page, d => d.beacon().markerVisible)).toBe(false);
    await ev(page, d => d.saveNow());
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__debug);
    await frames(page, 30);
    expect((await wizardState(page)).met).toBe(true);
    expect(await ev(page, d => d.beacon().markerVisible)).toBe(false);
  });

  test('Pip leads him once: never without a gem', async ({ page }) => {
    test.setTimeout(90_000);
    await ready(page);
    expect(await ev(page, d => d.leadTowerState())).toBe('waiting');
    const gems = await ev<number>(page, d => d.giveGem(0));
    expect(gems).toBe(0);
    // Wait out the 25 s offer time in the village with the village walk done: no gem, no lead.
    const t = await tower(page);
    await ev(page, (d, c) => d.teleport(c[0] + 0.5, c[1], c[2] + 0.5), t.route[2]);
    await page.waitForTimeout(27_000);
    expect(await ev(page, d => d.leadTowerState())).not.toBe('leading');
    const got = await ev<number>(page, d => d.giveGem(1));
    test.skip(got === 0, 'gems arrive with the grumps step: the gem lead is covered by tests/game/leadTower.test.ts until then');
    await expect.poll(() => ev(page, d => d.leadTowerState()), { timeout: 30_000 }).toBe('leading');
  });

  test('hello in his own voice, then the welcome gift exactly once', async ({ page }) => {
    await ready(page);
    await ev(page, d => d.resumeAudio());
    await page.touchscreen.tap(30, 300); // the first tap unlocks audio
    await faceWizard(page);
    await expect.poll(() => ev(page, d => d.wizard().lastKey()), { timeout: 15_000 }).toBe('hello');
    await expect.poll(() => ev<any>(page, d => d.voiceLast().key), { timeout: 15_000 }).toMatch(/^wizard\//);
    await tapWizard(page);
    await expect.poll(() => ev(page, d => d.wizard().isOpen)).toBe(true);
    expect(await ev(page, d => d.wizard().currentTab)).toBe('trade');
    await expect(page.locator('.wiz-card')).toHaveCount(8);
    expect(await page.locator('.wiz-card .wiz-gift').count()).toBe(8);
    await tapEl(page, '.wiz-card', 3);
    expect(await total(page)).toBe(1);
    expect(await ev(page, d => d.game.inventory.count(43))).toBe(1);
    await tapEl(page, '.wiz-close');
    expect(await ev(page, d => d.wizard().isOpen)).toBe(false);
    await page.waitForTimeout(300);
    await tapWizard(page);
    await expect.poll(() => ev(page, d => d.wizard().isOpen)).toBe(true);
    // Gift had and no gem: it opens on the puzzles; the trade tab shows prices now and no second gift.
    expect(await ev(page, d => d.wizard().currentTab)).toBe('puzzle');
    await tapEl(page, '.wiz-tab[data-tab="trade"]');
    expect(await page.locator('.wiz-card .wiz-gift').count()).toBe(0);
    expect(await page.locator('.wiz-card .wiz-price').count()).toBe(8);
    await tapEl(page, '.wiz-card', 1);
    expect(await total(page)).toBe(1);
    // Saved at once.
    const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), SAVE);
    expect(saved.wizard.gift).toBe(true);
  });

  test('trade: with no gem a card changes nothing and Orlo kindly says so; with gems a bundle of 4', async ({ page }) => {
    await ready(page);
    await faceWizard(page);
    await giftTaken(page);
    await ev(page, d => d.wizard().tab('trade'));
    const before = await total(page);
    await tapEl(page, '.wiz-card', 2);
    expect(await total(page)).toBe(before);
    expect(await ev(page, d => d.wizard().lastKey())).toBe('needGem');
    await expect(page.locator('.wiz-tab[data-tab="puzzle"]')).toHaveClass(/pulse/);
    const got = await ev<number>(page, d => d.giveGem(1));
    test.skip(got === 0, 'gems arrive with the grumps step: buying is covered by tests/ui/wizard.test.ts until then');
    await ev(page, d => { d.wizard().tab('puzzle'); d.wizard().tab('trade'); });
    await tapEl(page, '.wiz-card', 2); // Cloud: 1 gem
    expect(await ev(page, d => d.game.inventory.count(42))).toBe(4);
    expect(await ev(page, d => d.giveGem(0))).toBe(0);
  });

  test('puzzles: a wrong card loses nothing, the right one gives a block, counting works with an empty bag, three clean solves raise the level', async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page);
    await faceWizard(page);
    await giftTaken(page);
    await ev(page, d => d.wizard().tab('puzzle'));
    for (const kind of ['pattern', 'match']) {
      const p = await puzzleOf(page, kind);
      const wrong = p.answer === 0 ? 1 : 0;
      const before = await total(page);
      await tapEl(page, `.wiz-option[data-option="${wrong}"]`);
      expect(await total(page)).toBe(before);
      expect(await ev(page, d => d.wizard().lastKey())).toBe('tryAgain');
      await tapEl(page, `.wiz-option[data-option="${p.answer}"]`);
      expect(await total(page)).toBe(before + 1);
      expect(await ev(page, d => d.wizard().puzzle().solved)).toBe(true);
    }
    const c = await puzzleOf(page, 'count');
    const before = await total(page);
    for (const w of c.wants) for (let i = 0; i < w.n; i++) await tapEl(page, `.wiz-shelf-item[data-add="${w.thing}"]`);
    expect(await total(page)).toBe(before + 1);
    expect((await wizardState(page)).clean).toBeGreaterThanOrEqual(2); // the two picks above had one wrong each: still clean
    // Closing mid-puzzle changes nothing.
    await ev(page, d => { d.wizard().tab('trade'); d.wizard().tab('puzzle'); });
    const mid = JSON.stringify(await wizardState(page));
    await tapEl(page, '.wiz-close');
    expect(JSON.stringify(await wizardState(page))).toBe(mid);
    expect((await wizardState(page)).clean).toBe(3);
    await ev(page, d => d.saveNow());
    await page.reload();
    await page.waitForFunction(() => !!(window as any).__debug);
    expect((await wizardState(page)).clean).toBe(3);
    await ev(page, d => { d.wizard().open(); d.wizard().tab('puzzle'); });
    expect((await ev<any>(page, d => d.wizard().puzzle())).level).toBe(1);
  });

  test('hints: 1 at 12 s, 2 at 24 s, and at 45 s Orlo finishes it with the block given', async ({ page }) => {
    await ready(page);
    await faceWizard(page);
    await giftTaken(page);
    await ev(page, d => d.wizard().tab('puzzle'));
    const before = await total(page);
    await ev(page, d => d.wizard().advance(12.5));
    expect(await ev(page, d => d.wizard().hint())).toBe(1);
    await expect(page.locator('.wiz-body .glow')).toHaveCount(1);
    await ev(page, d => d.wizard().advance(12));
    expect(await ev(page, d => d.wizard().hint())).toBe(2);
    await ev(page, d => d.wizard().advance(21));
    const p = await ev<any>(page, d => d.wizard().puzzle());
    expect(p.solved && p.helped).toBe(true);
    expect(await total(page)).toBe(before + 1);
    expect(await ev(page, d => d.wizard().lastKey())).toBe('helped');
  });

  test('the world is paused while the screen is open; with the break bubble up Orlo is silent and the screen still works', async ({ page }) => {
    await ready(page);
    await faceWizard(page);
    await giftTaken(page);
    const pos = await ev<any>(page, d => d.playerPos());
    await ev(page, (d, p) => d.game.applyIntent({ kind: 'walk', to: [Math.floor(p.x) - 6, Math.floor(p.y), Math.floor(p.z)] }), pos);
    await page.waitForTimeout(800);
    const pos2 = await ev<any>(page, d => d.playerPos());
    expect(Math.hypot(pos2.x - pos.x, pos2.z - pos.z)).toBeLessThan(0.01);
    expect(await ev(page, d => d.game.paused)).toBe(true);
    await ev(page, d => { d.wizard().tab('puzzle'); d.hud.showBreak(() => {}); });
    const said = await ev(page, d => d.wizard().lastKey());
    const p = await puzzleOf(page, 'match');
    const before = await total(page);
    await tapEl(page, `.wiz-option[data-option="${p.answer}"]`);
    expect(await total(page)).toBe(before + 1);
    expect(await ev(page, d => d.wizard().lastKey())).toBe(said);
  });

  test('the eight blocks: placed, dug back with a hold, Rainbow shimmers without rebuilding a chunk', async ({ page }) => {
    await ready(page);
    // A row on the flat, paved village square.
    const sq = await ev<any>(page, d => d.village().square);
    const z = sq.z0 + 1;
    const y = await ev<number>(page, (d, a) => d.game.world.topSolidY(a.x, a.z) + 1, { x: sq.x0 + 1, z });
    const cells: Cell[] = MYTHICAL.map((_, i) => [sq.x0 + 1 + i, y, z]);
    await ev(page, (d, ids) => { for (const id of ids) d.giveItem(id, 2); }, MYTHICAL);
    for (let i = 0; i < MYTHICAL.length; i++) {
      const placed = await ev<number>(page, (d, a) => {
        d.teleport(a.c[0] + 0.5, a.c[1], a.c[2] + 2.5);
        d.game.selected = a.id;
        d.game.applyIntent({ kind: 'place', cell: a.c });
        return d.game.world.get(a.c[0], a.c[1], a.c[2]);
      }, { c: cells[i], id: MYTHICAL[i] });
      expect(placed, `block ${MYTHICAL[i]}`).toBe(MYTHICAL[i]);
    }
    // Stand 3 south of the Rainbow block, looking north at it.
    await ev(page, (d, c) => { d.teleport(c[0] + 0.5, c[1], c[2] + 3.5); d.setCamera(Math.PI, 0.5); }, cells[1]);
    await frames(page, 30);
    const s0 = await ev<any>(page, d => d.stats());
    await page.waitForTimeout(2000);
    const s1 = await ev<any>(page, d => d.stats());
    expect(s1.shimmerRepaints).toBeGreaterThan(s0.shimmerRepaints);
    expect(s1.chunkBuilds).toBe(s0.chunkBuilds);
    // Dig the Rainbow back with a real hold.
    const at = await ev<any>(page, (d, c) => d.screenOf(c[0] + 0.5, c[1] + 0.5, c[2] + 1), cells[1]);
    expect((await ev<any>(page, (d, p) => d.pick(p.x, p.y), at)).cell).toEqual(cells[1]);
    await ev(page, d => d.selectStack('hand'));
    await press(page, at.x, at.y, 900);
    await expect.poll(() => ev(page, (d, c) => d.game.world.get(c[0], c[1], c[2]), cells[1])).toBe(0);
    expect(await ev(page, (d, id) => d.game.inventory.count(id), RAINBOW)).toBe(2);
  });

  test('camera in the tower: drag to turn on both floors and the camera is never inside a block', async ({ page }) => {
    await ready(page);
    const t = await tower(page);
    for (const floor of t.floors) {
      const c = floor.cells[Math.floor(floor.cells.length / 2)];
      expect(await ev(page, (d, a) => d.teleport(a[0] + 0.5, a[1], a[2] + 0.5), c)).toBe(true);
      await frames(page, 20);
      for (let k = 0; k < 4; k++) {
        const yaw = await ev<number>(page, d => d.camera().yaw);
        // As the smoke test: start high on the screen, long enough that a hold can never start.
        await drag(page, 440, 200, 400, 0);
        await frames(page, 15);
        const after = await ev<number>(page, d => d.camera().yaw);
        expect(Math.abs(Math.atan2(Math.sin(after - yaw), Math.cos(after - yaw)))).toBeGreaterThan(0.3);
        const inside = await ev<boolean>(page, d => {
          const p = d.camera().position;
          const id = d.game.world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          return id !== 0 && id !== 7; // not air, not water
        });
        expect(inside).toBe(false);
      }
    }
  });

  test('gestures unchanged: a hold on Orlo digs nothing, a block cannot go into him, a tap elsewhere walks', async ({ page }) => {
    await ready(page);
    const t = await faceWizard(page);
    const p = await ev<{ x: number; y: number }>(page, d => d.wizard().screenOf());
    const edits = await ev<number>(page, d => d.game.world.edits().length);
    await press(page, p.x, p.y, 900);
    await page.waitForTimeout(200);
    expect(await ev(page, d => d.outlineVisible())).toBe(false);
    expect(await ev<number>(page, d => d.game.world.edits().length)).toBe(edits);
    expect(await ev(page, d => d.wizard().isOpen)).toBe(false); // a hold is not a tap
    const [wx, wy, wz] = t.wizardSpot;
    const stillAir = await ev<number[]>(page, (d, c) => {
      d.giveItem(3, 5);
      d.game.selected = 3;
      d.game.applyIntent({ kind: 'place', cell: [c[0], c[1], c[2]] });
      d.game.applyIntent({ kind: 'place', cell: [c[0], c[1] + 1, c[2]] });
      return [d.game.world.get(c[0], c[1], c[2]), d.game.world.get(c[0], c[1] + 1, c[2])];
    }, [wx, wy, wz]);
    expect(stillAir).toEqual([0, 0]);
    // A quick tap on the floor away from him walks.
    await ev(page, d => d.selectStack('hand'));
    const floor = t.floors[0].cells.find(c => Math.hypot(c[0] - wx, c[2] - wz) > 2.5)!;
    const at = await ev<any>(page, (d, c) => d.screenOf(c[0] + 0.5, c[1], c[2] + 0.5), floor);
    const from = await ev<any>(page, d => d.playerPos());
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => {
      const q = await ev<any>(page, d => d.playerPos());
      return Math.hypot(q.x - from.x, q.z - from.z);
    }).toBeGreaterThan(0.3);
    expect(await ev(page, d => d.wizard().isOpen)).toBe(false);
  });

  test('old saves load: a version 2 save without the wizard fields keeps his bag and spot, the tower exists', async ({ page: first }) => {
    await ready(first);
    const spawn = await first.evaluate(() => (window as any).__debug.playerPos());
    const v2 = JSON.stringify({
      version: 2, gen: 2, seed: 2026, edits: [[20, 9, 20, 3]], inventory: { 4: 6 }, order: [4],
      player: spawn, flags: { ledToVillage: true },
    });
    const page = await first.context().newPage();
    await first.close();
    await page.addInitScript(raw => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      localStorage.setItem('blockpals.save.v2', raw);
    }, v2);
    await page.goto(URL);
    await page.waitForFunction(() => !!(window as any).__debug);
    const t = await tower(page);
    expect(t.wizardSpot).toEqual([34, 10, 82]);
    expect(await ev(page, d => d.game.inventory.count(4))).toBe(6);
    expect(await ev(page, d => d.game.world.get(20, 9, 20))).toBe(3);
    const p = await ev<any>(page, d => d.playerPos());
    expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(0.5);
    expect(await wizardState(page)).toEqual({ gift: false, met: false, led: false, solved: 0, clean: 0, bought: 0, hints: expect.any(Array) });
    expect(await page.evaluate(() => localStorage.getItem('blockpals.save.v1'))).toBeNull();
  });

  test('fps with the tower, the light and the village in view, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
    const t = await tower(page);
    await ev(page, (d, a) => { d.teleport(a.x + 0.5, d.game.world.topSolidY(a.x, a.z) + 1, a.z + 0.5); d.setCamera(0, 0.2); }, { x: 50, z: 45 });
    await page.waitForTimeout(2500);
    const s = await ev<any>(page, d => d.stats());
    console.log(`wizard e2e: fps ${s.fps}, draw calls ${s.drawCalls}, triangles ${s.triangles}, depthBits ${s.depthBits}, beacon ${JSON.stringify(await ev(page, d => d.beacon()))}`);
    expect(s.fps).toBeGreaterThan(0);
    expect(t.beacon.y).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });
});
