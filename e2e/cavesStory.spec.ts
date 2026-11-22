import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { frames, press, ready, screenOfCell, walkTo, type Cell } from './helpers';

// The caves story (spec 7h, plan Task 24): dig down, walk in by a mouth, a gem, a treasure chest by a
// real tap, the Old Hideout, the way back up on foot and by the Home button, gestures unchanged, the
// old village intact. Real gestures where cheap, debug intents where a walk would be long.
export interface CaveDbg {
  caves(): {
    mouths: Array<{ kind: string; cell: Cell; ramp: Cell[] }>;
    rooms: Array<{ id: number; layer: string; centre: Cell }>;
    treasure: Array<{ id: string; chest: Cell; entrance: Cell; front: Cell }>;
    ruin: { rect: { x0: number; z0: number; x1: number; z1: number }; floorY: number; chest: Cell; gaps: Cell[] } | null;
    stairs: Cell[];
    ore: Cell[];
    lights: number;
  };
  teleport(x: number, y: number, z: number): boolean;
  setCamera(yaw: number, pitch: number): void;
  setBlock(x: number, y: number, z: number, id: number): void;
  giveItem(id: number, n: number): void;
  selectStack(id: number | 'hand'): void;
  deep(): boolean;
  look(): { fogColor: number; luminance: number };
  lightCheck(): number;
  worldSize(): { x: number; y: number; z: number };
  loading(): boolean;
  sections(): { queued: number; zone: string };
  playerPos(): { x: number; y: number; z: number };
  pipPos(): { x: number; y: number; z: number };
  flags(): { ledToVillage: boolean; hints?: string[]; cavesSeen?: boolean; ruinFound?: boolean };
  pipSaid(): string[];
  hushVoice(): void;
  skipVillageWalk(): void;
  resumeAudio(): void;
  saveNow(): void;
  home(): { visible: boolean; fading: boolean; lead: string; target: number; route: number };
  routeHome(x: number, y: number, z: number): Cell[] | null;
  openChests(): Array<{ id: string; cell: Cell; open: boolean }>;
  chestReveal(): { open: boolean; cards: number };
  village(): { houses: Array<{ id: string; doorFront: Cell }> };
  game: {
    applyIntent(i: unknown): void;
    inventory: { count(id: number): number };
    world: { get(x: number, y: number, z: number): number; topSolidY(x: number, z: number): number };
  };
}
export const ev = <T>(page: Page, fn: (d: CaveDbg, a: never) => T, arg?: unknown): Promise<T> =>
  page.evaluate(([f, a]) => (new Function('d', 'a', `return (${f})(d, a)`))((window as unknown as { __debug: unknown }).__debug, a), [fn.toString(), arg] as const) as Promise<T>;

const BRICKS = 10, CHEST_OPEN = 63, AIR = 0;

/** Puts him on the nearest standable cell at or around `c` (feet), looking along (yaw, pitch). */
async function standAt(page: Page, c: Cell, yaw: number, pitch = 0.3): Promise<Cell> {
  const at = await ev<Cell | null>(page, (d, a: Cell) => {
    for (const dy of [0, 1, -1, 2, -2]) if (d.teleport(a[0] + 0.5, a[1] + dy, a[2] + 0.5)) return [a[0], a[1] + dy, a[2]] as Cell;
    return null;
  }, c);
  expect(at, `somewhere to stand near ${c}`).not.toBeNull();
  await ev(page, (d, a: [number, number]) => d.setCamera(a[0], a[1]), [yaw, pitch]);
  await frames(page, 20);
  await page.waitForFunction(() => (window as unknown as { __debug: CaveDbg }).__debug.sections().queued === 0, null, { timeout: 20_000 }).catch(() => {});
  await frames(page, 10);
  return at!;
}

/** Waits until the Home lift (fade out, lift, fade in) is over, checking the fade is white-gold, never black. */
async function homeByButton(page: Page): Promise<{ me: { x: number; y: number; z: number }; pip: { x: number; y: number; z: number } }> {
  await expect(page.locator('.home-btn')).toBeVisible();
  await page.locator('.home-btn').tap();
  const fade = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.home-fade')!;
    const cs = getComputedStyle(el);
    return { hidden: el.hidden, image: cs.backgroundImage, colour: cs.backgroundColor };
  });
  expect(fade.hidden).toBe(false);
  expect(fade.image).toContain('radial-gradient');
  expect(fade.image).toMatch(/rgb\(255, 255, 255\)/);
  expect(fade.image).not.toMatch(/rgb\(0, 0, 0\)/);
  expect(fade.colour).not.toBe('rgb(0, 0, 0)');
  await expect.poll(() => ev(page, d => d.home().fading), { timeout: 5_000 }).toBe(false);
  // Read at once: Pip appeared beside him behind the fade (later he may walk off on his own errands).
  const at = await ev(page, d => ({ me: d.playerPos(), pip: d.pipPos() }));
  await frames(page, 10);
  return at;
}

test.describe('the caves story', () => {
  test('dig down, a mouth, a gem, a chest, the Old Hideout, home on foot and by the button', async ({ page }, info) => {
    test.setTimeout(480_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);

    // 1. A fresh world: 192 x 68 x 192, the loading picture gone, spawn (72, y, 72), the outdoor look.
    expect(await ev(page, d => d.worldSize())).toEqual({ x: 192, y: 68, z: 192 });
    await expect.poll(() => ev(page, d => d.loading()), { timeout: 10_000 }).toBe(false);
    const spawn = await ev(page, d => d.playerPos());
    expect([Math.floor(spawn.x), Math.floor(spawn.z)]).toEqual([72, 72]);
    // He has met the neighbours before (a fresh game would have Pip lead him to the village 25 s in).
    await ev(page, d => d.skipVillageWalk());
    const outdoor = await ev(page, d => d.look());
    expect(await ev(page, d => d.deep())).toBe(false);
    await expect(page.locator('.home-btn')).toBeHidden();

    // 8 (first, on the meadow). Gestures unchanged: a tap on the ground walks and never digs; a hold
    // on the block under his feet does nothing.
    const feet: Cell = [Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)];
    await standAt(page, feet, 0, 0.55);
    const ahead: Cell = [feet[0], feet[1] - 1, feet[2] + 4];
    const ahead0 = await ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), ahead);
    const pt = await screenOfCell(page, ahead, 1.0);
    await press(page, pt.x, pt.y, 80);
    await expect.poll(async () => (await ev(page, d => d.playerPos())).z - spawn.z, { timeout: 8_000 }).toBeGreaterThan(1.5);
    expect(await ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), ahead)).toBe(ahead0);
    const here = await standAt(page, feet, 0, 1.1);
    const under: Cell = [here[0], here[1] - 1, here[2]];
    const under0 = await ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), under);
    const ptU = await screenOfCell(page, under, 1.0);
    await press(page, ptU.x, ptU.y, 1300);
    await frames(page, 10);
    expect(await ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), under)).toBe(under0);
    await ev(page, d => d.resumeAudio());

    // 2. Dig down: a real press and hold digs the ground in front of him, then the block below it.
    await standAt(page, feet, 0, 0.9);
    const step1: Cell = [feet[0], feet[1] - 1, feet[2] + 1];
    const p1 = await screenOfCell(page, step1, 1.0);
    await press(page, p1.x, p1.y, 1300);
    await expect.poll(() => ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), step1), { timeout: 5_000 }).toBe(AIR);
    const step2: Cell = [feet[0], feet[1] - 2, feet[2] + 1];
    await ev(page, d => d.setCamera(0, 1.2)); // look down into the first step
    await frames(page, 20);
    const p2 = await screenOfCell(page, step2, 1.0);
    expect(await ev(page, (d, q: { x: number; y: number }) => (d as unknown as { pick(x: number, y: number): { cell: Cell } | null }).pick(q.x, q.y)?.cell, p2)).toEqual(step2);
    await press(page, p2.x, p2.y, 1300);
    await expect.poll(() => ev(page, (d, c: Cell) => d.game.world.get(c[0], c[1], c[2]), step2), { timeout: 5_000 }).toBe(AIR);
    // The rest of a staircase, 9 below the ground, by debug intents (long by hand).
    const bottom = await ev<Cell>(page, (d, f: Cell) => {
      let x = f[0], y = f[1], z = f[2] + 1;
      for (let i = 0; i < 9; i++) {
        y -= 1; z += 1;
        for (let k = 0; k <= 2; k++) d.setBlock(x, y + k, z, 0);
      }
      return [x, y, z] as Cell;
    }, [feet[0], feet[1] - 2, feet[2]]);
    await standAt(page, bottom, Math.PI, 0.3);
    await expect.poll(() => ev(page, d => d.deep()), { timeout: 5_000 }).toBe(true);
    await expect(page.locator('.home-btn')).toBeVisible();
    await page.screenshot({ path: info.outputPath('home-button.png') });
    // Home from his own staircase.
    await homeByButton(page);
    expect(await ev(page, d => d.deep())).toBe(false);
    await expect(page.locator('.home-btn')).toBeHidden();

    // 3. Walk into a cave by the hill mouth, down its ramp.
    const c = await ev(page, d => d.caves());
    const hill = c.mouths.find(m => m.kind === 'hill')!;
    await standAt(page, hill.cell, 0, 0.3);
    for (let i = 4; i < hill.ramp.length; i += 5) await walkTo(page, hill.ramp[i], 1.6, 20_000);
    await walkTo(page, hill.ramp[hill.ramp.length - 1], 1.6, 20_000);
    await expect.poll(() => ev(page, d => d.deep()), { timeout: 5_000 }).toBe(true);
    await frames(page, 40);
    const inCave = await ev(page, d => d.look());
    expect(inCave.luminance).toBeGreaterThanOrEqual(0.62);
    expect(inCave.luminance).toBeGreaterThanOrEqual(outdoor.luminance);
    expect(await ev(page, d => d.lightCheck())).toBeLessThanOrEqual(6);
    await page.screenshot({ path: info.outputPath('cave-from-the-hill-mouth.png') });
    await expect.poll(() => ev(page, d => d.flags().cavesSeen === true), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => ev(page, d => { d.hushVoice(); return d.pipSaid(); }).then(said => said.includes('cavesLit')), { timeout: 25_000 }).toBe(true);

    // 4. A gem: stand beside a gem stone and dig it (one Gem, Pip's gemFound once).
    const gemsBefore = await ev(page, d => d.game.inventory.count(123));
    const ore = await ev<Cell | null>(page, d => {
      for (const o of d.caves().ore) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, -1, 1, -2]) {
          if (d.teleport(o[0] + dx + 0.5, o[1] + dy, o[2] + dz + 0.5)) return o;
        }
      }
      return null;
    });
    expect(ore).not.toBeNull();
    await frames(page, 5);
    await ev(page, (d, o: Cell) => d.game.applyIntent({ kind: 'dig', cell: o }), ore);
    expect(await ev(page, d => d.game.inventory.count(123))).toBe(gemsBefore + 1);
    expect(await ev(page, (d, o: Cell) => d.game.world.get(o[0], o[1], o[2]), ore)).toBe(AIR);
    await expect.poll(() => ev(page, d => { d.hushVoice(); return d.pipSaid(); }).then(said => said.filter(k => k === 'gemFound').length), { timeout: 25_000 }).toBe(1);
    expect(await ev(page, d => d.flags().hints ?? [])).toContain('gemFound');

    // 5. The seed nook (T0): a real quick tap on the chest opens it; the cards show and close; a reload keeps it open.
    const t0 = c.treasure.find(t => t.id === 'T0')!;
    const yaw = Math.atan2(t0.chest[0] - t0.front[0], t0.chest[2] - t0.front[2]);
    await standAt(page, t0.front, yaw, 0.35);
    const seeds0 = await ev(page, d => d.game.inventory.count(100));
    const pc = await screenOfCell(page, t0.chest, 0.5);
    await press(page, pc.x, pc.y, 80);
    await expect.poll(() => ev(page, (d, ch: Cell) => d.game.world.get(ch[0], ch[1], ch[2]), t0.chest), { timeout: 5_000 }).toBe(CHEST_OPEN);
    expect(await ev(page, d => d.game.inventory.count(100))).toBe(seeds0 + 3);
    await expect(page.locator('.chest-reveal')).toBeVisible();
    expect((await ev(page, d => d.chestReveal())).cards).toBe(4);
    await page.screenshot({ path: info.outputPath('chest-opening.png') });
    await expect(page.locator('.chest-reveal')).toBeHidden({ timeout: 6_000 });
    await expect.poll(() => ev(page, d => { d.hushVoice(); return d.pipSaid(); }).then(said => said.includes('treasureFound')), { timeout: 10_000 }).toBe(true);
    await ev(page, d => d.saveNow());
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
    await frames(page, 10);
    expect((await ev(page, d => d.flags())).ledToVillage).toBe(true);
    expect(await ev(page, (d, ch: Cell) => d.game.world.get(ch[0], ch[1], ch[2]), t0.chest)).toBe(CHEST_OPEN);
    expect(await ev(page, d => d.game.inventory.count(100))).toBe(seeds0 + 3);
    expect((await ev(page, d => d.openChests())).find(o => o.id === 'T0')!.open).toBe(true);
    await ev(page, (d, ch: Cell) => d.game.applyIntent({ kind: 'open', cell: ch }), t0.chest);
    expect(await ev(page, d => d.game.inventory.count(100))).toBe(seeds0 + 3);
    // After the reload the first touch unlocks the audio again (a tap on the hand slot changes nothing).
    await page.locator('.slot[data-slot="0"]').tap();
    await ev(page, d => d.resumeAudio());

    // 6. The Old Hideout: found (saved), Pip's oldBase, and a Bricks block built into a gap.
    const r = c.ruin!;
    await standAt(page, [96, r.floorY, 97], 0.8, 0.3);
    await expect.poll(() => ev(page, d => d.flags().ruinFound === true), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => ev(page, d => { d.hushVoice(); return d.pipSaid(); }).then(said => said.includes('oldBase')), { timeout: 25_000 }).toBe(true);
    await page.screenshot({ path: info.outputPath('old-hideout.png') });
    await ev(page, d => { d.giveItem(10, 3); d.selectStack(10); });
    let built: Cell | null = null;
    for (const g of r.gaps) {
      // Stand two cells inside the hall from the gap, and build into it.
      const inX = g[0] < r.rect.x0 ? 2 : g[0] > r.rect.x1 ? -2 : 0;
      const inZ = g[2] < r.rect.z0 ? 2 : g[2] > r.rect.z1 ? -2 : 0;
      if (!(await ev(page, (d, a: Cell) => d.teleport(a[0] + 0.5, a[1], a[2] + 0.5), [g[0] + inX, g[1], g[2] + inZ]))) continue;
      await frames(page, 5);
      await ev(page, (d, a: Cell) => d.game.applyIntent({ kind: 'place', cell: a }), g);
      if ((await ev(page, (d, a: Cell) => d.game.world.get(a[0], a[1], a[2]), g)) === BRICKS) { built = g; break; }
    }
    expect(built, 'a Bricks block built into a gap of the hideout').not.toBeNull();

    // 7a. Walk back up from the hideout on foot, along the way home, to a mouth.
    const start = await standAt(page, [96, r.floorY, 97], 0, 0.3);
    const way = await ev<Cell[] | null>(page, (d, s: Cell) => d.routeHome(s[0], s[1], s[2]), start);
    expect(way).not.toBeNull();
    console.log(`caves story: the way home from the hideout is ${way!.length} steps`);
    for (let i = 8; i < way!.length; i += 8) await walkTo(page, way![i], 2.2, 30_000);
    await walkTo(page, way![way!.length - 1], 1.6, 30_000);
    await expect.poll(() => ev(page, d => d.deep()), { timeout: 10_000 }).toBe(false);

    // 7b. From a stair tunnel, the Home button: on the surface, Pip beside him, a white-gold fade.
    await standAt(page, c.stairs[1], 0, 0.3);
    await expect.poll(() => ev(page, d => d.deep()), { timeout: 5_000 }).toBe(true);
    const { me, pip } = await homeByButton(page);
    expect(await ev(page, d => d.deep())).toBe(false);
    expect(Math.hypot(pip.x - me.x, pip.z - me.z)).toBeLessThan(4);
    expect(Math.abs(pip.y - me.y)).toBeLessThanOrEqual(2);
    await expect.poll(() => ev(page, d => { d.hushVoice(); return d.pipSaid(); }).then(said => said.includes('backUp')), { timeout: 10_000 }).toBe(true);

    // 9. The old village is intact: the layout is the frozen one moved by +48, and the path to the bakery walks.
    const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/village-world-gen3-2026.json', import.meta.url), 'utf8')) as {
      layout: { houses: Array<{ id: string; doorFront: Cell }> };
    };
    const houses = (await ev(page, d => d.village())).houses;
    for (const h of fixture.layout.houses) {
      expect(houses.find(o => o.id === h.id)!.doorFront).toEqual([h.doorFront[0] + 48, h.doorFront[1] + 48, h.doorFront[2] + 48]);
    }
    const bakery = houses.find(h => h.id === 'bakery')!;
    await standAt(page, [bakery.doorFront[0] - 6, bakery.doorFront[1], bakery.doorFront[2] + 6], 0, 0.4);
    await walkTo(page, bakery.doorFront, 1.3, 30_000);
    expect(errors).toEqual([]);
  });
});
