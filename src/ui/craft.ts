import { canCraft } from '../core/crafting';
import type { Inventory } from '../core/inventory';
import { stackName, type StackId } from '../core/items';
import { RECIPES, type Recipe } from '../core/recipes';
import type { Action } from '../input/mapping';
import { createDebouncer } from '../input/tap';
import { stackPicture } from './picture';

export interface CraftRow {
  recipe: Recipe;
  can: boolean;
  missing: StackId[];
}

/** Pure view model: which recipes can be made, and which inputs are short. */
export function craftRows(inv: Inventory): CraftRow[] {
  return RECIPES.map(recipe => ({
    recipe,
    can: canCraft(inv, recipe),
    missing: recipe.inputs.filter(i => inv.count(i.id) < i.n).map(i => i.id),
  }));
}

export interface CraftDeps {
  inventory: Inventory;
  tryCraft(recipeId: string): boolean;
  iconFor(id: StackId): string;
  say(text: string): void;
  /** Speaks a 'craftNeedMore' line. */
  sayNeedMore(): void;
  /** Speaks a 'full' line (output stack is full). */
  sayFull?(): void;
  /** Clock in ms; injectable for tests. */
  now?: () => number;
  sfxTap(): void;
  sfxCraft(): void;
  onOpenChange(open: boolean): void;
}

const MAX_DOTS = 20;

export class CraftScreen {
  private readonly el = document.createElement('div');
  private readonly list = document.createElement('div');
  private open_ = false;
  private selected = 0;
  private padX = 0;
  private readonly allow = createDebouncer(150);

  constructor(root: HTMLElement, private readonly deps: CraftDeps) {
    this.el.className = 'craft-screen';
    this.el.hidden = true;
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'])
      this.el.addEventListener(type, e => e.stopPropagation());
    this.list.className = 'craft-list' + (RECIPES.length > 4 ? ' dense' : '');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'craft-close';
    close.textContent = '✖';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    this.el.append(this.list, close);
    root.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.padX = 0;
    const firstCan = craftRows(this.deps.inventory).findIndex(r => r.can);
    this.selected = firstCan === -1 ? 0 : firstCan;
    this.el.hidden = false;
    this.render();
    this.deps.onOpenChange(true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.hidden = true;
    this.deps.onOpenChange(false);
  }

  /** Pad routing while open: left/right choose (edge-triggered), collect makes, place closes. */
  padInput(stick: [number, number], pressed: Action[]): void {
    const dir = stick[0] > 0.5 ? 1 : stick[0] < -0.5 ? -1 : 0;
    if (dir !== 0 && dir !== this.padX) {
      const n = RECIPES.length;
      this.selected = (this.selected + dir + n) % n;
      this.deps.sfxTap();
      this.refreshSelection();
    }
    this.padX = dir;
    for (const a of pressed) {
      if (a === 'collect') this.make(this.selected, 'craft:pad');
      else if (a === 'place') this.close();
    }
  }

  make(i: number, source = 'craft:tap'): void {
    const now = this.deps.now ? this.deps.now() : performance.now();
    if (!this.allow(source, now)) return;
    const row = craftRows(this.deps.inventory)[i];
    if (!row) return;
    if (!row.can) {
      if (row.missing.length === 0) {
        (this.deps.sayFull ?? this.deps.sayNeedMore)();
        this.pulse(i, [row.recipe.output.id]);
      } else {
        this.deps.sayNeedMore();
        this.pulse(i, row.missing);
      }
      return;
    }
    if (this.deps.tryCraft(row.recipe.id)) {
      this.deps.sfxCraft();
      this.render();
      this.list.children[i]?.classList.add('made');
    }
  }

  private pulse(i: number, missing: StackId[]): void {
    const rowEl = this.list.children[i];
    for (const id of missing)
      rowEl?.querySelectorAll<HTMLElement>(`[data-block="${id}"]`).forEach(item => {
        item.classList.remove('pulse');
        void item.offsetWidth;
        item.classList.add('pulse');
      });
  }

  private refreshSelection(): void {
    [...this.list.children].forEach((c, i) => c.classList.toggle('selected', i === this.selected));
    // The list scrolls on small screens: the chosen row must never sit out of sight.
    (this.list.children[this.selected] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }

  private item(id: StackId, n: number, have?: number): HTMLElement {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'craft-item';
    wrap.dataset.block = String(id);
    const img = stackPicture(id, this.deps.iconFor, 'craft-pic');
    const digit = document.createElement('span');
    digit.className = 'craft-digit';
    digit.textContent = String(n);
    const dots = document.createElement('span');
    dots.className = 'craft-dots';
    for (let d = 0; d < Math.min(n, MAX_DOTS); d++) {
      const dot = document.createElement('i');
      if (have !== undefined && d >= have) dot.className = 'short';
      dots.appendChild(dot);
    }
    wrap.append(img, digit, dots);
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      this.deps.sfxTap();
      const word = stackName(id);
      if (word) this.deps.say(word); // never speak an empty word for an unknown id
    });
    return wrap;
  }

  private sign(s: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'craft-sign';
    el.textContent = s;
    return el;
  }

  private render(): void {
    const keep = this.list.scrollTop; // a rebuild must not jump the list back to the top
    this.list.replaceChildren();
    craftRows(this.deps.inventory).forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'craft-row' + (row.can ? '' : ' dim');
      el.addEventListener('click', () => {
        this.selected = i;
        this.refreshSelection();
        if (!row.can) this.make(i);
      });
      row.recipe.inputs.forEach((inp, k) => {
        if (k > 0) el.appendChild(this.sign('+'));
        el.appendChild(this.item(inp.id, inp.n, this.deps.inventory.count(inp.id)));
      });
      el.appendChild(this.sign('='));
      el.appendChild(this.item(row.recipe.output.id, row.recipe.output.n));
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'craft-make';
      ok.textContent = '✔';
      ok.setAttribute('aria-label', 'Make');
      ok.addEventListener('click', e => {
        e.stopPropagation();
        this.selected = i;
        this.make(i);
      });
      el.appendChild(ok);
      this.list.appendChild(el);
    });
    this.list.scrollTop = keep;
    this.refreshSelection();
  }
}
