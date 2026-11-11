import { MAX_STACK } from '../core/inventory';
import { BUNDLE, MYTHICAL, PRICE } from '../core/mythical';

/**
 * The wizard's trades (spec §7g): gems for bundles of mythical blocks, the one free welcome block,
 * and the block a solved puzzle gives. Pure. Everything is all or nothing: if the blocks would not
 * fit (a stack past 99), nothing is spent and nothing changes. Only gems are ever taken.
 */

/** The part of the bag the wizard uses. The real `Inventory` fits it. */
export interface Bag {
  count(id: number): number;
  /** Returns how many were actually added (a stack never passes 99). */
  add(id: number, n?: number): number;
  remove(id: number, n?: number): boolean;
}

/** What the wizard sells: his eight blocks in their fixed order, their prices, the bundle size and the gem id. */
export interface WizardStock {
  order: readonly number[];
  price: Readonly<Record<number, 1 | 2>>;
  bundle: number;
  gem: number;
}

/** The gem item is added by the grumps step (`ItemId.Gem = 123`); the blocks come from `src/core/mythical.ts`. */
export const WIZARD_STOCK: WizardStock = {
  order: MYTHICAL,
  price: PRICE,
  bundle: BUNDLE,
  gem: 123,
};

export type TradeResult =
  | { ok: true; got: number; spent: number }
  | { ok: false; why: 'needGem' | 'bagFull' | 'unknown' | 'given' };

/** What the save keeps about the wizard (Task 9 validates it). */
export interface WizardState {
  gift: boolean;
  met: boolean;
  led: boolean;
  solved: number;
  clean: number;
  bought: number;
  hints: string[];
}

export const newWizardState = (): WizardState => ({
  gift: false, met: false, led: false, solved: 0, clean: 0, bought: 0, hints: [],
});

const sells = (stock: WizardStock, kind: number): boolean => Number.isInteger(kind) && stock.order.includes(kind);

/** Room for `n` more of `kind` without passing 99. */
const fits = (inv: Bag, kind: number, n: number): boolean => inv.count(kind) + n <= MAX_STACK;

/** Whether a bundle of `kind` can be bought now. Changes nothing. */
export function canBuy(inv: Bag, kind: number, stock: WizardStock = WIZARD_STOCK): TradeResult {
  if (!sells(stock, kind)) return { ok: false, why: 'unknown' };
  const price = stock.price[kind]!;
  if (inv.count(stock.gem) < price) return { ok: false, why: 'needGem' };
  if (!fits(inv, kind, stock.bundle)) return { ok: false, why: 'bagFull' };
  return { ok: true, got: stock.bundle, spent: price };
}

/** PRICE gems for BUNDLE blocks of `kind`, all or nothing. Counts the purchase in `wizard.bought` if given. */
export function buy(inv: Bag, kind: number, wizard?: WizardState, stock: WizardStock = WIZARD_STOCK): TradeResult {
  const check = canBuy(inv, kind, stock);
  if (!check.ok) return check;
  if (!inv.remove(stock.gem, check.spent)) return { ok: false, why: 'needGem' };
  const got = inv.add(kind, check.got);
  if (got !== check.got) {
    // The bag would not take the whole bundle: put everything back as it was.
    if (got > 0) inv.remove(kind, got);
    inv.add(stock.gem, check.spent);
    return { ok: false, why: 'bagFull' };
  }
  if (wizard) wizard.bought = safeCount(wizard.bought) + 1;
  return check;
}

/** The welcome gift: one block of his choice, once. The flag is set only when the block arrived. */
export function claimGift(inv: Bag, kind: number, wizard: WizardState, stock: WizardStock = WIZARD_STOCK): TradeResult {
  if (!sells(stock, kind)) return { ok: false, why: 'unknown' };
  if (wizard.gift) return { ok: false, why: 'given' };
  if (!fits(inv, kind, 1) || inv.add(kind, 1) !== 1) return { ok: false, why: 'bagFull' };
  wizard.gift = true;
  return { ok: true, got: 1, spent: 0 };
}

/**
 * The kind he holds fewest of (ties in the fixed order), skipping full stacks; null when every
 * stack is full. So over time he collects all eight.
 */
export function rewardKind(held: (id: number) => number, stock: WizardStock = WIZARD_STOCK, cap = MAX_STACK): number | null {
  let best: number | null = null;
  let bestCount = Infinity;
  for (const id of stock.order) {
    const n = held(id);
    if (n < cap && n < bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/** A solved puzzle gives 1 block, the wizard's choice. If every stack is full there is no block (the wizard still cheers). */
export function puzzleReward(inv: Bag, stock: WizardStock = WIZARD_STOCK): { kind: number; n: 1 } | null {
  const kind = rewardKind(id => inv.count(id), stock);
  if (kind === null || inv.add(kind, 1) !== 1) return null;
  return { kind, n: 1 };
}

/** A counter from the save, or 0 if it is damaged. */
function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** A solve always counts; a clean one also counts towards the level (which comes from `clean`, so it only rises). */
export function recordSolve(w: WizardState, session: { clean(): boolean }): void {
  w.solved = safeCount(w.solved) + 1;
  w.clean = safeCount(w.clean) + (session.clean() ? 1 : 0);
}
