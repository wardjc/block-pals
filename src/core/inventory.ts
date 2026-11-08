import { BlockId, isCarriable } from './blocks';
import { isItemId, isStackId, type StackId } from './items';

/** Most of one kind the bag holds (v1.1: raised from 20, spec §7a). Recipes and prices never ask for more than 20. */
export const MAX_STACK = 99;

function validBlockId(id: number): id is BlockId {
  return isCarriable(id);
}

function validQuantity(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export class Inventory {
  // Keep depleted stacks to preserve their first-collected order.
  private readonly counts = new Map<StackId, number>();
  private rev = 0;

  /** Bumped on every count change, so the HUD redraws only when needed. */
  get revision(): number {
    return this.rev;
  }

  count(id: StackId): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: StackId, n = 1): number {
    if (!isStackId(id) || !validQuantity(n)) return 0;
    const added = Math.min(n, MAX_STACK - this.count(id));
    if (added > 0) {
      this.counts.set(id, this.count(id) + added);
      this.rev++;
    }
    return added;
  }

  remove(id: StackId, n = 1): boolean {
    if (!isStackId(id) || !validQuantity(n) || this.count(id) < n) return false;
    if (n > 0) {
      this.counts.set(id, this.count(id) - n);
      this.rev++;
    }
    return true;
  }

  /** Every held block kind, in stable first-collected order. Blocks only: items are in slots(). */
  hotbar(): BlockId[] {
    return [...this.counts]
      .filter(([id, n]) => n > 0 && !isItemId(id))
      .map(([id]) => id as BlockId);
  }

  /** Every held stack: blocks first, then items, each in first-obtained order. */
  slots(): StackId[] {
    const held = [...this.counts].filter(([, n]) => n > 0).map(([id]) => id);
    return [...held.filter(id => !isItemId(id)), ...held.filter(isItemId)];
  }

  /** Every block kind ever held this session, emptied ones included, in first-collected order. */
  order(): BlockId[] {
    return [...this.counts.keys()].filter((id): id is BlockId => !isItemId(id));
  }

  /** Every item kind ever held this session, emptied ones included, in first-obtained order. */
  itemOrder(): number[] {
    return [...this.counts.keys()].filter(isItemId);
  }

  /** Block kinds only, so the saved `inventory` field stays what step 1 wrote. */
  toJSON(): Record<number, number> {
    return Object.fromEntries([...this.counts].filter(([id, n]) => n > 0 && !isItemId(id)));
  }

  /** Item kinds only (the saved `items` field). */
  itemsToJSON(): Record<number, number> {
    return Object.fromEntries([...this.counts].filter(([id, n]) => n > 0 && isItemId(id)));
  }

  /** True for a list of distinct valid ids: the saved hotbar order. */
  static validOrder(order: unknown): order is BlockId[] {
    return Array.isArray(order) && new Set(order).size === order.length
      && order.every(id => typeof id === 'number' && validBlockId(id));
  }

  /** `order` (optional, from newer saves) restores the hotbar order; without it kinds go in id order. */
  static fromJSON(o: unknown, order?: unknown, items?: unknown, itemOrder?: unknown): Inventory {
    const inv = new Inventory();
    inv.restoreBlocks(o, order);
    inv.restoreItems(items, itemOrder);
    return inv;
  }

  /** A damaged block bag is dropped whole (as in step 1); items are read separately and never lost with it. */
  private restoreBlocks(o: unknown, order: unknown): void {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return;
    const prototype = Object.getPrototypeOf(o);
    if (prototype !== Object.prototype && prototype !== null) return;
    const entries = Object.entries(o);
    if (entries.some(([key, n]) => {
      const id = Number(key);
      return !validBlockId(id) || String(id) !== key
        || typeof n !== 'number' || !validQuantity(n) || n > MAX_STACK;
    })) return;
    if (Inventory.validOrder(order)) {
      for (const id of order) this.counts.set(id, (o as Record<number, number>)[id] ?? 0);
    }
    for (const [key, n] of entries) if (!this.counts.has(Number(key))) this.add(Number(key) as BlockId, n);
  }

  /** Items are read entry by entry: a bad id or count is skipped and never touches blocks or other items. */
  private restoreItems(items: unknown, itemOrder?: unknown): void {
    const valid = new Map<number, number>();
    if (items !== null && typeof items === 'object' && !Array.isArray(items)) {
      for (const [key, n] of Object.entries(items)) {
        const id = Number(key);
        if (String(id) === key && isItemId(id) && typeof n === 'number' && validQuantity(n) && n <= MAX_STACK) valid.set(id, n);
      }
    }
    if (Array.isArray(itemOrder)) {
      for (const id of itemOrder) {
        if (typeof id === 'number' && isItemId(id) && !this.counts.has(id) && valid.has(id)) {
          this.counts.set(id, valid.get(id)!);
          valid.delete(id);
        } else if (typeof id === 'number' && isItemId(id) && !this.counts.has(id)) {
          this.counts.set(id, 0); // emptied earlier, keeps its place
        }
      }
    }
    for (const [id, n] of valid) if (!this.counts.has(id)) this.counts.set(id, n);
    this.rev++;
  }
}
