import { test, expect, type Page } from '@playwright/test';
import { frames } from './helpers';

const URL = '/block-pals/?debug&viewtest';

interface HDbg {
  horizon(): { ready: boolean; on: boolean; cells: number; pending: number; uploads: number; busyMs: number; maxSliceMs: number; bytes: number; triangles: number; tower: { x: number; y: number; z: number } };
  setHorizon(on: boolean): void;
  setViewSetting(s: string): void;
  view(): { distance: number; fogEnd: number };
  stats(): { drawCalls: number; frustumVisible: number; triangles: number; meshed: number; zone: string };
  teleport(x: number, y: number, z: number): boolean;
  setCamera(yaw: number, pitch: number): void;
  camera(): { position: { x: number; y: number; z: number } };
  worldSize(): { x: number; y: number; z: number };
  caves(): { mouths: Array<{ cell: [number, number, number] }> };
  game: { world: { topSolidY(x: number, z: number): number } };
}
const dbg = <T>(page: Page, fn: (d: HDbg, arg: never) => T, arg?: unknown): Promise<T> =>
  page.evaluate(([f, a]) => (new Function('d', 'a', `return (${f})(d, a)`))((window as unknown as { __debug: unknown }).__debug, a), [fn.toString(), arg] as const) as Promise<T>;

async function load(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
  await frames(page, 10);
  await page.waitForFunction(() => (window as unknown as { __debug: { horizon(): { ready: boolean } } }).__debug.horizon().ready, null, { timeout: 30_000 });
}

/** Pixels in a band across the upper-middle of the page that are not the sky colour (so: far land). */
async function landPixels(page: Page): Promise<number> {
  const buf = await page.screenshot();
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const y0 = Math.floor(img.height * 0.3), y1 = Math.floor(img.height * 0.5);
    const sky = g.getImageData(Math.floor(img.width * 0.3), 4, 1, 1).data; // the top of the page is clear sky
    const d = g.getImageData(0, y0, img.width, y1 - y0).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // Count pixels clearly different from the sky.
      if (Math.abs(d[i] - sky[0]) + Math.abs(d[i + 1] - sky[1]) + Math.abs(d[i + 2] - sky[2]) > 24) n++;
    }
    return n;
  }, buf.toString('base64'));
}

test.describe('the horizon (far terrain beyond the detailed ring)', () => {
  test('distant land shows at Near, costs one draw call, builds cheaply', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await load(page);
    await dbg(page, d => d.setViewSetting('near'));
    await frames(page, 90);

    // Stand on open ground (no tree canopy or roof overhead, which would count as the cave look), looking south.
    await dbg(page, d => {
      const w = d.game.world, ws = d.worldSize();
      const mouths = d.caves().mouths;
      let best = { x: 96, z: 96, score: -1e9 };
      for (let z = 24; z < ws.z - 24; z += 4) {
        for (let x = 24; x < ws.x - 24; x += 4) {
          if (mouths.some(m => Math.hypot(m.cell[0] - x, m.cell[2] - z) < 44)) continue; // the cave look starts 24 blocks from a mouth
          const h = w.topSolidY(x, z);
          let spread = 0;
          for (let dz = -9; dz <= 9; dz += 3) for (let dx = -9; dx <= 9; dx += 3) spread = Math.max(spread, Math.abs(w.topSolidY(x + dx, z + dz) - h));
          const score = h - spread * 4;
          if (score > best.score) best = { x, z, score };
        }
      }
      d.teleport(best.x + 0.5, w.topSolidY(best.x, best.z) + 1, best.z + 0.5);
    });
    await dbg(page, d => d.setCamera(0, 0.05));
    await frames(page, 60);

    await dbg(page, d => d.setHorizon(false));
    await frames(page, 6);
    const calls0 = (await dbg(page, d => d.stats())).drawCalls;
    const off = await landPixels(page);
    await page.screenshot({ path: info.outputPath('horizon-off.png') });

    await dbg(page, d => d.setHorizon(true));
    await frames(page, 6);
    const h = await dbg(page, d => d.horizon());
    const calls1 = (await dbg(page, d => d.stats())).drawCalls;
    const on = await landPixels(page);
    await page.screenshot({ path: info.outputPath('horizon-on.png') });
    console.log(JSON.stringify({ calls0, calls1, off, on, horizon: h, zone: (await dbg(page, d => d.stats())).zone }));

    expect(h.ready).toBe(true);
    expect(h.on).toBe(true);
    expect(h.cells).toBe(48 * 48);
    expect(calls1 - calls0).toBeLessThanOrEqual(2);
    expect(h.bytes).toBeLessThan(2 * 1024 * 1024);
    expect(h.maxSliceMs).toBeLessThan(16); // the budget is 1.2 ms a frame; this allows a stray GC pause on a loaded runner
    expect(on).toBeGreaterThan(off + 2000); // far land fills the band the haze used to hide
    expect(errors).toEqual([]);

    // The same spot at Far, turned toward the wizard's tower on its far hill: still one extra draw call and the page stays in budget.
    await dbg(page, d => d.setViewSetting('far'));
    await dbg(page, (d, a) => { const p = d.horizon().tower; const c = a as { x: number; z: number }; d.setCamera(Math.atan2(p.x - c.x, p.z - c.z), 0.12); }, await dbg(page, d => d.camera().position));
    await frames(page, 120);
    const far = await dbg(page, d => d.stats());
    await dbg(page, d => d.setHorizon(false));
    await frames(page, 6);
    const farOff = await dbg(page, d => d.stats());
    await dbg(page, d => d.setHorizon(true));
    await page.screenshot({ path: info.outputPath('horizon-tower-far.png') });
    console.log(JSON.stringify({ far, farOff }));
    expect(far.drawCalls - farOff.drawCalls).toBeLessThanOrEqual(2); // Far itself is the known 96 miss (viewBudget.test.ts); the horizon adds one call
  });

  test('is never drawn inside a cave', async ({ page }) => {
    test.setTimeout(120_000);
    await load(page);
    // Down into the rock under the spawn: the camera ends up underground.
    await dbg(page, d => d.teleport(96.5, 6, 96.5));
    await frames(page, 150);
    expect((await dbg(page, d => d.horizon())).on).toBe(false);
  });
});
