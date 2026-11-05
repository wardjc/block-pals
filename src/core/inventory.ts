import { BLOCKS, BlockId } from './blocks';

export const MAX_STACK = 20;

function validId(id: number): id is BlockId {
  return Number.isInteger(id) && Object.hasOwn(BLOCKS, id) && id !== BlockId.Air && id !== BlockId.Bedrock;
}

function validQuantity(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export class Inventory {
  // Keep depleted stacks to preserve their first-collected order.
  private readonly counts = new Map<BlockId, number>();
  private rev = 0;

  /** Bumped on every count change, so the HUD redraws only when needed. */
  get revision(): number {
    return this.rev;
  }

  count(id: BlockId): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: BlockId, n = 1): number {
    if (!validId(id) || !validQuantity(n)) return 0;
    const added = Math.min(n, MAX_STACK - this.count(id));
    if (added > 0) {
      this.counts.set(id, this.count(id) + added);
      this.rev++;
    }
    return added;
  }

  remove(id: BlockId, n = 1): boolean {
    if (!validId(id) || !validQuantity(n) || this.count(id) < n) return false;
    if (n > 0) {
      this.counts.set(id, this.count(id) - n);
      this.rev++;
    }
    return true;
  }

  /** Every held kind (at most 9 exist), in stable first-collected order. */
  hotbar(): BlockId[] {
    return [...this.counts]
      .filter(([, n]) => n > 0)
      .map(([id]) => id);
  }

  /** Every kind ever held this session, emptied ones included, in first-collected order. */
  order(): BlockId[] {
    return [...this.counts.keys()];
  }

  toJSON(): Record<number, number> {
    return Object.fromEntries([...this.counts].filter(([, n]) => n > 0));
  }

  /** True for a list of distinct valid ids: the saved hotbar order. */
  static validOrder(order: unknown): order is BlockId[] {
    return Array.isArray(order) && new Set(order).size === order.length
      && order.every(id => typeof id === 'number' && validId(id));
  }

  /** `order` (optional, from newer saves) restores the hotbar order; without it kinds go in id order. */
  static fromJSON(o: unknown, order?: unknown): Inventory {
    const inv = new Inventory();
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return inv;
    const prototype = Object.getPrototypeOf(o);
    if (prototype !== Object.prototype && prototype !== null) return inv;
    const entries = Object.entries(o);
    if (entries.some(([key, n]) => {
      const id = Number(key);
      return !validId(id) || String(id) !== key
        || typeof n !== 'number' || !validQuantity(n) || n > MAX_STACK;
    })) return inv;
    if (Inventory.validOrder(order)) {
      for (const id of order) inv.counts.set(id, (o as Record<number, number>)[id] ?? 0);
    }
    for (const [key, n] of entries) if (!inv.counts.has(Number(key))) inv.add(Number(key) as BlockId, n);
    return inv;
  }
}
