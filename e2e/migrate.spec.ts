import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { frames, URL as GAME_URL, type Cell } from './helpers';

// Old saves move into the big world (plan Task 24): a v2 save (the step 2 extremes, and a realistic
// save as the live game writes it today: gen 3, the tower, the wizard's progress) and a v1 save are
// each shifted by +48 once, the old keys stay byte-identical, the raw copy is kept, and reloading
// never shifts again.
type Dbg = {
  playerPos(): { x: number; y: number; z: number };
  saveNow(): void;
  farm(): { crops: Array<{ x: number; y: number; z: number }> };
  wizard(): { state: Record<string, unknown> };
  tower(): { rect: { x0: number; z0: number; x1: number; z1: number }; wizardSpot: Cell };
  game: { world: { get(x: number, y: number, z: number): number }; inventory: { count(id: number): number } };
};
const dbg = <T>(page: Page, fn: (d: Dbg, a: never) => T, arg?: unknown): Promise<T> =>
  page.evaluate(([f, a]) => (new Function('d', 'a', `return (${f})(d, a)`))((window as unknown as { __debug: unknown }).__debug, a), [fn.toString(), arg] as const) as Promise<T>;
const fixture = (name: string): string => readFileSync(new URL(`../tests/fixtures/saves/${name}`, import.meta.url), 'utf8');
type Edit = [number, number, number, number];

async function load(page: Page, key: string, raw: string): Promise<void> {
  await page.addInitScript(([k, r]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem(k, r);
  }, [key, raw] as const);
  await page.goto(GAME_URL);
  await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug, null, { timeout: 60_000 });
  await frames(page, 10);
}
const keys = (page: Page) => page.evaluate(() => ({
  v1: localStorage.getItem('blockpals.save.v1'), v2: localStorage.getItem('blockpals.save.v2'), v3: localStorage.getItem('blockpals.save.v3'),
  v1backup: localStorage.getItem('blockpals.save.v1.backup'), v2backup: localStorage.getItem('blockpals.save.v2.backup'),
}));
/** What must never change on a reload: the builds, the bag, the flags, the farm records (animals wander, so not them). */
const stable = (raw: string): string => {
  const s = JSON.parse(raw) as Record<string, unknown> & { edits: Edit[] };
  return JSON.stringify({
    version: s.version, origin: s.origin, seed: s.seed, edits: [...s.edits].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]),
    inventory: s.inventory, items: s.items, flags: s.flags, wizard: s.wizard, crops: s.crops, trees: s.trees,
  });
};

async function reloadTwiceNoShift(page: Page): Promise<void> {
  await dbg(page, d => d.saveNow());
  const first = stable((await keys(page)).v3!);
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug, null, { timeout: 60_000 });
    await frames(page, 10);
    await dbg(page, d => d.saveNow());
    expect(stable((await keys(page)).v3!)).toBe(first);
  }
}

test.describe('old saves move into the big world', () => {
  test('the v2 extremes: every edit, the player, crops, trees and animals at +48; the v2 key untouched and backed up; no second shift', async ({ page }) => {
    test.setTimeout(180_000);
    const raw = fixture('v2-extremes.json');
    const v2 = JSON.parse(raw) as { edits: Edit[]; player: { x: number; y: number; z: number }; crops: number[][]; trees: number[][]; animals: number[][] };
    await load(page, 'blockpals.save.v2', raw);
    const k = await keys(page);
    expect(k.v3).not.toBeNull();
    expect(k.v2).toBe(raw);
    expect(k.v2backup).toBe(raw);
    expect(k.v1).toBeNull();
    const v3 = JSON.parse(k.v3!) as { version: number; origin: number[]; migratedFrom?: number; edits: Edit[]; player: { x: number; y: number; z: number }; crops: number[][]; trees: number[][]; animals: number[][] };
    expect(v3.version).toBe(3);
    expect(v3.origin).toEqual([48, 48, 48]);
    // The migration's own write: everything at +48 exactly.
    for (const [x, y, z, id] of v2.edits) expect(v3.edits).toContainEqual([x + 48, y + 48, z + 48, id]);
    expect(v3.player).toEqual({ x: v2.player.x + 48, y: v2.player.y + 48, z: v2.player.z + 48 });
    for (const c of v2.crops) expect(v3.crops).toContainEqual([c[0] + 48, c[1] + 48, c[2] + 48, c[3]]);
    for (const t of v2.trees) expect(v3.trees).toContainEqual([t[0] + 48, t[1] + 48, t[2] + 48, t[3], t[4]]);
    for (const a of v2.animals) expect(v3.animals).toContainEqual([a[0], a[1] + 48, a[2] + 48, a[3] + 48, a[4], a[5]]);
    // And in the running game: every extreme edit is that block at +48.
    for (const [x, y, z, id] of v2.edits) {
      // A crop he planted may have grown while the game was closed (offline growth): it is still his crop, a stage on.
      const grows = v2.crops.some(c => c[0] === x && c[1] === y && c[2] === z);
      const got = await dbg(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), [x + 48, y + 48, z + 48]);
      // A sapling may have grown into a tree's trunk (Sapling 22 to Wood 4).
      const tree = v2.trees.some(t => t[0] === x && t[1] === y && t[2] === z);
      if (grows) expect(got).toBeGreaterThanOrEqual(id);
      else if (tree) expect([22, 4]).toContain(got);
      else expect(got).toBe(id);
    }
    const p = await dbg(page, d => d.playerPos());
    expect(p).toEqual({ x: v2.player.x + 48, y: v2.player.y + 48, z: v2.player.z + 48 });
    const crops = await dbg(page, d => d.farm().crops);
    expect(crops.some(c => c.x === v2.crops[0][0] + 48 && c.y === v2.crops[0][1] + 48 && c.z === v2.crops[0][2] + 48)).toBe(true);
    await reloadTwiceNoShift(page);
    const after = await keys(page);
    expect(after.v2).toBe(raw);
    expect(after.v2backup).toBe(raw);
  });

  test('a realistic save from today\'s game (v2, gen 3): his edits at +48, the tower, the wizard\'s progress and the mythical blocks kept', async ({ page }) => {
    test.setTimeout(180_000);
    const raw = fixture('v2-gen3-tower.json');
    const v2 = JSON.parse(raw) as { edits: Edit[]; crops: number[][]; trees: number[][]; inventory: Record<string, number>; wizard: Record<string, unknown>; player: { x: number; y: number; z: number } };
    await load(page, 'blockpals.save.v2', raw);
    const k = await keys(page);
    expect(k.v2).toBe(raw);
    expect(k.v2backup).toBe(raw);
    for (const [x, y, z, id] of v2.edits) {
      // A crop he planted may have grown while the game was closed (offline growth): it is still his crop, a stage on.
      const grows = v2.crops.some(c => c[0] === x && c[1] === y && c[2] === z);
      const got = await dbg(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), [x + 48, y + 48, z + 48]);
      // A sapling may have grown into a tree's trunk (Sapling 22 to Wood 4).
      const tree = v2.trees.some(t => t[0] === x && t[1] === y && t[2] === z);
      if (grows) expect(got).toBeGreaterThanOrEqual(id);
      else if (tree) expect([22, 4]).toContain(got);
      else expect(got).toBe(id);
    }
    for (const [id, n] of Object.entries(v2.inventory)) expect(await dbg(page, (d, i: number) => d.game.inventory.count(i), Number(id))).toBe(n);
    const w = await dbg(page, d => d.wizard().state);
    for (const [key, value] of Object.entries(v2.wizard)) expect(w[key]).toEqual(value);
    const t = await dbg(page, d => d.tower());
    expect(t.wizardSpot).toEqual([34 + 48, 10 + 48, 82 + 48]);
    // He stood by the tower door: the same spot, +48 (never inside the tower).
    const p = await dbg(page, d => d.playerPos());
    expect(p).toEqual({ x: v2.player.x + 48, y: v2.player.y + 48, z: v2.player.z + 48 });
    const v3 = JSON.parse(k.v3!) as { wizard: Record<string, unknown>; migratedFrom?: number };
    expect(v3.wizard).toEqual(v2.wizard);
    await reloadTwiceNoShift(page);
  });

  test('the v1 extremes: the chain v1 to v2 to v3, every edit at +48, the v1 key untouched and backed up', async ({ page }) => {
    test.setTimeout(180_000);
    const raw = fixture('v1-extremes.json');
    const v1 = JSON.parse(raw) as { edits: Edit[]; inventory: Record<string, number> };
    await load(page, 'blockpals.save.v1', raw);
    const k = await keys(page);
    expect(k.v1).toBe(raw);
    expect(k.v1backup).toBe(raw);
    expect(k.v2).toBeNull();
    expect(JSON.parse(k.v3!).version).toBe(3);
    for (const [x, y, z, id] of v1.edits) expect(await dbg(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), [x + 48, y + 48, z + 48])).toBe(id);
    for (const [id, n] of Object.entries(v1.inventory)) expect(await dbg(page, (d, i: number) => d.game.inventory.count(i), Number(id))).toBe(n);
    await reloadTwiceNoShift(page);
    expect((await keys(page)).v1).toBe(raw);
  });
});
