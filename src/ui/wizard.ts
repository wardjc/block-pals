import { levelFor, makePuzzle, type Puzzle, type Sym, type Thing } from '../core/puzzles';
import type { WizardKey } from '../content/wizard';
import type { Action } from '../input/mapping';
import { createDebouncer } from '../input/tap';
import { PuzzleSession, type HintLevel } from '../game/puzzleSession';
import {
  WIZARD_STOCK, buy, canBuy, claimGift, puzzleReward, recordSolve, type Bag, type WizardStock, type WizardState,
} from '../game/wizardTrade';

/**
 * Orlo's screen (spec §7g): a full-screen overlay like the craft screen. Pictures, digits and dots
 * only, a voice line for everything and a 🔊 to hear it again. Two tabs: 💎 trade (the welcome gift
 * the first time) and 🧩 puzzles. Nothing on it can be failed or lost: an unaffordable card only
 * gives a soft wobble and a kind word, a wrong card a wobble and "try again", the counting basket is
 * a game on the screen (never his bag), and in the end the wizard helps him through.
 */

/** Every touch target is at least this big (CSS px); the tabs and ✖ are bigger still. */
export const TARGET_MIN_PX = 88;
/** Sizes used by styles.css (the test reads both and checks they agree). */
export const WIZ_PX = { card: 150, tab: 120, close: 96, speak: 96, shelf: 112, option: 132, basketItem: 88 } as const;

export const THING_ICONS: Record<Thing, string> = { apple: '🍎', carrot: '🥕', potato: '🥔', wheat: '🌾', egg: '🥚' };
/** After a solve, the next puzzle comes after this pause (the hop, the sparkle and the line first). */
export const NEXT_PUZZLE_SECONDS = 2.2;
/** Pip's "you got a magic block" reaction is said at most this often. */
export const GOT_REACTION_SECONDS = 20;

export interface WizardSpeak {
  line(key: WizardKey): void;
  /** The counting sentence: a `countAsk` lead-in then the stitched numbers and things. */
  countSentence(p: Puzzle): void;
  again(): void;
}

export interface WizardDeps {
  /** Gems and blocks. The real Inventory fits. */
  inventory: Bag;
  state(): WizardState;
  save(): void;
  /** Atlas icon (frame 0) for a block id. */
  iconFor(id: number): string;
  /** Already behind wizardSpeech(): silent while the break bubble is up. */
  speak: WizardSpeak;
  /** Pip's puzzleStuck line, at most once per puzzle. */
  pipNudge(): void;
  /** Pip's gotMagicBlock reaction (the screen limits it to once per 20 s). */
  pipGot?(): void;
  rng: () => number;
  /** Clock in ms (debounce); injectable for tests. */
  now?: () => number;
  /** The wizard hops. */
  celebrate(): void;
  /** Pauses the game while open. */
  onOpenChange(open: boolean): void;
  sfx?: { tap(): void; gift(): void; nudge(): void; solved(): void };
  stock?: WizardStock;
}

type Tab = 'trade' | 'puzzle';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (cls: string, text?: string, label?: string): HTMLButtonElement => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

/** A digit with that many dots under it (at most 20), the way the craft screen shows counts. */
function countPicture(n: number, cls = 'wiz-count'): HTMLElement {
  const wrap = el('span', cls);
  wrap.append(el('span', 'wiz-digit', String(n)));
  const dots = el('span', 'wiz-dots');
  for (let i = 0; i < Math.min(20, n); i++) dots.appendChild(el('i', ''));
  wrap.appendChild(dots);
  return wrap;
}

/** A shape drawn in CSS (no emoji font needed). `outline` draws the grey silhouette of the shape. */
export function symbolPicture(s: Sym, outline = false, cls = 'wiz-sym'): HTMLElement {
  const e = el('span', `${cls} shape-${s.shape} ${outline ? 'outline' : `col-${s.colour}`}`);
  e.dataset.shape = s.shape;
  if (!outline) e.dataset.colour = s.colour;
  return e;
}

export class WizardScreen {
  private readonly root = el('div', 'wizard-screen');
  private readonly tabs = el('div', 'wiz-tabs');
  private readonly tradeTab = button('wiz-tab', '💎', 'Trade');
  private readonly puzzleTab = button('wiz-tab', '🧩', 'Puzzle');
  private readonly gems = el('span', 'wiz-gems');
  private readonly body = el('div', 'wiz-body');
  private open_ = false;
  private tab_: Tab = 'trade';
  private sessionNow: PuzzleSession | null = null;
  private last: Puzzle | undefined;
  private beforeLast: Puzzle | undefined;
  private shownHint: HintLevel = 0;
  private nudged = false;
  private nextIn = 0;
  private sinceGot = Infinity;
  private focus = 0;
  private padX = 0;
  private padY = 0;
  private padUsed = false;
  private readonly allow = createDebouncer(150);
  private readonly stock: WizardStock;

  constructor(host: HTMLElement, private readonly deps: WizardDeps) {
    this.stock = deps.stock ?? WIZARD_STOCK;
    this.root.hidden = true;
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'])
      this.root.addEventListener(type, e => e.stopPropagation());
    const head = el('div', 'wiz-head');
    const orlo = button('wiz-orlo', '🧙', 'Orlo');
    orlo.appendChild(el('span', 'wiz-glim', '✨'));
    orlo.addEventListener('click', () => this.deps.speak.again());
    const speak = button('wiz-speak', '🔊', 'Again');
    speak.addEventListener('click', () => this.repeat());
    this.tradeTab.addEventListener('click', () => this.tab('trade'));
    this.puzzleTab.addEventListener('click', () => this.tab('puzzle'));
    this.tradeTab.dataset.tab = 'trade';
    this.puzzleTab.dataset.tab = 'puzzle';
    this.tabs.append(this.tradeTab, this.puzzleTab);
    head.append(orlo, speak, this.tabs, this.gems);
    const close = button('wiz-close', '✖', 'Close');
    close.addEventListener('click', () => this.close());
    this.root.append(head, this.body, close);
    host.appendChild(this.root);
  }

  get isOpen(): boolean { return this.open_; }
  get currentTab(): Tab { return this.tab_; }
  /** The puzzle being played (debug and tests), or null. */
  get session(): PuzzleSession | null { return this.sessionNow; }
  get element(): HTMLElement { return this.root; }

  private now(): number { return this.deps.now ? this.deps.now() : performance.now(); }
  private gemCount(): number { return this.deps.inventory.count(this.stock.gem); }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.root.hidden = false;
    this.deps.onOpenChange(true);
    // The gift is the first thing he sees; with no gem (and the gift had) the puzzles are more use.
    const s = this.deps.state();
    this.tab(s.gift && this.gemCount() === 0 ? 'puzzle' : 'trade', true);
  }

  /** Closing mid-puzzle just drops it: nothing was at stake, so nothing changes. */
  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.sessionNow = null;
    this.nextIn = 0;
    this.deps.speak.line('bye');
    this.deps.onOpenChange(false);
  }

  tab(t: Tab, force = false): void {
    if (!this.open_ || (!force && t === this.tab_ && (t === 'trade' || this.sessionNow))) return;
    this.tab_ = t;
    this.focus = 0;
    this.tradeTab.classList.toggle('on', t === 'trade');
    this.puzzleTab.classList.toggle('on', t === 'puzzle');
    this.puzzleTab.classList.remove('pulse');
    if (t === 'trade') {
      this.sessionNow = null;
      this.nextIn = 0;
      this.deps.speak.line(this.deps.state().gift ? 'tradeAsk' : 'welcomeGift');
      this.render();
    } else {
      this.newPuzzle();
    }
  }

  /** Drives the hint clock. `dt` is 0 while the break bubble is up (and nothing then changes). */
  update(dt: number): void {
    if (!this.open_ || !(dt > 0)) return;
    this.sinceGot += dt;
    if (this.nextIn > 0) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) { this.nextIn = 0; this.newPuzzle(); }
      return;
    }
    const s = this.sessionNow;
    if (!s || s.solved) return;
    const before = `${s.hint()}:${s.faded.size}`;
    s.update(dt);
    // Redrawn only when something shows differently (a rebuild under his finger would lose the tap).
    if (s.solved || `${s.hint()}:${s.faded.size}` !== before) this.afterMove();
  }

  // ---- trade ----

  private renderTrade(): void {
    const s = this.deps.state();
    const grid = el('div', 'wiz-grid');
    this.stock.order.forEach(kind => {
      const card = button('wiz-card');
      card.dataset.kind = String(kind);
      const pic = el('span', 'wiz-block');
      const img = el('img', 'wiz-block-img');
      img.src = this.deps.iconFor(kind);
      img.alt = '';
      img.draggable = false;
      pic.appendChild(img);
      card.appendChild(pic);
      if (!s.gift) {
        card.classList.add('gift', 'can');
        card.appendChild(el('span', 'wiz-gift', '🎁'));
      } else {
        const price = this.stock.price[kind] ?? 1;
        const row = el('span', 'wiz-price');
        row.append(el('span', 'wiz-gem', '💎'), countPicture(price));
        const bundle = el('span', 'wiz-bundle');
        bundle.append(el('span', 'wiz-times', '×'), countPicture(this.stock.bundle));
        card.append(row, bundle);
        if (canBuy(this.deps.inventory, kind, this.stock).ok) card.classList.add('can');
      }
      card.addEventListener('click', () => this.choose(kind, card));
      grid.appendChild(card);
    });
    this.body.replaceChildren(grid);
  }

  /** A card was chosen: the gift, a purchase, or a gentle "not yet". */
  choose(kind: number, card?: HTMLElement): void {
    if (!this.open_ || this.tab_ !== 'trade') return;
    if (!this.allow(`card${kind}`, this.now())) return;
    this.deps.sfx?.tap();
    const w = this.deps.state();
    const target = card ?? this.body.querySelector<HTMLElement>(`[data-kind="${kind}"]`) ?? undefined;
    if (!w.gift) {
      const r = claimGift(this.deps.inventory, kind, w, this.stock);
      if (r.ok) {
        this.deps.save();
        this.gotBlock(kind, target);
        this.deps.speak.line('tradeAsk');
        this.render();
      } else {
        this.wobble(target);
        this.deps.speak.line('bagFull');
      }
      return;
    }
    const r = buy(this.deps.inventory, kind, w, this.stock);
    if (r.ok) {
      this.deps.save();
      this.gotBlock(kind, target);
      this.deps.speak.line('bought');
      this.render();
      return;
    }
    this.wobble(target);
    if (r.why === 'needGem') {
      this.deps.speak.line('needGem');
      this.pulse(this.puzzleTab);
    } else {
      this.deps.speak.line('bagFull');
    }
  }

  // ---- puzzles ----

  private newPuzzle(): void {
    const level = levelFor(this.deps.state().clean);
    const p = makePuzzle(level, this.deps.rng, this.last, this.beforeLast);
    this.beforeLast = this.last;
    this.last = p;
    this.sessionNow = new PuzzleSession(p);
    this.shownHint = 0;
    this.nudged = false;
    this.focus = 0;
    this.render();
    this.sayPuzzle();
  }

  private sayPuzzle(): void {
    const p = this.sessionNow?.puzzle;
    if (!p) return;
    if (p.kind === 'count') this.deps.speak.countSentence(p);
    else this.deps.speak.line(p.kind === 'pattern' ? 'patternAsk' : 'matchAsk');
  }

  private repeat(): void {
    if (this.tab_ === 'puzzle' && this.sessionNow && !this.sessionNow.solved) this.sayPuzzle();
    else this.deps.speak.again();
  }

  /** Pattern and matching: a card is chosen. */
  pick(i: number): void {
    const s = this.sessionNow;
    if (!s || s.solved || !this.allow(`opt${i}`, this.now())) return;
    this.deps.sfx?.tap();
    const r = s.pick(i);
    if (r === 'wrong') {
      this.deps.sfx?.nudge();
      this.deps.speak.line('tryAgain');
      this.afterMove();
      this.wobble(this.body.querySelector<HTMLElement>(`[data-option="${i}"]`) ?? undefined);
      return;
    }
    this.afterMove();
  }

  /** Counting: a picture from the shelf goes into the basket. */
  add(thing: Thing): void {
    const s = this.sessionNow;
    if (!s || s.solved || s.puzzle.kind !== 'count' || !this.allow(`add${thing}`, this.now())) return;
    this.deps.sfx?.tap();
    s.add(thing);
    this.afterMove();
  }

  /** Counting: a picture in the basket goes back to the shelf. */
  take(thing: Thing): void {
    const s = this.sessionNow;
    if (!s || s.solved || s.puzzle.kind !== 'count' || !this.allow(`take${thing}`, this.now())) return;
    this.deps.sfx?.tap();
    s.take(thing);
    this.afterMove();
  }

  /** After any move or tick: hints that just arrived, a solve, and the redraw. */
  private afterMove(): void {
    const s = this.sessionNow;
    if (!s) return;
    if (s.solved) { this.solved(s); return; }
    const h = s.hint();
    if (h > this.shownHint) {
      if (h >= 1 && this.shownHint < 1) this.deps.speak.line('hint1');
      if (h >= 2 && !this.nudged) { this.nudged = true; this.deps.pipNudge(); }
      this.shownHint = h;
    }
    this.render();
  }

  private solved(s: PuzzleSession): void {
    if (this.nextIn > 0) return;
    const w = this.deps.state();
    recordSolve(w, s);
    const reward = puzzleReward(this.deps.inventory, this.stock);
    this.deps.save();
    this.deps.celebrate();
    this.deps.sfx?.solved();
    this.deps.speak.line(s.helped ? 'helped' : 'solved');
    this.render();
    this.body.classList.remove('sparkle');
    void this.body.offsetWidth;
    this.body.classList.add('sparkle');
    if (reward) this.gotBlock(reward.kind, this.body.querySelector<HTMLElement>('.wiz-puzzle') ?? undefined);
    this.nextIn = NEXT_PUZZLE_SECONDS;
  }

  private renderPuzzle(): void {
    const s = this.sessionNow;
    if (!s) { this.body.replaceChildren(); return; }
    const p = s.puzzle;
    const card = el('div', `wiz-puzzle kind-${p.kind}${s.solved ? ' done' : ''}`);
    const h = s.hint();
    if (p.kind === 'count') {
      const ask = button('wiz-ask');
      for (const want of p.wants) {
        const w = el('span', 'wiz-want');
        w.append(el('span', 'wiz-thing', THING_ICONS[want.thing]), countPicture(want.n));
        ask.appendChild(w);
      }
      ask.addEventListener('click', () => this.sayPuzzle());
      const basket = el('div', 'wiz-basket');
      basket.appendChild(el('span', 'wiz-basket-icon', '🧺'));
      const items = el('div', 'wiz-basket-items');
      for (const thing of Object.keys(THING_ICONS) as Thing[]) {
        for (let i = 0; i < s.basket[thing]; i++) {
          const b = button('wiz-item', THING_ICONS[thing]);
          b.dataset.take = thing;
          b.addEventListener('click', () => this.take(thing));
          items.appendChild(b);
        }
      }
      for (const g of s.ghost()) {
        for (let i = 0; i < g.missing; i++) {
          const ghost = el('span', 'wiz-item ghost', THING_ICONS[g.thing]);
          ghost.dataset.ghost = g.thing;
          items.appendChild(ghost);
        }
      }
      basket.appendChild(items);
      const shelf = el('div', 'wiz-shelf');
      const glow = h >= 1 && !s.solved ? s.nextNeeded() : null;
      for (const thing of p.shelf) {
        const b = button(`wiz-shelf-item${glow === thing ? ' glow' : ''}`, THING_ICONS[thing]);
        b.dataset.add = thing;
        b.addEventListener('click', () => this.add(thing));
        shelf.appendChild(b);
      }
      card.append(ask, basket, shelf);
    } else {
      const ask = button('wiz-ask');
      if (p.kind === 'pattern') {
        for (const sym of p.seq) ask.appendChild(symbolPicture(sym));
        ask.appendChild(el('span', 'wiz-sym wiz-q', s.solved ? '' : '?'));
        if (s.solved) ask.lastElementChild!.replaceWith(symbolPicture(p.options[p.answer]!));
      } else {
        ask.appendChild(symbolPicture(p.target, p.mode === 'outline', 'wiz-sym big'));
      }
      ask.addEventListener('click', () => this.sayPuzzle());
      const opts = el('div', 'wiz-options');
      p.options.forEach((sym, i) => {
        const b = button('wiz-option');
        b.dataset.option = String(i);
        if (s.faded.has(i)) { b.classList.add('faded'); b.disabled = true; }
        if (h >= 1 && i === p.answer) b.classList.add('glow');
        if (s.solved && i === p.answer) b.classList.add('right');
        b.appendChild(symbolPicture(sym));
        b.addEventListener('click', () => this.pick(i));
        opts.appendChild(b);
      });
      card.append(ask, opts);
    }
    this.body.replaceChildren(card);
  }

  private render(): void {
    this.gems.replaceChildren(el('span', 'wiz-gem', '💎'), el('span', 'wiz-digit', String(this.gemCount())));
    this.body.classList.remove('sparkle');
    if (this.tab_ === 'trade') this.renderTrade();
    else this.renderPuzzle();
    this.refreshFocus();
  }

  // ---- little animations ----

  private gotBlock(kind: number, from?: HTMLElement): void {
    this.deps.sfx?.gift();
    if (this.sinceGot >= GOT_REACTION_SECONDS) { this.sinceGot = 0; this.deps.pipGot?.(); }
    const fly = el('img', 'wiz-fly');
    fly.src = this.deps.iconFor(kind);
    fly.alt = '';
    const r = from?.getBoundingClientRect();
    if (r) { fly.style.left = `${r.left + r.width / 2 - 40}px`; fly.style.top = `${r.top + r.height / 2 - 40}px`; }
    this.root.appendChild(fly);
    setTimeout(() => fly.remove(), 1000);
  }

  private wobble(e?: HTMLElement): void {
    if (!e) return;
    e.classList.remove('wobble');
    void e.offsetWidth;
    e.classList.add('wobble');
  }

  private pulse(e: HTMLElement): void {
    e.classList.remove('pulse');
    void e.offsetWidth;
    e.classList.add('pulse');
  }

  // ---- the controller ----

  private targets(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('.wiz-tab, .wiz-card, .wiz-shelf-item, .wiz-item:not(.ghost), .wiz-option:not(.faded), .wiz-close')];
  }

  private refreshFocus(): void {
    const t = this.targets();
    if (t.length === 0) return;
    this.focus = Math.max(0, Math.min(t.length - 1, this.focus));
    // The ring only shows once the controller is used, so it never looks like a second chosen tab.
    t.forEach((e, i) => e.classList.toggle('focus', this.padUsed && i === this.focus));
  }

  padMove(dx: number, dy: number): void {
    const t = this.targets();
    if (t.length === 0) return;
    this.padUsed = true;
    const step = dx + dy * (this.tab_ === 'trade' ? 4 : 1);
    this.focus = (this.focus + step + t.length * 4) % t.length;
    this.deps.sfx?.tap();
    this.refreshFocus();
  }

  padSelect(): void {
    this.targets()[this.focus]?.click();
  }

  /** Pad routing while open, like the craft screen: the stick moves (edge-triggered), collect chooses, place closes. */
  padInput(stick: [number, number], pressed: Action[]): void {
    const dx = stick[0] > 0.5 ? 1 : stick[0] < -0.5 ? -1 : 0;
    const dy = stick[1] > 0.5 ? 1 : stick[1] < -0.5 ? -1 : 0;
    if (dx !== 0 && dx !== this.padX) this.padMove(dx, 0);
    if (dy !== 0 && dy !== this.padY) this.padMove(0, dy);
    this.padX = dx;
    this.padY = dy;
    for (const a of pressed) {
      if (a === 'collect') this.padSelect();
      else if (a === 'place') this.close();
    }
  }
}
