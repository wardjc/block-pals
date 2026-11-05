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

  count(id: BlockId): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: BlockId, n = 1): number {
    if (!validId(id) || !validQuantity(n)) return 0;
    const added = Math.min(n, MAX_STACK - this.count(id));
    if (added > 0) this.counts.set(id, this.count(id) + added);
    return added;
  }

  remove(id: BlockId, n = 1): boolean {
    if (!validId(id) || !validQuantity(n) || this.count(id) < n) return false;
    if (n > 0) this.counts.set(id, this.count(id) - n);
    return true;
  }

  hotbar(): BlockId[] {
    return [...this.counts]
      .filter(([, n]) => n > 0)
      .slice(0, 6)
      .map(([id]) => id);
  }

  toJSON(): Record<number, number> {
    return Object.fromEntries([...this.counts].filter(([, n]) => n > 0));
  }

  static fromJSON(o: unknown): Inventory {
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
    for (const [key, n] of entries) inv.add(Number(key) as BlockId, n);
    return inv;
  }
}
