// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { BUNDLE, MYTHICAL, PRICE } from '../../src/core/mythical';
import { mulberry32 } from '../../src/core/rng';
import { levelFor, type Puzzle } from '../../src/core/puzzles';
import { HELP_SECONDS, HINT1_SECONDS, HINT2_SECONDS } from '../../src/game/puzzleSession';
import { WIZARD_STOCK, newWizardState, type Bag, type WizardState } from '../../src/game/wizardTrade';
import { wizardSpeech } from '../../src/game/speechPolicy';
import { TARGET_MIN_PX, WIZ_PX, WizardScreen } from '../../src/ui/wizard';

const GEM = WIZARD_STOCK.gem;

/** A bag like the real one (99 a stack) that already knows the gem (the grumps step adds it to Inventory). */
class FakeBag implements Bag {
  readonly m = new Map<number, number>();
  count(id: number): number { return this.m.get(id) ?? 0; }
  add(id: number, n = 1): number { const k = Math.max(0, Math.min(n, 99 - this.count(id))); this.m.set(id, this.count(id) + k); return k; }
  remove(id: number, n = 1): boolean { if (this.count(id) < n) return false; this.m.set(id, this.count(id) - n); return true; }
}

function setup(o: { bag?: Bag; state?: WizardState; breakOpen?: () => boolean; now?: () => number } = {}) {
  const bag = o.bag ?? new FakeBag();
  const state = o.state ?? newWizardState();
  const said: string[] = [];
  const counts = { save: 0, nudge: 0, celebrate: 0, got: 0, open: [] as boolean[] };
  let t = 0;
  const raw = {
    line: (k: string) => said.push(k),
    countSentence: (p: unknown) => said.push(`count:${(p as Puzzle).kind}`),
    again: () => said.push('again'),
  };
  const speak = wizardSpeech(o.breakOpen ?? (() => false), raw);
  document.body.replaceChildren();
  const screen = new WizardScreen(document.body, {
    inventory: bag,
    state: () => state,
    save: () => { counts.save++; },
    iconFor: id => `data:image/png;base64,${id}`,
    speak: { line: k => speak.line(k), countSentence: p => speak.countSentence(p), again: () => speak.again() },
    pipNudge: () => { counts.nudge++; },
    pipGot: () => { counts.got++; },
    rng: mulberry32(7),
    now: o.now ?? (() => (t += 1000)),
    celebrate: () => { counts.celebrate++; },
    onOpenChange: open => counts.open.push(open),
  });
  return { screen, bag, state, said, counts, root: screen.element };
}
const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.wiz-card')];
const total = (bag: Bag) => MYTHICAL.reduce((s, id) => s + bag.count(id), 0);

/** Solves the current pattern/match puzzle by its answer, or fills the basket. */
function solve(screen: WizardScreen): void {
  const s = screen.session!;
  const p = s.puzzle;
  if (p.kind === 'count') for (const w of p.wants) for (let i = 0; i < w.n; i++) screen.add(w.thing);
  else screen.pick(p.answer);
}

const css = readFileSync('src/ui/styles.css', 'utf8');
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${sel}`);
  return m[1];
};
const px = (r: string, prop: string): number => Number(r.match(new RegExp(`(?:^|[^-])${prop}: (\\d+)px`))![1]);

describe('WizardScreen: sizes and pictures', () => {
  it('every target is at least 88 px (from the CSS), the tabs and ✖ at least 96', () => {
    expect(TARGET_MIN_PX).toBe(88);
    expect(px(rule('.wiz-card'), 'width')).toBe(WIZ_PX.card);
    expect(px(rule('.wiz-card'), 'min-height')).toBe(WIZ_PX.card);
    expect(px(rule('.wiz-tab'), 'width')).toBe(WIZ_PX.tab);
    expect(px(rule('.wiz-close'), 'width')).toBe(WIZ_PX.close);
    expect(px(rule('.wiz-speak'), 'width')).toBe(WIZ_PX.speak);
    expect(px(rule('.wiz-shelf-item'), 'width')).toBe(WIZ_PX.shelf);
    expect(px(rule('.wiz-option'), 'width')).toBe(WIZ_PX.option);
    expect(px(rule('.wiz-item'), 'width')).toBe(WIZ_PX.basketItem);
    for (const v of Object.values(WIZ_PX)) expect(v).toBeGreaterThanOrEqual(TARGET_MIN_PX);
    expect(WIZ_PX.tab).toBeGreaterThanOrEqual(96);
    expect(WIZ_PX.close).toBeGreaterThanOrEqual(96);
    // The small-screen sizes never go under 88 either.
    const small = css.slice(css.indexOf('@media (max-width: 899px), (max-height: 699px)'));
    for (const m of small.matchAll(/(?:^|[ ;{])(?:width|height|min-height): (\d+)px/g)) {
      const line = small.slice(0, m.index).split('\n').pop()!;
      if (/wiz-(card|tab|shelf-item|option|orlo)/.test(line)) expect(Number(m[1]), line).toBeGreaterThanOrEqual(88);
    }
  });

  it('trade shows eight cards, each with the block picture, a gem picture, the price as a digit with that many dots, and ×4 with 4 dots', () => {
    const state = newWizardState();
    state.gift = true;
    const { screen, root, bag } = setup({ state });
    bag.add(GEM, 5);
    screen.open();
    expect(screen.currentTab).toBe('trade');
    const cs = cards(root);
    expect(cs).toHaveLength(8);
    cs.forEach((c, i) => {
      const kind = MYTHICAL[i];
      expect(c.querySelector('img')!.getAttribute('src')).toContain(String(kind));
      expect(c.querySelector('.wiz-price .wiz-gem')!.textContent).toBe('💎');
      const price = c.querySelector('.wiz-price .wiz-count')!;
      expect(price.querySelector('.wiz-digit')!.textContent).toBe(String(PRICE[kind]));
      expect(price.querySelectorAll('.wiz-dots i')).toHaveLength(PRICE[kind]);
      const bundle = c.querySelector('.wiz-bundle')!;
      expect(bundle.querySelector('.wiz-digit')!.textContent).toBe(String(BUNDLE));
      expect(bundle.querySelectorAll('.wiz-dots i')).toHaveLength(4);
    });
  });

  it('no text node longer than a digit or a one-word label appears anywhere on the screen', () => {
    const { screen, root } = setup();
    screen.open();
    const check = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent!.trim();
        if (!t) continue;
        expect(/[a-z]{2,}/i.test(t), `text "${t}"`).toBe(false); // pictures, digits, × and ? only
        expect(t.length).toBeLessThanOrEqual(4);
      }
    };
    check();
    for (let i = 0; i < 12; i++) { screen.tab('trade'); screen.tab('puzzle'); check(); }
  });
});

describe('WizardScreen: the welcome gift and trades', () => {
  it('first open: 🎁 on every card, one pick gives exactly 1 block and flips the flag (saved), then prices show', () => {
    const { screen, root, bag, state, said, counts } = setup();
    screen.open();
    expect(said).toContain('welcomeGift');
    expect(cards(root).every(c => c.querySelector('.wiz-gift')?.textContent === '🎁')).toBe(true);
    cards(root)[2].click();
    expect(total(bag)).toBe(1);
    expect(bag.count(MYTHICAL[2])).toBe(1);
    expect(state.gift).toBe(true);
    expect(counts.save).toBe(1);
    expect(counts.got).toBe(1);
    expect(cards(root).some(c => c.querySelector('.wiz-gift'))).toBe(false);
    expect(cards(root)[0].querySelector('.wiz-price')).not.toBeNull();
    // A second pick is a purchase, not a second gift: with no gems nothing changes.
    cards(root)[2].click();
    expect(total(bag)).toBe(1);
  });

  it('the gift needs no gem at all and works with the real (gemless) Inventory', () => {
    const inv = new Inventory();
    const { screen, root, state } = setup({ bag: inv });
    screen.open();
    cards(root)[0].click();
    expect(inv.count(BlockId.StarlightCrystal)).toBe(1);
    expect(state.gift).toBe(true);
  });

  it('buy with enough gems takes the price and gives 4, and says bought', () => {
    const state = newWizardState();
    state.gift = true;
    const { screen, root, bag, said, counts } = setup({ state });
    bag.add(GEM, 3);
    screen.open();
    const rainbow = MYTHICAL.indexOf(BlockId.RainbowBlock);
    expect(cards(root)[rainbow].classList.contains('can')).toBe(true);
    cards(root)[rainbow].click();
    expect(bag.count(BlockId.RainbowBlock)).toBe(4);
    expect(bag.count(GEM)).toBe(2);
    expect(said).toContain('bought');
    expect(counts.save).toBe(1);
    expect(state.bought).toBe(1);
  });

  it('without enough gems nothing changes: a gentle wobble, the wizard says needGem and the puzzle tab pulses (nothing red, no error)', () => {
    const state = newWizardState();
    state.gift = true;
    const { screen, root, bag, said } = setup({ state });
    bag.add(GEM, 1);
    screen.tab('trade');
    screen.open();
    screen.tab('trade');
    const star = MYTHICAL.indexOf(BlockId.StarBlock); // costs 2
    const card = cards(root)[star];
    expect(card.classList.contains('can')).toBe(false);
    card.click();
    expect(bag.count(GEM)).toBe(1);
    expect(total(bag)).toBe(0);
    expect(said).toContain('needGem');
    expect(card.classList.contains('wobble')).toBe(true);
    expect(root.querySelector('.wiz-tab[data-tab="puzzle"]')!.classList.contains('pulse')).toBe(true);
    expect(root.innerHTML).not.toMatch(/error|wrong|red;/i);
  });

  it('a purchase that would pass 99 is refused whole and says bagFull', () => {
    const state = newWizardState();
    state.gift = true;
    const { screen, root, bag, said } = setup({ state });
    bag.add(GEM, 4);
    bag.add(BlockId.CloudBlock, 97);
    screen.open();
    cards(root)[MYTHICAL.indexOf(BlockId.CloudBlock)].click();
    expect(bag.count(GEM)).toBe(4);
    expect(bag.count(BlockId.CloudBlock)).toBe(97);
    expect(said).toContain('bagFull');
  });

  it('opens on trade, or on puzzles when he has no gem and has had his gift', () => {
    const s1 = setup();
    s1.screen.open();
    expect(s1.screen.currentTab).toBe('trade');
    const state = newWizardState();
    state.gift = true;
    const s2 = setup({ state });
    s2.screen.open();
    expect(s2.screen.currentTab).toBe('puzzle');
    s2.screen.close();
    s2.bag.add(GEM, 1);
    s2.screen.open();
    expect(s2.screen.currentTab).toBe('trade');
  });
});

describe('WizardScreen: puzzles', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    const state = newWizardState();
    state.gift = true;
    ctx = setup({ state });
    ctx.screen.open();
  });

  it('a new puzzle each time the tab opens and each solve, at the saved level, and the wizard says it', () => {
    const { screen, said } = ctx;
    const first = screen.session!.puzzle;
    expect(first.level).toBe(0);
    expect(said.some(k => k === 'patternAsk' || k === 'matchAsk' || k === 'count:count')).toBe(true);
    screen.tab('trade');
    screen.tab('puzzle');
    expect(screen.session!.puzzle).not.toBe(first);
    const before = screen.session;
    solve(screen);
    screen.update(3);
    expect(screen.session).not.toBe(before);
  });

  it('counting: the shelf adds, the basket takes back, the right basket solves; his bag is never touched for it', () => {
    const { screen, root, bag } = ctx;
    let guard = 0;
    while (screen.session!.puzzle.kind !== 'count' && guard++ < 40) { screen.tab('trade'); screen.tab('puzzle'); }
    const p = screen.session!.puzzle;
    if (p.kind !== 'count') throw new Error('no counting puzzle');
    const want = p.wants[0];
    const shelfBtn = root.querySelector<HTMLButtonElement>(`.wiz-shelf-item[data-add="${want.thing}"]`)!;
    shelfBtn.click();
    expect(screen.session!.basket[want.thing]).toBe(1);
    root.querySelector<HTMLButtonElement>(`.wiz-item[data-take="${want.thing}"]`)!.click();
    expect(screen.session!.basket[want.thing]).toBe(0);
    const blocks = total(bag);
    for (const w of p.wants) for (let i = 0; i < w.n; i++) screen.add(w.thing);
    expect(screen.session!.solved).toBe(true);
    expect(total(bag)).toBe(blocks + 1); // the reward only
  });

  it('the want row shows each thing with its digit and that many dots', () => {
    const { screen, root } = ctx;
    let guard = 0;
    while (screen.session!.puzzle.kind !== 'count' && guard++ < 40) { screen.tab('trade'); screen.tab('puzzle'); }
    const p = screen.session!.puzzle;
    if (p.kind !== 'count') throw new Error('no counting puzzle');
    const wants = [...root.querySelectorAll('.wiz-want')];
    expect(wants).toHaveLength(p.wants.length);
    wants.forEach((w, i) => {
      expect(w.querySelector('.wiz-digit')!.textContent).toBe(String(p.wants[i].n));
      expect(w.querySelectorAll('.wiz-dots i')).toHaveLength(p.wants[i].n);
    });
  });

  it('a wrong card wobbles and says tryAgain; nothing is lost and the same card can be pressed forever', () => {
    const { screen, root, bag, said } = ctx;
    let guard = 0;
    while (screen.session!.puzzle.kind === 'count' && guard++ < 40) { screen.tab('trade'); screen.tab('puzzle'); }
    const p = screen.session!.puzzle;
    if (p.kind === 'count') throw new Error('no answer puzzle');
    const wrong = p.answer === 0 ? 1 : 0;
    for (let i = 0; i < 5; i++) {
      root.querySelector<HTMLButtonElement>(`.wiz-option[data-option="${wrong}"]`)?.click();
    }
    expect(said.filter(k => k === 'tryAgain').length).toBeGreaterThanOrEqual(1);
    expect(total(bag)).toBe(0);
    expect(screen.session!.solved || root.querySelector(`.wiz-option[data-option="${wrong}"]`)).toBeTruthy();
  });

  it('hint 1 at 12 s pulses the right thing, hint 2 at 24 s fades cards or shows ghost slots (and Pip nudges once), at 45 s it finishes itself and still gives the block', () => {
    const { screen, root, bag, said, counts, state } = ctx;
    const p = screen.session!.puzzle;
    screen.update(HINT1_SECONDS + 0.1);
    expect(said).toContain('hint1');
    expect(root.querySelector('.glow')).not.toBeNull();
    screen.update(HINT2_SECONDS - HINT1_SECONDS + 0.1);
    expect(counts.nudge).toBe(1);
    if (p.kind === 'count') expect(root.querySelector('.wiz-item.ghost')).not.toBeNull();
    else expect(root.querySelector('.wiz-option.faded')).not.toBeNull();
    for (let t = 0; t < HELP_SECONDS; t += 1) screen.update(1);
    expect(said).toContain('helped');
    expect(total(bag)).toBe(1);
    expect(state.solved).toBe(1);
    expect(state.clean).toBe(0); // helped solves do not count towards the level
    expect(counts.nudge).toBe(1);
  });

  it('a solve gives exactly one mythical block (the kind he has fewest of) and records solved and clean, saved', () => {
    const { screen, bag, state, counts, said } = ctx;
    bag.add(BlockId.StarlightCrystal, 3);
    const saves = counts.save;
    solve(screen);
    expect(bag.count(BlockId.RainbowBlock)).toBe(1); // fewest, first in order after the Starlight he has
    expect(state.solved).toBe(1);
    expect(state.clean).toBe(1);
    expect(counts.save).toBe(saves + 1);
    expect(counts.celebrate).toBe(1);
    expect(said).toContain('solved');
  });

  it('three clean solves raise the level and it is saved', () => {
    const { screen, state } = ctx;
    for (let i = 0; i < 3; i++) { solve(screen); screen.update(3); }
    expect(state.clean).toBe(3);
    expect(levelFor(state.clean)).toBe(1);
    expect(screen.session!.puzzle.level).toBe(1);
  });

  it('closing mid-puzzle drops it with no state change', () => {
    const { screen, bag, state, counts } = ctx;
    const snapshot = JSON.stringify(state);
    screen.update(5);
    screen.close();
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(total(bag)).toBe(0);
    expect(counts.open).toEqual([true, false]);
    expect(screen.session).toBeNull();
  });

  it('dt 0 stops the hint clock (paused or the break bubble up)', () => {
    const { screen, said } = ctx;
    for (let i = 0; i < 100; i++) screen.update(0);
    expect(screen.session!.hint()).toBe(0);
    expect(said).not.toContain('hint1');
  });

  it('every picture repeats its line', () => {
    const { root, said } = ctx;
    said.length = 0;
    root.querySelector<HTMLButtonElement>('.wiz-ask')!.click();
    expect(said.length).toBe(1);
    root.querySelector<HTMLButtonElement>('.wiz-speak')!.click();
    expect(said.length).toBe(2);
    root.querySelector<HTMLButtonElement>('.wiz-orlo')!.click();
    expect(said.at(-1)).toBe('again');
  });

  it('the pad moves over the targets and selects', () => {
    const { screen, root } = ctx;
    screen.padMove(1, 0);
    expect(root.querySelectorAll('.focus')).toHaveLength(1);
    // The first target is the trade tab: select it.
    screen.padMove(-1, 0);
    screen.padSelect();
    expect(screen.currentTab).toBe('trade');
    screen.padInput([0, 0], ['place']);
    expect(screen.isOpen).toBe(false);
  });
});

describe('WizardScreen: overlay and break bubble', () => {
  it('pauses the game while open (onOpenChange) and swallows pointer events', () => {
    const { screen, counts, root } = setup();
    screen.open();
    expect(counts.open).toEqual([true]);
    let reached = false;
    document.body.addEventListener('pointerdown', () => { reached = true; });
    root.querySelector('.wiz-card')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(reached).toBe(false);
  });

  it('with the break bubble up the wizard says nothing, and the screen keeps working', () => {
    const { screen, root, bag, said, state } = setup({ breakOpen: () => true });
    screen.open();
    cards(root)[0].click();
    expect(state.gift).toBe(true);
    expect(total(bag)).toBe(1);
    expect(said).toEqual([]);
  });

  it('a random clicker always finishes (and nothing he holds is lost)', () => {
    const state = newWizardState();
    state.gift = true;
    const { screen, root, bag } = setup({ state });
    bag.add(BlockId.Planks, 10);
    screen.open();
    const rng = mulberry32(99);
    let solves = 0;
    for (let step = 0; step < 3000; step++) {
      const before = state.solved;
      const targets = [...root.querySelectorAll<HTMLButtonElement>('.wiz-option:not(.faded), .wiz-shelf-item, .wiz-item:not(.ghost)')];
      if (targets.length) targets[Math.floor(rng() * targets.length)].click();
      screen.update(rng() * 2);
      if (state.solved > before) solves++;
    }
    expect(solves).toBeGreaterThan(20);
    expect(bag.count(BlockId.Planks)).toBe(10);
  });
});

describe('WizardScreen: the opening tap', () => {
  it('the browser click that echoes the tap on Orlo never chooses a card; a real tap a moment later does', () => {
    let clock = 10_000;
    const { screen, root, bag, state } = setup({ now: () => clock });
    screen.open();
    clock += 120; // the opening tap's own click, at the same spot
    cards(root)[4].click();
    expect(state.gift).toBe(false);
    expect(total(bag)).toBe(0);
    clock += 1000; // he looks, then chooses
    cards(root)[4].click();
    expect(state.gift).toBe(true);
    expect(total(bag)).toBe(1);
  });
});
