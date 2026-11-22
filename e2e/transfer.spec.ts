import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { frames, press, ready, type FarmDbg } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
};

async function openPanel(page: Page): Promise<void> {
  await press(page, 12, 12, 3400);
  const sum = await page.locator('[data-testid="gate-sum"]').textContent();
  const [a, b] = sum!.match(/\d+/g)!.map(Number);
  for (const d of String(a + b)) await page.locator('.gu-key', { hasText: new RegExp(`^${d}$`) }).click();
  await page.locator('.gu-ok').click();
  await expect(page.locator('.gu-panel')).toBeVisible();
}

test('save a copy, load it on a fresh device, and a corrupted file changes nothing', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, acceptDownloads: true });
  const p1 = await ctx1.newPage();
  await ready(p1);
  const cell = await p1.evaluate(() => {
    const d = window.__debug as unknown as FarmDbg;
    const y = d.game.world.topSolidY(20, 20);
    d.game.world.set(20, y, 20, 0);
    d.giveItem(4, 5);
    d.saveNow();
    return [20, y, 20] as const;
  });
  await frames(p1, 5);
  await openPanel(p1);
  await shot(p1, 'transfer-1-panel.png');
  const [download] = await Promise.all([p1.waitForEvent('download'), p1.locator('.gu-save').click()]);
  expect(download.suggestedFilename()).toMatch(/^block-pals-saved-game-\d{4}-\d{2}-\d{2}\.json$/);
  const file = info.outputPath('copy.json');
  await download.saveAs(file);
  await expect(p1.locator('[data-testid="transfer-last"]')).not.toHaveText('Last copy saved: never');
  await ctx1.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const p2 = await ctx2.newPage();
  await ready(p2);
  expect(await p2.evaluate(c => (window.__debug as unknown as FarmDbg).game.world.get(c[0], c[1], c[2]), cell)).not.toBe(0);
  await p2.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow()); // his other game on this device
  await openPanel(p2);

  // A corrupted file: friendly message, game unchanged.
  const bad = info.outputPath('bad.json');
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(bad, '{ not a save at all');
  await p2.locator('[data-testid="transfer-file"]').setInputFiles(bad);
  await expect(p2.locator('[data-testid="transfer-status"]')).toContainText('not a Block Pals saved game');
  await shot(p2, 'transfer-2-corrupt.png');
  expect(await p2.evaluate(() => Object.keys(localStorage).filter(k => k.includes('preimport')))).toEqual([]);

  // The real copy.
  await p2.locator('[data-testid="transfer-file"]').setInputFiles(file);
  await expect(p2.locator('.gu-replace')).toBeVisible();
  await expect(p2.locator('[data-testid="import-summary"]')).toContainText('Blocks he changed');
  await shot(p2, 'transfer-3-confirm.png');
  await Promise.all([p2.waitForEvent('load'), p2.locator('.gu-replace').click()]);
  await p2.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
  await frames(p2, 10);
  const after = await p2.evaluate(c => {
    const d = window.__debug as unknown as FarmDbg;
    return { block: d.game.world.get(c[0], c[1], c[2]), wood: d.game.inventory.count(4), keys: Object.keys(localStorage).filter(k => k.includes('preimport')) };
  }, cell);
  expect(after.block).toBe(0);
  expect(after.wood).toBe(5);
  expect(after.keys.length).toBe(1); // the fresh game that was replaced was kept
  await shot(p2, 'transfer-4-result.png');
  await ctx2.close();
});

test('a copy saved by the old game (the v2 key) loads into this game, shifted into the big world', async ({ browser }, info) => {
  test.setTimeout(120_000);
  // The bundle exactly as the build before this one wrote it: its main key was blockpals.save.v2.
  const raw = readFileSync(new URL('../tests/fixtures/saves/v2-gen3-tower.json', import.meta.url), 'utf8');
  const v2 = JSON.parse(raw) as { edits: number[][]; wizard: Record<string, unknown> };
  const keys = { 'blockpals.save.v2': raw };
  const canonical = JSON.stringify(Object.fromEntries(Object.keys(keys).sort().map(k => [k, keys[k as keyof typeof keys]])));
  const bundle = {
    format: 'blockpals-save-bundle', formatVersion: 1, createdAt: new Date(Date.UTC(2026, 10, 20)).toISOString(), keys,
    checksum: createHash('sha256').update(canonical).digest('hex'),
  };
  mkdirSync(info.outputDir, { recursive: true });
  const file = info.outputPath('old-copy.json');
  writeFileSync(file, JSON.stringify(bundle));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  await ready(page);
  await page.evaluate(() => (window.__debug as unknown as FarmDbg).saveNow());
  await openPanel(page);
  await page.locator('[data-testid="transfer-file"]').setInputFiles(file);
  await expect(page.locator('.gu-replace')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.locator('.gu-replace').click()]);
  await page.waitForFunction(() => !!(window as unknown as { __debug?: unknown }).__debug);
  await frames(page, 10);
  const got = await page.evaluate(edits => {
    const d = window.__debug as unknown as FarmDbg;
    return edits.map(([x, y, z]) => d.game.world.get(x + 48, y + 48, z + 48));
  }, v2.edits);
  // The last two edits are a wheat plant and a sapling: they grow while the copy was away (offline
  // growth), so only the blocks he built or dug must match exactly.
  expect(got.slice(0, -2)).toEqual(v2.edits.slice(0, -2).map(e => e[3]));
  expect(got.slice(-2).every(id => id !== 0)).toBe(true);
  const stored = await page.evaluate(() => ({ v2: localStorage.getItem('blockpals.save.v2'), v3: localStorage.getItem('blockpals.save.v3') }));
  expect(stored.v2).toBeNull(); // the old key is never written on this device
  const v3 = JSON.parse(stored.v3!);
  expect(v3.version).toBe(3);
  expect(v3.wizard).toEqual(v2.wizard);
  expect(v3.edits).toEqual(expect.arrayContaining(v2.edits.slice(0, -2).map(([x, y, z, id]) => [x + 48, y + 48, z + 48, id])));
  await ctx.close();
});
