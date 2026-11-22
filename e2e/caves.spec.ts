import { test, expect, type Page } from '@playwright/test';
import { frames, ready, screenOfCell, type Cell } from './helpers';

// The caves (spec 7h, chunk C): the generated caves are in the real game, bright and reachable.
// Chunk D adds the full browser story (chests by tap, Home button, Pip leading home).
interface CaveDbg {
  caves(): {
    mouths: Array<{ kind: string; cell: Cell; ramp: Cell[] }>;
    rooms: Array<{ id: number; layer: string; centre: Cell }>;
    treasure: Array<{ id: string; chest: Cell; entrance: Cell; front: Cell }>;
    ruin: { rect: { x0: number; z0: number; x1: number; z1: number }; floorY: number; chest: Cell } | null;
    lights: number;
  };
  teleport(x: number, y: number, z: number): boolean;
  setCamera(yaw: number, pitch: number): void;
  deep(): boolean;
  pick(x: number, y: number): { cell: Cell } | null;
  look(): { fogColor: number; luminance: number };
  worldSize(): { x: number; y: number; z: number };
  sections(): { queued: number; zone: string };
  audioState(): { locked: boolean; pending: string | null; busy: boolean };
  home(): { fading: boolean; lead: string; cavePending: string[] };
  pipSaid(): string[];
  skipVillageWalk(): void;
  game: { emit(event: { type: 'noPathDeep' }): void; world: { get(x: number, y: number, z: number): number } };
}
const ev = <T>(page: Page, fn: (d: CaveDbg, a: never) => T, arg?: unknown): Promise<T> =>
  page.evaluate(([f, a]) => (new Function('d', 'a', `return (${f})(d, a)`))((window as unknown as { __debug: unknown }).__debug, a), [fn.toString(), arg] as const) as Promise<T>;

/** Stand at a cell, look along (yaw, pitch), and let the sections around build. */
async function standAt(page: Page, c: Cell, yaw: number, pitch = -0.15): Promise<void> {
  expect(await ev(page, (d, a: Cell) => d.teleport(a[0] + 0.5, a[1], a[2] + 0.5), c)).toBe(true);
  await ev(page, (d, a: [number, number]) => d.setCamera(a[0], a[1]), [yaw, pitch]);
  await frames(page, 30);
  await page.waitForFunction(() => (window as unknown as { __debug: CaveDbg }).__debug.sections().queued === 0, null, { timeout: 20_000 }).catch(() => {});
  await frames(page, 20);
}

test.describe('the caves', () => {
  test('Home stays clear of the grown-ups hotspot on a short screen', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await ready(page);
    const c = await ev(page, d => d.caves());
    await standAt(page, c.treasure[0].front, 0);
    const home = page.locator('.home-btn');
    await expect(home).toBeVisible();
    const h = (await home.boundingBox())!;
    const g = (await page.locator('.grownups-hotspot').boundingBox())!;
    expect(h.x).toBeGreaterThanOrEqual(g.x + g.width);
    expect(h.y).toBe(12);
    expect(h.width).toBeGreaterThanOrEqual(96);
    expect(h.height).toBeGreaterThanOrEqual(96);
    await home.tap();
    await expect.poll(() => ev(page, d => d.deep())).toBe(false);
  });

  test('Home cancels a captured chest press before its release', async ({ page }) => {
    await ready(page);
    const c = await ev(page, d => d.caves());
    const chest = c.treasure[0];
    const yaw = Math.atan2(chest.chest[0] - chest.front[0], chest.chest[2] - chest.front[2]);
    await standAt(page, chest.front, yaw, 0.35);
    const point = await screenOfCell(page, chest.chest);
    expect(await ev(page, (d, p: { x: number; y: number }) => d.pick(p.x, p.y)?.cell, point)).toEqual(chest.chest);
    await expect(page.locator('.home-btn')).toBeVisible();
    // Keep a real captured canvas pointer down while another input activates Home.
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const state = await page.evaluate(() => {
      const d = (window as unknown as { __debug: CaveDbg }).__debug;
      const busyBefore = d.audioState().busy;
      document.querySelector<HTMLButtonElement>('.home-btn')!.click();
      return { busyBefore, busyAfter: d.audioState().busy, fading: d.home().fading };
    });
    await page.mouse.up();
    expect(state).toEqual({ busyBefore: true, busyAfter: false, fading: true });
    await expect.poll(() => ev(page, d => d.home().fading)).toBe(false);
    expect(await ev(page, d => d.deep())).toBe(false);
    await expect(page.locator('.chest-reveal')).toBeHidden();
    expect(await ev(page, (d, cell: Cell) => d.game.world.get(...cell), chest.chest)).toBe(62);
  });

  test('Home drops queued cave speech and keeps its arrival silent while audio is locked', async ({ page }) => {
    await ready(page);
    await ev(page, d => d.skipVillageWalk());
    const c = await ev(page, d => d.caves());
    expect(await ev(page, (d, y: number) => d.teleport(96.5, y, 97.5), c.ruin!.floorY)).toBe(true);
    await frames(page, 2);
    expect(await ev(page, d => d.audioState().locked)).toBe(true);
    expect(await ev(page, d => d.home().cavePending)).toEqual(['cavesLit', 'oldBase']);
    // The failed-path event offers the walking route, whose line must wait for audio.
    await ev(page, d => d.game.emit({ type: 'noPathDeep' }));
    expect(await ev(page, d => d.audioState().pending)).toBe('goUp');
    expect(await ev(page, d => d.home().lead)).toBe('leading');
    // A keyboard/assistive click does not unlock audio via pointerdown.
    await page.locator('.home-btn').evaluate((button: HTMLButtonElement) => button.click());
    expect(await ev(page, d => d.audioState().pending)).toBeNull();
    expect(await ev(page, d => d.home().cavePending)).toEqual([]);
    await expect.poll(() => ev(page, d => d.home().fading)).toBe(false);
    expect(await ev(page, d => d.deep())).toBe(false);
    expect(await ev(page, d => d.home().lead)).toBe('idle');
    expect(await ev(page, d => d.home().cavePending)).toEqual([]);
    expect(await ev(page, d => d.pipSaid())).not.toContain('backUp');
    expect(await ev(page, d => d.pipSaid())).not.toContain('goUp');
  });

  test('six mouths, three treasure rooms and the Old Hideout are in the world', async ({ page }) => {
    await ready(page);
    const c = await ev(page, d => d.caves());
    expect(c.mouths.map(m => m.kind).sort()).toEqual(['east', 'hill', 'north', 'quarry', 'south', 'west']);
    expect(c.treasure.map(t => t.id)).toEqual(['T0', 'T1', 'T2']);
    expect(c.ruin).not.toBeNull();
    expect(c.lights).toBeGreaterThan(500);
    // Closed chests stand where the layout says.
    for (const t of c.treasure) expect(await ev(page, (d, a: Cell) => d.game.world.get(a[0], a[1], a[2]), t.chest)).toBe(62);
  });

  test('inside a cave it is bright: the haze is lighter than the sky, and nothing errs', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
    const outdoor = await ev(page, d => d.look());
    const c = await ev(page, d => d.caves());
    // A shallow room: deep below the ground, the haze turns light.
    const room = c.rooms.find(r => r.layer === 'shallow' && r.id > 6)!;
    await standAt(page, room.centre, 0.6);
    expect(await ev(page, d => d.deep())).toBe(true);
    const inCave = await ev(page, d => d.look());
    expect(inCave.luminance).toBeGreaterThanOrEqual(0.62);
    expect(inCave.luminance).toBeGreaterThanOrEqual(outdoor.luminance);
    await page.screenshot({ path: info.outputPath('cave-shallow.png') });
    const deep = c.rooms.find(r => r.layer === 'deep' && r.id > 8)!;
    await standAt(page, deep.centre, 2.2);
    await page.screenshot({ path: info.outputPath('cave-deep.png') });
    // The hill mouth from outside, then from halfway down its ramp.
    const hill = c.mouths.find(m => m.kind === 'hill')!;
    await standAt(page, hill.cell, 0, -0.25);
    await page.screenshot({ path: info.outputPath('mouth-hill.png') });
    const mid = hill.ramp[Math.floor(hill.ramp.length / 2)];
    await standAt(page, [mid[0], mid[1], mid[2]], 0.3);
    await page.screenshot({ path: info.outputPath('mouth-ramp.png') });
    expect(errors).toEqual([]);
  });

  test('a treasure room and the Old Hideout (screenshots)', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await ready(page);
    const c = await ev(page, d => d.caves());
    for (const t of c.treasure) {
      // Stand at the archway looking in at the chest.
      const yaw = Math.atan2(-(t.chest[0] - t.entrance[0]), -(t.chest[2] - t.entrance[2]));
      await standAt(page, t.entrance, yaw, -0.2);
      await page.screenshot({ path: info.outputPath(`treasure-${t.id}.png`) });
    }
    const r = c.ruin!;
    await standAt(page, [r.rect.x0 - 2, r.floorY, r.rect.z0 - 2], Math.PI * 1.25 + Math.PI, -0.3);
    await page.screenshot({ path: info.outputPath('old-hideout.png') });
    await standAt(page, [96, r.floorY, 97], 0.8, -0.2);
    await page.screenshot({ path: info.outputPath('old-hideout-inside.png') });
    expect(errors).toEqual([]);
  });
});
