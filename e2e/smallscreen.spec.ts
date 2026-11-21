import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { frames, press, ready, type FarmDbg } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? '';
const VIEWPORTS = [
  [1280, 800], [1024, 600], [800, 450], [667, 375], [568, 320], [600, 900], [375, 667],
] as const;
// Items 100..110 are seeds, foods and gifts: plenty of stacks, so the bag slot shows too.
const MANY = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];

async function fill(page: Page, ids = MANY): Promise<void> {
  await page.evaluate(list => { const d = window.__debug as unknown as FarmDbg; for (const id of list) d.giveItem(id, 3); }, ids);
  await frames(page, 3);
}
async function barInfo(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.hotbar') as HTMLElement;
    const r = bar.getBoundingClientRect();
    const last = bar.lastElementChild as HTMLElement;
    const lr = last.getBoundingClientRect();
    return {
      vw: window.innerWidth, left: r.left, right: r.right, scrollW: bar.scrollWidth, clientW: bar.clientWidth, scrollLeft: bar.scrollLeft,
      lastRight: lr.right, slotMin: Math.min(...[...bar.children].map(c => Math.min(c.getBoundingClientRect().width, c.getBoundingClientRect().height))),
    };
  });
}
async function slotBox(page: Page, i: number) {
  const b = await page.locator(`.hotbar .slot[data-slot="${i}"]`).boundingBox();
  if (!b) throw new Error(`no slot ${i}`);
  return b;
}
const selectedIndex = (page: Page) => page.evaluate(() => (document.querySelector('.hotbar .slot.selected') as HTMLElement | null)?.dataset.slot ?? null);
async function touchDrag(page: Page, x: number, y: number, dx: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 12, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(150);
}

test.describe('the bottom bar on small screens', () => {
  for (const [w, h] of VIEWPORTS) {
    test(`bar fits or scrolls at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await ready(page);
      await fill(page);
      const b = await barInfo(page);
      expect(b.left, 'bar starts on screen').toBeGreaterThanOrEqual(-0.5);
      expect(b.right, 'bar ends on screen').toBeLessThanOrEqual(b.vw + 0.5);
      expect(b.slotMin, 'every slot stays a big target').toBeGreaterThanOrEqual(88);
      if (b.scrollW > b.clientW + 1) {
        // Wider than the screen: it must scroll, and the last slot must be reachable.
        const reached = await page.evaluate(() => {
          const bar = document.querySelector('.hotbar') as HTMLElement;
          bar.scrollLeft = bar.scrollWidth;
          const last = bar.lastElementChild!.getBoundingClientRect();
          return { right: last.right, vw: window.innerWidth, scrolled: bar.scrollLeft };
        });
        expect(reached.scrolled).toBeGreaterThan(0);
        expect(reached.right).toBeLessThanOrEqual(reached.vw + 0.5);
      }
    });
  }

  test('the bar scrolls by a touch drag, a tap still selects, and a scroll drag does not', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await ready(page);
    await fill(page);
    expect((await barInfo(page)).scrollW).toBeGreaterThan(568);
    expect(await selectedIndex(page)).toBe('0');
    // A swipe leftwards across slots 2..3 scrolls and selects nothing.
    const s2 = await slotBox(page, 2);
    await touchDrag(page, s2.x + s2.width / 2, s2.y + s2.height / 2, -250);
    expect((await barInfo(page)).scrollLeft, 'the swipe scrolled').toBeGreaterThan(100);
    expect(await selectedIndex(page), 'a scroll drag does not select').toBe('0');
    // A tap on a visible slot selects it.
    const vis = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hotbar .slot')]
      .filter(s => { const r = s.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })
      .map(s => s.dataset.slot).filter(s => s !== '0'));
    const target = Number(vis[Math.floor(vis.length / 2)]);
    const tb = await slotBox(page, target);
    await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.waitForTimeout(150);
    expect(await selectedIndex(page)).toBe(String(target));
  });

  test('a mouse wheel scrolls the bar sideways', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await ready(page);
    await fill(page);
    const s = await slotBox(page, 1);
    await page.mouse.move(s.x + 40, s.y + 40);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect((await barInfo(page)).scrollLeft).toBeGreaterThan(50);
  });

  test('the selected slot scrolls into view, by selection and by the bag tray', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await ready(page);
    await fill(page);
    const inView = (i: number) => page.evaluate(n => {
      const r = (document.querySelector(`.hotbar .slot[data-slot="${n}"]`) as HTMLElement).getBoundingClientRect();
      return r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
    }, i);
    // The 7th stack sits well off the right edge at 568 wide.
    await page.evaluate(() => { const d = window.__debug as unknown as FarmDbg; d.selectStack(d.bag()[6].id); });
    await frames(page, 3);
    expect(await selectedIndex(page)).toBe('7');
    expect(await inView(7)).toBe(true);
    // A stack hidden behind the bag slot is chosen from the tray: the bag slot (now showing it) is in view.
    await page.evaluate(() => { const d = window.__debug as unknown as FarmDbg; d.selectStack('hand'); });
    await frames(page, 3);
    expect(await inView(0)).toBe(true);
    await page.evaluate(() => { const d = window.__debug as unknown as FarmDbg; d.selectStack(d.bag()[9].id); });
    await frames(page, 3);
    expect(await selectedIndex(page)).toBe('9');
    expect(await inView(9)).toBe(true);
  });

  test('munch, craft button and the bar do not overlap at 568x320', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await ready(page);
    await fill(page);
    await page.evaluate(() => { const d = window.__debug as unknown as FarmDbg; d.selectStack(108); }); // an apple: edible
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const m = q('.munch-btn'), b = q('.hotbar'), c = q('.craft-btn');
      return { m, b, c, vw: window.innerWidth, vh: window.innerHeight };
    });
    const inside = (x: DOMRect) => x.left >= 0 && x.top >= 0 && x.right <= r.vw && x.bottom <= r.vh;
    expect(inside(r.m) && inside(r.c) && inside(r.b)).toBe(true);
    const hit = (a: DOMRect, c: DOMRect) => a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
    expect(hit(r.m, r.b), 'munch over the bar').toBe(false);
    expect(hit(r.c, r.b), 'craft over the bar').toBe(false);
    expect(hit(r.m, r.c), 'munch over craft').toBe(false);
  });
});

type Overlay = { name: string; open(page: Page): Promise<void>; close(page: Page): Promise<void>; scope: string; buttons: string[] };

async function solveGate(page: Page): Promise<void> {
  const sum = await page.locator('[data-testid="gate-sum"]').textContent();
  const m = /(\d+) \+ (\d+)/.exec(sum ?? '')!;
  for (const ch of String(Number(m[1]) + Number(m[2]))) await page.locator('.gu-key', { hasText: new RegExp(`^${ch}$`) }).click({ force: true });
  await page.locator('.gu-ok').click({ force: true });
}
async function holdGate(page: Page): Promise<void> {
  await press(page, 40, 40, 3300); // the hidden corner button: a real 3 second touch hold
  await expect(page.locator('.gu-gate')).toBeVisible({ timeout: 6000 });
}

const OVERLAYS: Overlay[] = [
  { name: 'craft', scope: '.craft-screen', buttons: ['.craft-close', '.craft-make'],
    open: async p => { await p.evaluate(() => (document.querySelector('.craft-btn') as HTMLElement).click()); await expect(p.locator('.craft-screen')).toBeVisible(); },
    close: async p => { await p.evaluate(() => (document.querySelector('.craft-close') as HTMLElement).click()); } },
  { name: 'bag', scope: '.bag-tray', buttons: ['.bag-close', '.bag-stack'],
    open: async p => { await p.evaluate(() => (window.__debug as unknown as FarmDbg).openBag()); await expect(p.locator('.bag-tray')).toBeVisible(); },
    close: async p => { await p.evaluate(() => (document.querySelector('.bag-close') as HTMLElement).click()); } },
  { name: 'gate', scope: '.gu-overlay', buttons: ['.gu-x', '.gu-key'],
    open: holdGate,
    close: async p => { await p.evaluate(() => (document.querySelector('.gu-x') as HTMLElement).click()); } },
  { name: 'panel', scope: '.gu-overlay', buttons: ['.gu-close', '.gu-opt', '.gu-action'],
    open: async p => { await holdGate(p); await solveGate(p); await expect(p.locator('.gu-panel')).toBeVisible(); },
    close: async p => { await p.evaluate(() => (document.querySelector('.gu-close') as HTMLElement).click()); } },
  { name: 'break', scope: '.break-bubble', buttons: ['.break-ok'],
    open: async p => { await p.evaluate(() => (window.__debug as unknown as { hud: { showBreak(f: () => void): void } }).hud.showBreak(() => {})); await expect(p.locator('.break-bubble')).toBeVisible(); },
    close: async p => { await p.evaluate(() => (document.querySelector('.break-ok') as HTMLElement).click()); } },
];

/** Every button in the overlay can be brought on screen and is the thing under its own middle. */
async function reachable(page: Page, ov: Overlay) {
  return page.evaluate(({ buttons, scope }) => {
    const out: Array<{ sel: string; ok: boolean; w: number; h: number; why: string }> = [];
    const root = document.querySelector(scope) as HTMLElement;
    for (const sel of buttons) for (const el of root.querySelectorAll<HTMLElement>(sel)) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; // hidden on purpose (the reset confirmation)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      const within = r.left >= -0.5 && r.top >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
      const hit = !!top && (el === top || el.contains(top));
      out.push({ sel, ok: within && hit, w: r.width, h: r.height, why: `${within ? '' : 'off-screen '}${hit ? '' : 'covered'}` });
    }
    return out;
  }, { buttons: ov.buttons, scope: ov.scope });
}

test.describe('overlays on small screens', () => {
  for (const [w, h] of [[568, 320], [375, 667], [667, 375]] as const) {
    for (const ov of OVERLAYS) {
      test(`${ov.name} is fully reachable at ${w}x${h}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await ready(page);
        await fill(page);
        await ov.open(page);
        const res = await reachable(page, ov);
        expect(res.length).toBeGreaterThan(0);
        const bad = res.filter(x => !x.ok);
        expect(bad, JSON.stringify(bad.slice(0, 3))).toEqual([]);
        // Child-facing controls stay big.
        for (const x of res) if (x.sel !== '.gu-opt' && x.sel !== '.gu-action' && x.sel !== '.gu-close') expect(Math.min(x.w, x.h), x.sel).toBeGreaterThanOrEqual(87.5);
        // The page itself never scrolls sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await ov.close(page);
      });
    }
  }

  test('screenshots of every overlay at 667x375 and 375x667', async ({ page }) => {
    test.skip(!SHOTS, 'set SHOTS_DIR to write screenshots');
    mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of [[667, 375], [375, 667]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await ready(page);
      await fill(page);
      await page.evaluate(() => (window.__debug as unknown as FarmDbg).selectStack(108));
      await frames(page, 3);
      await page.evaluate(() => (window.__debug as unknown as { hud: { showBubble(p: string, w?: string): void } }).hud.showBubble('👋', 'Hi!'));
      await page.evaluate(([x, y]) => (window.__debug as unknown as { hud: { showDigRing(x: number, y: number, p: number): void } }).hud.showDigRing(x, y, 0.6), [w / 2, h / 3]);
      await page.screenshot({ path: `${SHOTS}/hud-${w}x${h}.png` });
      await page.evaluate(() => { const hud = (window.__debug as unknown as { hud: { hideBubble(): void; hideDigRing(): void } }).hud; hud.hideBubble(); hud.hideDigRing(); });
      for (const ov of OVERLAYS) {
        await ov.open(page);
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/${ov.name}-${w}x${h}.png` });
        await ov.close(page);
      }
    }
  });
});