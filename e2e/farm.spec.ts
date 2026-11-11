import { test, expect, type Page } from '@playwright/test';
import { drag, frames, press, ready, screenOfCell, standLooking, URL, walkTo, type Cell, type FarmDbg } from './helpers';

// Village step 2: the browser story for eating and the farm. Item ids: seeds 100..103, Apple 104,
// Carrot 105, Potato 106, Wheat 107, Egg 108, Milk 109, Wool 110. Blocks: Farmland 16, WoolRed 19,
// Wheat0..3 24..27, Carrot0..3 28..31.
const WHEAT_SEED = 100, CARROT_SEED = 101, SAPLING = 103, APPLE = 104, CARROT = 105, WHEAT = 107, EGG = 108, MILK = 109, WOOL = 110;
const FARMLAND = 16, WOOL_RED = 19, WHEAT0 = 24, WHEAT3 = 27, CARROT0 = 28;
const SAVE = 'blockpals.save.v2';

/**
 * Stands him on the aisle beside the first bed, looking at it, and returns a bed cell in reach that
 * Pip is not standing on (Pip follows close behind him and a seed cannot go where Pip stands).
 */
async function atBed(page: Page): Promise<{ bed: Cell; ground: number }> {
  const layout = await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm());
  const b = layout.beds[0];
  const stand = b.x0 + 3;
  await standLooking(page, { x: stand, z: b.z1 + 1 }, stand + 0.5, b.z1 + 0.5);
  const pip = await page.evaluate(() => (window.__debug as unknown as FarmDbg).pipPos());
  let x = b.x0 + 2;
  for (let c = b.x0 + 1; c <= b.x0 + 5; c++) {
    if (Math.hypot(pip.x - (c + 0.5), pip.z - (b.z1 + 0.5)) > Math.hypot(pip.x - (x + 0.5), pip.z - (b.z1 + 0.5))) x = c;
  }
  const ground = await page.evaluate(([px, pz]) => (window.__debug as unknown as FarmDbg).game.world.topSolidY(px, pz), [x, b.z1]);
  return { bed: [x, ground, b.z1], ground };
}
const world = (page: Page, c: Cell) => page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).game.world.get(x, y, z), c);
const count = (page: Page, id: number) => page.evaluate(i => (window.__debug as unknown as FarmDbg).game.inventory.count(i), id);

test.describe('eating and the farm', () => {
  test('plant, tap to grow three times, press and hold to pick, then eat', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
    const { bed } = await atBed(page);
    await page.evaluate(([w]) => { (window.__debug as unknown as FarmDbg).giveItem(w, 5); (window.__debug as unknown as FarmDbg).selectStack(w); }, [WHEAT_SEED]);
    // A quick tap on the soil in reach plants one seed.
    const soil = await screenOfCell(page, bed, 1);
    await page.touchscreen.tap(soil.x, soil.y);
    const plant: Cell = [bed[0], bed[1] + 1, bed[2]];
    await expect.poll(() => world(page, plant)).toBe(WHEAT0);
    expect(await count(page, WHEAT_SEED)).toBe(4);
    expect(await world(page, bed)).toBe(FARMLAND);
    // Three quick taps ripen it, a sparkle each.
    for (let stage = 1; stage <= 3; stage++) {
      await page.waitForTimeout(450);
      const at = await screenOfCell(page, plant, 0.4);
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => world(page, plant)).toBe(WHEAT0 + stage);
      expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).stats())).particles).toBeGreaterThan(0);
    }
    // A quick tap on a ripe plant changes nothing more.
    await page.waitForTimeout(450);
    const ripe = await screenOfCell(page, plant, 0.4);
    await page.touchscreen.tap(ripe.x, ripe.y);
    await page.waitForTimeout(300);
    expect(await world(page, plant)).toBe(WHEAT3);
    // Press and hold picks it: the ring shows, 2 wheat and 2 seeds arrive, the soil stays.
    await page.waitForTimeout(450);
    await press(page, ripe.x, ripe.y, 900, async () => { await expect(page.locator('.dig-ring')).toBeVisible(); });
    await expect.poll(() => world(page, plant)).toBe(0);
    expect(await count(page, WHEAT)).toBe(2);
    expect(await count(page, WHEAT_SEED)).toBe(6);
    expect(await world(page, bed)).toBe(FARMLAND);

    // Eating: select the food, then the big button. One carrot goes and nothing else changes.
    await page.evaluate(([c]) => { (window.__debug as unknown as FarmDbg).giveItem(c, 3); (window.__debug as unknown as FarmDbg).selectStack(c); }, [CARROT]);
    await expect(page.locator('.munch-btn')).toBeVisible();
    const before = await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()));
    const pos = await page.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
    await page.locator('.munch-btn').tap({ force: true }); // it pulses for its first few seconds
    expect(await count(page, CARROT)).toBe(2);
    await page.locator('.munch-btn').tap({ force: true }); // it pulses for its first few seconds // a second tap during the munch eats nothing
    expect(await count(page, CARROT)).toBe(2);
    expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).eating())).active).toBe(true);
    await expect.poll(() => page.evaluate(() => (window.__debug as unknown as FarmDbg).eating().active), { timeout: 3000 }).toBe(false);
    const after = await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()));
    expect(JSON.parse(after).filter((s: { id: number }) => s.id !== CARROT)).toEqual(JSON.parse(before).filter((s: { id: number }) => s.id !== CARROT));
    expect(await count(page, CARROT)).toBe(2);
    const pos2 = await page.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
    expect(Math.hypot(pos2.x - pos.x, pos2.z - pos.z)).toBeLessThan(0.01);
    // Wheat is not edible: no munch button.
    await page.evaluate(([w]) => (window.__debug as unknown as FarmDbg).selectStack(w), [WHEAT]);
    await expect(page.locator('.munch-btn')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a quick tap on a plant out of reach walks; tap never digs', async ({ page }) => {
    await ready(page);
    const { bed } = await atBed(page);
    const plant: Cell = [bed[0], bed[1] + 1, bed[2]];
    await page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).game.world.set(x, y, z, 24), plant);
    await page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).game.world.set(x, y, z, 0), plant);
    // Another plant well out of reach: put it 9 cells along the bed.
    const far: Cell = [bed[0] + 5, bed[1] + 1, bed[2]];
    await page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).game.world.set(x, y, z, 24), far);
    await frames(page, 5);
    const start = await page.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
    await standLooking(page, { x: bed[0] - 2, z: bed[2] + 1 }, far[0] + 0.5, far[2] + 0.5);
    const s = await screenOfCell(page, far, 0.4);
    await page.touchscreen.tap(s.x, s.y);
    await expect.poll(() => page.evaluate(([sx, sz]) => {
      const p = (window.__debug as unknown as FarmDbg).playerPos();
      return Math.hypot(p.x - sx, p.z - sz);
    }, [bed[0] - 1.5, bed[2] + 1.5])).toBeGreaterThan(0.8);
    expect(await world(page, far)).toBe(WHEAT0); // not helped (out of reach) and not dug
    void start;
  });

  test('hold on an animal never digs; a block placed into an animal is refused', async ({ page }) => {
    test.setTimeout(90_000);
    await ready(page);
    const lay = await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm());
    const p = lay.pasture;
    await standLooking(page, { x: p.x0 + 3, z: p.z0 + 4 }, p.x0 + 8.5, p.z0 + 5.5);
    // He must stand still: a walk in progress drags the camera, and a small animal slides out from
    // under the spot we aim at between measuring and pressing (that was the flake).
    await expect.poll(async () => {
      const a = await page.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
      await page.waitForTimeout(150);
      const b = await page.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
      return Math.hypot(a.x - b.x, a.z - b.z);
    }).toBeLessThan(0.001);
    const animals = await page.evaluate(() => (window.__debug as unknown as FarmDbg).herd());
    expect(animals).toHaveLength(10);
    // The animal nearest to him that is on screen, and the real pick agrees the finger is on it.
    let target: { id: number; x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !target; i++) {
      const found = await page.evaluate(() => {
        const d = window.__debug as unknown as FarmDbg;
        const me = d.playerPos();
        const list = d.herd().map(a => ({ a, s: d.screenOfAnimal(a.id), dist: Math.hypot(a.x - me.x, a.z - me.z) }))
          .filter(o => o.s && o.s.x > 150 && o.s.x < 1130 && o.s.y > 150 && o.s.y < 650 && o.dist < 6 && d.animalAt(o.s.x, o.s.y) === o.a.id)
          .sort((u, v) => u.dist - v.dist);
        return list[0] ? { id: list[0].a.id, ...list[0].s! } : null;
      });
      if (found) target = found; else await page.waitForTimeout(250);
    }
    expect(target, 'an animal near him and on screen').not.toBeNull();
    const groundBefore = await page.evaluate(() => (window.__debug as unknown as FarmDbg).game.world.get(0, 0, 0)); // sentinel: world reads work
    void groundBefore;
    const edits = await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()));
    expect(await page.evaluate(([x, y]) => (window.__debug as unknown as FarmDbg).animalAt(x, y), [target!.x, target!.y])).toBe(target!.id); // still under the finger
    await press(page, target!.x, target!.y, 900, async () => { await expect(page.locator('.dig-ring')).toBeHidden(); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()))).toBe(edits); // nothing dug
    expect(await page.evaluate(() => (window.__debug as unknown as FarmDbg).herd().length)).toBe(10);
    // Placing: a block selected, tap on the animal: the bag count is unchanged (a pet or a walk, never a block).
    await page.evaluate(() => { (window.__debug as unknown as FarmDbg).giveItem(8, 5); (window.__debug as unknown as FarmDbg).selectStack(8); });
    const now = await page.evaluate(id => {
      const d = window.__debug as unknown as FarmDbg;
      const a = d.herd().find(o => o.id === id)!;
      return { s: d.screenOfAnimal(id), a };
    }, target!.id);
    if (now.s) await page.touchscreen.tap(now.s.x, now.s.y);
    await page.waitForTimeout(400);
    expect(await count(page, 8)).toBe(5);
  });

  test('hold out food and the animals come; a gift; a resting animal costs nothing; wool crafts into a red block', async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page);
    const lay = await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm());
    const p = lay.pasture;
    const stand = { x: Math.floor((p.x0 + p.x1) / 2), z: p.z0 + 2 };
    await standLooking(page, stand, stand.x + 0.5, p.z0 + 6.5);
    await page.evaluate(() => { (window.__debug as unknown as FarmDbg).giveItem(107, 6); (window.__debug as unknown as FarmDbg).giveItem(105, 3); (window.__debug as unknown as FarmDbg).selectStack(107); });
    // Every animal within 10 blocks walks over and stands within 3 blocks.
    await expect.poll(() => page.evaluate(() => {
      const d = window.__debug as unknown as FarmDbg;
      const me = d.playerPos();
      const near = d.herd().filter(a => Math.hypot(a.x - me.x, a.z - me.z) <= 10.5 || a.state === 'come');
      const far = near.filter(a => Math.hypot(a.x - me.x, a.z - me.z) > 3.2);
      return { n: near.length, far: far.length };
    }), { timeout: 20_000, intervals: [250] }).toMatchObject({ far: 0 });
    // Tap a close cow: a gift. The spare tap at once: resting, nothing used.
    const cowTap = async (): Promise<boolean> => {
      const s = await page.evaluate(() => {
        const d = window.__debug as unknown as FarmDbg;
        const me = d.playerPos();
        const cow = d.herd().filter(a => a.kind === 'cow' && Math.hypot(a.x - me.x, a.z - me.z) < 3).sort((u, v) => u.giftIn - v.giftIn)[0];
        return cow ? { s: d.screenOfAnimal(cow.id), id: cow.id } : null;
      });
      if (!s?.s) return false;
      await page.touchscreen.tap(s.s.x, s.s.y);
      return true;
    };
    let fed = false;
    for (let i = 0; i < 20 && !fed; i++) {
      if (await cowTap()) { await page.waitForTimeout(300); fed = (await count(page, MILK)) > 0; }
      else await page.waitForTimeout(400);
    }
    expect(fed, 'a cow gave milk').toBe(true);
    expect(await count(page, WHEAT)).toBe(5);
    const wheatNow = await count(page, WHEAT);
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(450); await cowTap(); }
    expect(await count(page, WHEAT)).toBeLessThanOrEqual(wheatNow);
    expect(await count(page, WHEAT)).toBeGreaterThanOrEqual(wheatNow - 1); // the second cow may have taken one; the first rests
    expect(await count(page, MILK)).toBeGreaterThanOrEqual(1);
    // Wool makes coloured blocks.
    const woolBefore = await count(page, WOOL);
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).giveItem(110, 1));
    expect(await page.evaluate(() => (window.__debug as unknown as FarmDbg).game.tryCraft('wool-red'))).toBe(true);
    expect(await count(page, WOOL_RED)).toBe(2);
    expect(await count(page, WOOL)).toBe(woolBefore);
  });

  test('Fern gives the starter seeds once, on her first hello', async ({ page }) => {
    test.setTimeout(150_000);
    await ready(page);
    const v = await page.evaluate(() => (window.__debug as unknown as FarmDbg).village());
    const house = v.houses.find(h => h.id === 'farmhouse')!;
    await page.touchscreen.tap(640, 120); // the first tap unlocks audio
    await page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).teleport(x + 0.5, y, z + 0.5), house.doorFront);
    await walkTo(page, house.doorInside, 1.2, 15_000);
    const state = () => page.evaluate(() => (window.__debug as unknown as FarmDbg).audioState());
    for (let i = 0; i < 15 && (await state()).ctx !== 'running'; i++) {
      await page.evaluate(() => (window.__debug as unknown as FarmDbg).resumeAudio());
      await page.waitForTimeout(1500);
    }
    if ((await state()).ctx !== 'running') {
      // Headless audio never woke: her hello (and so the gift) is held, quietly, and nothing is spent.
      test.info().annotations.push({ type: 'note', description: 'AudioContext stayed suspended; checked the seeds are held, not given' });
      expect(await count(page, WHEAT_SEED)).toBe(0);
      expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).flags())).fernSeeds).toBeUndefined();
      return;
    }
    await expect.poll(() => page.locator('.bubble-picture').textContent(), { timeout: 40_000 }).toBe('🌱');
    expect([await count(page, WHEAT_SEED), await count(page, CARROT_SEED), await count(page, 102), await count(page, SAPLING)]).toEqual([5, 5, 5, 2]);
    expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).flags())).fernSeeds).toBe(true);
    await expect.poll(() => page.evaluate(() => (window.__debug as unknown as FarmDbg).voiceLast()), { timeout: 15_000 }).toMatchObject({ key: expect.stringMatching(/^fern\//) });
    // The bag tray shows the seeds (pictures with digits).
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).openBag());
    await expect(page.locator('.bag-tray')).toBeVisible();
    // Reload and walk back in: no second gift.
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
    expect(await count(page, WHEAT_SEED)).toBe(5);
    await page.touchscreen.tap(640, 120);
    await page.evaluate(([x, y, z]) => (window.__debug as unknown as FarmDbg).teleport(x + 0.5, y, z + 0.5), house.doorFront);
    await walkTo(page, house.doorInside, 1.2, 15_000);
    await page.waitForTimeout(6000);
    expect(await count(page, WHEAT_SEED)).toBe(5);
    expect(await count(page, SAPLING)).toBe(2);
  });

  test('plants keep growing while away, and a clock set to the future costs nothing', async ({ page }) => {
    test.setTimeout(150_000);
    await ready(page);
    const { bed } = await atBed(page);
    const plant: Cell = [bed[0], bed[1] + 1, bed[2]];
    await page.evaluate(() => { (window.__debug as unknown as FarmDbg).giveItem(100, 3); (window.__debug as unknown as FarmDbg).selectStack(100); });
    const soil = await screenOfCell(page, bed, 1);
    await page.touchscreen.tap(soil.x, soil.y);
    await expect.poll(() => world(page, plant)).toBe(WHEAT0);
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
    const reloadWithSavedAt = async (offsetMs: number): Promise<void> => {
      // pagehide saves on the way out, so the rewrite happens on the way back in.
      await page.evaluate(o => sessionStorage.setItem('rewrite', String(o)), offsetMs);
      await page.reload();
      await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
      await frames(page, 5);
    };
    await page.addInitScript(() => {
      const o = sessionStorage.getItem('rewrite');
      if (o === null) return;
      sessionStorage.removeItem('rewrite');
      const raw = localStorage.getItem('blockpals.save.v2');
      if (!raw) return;
      const d = JSON.parse(raw);
      d.savedAt = Date.now() - Number(o);
      localStorage.setItem('blockpals.save.v2', JSON.stringify(d));
    });
    // The future: no growth, nothing wilts.
    await reloadWithSavedAt(-60 * 60_000);
    expect(await world(page, plant)).toBe(WHEAT0);
    // 20 minutes away: ripe.
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
    await reloadWithSavedAt(20 * 60_000);
    expect(await world(page, plant)).toBe(WHEAT3);
    // A week: capped, still ripe, no errors.
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
    await reloadWithSavedAt(7 * 24 * 3600_000);
    expect(await world(page, plant)).toBe(WHEAT3);
    expect(await page.evaluate(() => (window.__debug as unknown as FarmDbg).farm().crops.length)).toBeGreaterThan(0);
  });

  test('save and reload keeps the crop stage, the animals and the bag', async ({ page }) => {
    test.setTimeout(90_000);
    await ready(page);
    const { bed } = await atBed(page);
    const plant: Cell = [bed[0], bed[1] + 1, bed[2]];
    await page.evaluate(() => { (window.__debug as unknown as FarmDbg).giveItem(101, 2); (window.__debug as unknown as FarmDbg).giveItem(109, 3); (window.__debug as unknown as FarmDbg).selectStack(101); });
    const soil = await screenOfCell(page, bed, 1);
    await page.touchscreen.tap(soil.x, soil.y);
    await expect.poll(() => world(page, plant)).toBe(CARROT0);
    await page.waitForTimeout(450);
    const at = await screenOfCell(page, plant, 0.4);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => world(page, plant)).toBe(CARROT0 + 1);
    const herdBefore = await page.evaluate(() => (window.__debug as unknown as FarmDbg).herd().map(a => a.kind).sort());
    const bagBefore = await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()));
    await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
    expect(await world(page, plant)).toBe(CARROT0 + 1);
    expect(await page.evaluate(() => (window.__debug as unknown as FarmDbg).herd().map(a => a.kind).sort())).toEqual(herdBefore);
    expect(await page.evaluate(() => JSON.stringify((window.__debug as unknown as FarmDbg).bag()))).toBe(bagBefore);
  });

  test('an old step 1 save loads, keeps his edits and the v1 key is byte-identical', async ({ page: first }) => {
    test.setTimeout(90_000);
    await ready(first);
    const spawn = await first.evaluate(() => (window.__debug as unknown as FarmDbg).playerPos());
    const v1 = JSON.stringify({
      version: 1, seed: 2026, edits: [[47, 6, 47, 3], [30, 6, 30, 8]], inventory: { 4: 7, 3: 2 }, order: [4, 3],
      player: { x: spawn.x, y: spawn.y, z: spawn.z },
    });
    const v2old = JSON.stringify({
      version: 2, gen: 1, seed: 2026, edits: [[47, 6, 47, 3], [30, 6, 30, 8]], inventory: { 4: 7, 3: 2 }, order: [4, 3],
      player: { x: spawn.x, y: spawn.y, z: spawn.z }, flags: { ledToVillage: true },
    });
    for (const [label, seeded] of [['v1', { 'blockpals.save.v1': v1 }], ['v2 from step 1', { 'blockpals.save.v2': v2old, 'blockpals.save.v1': v1 }]] as const) {
      const page = await first.context().newPage();
      await page.addInitScript(seeded => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries(seeded)) localStorage.setItem(k, v as string);
      }, seeded as Record<string, string>);
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(URL);
      await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
      await frames(page, 10);
      expect(await world(page, [47, 6, 47]), label).toBe(3);
      expect(await world(page, [30, 6, 30]), label).toBe(8);
      expect(await count(page, 4), label).toBe(7);
      expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).herd())).length, label).toBe(10); // the farm and animals exist
      expect((await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm())).beds.length).toBe(3);
      await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
      const keys = await page.evaluate(() => ({ v1: localStorage.getItem('blockpals.save.v1'), v2: localStorage.getItem('blockpals.save.v2') }));
      expect(keys.v1, label).toBe(v1); // never written
      expect(JSON.parse(keys.v2!).edits, label).toEqual(expect.arrayContaining([[47, 6, 47, 3], [30, 6, 30, 8]]));
      expect(errors, label).toEqual([]);
      await page.close();
    }
  });

  test('the camera in a field of ripe wheat is not pushed in or put inside a block', async ({ page }) => {
    test.setTimeout(90_000);
    await ready(page);
    const lay = await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm());
    const b = lay.beds[1];
    await page.evaluate(([x0, x1, z0, z1]) => {
      const d = window.__debug as unknown as FarmDbg;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) d.game.world.set(x, d.game.world.topSolidY(x, z) + 1, z, 27);
    }, [b.x0, b.x1, b.z0 - 1, b.z1 + 1]);
    await standLooking(page, { x: b.x0 + 3, z: b.z0 }, b.x0 + 3.5, b.z0 + 4);
    const distances: number[] = [];
    for (const yaw of [0, 1.5, 3, 4.5]) {
      await page.evaluate(y => (window.__debug as unknown as FarmDbg).setCamera(y, 0.3), yaw);
      await drag(page, 640, 400, 60, 0, 6);
      await frames(page, 20);
      const c = await page.evaluate(() => {
        const d = window.__debug as unknown as FarmDbg;
        const cam = d.camera();
        return { ...cam, block: d.game.world.get(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z)) };
      });
      expect([0, 7, 24, 25, 26, 27]).toContain(c.block); // air, water, or a (see-through) plant, never solid
      distances.push(c.distance);
    }
    expect(Math.min(...distances)).toBeGreaterThan(1.5);
  });

  test('ten kinds fill the bar to eight plus the bag slot; a block can be chosen from the tray and placed', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);
    await page.evaluate(() => { for (const id of [1, 2, 3, 4, 5, 6, 8, 9, 10, 12]) (window.__debug as unknown as FarmDbg).giveItem(id, 2); });
    await expect(page.locator('.hotbar .slot')).toHaveCount(10); // hand + 8 + bag slot
    await expect(page.locator('.bag-slot')).toBeVisible();
    await page.locator('.bag-slot').tap();
    await expect(page.locator('.bag-tray')).toBeVisible();
    const entries = page.locator('.bag-tray button');
    expect(await entries.count()).toBeGreaterThanOrEqual(10);
    // Choose the 9th stack (Bricks, hidden behind the bag slot) from the tray: it becomes the selection.
    const hidden = await page.evaluate(() => (window.__debug as unknown as FarmDbg).bag()[8].id);
    await page.locator(`.bag-tray [data-stack="${hidden}"]`).tap();
    await expect(page.locator('.bag-tray')).toBeHidden();
    expect(await page.evaluate(() => (window.__debug as unknown as FarmDbg).game.selected)).toBe(hidden);
    const { bed } = await atBed(page);
    const top = await screenOfCell(page, bed, 1);
    const had = await count(page, hidden);
    await page.touchscreen.tap(top.x, top.y);
    await expect.poll(() => count(page, hidden)).toBe(had - 1);
  });

  test('the village, the farm and ten animals in view: draw calls stay small, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
    const lay = await page.evaluate(() => (window.__debug as unknown as FarmDbg).layoutFarm());
    const b = lay.beds[0];
    await page.evaluate(([x0, x1, z0, z1]) => {
      const d = window.__debug as unknown as FarmDbg;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) d.game.world.set(x, d.game.world.topSolidY(x, z) + 1, z, 27);
    }, [b.x0, b.x1, b.z0, b.z1]);
    await standLooking(page, { x: lay.pasture.x0 + 11, z: lay.pasture.z0 - 3 }, lay.pasture.x0 + 11.5, lay.pasture.z0 + 5);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => (window.__debug as unknown as FarmDbg).stats());
    console.log(`farm story: ${JSON.stringify(st)}`);
    expect(st.animals).toBe(10);
    expect(st.drawCalls).toBeLessThanOrEqual(st.chunks * 2 + 14 + 20); // chunks (solid + see-through) + animals + sparkles + people + the sky
    expect(st.worldTriangles).toBeLessThan(115_000);
    expect(st.fps).toBeGreaterThan(5); // a loose floor in a software renderer; the tablet number is on the checklist
    expect(errors).toEqual([]);
  });
});
