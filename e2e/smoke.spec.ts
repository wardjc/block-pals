import { test, expect } from '@playwright/test';

const URL = '/block-pals/?debug';
const WOOD = 4;
const PLANKS = 8;

type Dbg = {
  playerPos(): { x: number; y: number; z: number };
  giveItem(id: number, n: number): void;
  game: {
    tryCraft(id: string): boolean;
    inventory: { count(id: number): number };
  };
};
declare global { interface Window { __debug: Dbg } }

test('loads with canvas and hotbar and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hotbar')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('tap on ground moves the player', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => !!window.__debug);
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => window.__debug.playerPos());
  await page.touchscreen.tap(640, 300);
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__debug.playerPos());
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
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
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hotbar')).toBeVisible();
});
